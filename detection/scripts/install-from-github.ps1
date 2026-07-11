#Requires -Version 5.1
<#
.SYNOPSIS
  One-shot No3 Darts camera detector install for Windows mini PCs.

.DESCRIPTION
  Clones/updates the GitHub repo, creates a Python venv, installs OpenCV + deps,
  writes config.yaml, and optionally calibrates later.

  Run from PowerShell (as a normal user is fine):

    # One-liner after the repo is public/private with your access:
    irm https://raw.githubusercontent.com/No3BeerBar/no3-darts/main/detection/scripts/install-from-github.ps1 | iex

    # Or download and run:
    powershell -ExecutionPolicy Bypass -File install-from-github.ps1

.PARAMETER RepoUrl
  Git clone URL (default: No3BeerBar/no3-darts)

.PARAMETER InstallDir
  Where to put the repo (default: C:\No3Darts)

.PARAMETER ApiUrl
  Your Railway (or local) No3 Darts base URL

.PARAMETER RoomId
  Room name matching the web app Admin setting

.PARAMETER CameraApiKey
  Optional; must match Railway CAMERA_API_KEY if set
#>

[CmdletBinding()]
param(
  [string]$RepoUrl = "https://github.com/No3BeerBar/no3-darts.git",
  [string]$InstallDir = "C:\No3Darts",
  [string]$ApiUrl = "",
  [string]$RoomId = "Board 1",
  [string]$CameraApiKey = "",
  [switch]$AutoInstall
)

$ErrorActionPreference = "Stop"
$RepoName = "no3-darts"
$RepoPath = Join-Path $InstallDir $RepoName
$DetectPath = Join-Path $RepoPath "detection"

function Write-Step($msg) {
  Write-Host ""
  Write-Host "==> $msg" -ForegroundColor Cyan
}

function Test-Command($name) {
  return [bool](Get-Command $name -ErrorAction SilentlyContinue)
}

function Refresh-Path {
  $machine = [Environment]::GetEnvironmentVariable("Path", "Machine")
  $user = [Environment]::GetEnvironmentVariable("Path", "User")
  $env:Path = "$machine;$user"
}

function Find-PythonExe {
  # Prefer real python.exe (not Windows Store stub)
  $candidates = @()

  if (Test-Command "py") {
    try {
      $fromPy = & py -3 -c "import sys; print(sys.executable)" 2>$null
      if ($fromPy -and (Test-Path $fromPy.Trim())) { $candidates += $fromPy.Trim() }
    } catch { }
  }

  if (Test-Command "python") {
    try {
      $fromPy = & python -c "import sys; print(sys.executable)" 2>$null
      if ($fromPy -and (Test-Path $fromPy.Trim())) {
        # Skip WindowsApps stub that just opens the Store
        if ($fromPy -notmatch "WindowsApps") { $candidates += $fromPy.Trim() }
      }
    } catch { }
  }

  $roots = @(
    "$env:LocalAppData\Programs\Python",
    "$env:ProgramFiles\Python312",
    "$env:ProgramFiles\Python311",
    "$env:ProgramFiles\Python310",
    "${env:ProgramFiles(x86)}\Python312",
    "${env:ProgramFiles(x86)}\Python311",
    "$env:UserProfile\AppData\Local\Programs\Python"
  )
  foreach ($root in $roots) {
    if (Test-Path $root) {
      Get-ChildItem -Path $root -Filter "python.exe" -Recurse -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -notmatch "WindowsApps" } |
        ForEach-Object { $candidates += $_.FullName }
    }
  }

  foreach ($c in $candidates) {
    try {
      $v = & $c --version 2>&1 | Out-String
      if ($v -match "Python 3\.(1[0-3]|[89])") {
        return $c
      }
      if ($v -match "Python 3\.") {
        return $c
      }
    } catch { }
  }
  return $null
}

