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
  [string]$CameraApiKey = ""
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

Write-Host ""
Write-Host "========================================" -ForegroundColor Yellow
Write-Host "  No3 Darts — Windows mini-PC installer" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow

# --- Python ---
Write-Step "Checking Python"
$py = $null
if (Test-Command "python") {
  $ver = & python --version 2>&1
  Write-Host "  Found: $ver"
  $py = "python"
} elseif (Test-Command "py") {
  $ver = & py -3 --version 2>&1
  Write-Host "  Found launcher: $ver"
  $py = "py -3"
} else {
  Write-Host "  Python not found." -ForegroundColor Red
  Write-Host ""
  Write-Host "Install Python 3.11 or 3.12 (64-bit) from:" -ForegroundColor Yellow
  Write-Host "  https://www.python.org/downloads/windows/"
  Write-Host "IMPORTANT: check 'Add python.exe to PATH', then open a NEW PowerShell and re-run this script."
  Write-Host ""
  # Try winget if available
  if (Test-Command "winget") {
    $ans = Read-Host "Install Python 3.12 with winget now? [Y/n]"
    if ($ans -eq "" -or $ans -match '^[Yy]') {
      Write-Step "Installing Python via winget"
      winget install -e --id Python.Python.3.12 --accept-package-agreements --accept-source-agreements
      Write-Host "Close this window, open a NEW PowerShell, and run the install script again." -ForegroundColor Yellow
      exit 0
    }
  }
  exit 1
}

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
  Invoke-Expression "$py -m venv .venv"
}

$python = Join-Path $DetectPath ".venv\Scripts\python.exe"
$pip = Join-Path $DetectPath ".venv\Scripts\pip.exe"

if (-not (Test-Path $python)) {
  Write-Host "  venv python missing" -ForegroundColor Red
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
