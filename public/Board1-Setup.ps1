#Requires -Version 5.1
<#
.SYNOPSIS
  No.3 Board 1 bootstrap for the Windows mini-PC.

.DESCRIPTION
  Downloads the Board 1 kit zip from Railway, extracts to C:\No3Darts\Board1\,
  writes config.yaml (Board 1 / production), best-effort Autodarts.exe detect,
  then launches board-station\start-board.bat.

  Prefer double-clicking Board1-Setup.bat (downloads/runs this script).
#>

$ErrorActionPreference = "Stop"

$No3Url = "https://no3-darts-production.up.railway.app"
$ZipUrl = "$No3Url/board-station-board1.zip"
$IpadUrl = "$No3Url/play?room=Board%201"
$TvUrl = "$No3Url/tv"
$KitRoot = "C:\No3Darts\Board1"
$ZipPath = Join-Path $env:TEMP "board-station-board1.zip"
$CfgPath = Join-Path $KitRoot "board-station\config.yaml"
$StartBat = Join-Path $KitRoot "board-station\start-board.bat"

function Write-Banner([string]$Text) {
  Write-Host ""
  Write-Host "============================================================" -ForegroundColor Cyan
  Write-Host " $Text" -ForegroundColor Cyan
  Write-Host "============================================================" -ForegroundColor Cyan
}

function Test-Python {
  foreach ($script in @(
    { python --version 2>&1 },
    { py -3 --version 2>&1 }
  )) {
    try {
      $out = & $script
      $text = ($out | Out-String).Trim()
      if ($text -match "Python\s+\d") {
        Write-Host "  $text"
        return $true
      }
    } catch { }
  }
  return $false
}

function Find-Autodarts {
  $candidates = @(
    (Join-Path $env:ProgramFiles "Autodarts\Autodarts.exe"),
    (Join-Path ${env:ProgramFiles(x86)} "Autodarts\Autodarts.exe"),
    (Join-Path $env:LocalAppData "Autodarts\Autodarts.exe"),
    (Join-Path $env:ProgramFiles "Autodarts Board Manager\Autodarts.exe"),
    (Join-Path $env:ProgramFiles "autodarts\Autodarts.exe"),
    (Join-Path $env:USERPROFILE "Desktop\Autodarts.lnk"),
    (Join-Path $env:PUBLIC "Desktop\Autodarts.lnk"),
    (Join-Path $env:USERPROFILE "Desktop\Autodarts Board Manager.lnk"),
    (Join-Path $env:PUBLIC "Desktop\Autodarts Board Manager.lnk")
  )
  foreach ($c in $candidates) {
    if ($c -and (Test-Path -LiteralPath $c)) { return $c }
  }
  foreach ($root in @($env:ProgramFiles, ${env:ProgramFiles(x86)}, $env:LocalAppData)) {
    if (-not $root -or -not (Test-Path -LiteralPath $root)) { continue }
    $hit = Get-ChildItem -LiteralPath $root -Filter "Autodarts.exe" -File -Recurse -Depth 4 -ErrorAction SilentlyContinue |
      Select-Object -First 1
    if ($hit) { return $hit.FullName }
  }
  return $null
}

function Write-Board1Config([string]$Path, [string]$ExePath) {
  $exeYaml = ""
  if ($ExePath) {
    # YAML needs doubled backslashes inside the quoted path
    $exeYaml = $ExePath.Replace('\', '\\')
  }
  $yaml = @"
# Board station config — Board 1 (production)
# Written by Board1-Setup

autodarts:
  host: "127.0.0.1"
  port: 3180
  # Set autodarts.exe_path if empty — path to Autodarts.exe or .lnk on THIS PC
  exe_path: "$exeYaml"
  process_names:
    - "Autodarts"
    - "autodarts"
    - "AutodartsDesktop"
  start_if_missing: true
  ready_timeout_s: 45

no3:
  url: "https://no3-darts-production.up.railway.app"
  room_id: "Board 1"
  camera_api_key: ""

bridge:
  enabled: true
  companion_dir: "../autodarts-companion"

kiosk:
  enabled: true
  browser: "msedge"
  open_tv: true
  tv_url: "{no3.url}/tv"
  open_play: false
  play_url: "{no3.url}/play"
  extra_args: "--autoplay-policy=no-user-gesture-required"
  tv_display: 1

health:
  enabled: true
  fps_min: 5.0
  unhealthy_seconds: 15.0
  restart_cooldown_seconds: 60.0
  between_games_recal: true
"@
  $dir = Split-Path -Parent $Path
  if (-not (Test-Path -LiteralPath $dir)) {
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
  }
  Set-Content -LiteralPath $Path -Value $yaml -Encoding UTF8
}

Write-Banner "No.3 Darts — Board 1 Setup"

Write-Host "[1/5] Checking Python..."
if (-not (Test-Python)) {
  Write-Host ""
  Write-Host "ERROR: Python 3 was not found on PATH." -ForegroundColor Red
  Write-Host "Install from https://www.python.org/downloads/"
  Write-Host "Check `"Add python.exe to PATH`", then re-run Board1-Setup.bat."
  Write-Host "Optional (ask first): winget install Python.Python.3.12"
  Write-Host ""
  Read-Host "Press Enter to exit"
  exit 1
}

Write-Host "[2/5] Creating $KitRoot ..."
New-Item -ItemType Directory -Force -Path $KitRoot | Out-Null

Write-Host "[3/5] Downloading kit zip..."
Write-Host "      $ZipUrl"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Invoke-WebRequest -Uri $ZipUrl -OutFile $ZipPath -UseBasicParsing

Write-Host "[4/5] Unzipping into $KitRoot ..."
foreach ($name in @("board-station", "autodarts-companion")) {
  $p = Join-Path $KitRoot $name
  if (Test-Path -LiteralPath $p) {
    Remove-Item -LiteralPath $p -Recurse -Force
  }
}
Expand-Archive -LiteralPath $ZipPath -DestinationPath $KitRoot -Force

if (-not (Test-Path -LiteralPath $StartBat)) {
  Write-Host "ERROR: Missing $StartBat after unzip." -ForegroundColor Red
  Get-ChildItem -LiteralPath $KitRoot | Format-Table Name
  Read-Host "Press Enter to exit"
  exit 1
}

Write-Host "[5/5] Writing Board 1 config + locating Autodarts..."
$exe = Find-Autodarts
if ($exe) {
  Write-Host "  Found Autodarts: $exe" -ForegroundColor Green
} else {
  Write-Host "  Autodarts.exe not found in common paths." -ForegroundColor Yellow
}
Write-Board1Config -Path $CfgPath -ExePath $exe

if (-not $exe) {
  Write-Host ""
  Write-Host "Edit exe_path in Notepad, SAVE, close Notepad, then continue." -ForegroundColor Yellow
  Start-Process -FilePath "notepad.exe" -ArgumentList $CfgPath -Wait
}

Write-Banner "Starting Board Station"
Write-Host "  iPad: $IpadUrl"
Write-Host "  TV:   $TvUrl"
Write-Host "  Kit:  $KitRoot"
Write-Host ""

$boardDir = Join-Path $KitRoot "board-station"
Push-Location $boardDir
try {
  & cmd.exe /c "`"$StartBat`""
  $code = $LASTEXITCODE
} finally {
  Pop-Location
}

Write-Host ""
Write-Host "Board station launcher finished (exit $code)."
Write-Host "iPad URL: $IpadUrl"
Write-Host ""
Read-Host "Press Enter to close"
exit $code