function Install-Python {
  Write-Step "Installing Python 3.12"
  if (Test-Command "winget") {
    Write-Host "  Using winget…"
    winget install -e --id Python.Python.3.12 --scope user --accept-package-agreements --accept-source-agreements
    Refresh-Path
    Start-Sleep -Seconds 2
    Refresh-Path
    return
  }

  Write-Host "  winget not available — downloading official installer…" -ForegroundColor Yellow
  $installer = Join-Path $env:TEMP "python-3.12.8-amd64.exe"
  $url = "https://www.python.org/ftp/python/3.12.8/python-3.12.8-amd64.exe"
  Write-Host "  Downloading $url"
  Invoke-WebRequest -Uri $url -OutFile $installer -UseBasicParsing
  Write-Host "  Running installer (silent, adds PATH)…"
  $args = "/quiet InstallAllUsers=0 PrependPath=1 Include_test=0 Include_launcher=1"
  $p = Start-Process -FilePath $installer -ArgumentList $args -Wait -PassThru
  if ($p.ExitCode -ne 0 -and $p.ExitCode -ne 3010) {
    Write-Host "  Installer exit code: $($p.ExitCode)" -ForegroundColor Yellow
  }
  Refresh-Path
  Start-Sleep -Seconds 2
  Refresh-Path
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Yellow
Write-Host "  No3 Darts — Windows mini-PC installer" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow

# --- Python ---
Write-Step "Checking Python"
Refresh-Path
$pythonExe = Find-PythonExe

if (-not $pythonExe) {
  Write-Host "  Python not found on PATH." -ForegroundColor Yellow
  if ($AutoInstall) {
    Install-Python
  } else {
    $ans = Read-Host "Install Python 3.12 automatically now? [Y/n]"
    if ($ans -eq "" -or $ans -match '^[Yy]') {
      Install-Python
    } else {
      Write-Host ""
      Write-Host "Manual install:" -ForegroundColor Yellow
      Write-Host "  1. Open https://www.python.org/downloads/windows/"
      Write-Host "  2. Download Python 3.12 (64-bit)"
      Write-Host "  3. Run installer — CHECK 'Add python.exe to PATH'"
      Write-Host "  4. Close PowerShell, open a NEW one, re-run install"
      Write-Host ""
      Write-Host "Or run this installer with auto Python:" -ForegroundColor Cyan
      Write-Host '  irm https://raw.githubusercontent.com/No3BeerBar/no3-darts/main/detection/scripts/install-from-github.ps1 | iex'
      Write-Host "  (answer Y when asked to install Python)"
      exit 1
    }
  }

  Refresh-Path
  $pythonExe = Find-PythonExe
  if (-not $pythonExe) {
    Write-Host "  Still cannot find python.exe after install." -ForegroundColor Red
    Write-Host "  Close this PowerShell window completely, open a NEW one, and re-run the install command." -ForegroundColor Yellow
    exit 1
  }
}

$ver = & $pythonExe --version 2>&1
Write-Host "  Using: $pythonExe"
Write-Host "  Version: $ver"
$py = "`"$pythonExe`""

# --- Git ---
Write-Step "Checking Git"
if (-not (Test-Command "git")) {
  Write-Host "  Git not found." -ForegroundColor Red
  if (Test-Command "winget") {
    $ans = Read-Host "Install Git with winget now? [Y/n]"
    if ($ans -eq "" -or $ans -match '^[Yy]') {
      winget install -e --id Git.Git --accept-package-agreements --accept-source-agreements
      Write-Host "Close this window, open a NEW PowerShell, and re-run this script." -ForegroundColor Yellow
      exit 0
    }
  }
  Write-Host "Install Git from https://git-scm.com/download/win then re-run." -ForegroundColor Yellow
  exit 1
}
Write-Host "  Git OK"

# --- Clone / update ---
Write-Step "Installing repo to $RepoPath"
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

if (Test-Path (Join-Path $RepoPath ".git")) {
  Write-Host "  Existing clone found — pulling latest…"
  Push-Location $RepoPath
  git fetch --all
  git pull --ff-only origin main 2>$null
  if ($LASTEXITCODE -ne 0) {
    git pull --ff-only origin master 2>$null
  }
  Pop-Location
} else {
  if (Test-Path $RepoPath) {
    Write-Host "  Folder exists but is not a git repo. Remove or rename it and re-run." -ForegroundColor Red
    exit 1
  }
  git clone $RepoUrl $RepoPath
}

if (-not (Test-Path $DetectPath)) {
  Write-Host "  detection/ folder missing in repo." -ForegroundColor Red
  exit 1
}

# --- Venv + packages ---
Write-Step "Creating Python virtual environment"
Push-Location $DetectPath

if (-not (Test-Path ".venv")) {
  & $pythonExe -m venv .venv
}

$python = Join-Path $DetectPath ".venv\Scripts\python.exe"
$pip = Join-Path $DetectPath ".venv\Scripts\pip.exe"

if (-not (Test-Path $python)) {
  Write-Host "  venv python missing at $python" -ForegroundColor Red
  Write-Host "  Tried base interpreter: $pythonExe" -ForegroundColor Red
  Pop-Location
  exit 1
}

Write-Step "Installing Python packages (this can take a few minutes)"
& $python -m pip install --upgrade pip
& $pip install -r (Join-Path $DetectPath "requirements.txt")
# Prefer GUI OpenCV for calibrate + preview on Windows
& $pip uninstall -y opencv-python-headless 2>$null
& $pip install "opencv-python>=4.9.0"

# --- Config ---
Write-Step "Writing config.yaml"
$cfgPath = Join-Path $DetectPath "config.yaml"
$example = Join-Path $DetectPath "config.example.yaml"

if (-not $ApiUrl) {
  $ApiUrl = Read-Host "No3 Darts URL (e.g. https://your-app.up.railway.app)"
}
if (-not $ApiUrl) {
  $ApiUrl = "http://localhost:3000"
  Write-Host "  Using default $ApiUrl (edit config.yaml later)" -ForegroundColor Yellow
}
$ApiUrl = $ApiUrl.TrimEnd("/")

if (-not $RoomId) { $RoomId = "Board 1" }

$cfg = @"
# Generated by install-from-github.ps1 — edit as needed

no3_api_url: "$ApiUrl"
camera_api_key: "$CameraApiKey"
room_id: "$RoomId"

debounce_ms: 1200
min_confidence: 0.55
motion_threshold: 28
min_blob_area: 40
max_blob_area: 12000
settle_frames: 4

preview: true
dry_run: false

cameras:
  - id: cam0
    source: 0
    enabled: true
    calibration: "./calib/cam0.json"
  - id: cam1
    source: 1
    enabled: true
    calibration: "./calib/cam1.json"
  - id: cam2
    source: 2
    enabled: true
    calibration: "./calib/cam2.json"
"@

if (Test-Path $cfgPath) {
  $overwrite = Read-Host "config.yaml already exists. Overwrite? [y/N]"
  if ($overwrite -match '^[Yy]') {
    Set-Content -Path $cfgPath -Value $cfg -Encoding UTF8
    Write-Host "  Overwrote config.yaml"
  } else {
    Write-Host "  Kept existing config.yaml"
  }
} else {
  Set-Content -Path $cfgPath -Value $cfg -Encoding UTF8
  Write-Host "  Created config.yaml"
}

$calibDir = Join-Path $DetectPath "calib"
New-Item -ItemType Directory -Force -Path $calibDir | Out-Null

# --- Self-test ---
Write-Step "Running geometry self-test"
& $python -m no3_detect test-geometry
if ($LASTEXITCODE -ne 0) {
  Write-Host "  Self-test failed" -ForegroundColor Red
  Pop-Location
  exit 1
}

# --- Shortcuts ---
Write-Step "Creating desktop shortcuts"
$desktop = [Environment]::GetFolderPath("Desktop")
$wsh = New-Object -ComObject WScript.Shell

$runBat = Join-Path $DetectPath "scripts\run-detector.bat"
if (Test-Path $runBat) {
  $sc = $wsh.CreateShortcut((Join-Path $desktop "No3 Darts Detector.lnk"))
  $sc.TargetPath = $runBat
  $sc.WorkingDirectory = $DetectPath
  $sc.Description = "Start No3 camera detector"
  $sc.Save()
  Write-Host "  Desktop: No3 Darts Detector.lnk"
}

$calBat = Join-Path $DetectPath "scripts\calibrate-all.bat"
if (Test-Path $calBat) {
  $sc2 = $wsh.CreateShortcut((Join-Path $desktop "No3 Calibrate Cameras.lnk"))
  $sc2.TargetPath = $calBat
  $sc2.WorkingDirectory = $DetectPath
  $sc2.Description = "Calibrate all three cameras"
  $sc2.Save()
  Write-Host "  Desktop: No3 Calibrate Cameras.lnk"
}

Pop-Location

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  Install complete" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Install path: $DetectPath"
Write-Host "API URL:      $ApiUrl"
Write-Host "Room:         $RoomId"
Write-Host ""
Write-Host "NEXT STEPS:" -ForegroundColor Yellow
Write-Host "  1. Plug in the 3 cameras (same USB ports every time)."
Write-Host "  2. Double-click 'No3 Calibrate Cameras' on the Desktop"
Write-Host "     (or run calibrate commands — see detection\WINDOWS.md)."
Write-Host "  3. Double-click 'No3 Darts Detector' to start scoring."
Write-Host "  4. Optional autostart:"
Write-Host "       cd $DetectPath"
Write-Host "       .\scripts\install-autostart.ps1"
Write-Host ""
Write-Host "List cameras anytime:"
Write-Host "  cd $DetectPath"
Write-Host "  .\.venv\Scripts\Activate.ps1"
Write-Host "  python -m no3_detect list-cameras"
Write-Host ""
