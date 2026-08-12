#Requires -Version 5.1
<#
.SYNOPSIS
  One-script board stack for No. 3: Autodarts Board Manager + companion bridge + optional TV kiosk.

.DESCRIPTION
  Reads config.yaml (copy from config.example.yaml). Starts Board Manager if missing,
  launches the Autodarts -> No3 bridge, optionally opens Edge/Chrome kiosk for the TV
  match view, and prints the iPad play URL (iPad is a separate device).

.NOTES
  Bar ops entry point. See docs/BOARD-STATION.md
#>

[CmdletBinding()]
param(
  [string]$ConfigPath = "",
  [switch]$NoKiosk,
  [switch]$DryRunBridge
)

$ErrorActionPreference = "Stop"
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $ConfigPath) { $ConfigPath = Join-Path $Here "config.yaml" }
$Example = Join-Path $Here "config.example.yaml"
$LoadConfigPy = Join-Path $Here "load-config.py"

function Write-Banner([string]$Text) {
  Write-Host ""
  Write-Host "============================================================" -ForegroundColor Cyan
  Write-Host " $Text" -ForegroundColor Cyan
  Write-Host "============================================================" -ForegroundColor Cyan
}

function Expand-UrlTemplate([string]$Template, [string]$No3Url) {
  if (-not $Template) { return $Template }
  return $Template.Replace("{no3.url}", $No3Url.TrimEnd("/"))
}

function Find-Browser([string]$Name) {
  $candidates = @()
  if ($Name -eq "msedge") {
    $candidates += "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
    $candidates += "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
  } elseif ($Name -eq "chrome") {
    $candidates += "$env:ProgramFiles\Google\Chrome\Application\chrome.exe"
    $candidates += "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe"
  }
  foreach ($c in $candidates) {
    if ($c -and (Test-Path -LiteralPath $c)) { return $c }
  }
  return $null
}

if (-not (Test-Path -LiteralPath $ConfigPath)) {
  if (Test-Path -LiteralPath $Example) {
    Copy-Item -LiteralPath $Example -Destination $ConfigPath
    Write-Host "Created $ConfigPath from example - edit exe_path / no3.url / room_id before relying on it." -ForegroundColor Yellow
  } else {
    throw "Missing config.yaml and config.example.yaml in $Here"
  }
}

# Resolve companion dir early (default) so we can use its venv + PyYAML for config
$CompanionDirGuess = [System.IO.Path]::GetFullPath((Join-Path $Here "..\autodarts-companion"))
$venvPy = Join-Path $CompanionDirGuess ".venv\Scripts\python.exe"

function Ensure-CompanionVenv([string]$Dir) {
  $py = Join-Path $Dir ".venv\Scripts\python.exe"
  if (Test-Path -LiteralPath $py) { return $py }
  Write-Host "Creating companion venv in $Dir ..."
  Push-Location $Dir
  try {
    python -m venv .venv
    $py = Join-Path $Dir ".venv\Scripts\python.exe"
    & $py -m pip install -r requirements.txt
  } finally {
    Pop-Location
  }
  if (-not (Test-Path -LiteralPath $py)) {
    throw "Failed to create companion venv at $py"
  }
  return $py
}

$venvPy = Ensure-CompanionVenv $CompanionDirGuess

# Reliable YAML -> JSON via PyYAML (shipped with companion requirements)
$cfgJson = & $venvPy $LoadConfigPy $ConfigPath
if ($LASTEXITCODE -ne 0 -or -not $cfgJson) {
  throw "Failed to load config.yaml (need PyYAML in companion venv)"
}
$cfg = $cfgJson | ConvertFrom-Json

$ad = $cfg.autodarts
$no3 = $cfg.no3
$bridge = $cfg.bridge
$kiosk = $cfg.kiosk
$health = $cfg.health

$No3Url = if ($no3.url) { [string]$no3.url } else { "http://localhost:3000" }
$Room = if ($no3.room_id) { [string]$no3.room_id } else { "Board 1" }
$AdHost = if ($ad.host) { [string]$ad.host } else { "127.0.0.1" }
$AdPort = if ($ad.port) { [int]$ad.port } else { 3180 }
$ExePath = if ($ad.exe_path) { [string]$ad.exe_path } else { $env:AUTODARTS_EXE }
$StartIfMissing = if ($null -ne $ad.start_if_missing) { [bool]$ad.start_if_missing } else { $true }
$ReadyTimeout = if ($ad.ready_timeout_s) { [int]$ad.ready_timeout_s } else { 45 }

$CompanionDir = Join-Path $Here $(if ($bridge.companion_dir) { [string]$bridge.companion_dir } else { "..\autodarts-companion" })
$CompanionDir = [System.IO.Path]::GetFullPath($CompanionDir)
if ($CompanionDir -ne $CompanionDirGuess) {
  $venvPy = Ensure-CompanionVenv $CompanionDir
}

Write-Banner "No. 3 Board Station"
Write-Host "  Config:     $ConfigPath"
Write-Host "  Autodarts:  http://${AdHost}:${AdPort}/api/state"
Write-Host "  No3:        $No3Url"
Write-Host "  Room:       $Room"
Write-Host "  Companion:  $CompanionDir"
Write-Host "  iPad:       open play URL below (separate device)"

function Test-AutodartsReady {
  try {
    $r = Invoke-WebRequest -Uri "http://${AdHost}:${AdPort}/api/state" -UseBasicParsing -TimeoutSec 2
    return $r.StatusCode -eq 200
  } catch {
    return $false
  }
}

# --- 1) Autodarts Board Manager ---
Write-Banner "1/3 Autodarts Board Manager"
$procNames = @()
if ($ad.process_names) { $procNames = @($ad.process_names) }
if ($procNames.Count -eq 0) { $procNames = @("Autodarts", "autodarts", "AutodartsDesktop") }

$ready = Test-AutodartsReady
if ($ready) {
  Write-Host "Board Manager already responding on :$AdPort" -ForegroundColor Green
} elseif ($StartIfMissing) {
  if (-not $ExePath) {
    Write-Host "exe_path is empty in config.yaml - start Autodarts Board Manager manually," -ForegroundColor Yellow
    Write-Host "then re-run, or set autodarts.exe_path to the .exe / .lnk on this PC." -ForegroundColor Yellow
  } elseif (-not (Test-Path -LiteralPath $ExePath)) {
    Write-Host "exe_path not found: $ExePath" -ForegroundColor Red
    Write-Host "Edit config.yaml autodarts.exe_path for this machine." -ForegroundColor Yellow
  } else {
    Write-Host "Starting Board Manager: $ExePath"
    Start-Process -FilePath $ExePath | Out-Null
  }
  $deadline = (Get-Date).AddSeconds($ReadyTimeout)
  while ((Get-Date) -lt $deadline) {
    if (Test-AutodartsReady) { $ready = $true; break }
    Start-Sleep -Seconds 2
  }
  if ($ready) {
    Write-Host "Board Manager ready." -ForegroundColor Green
  } else {
    Write-Host "Board Manager not ready after ${ReadyTimeout}s - bridge will retry." -ForegroundColor Yellow
  }
} else {
  Write-Host "start_if_missing=false and Board Manager not up - continuing anyway." -ForegroundColor Yellow
}

# --- 2) Companion bridge ---
Write-Banner "2/3 Companion bridge"
if (-not (Test-Path -LiteralPath $CompanionDir)) {
  throw "Companion dir missing: $CompanionDir"
}

$companionCfg = Join-Path $CompanionDir "config.yaml"
$apiKey = if ($no3.camera_api_key) { [string]$no3.camera_api_key } else { "" }
$exeEsc = if ($ExePath) { $ExePath.Replace('\', '\\') } else { "" }
$healthEnabled = if ($null -ne $health.enabled) { [bool]$health.enabled } else { $true }
$fpsMin = if ($null -ne $health.fps_min) { $health.fps_min } else { 5.0 }
$unhealthyS = if ($null -ne $health.unhealthy_seconds) { $health.unhealthy_seconds } else { 15.0 }
$cooldown = if ($null -ne $health.restart_cooldown_seconds) { $health.restart_cooldown_seconds } else { 60.0 }
$recal = if ($null -ne $health.between_games_recal) { [bool]$health.between_games_recal } else { $true }

$yaml = @"
autodarts:
  host: "$AdHost"
  port: $AdPort
  poll_ms: 300
  exe_path: "$exeEsc"
  process_names:
$(($procNames | ForEach-Object { "    - `"$_`"" }) -join "`n")

no3:
  url: "$No3Url"
  room_id: "$Room"
  camera_api_key: "$apiKey"

health:
  enabled: $($healthEnabled.ToString().ToLower())
  fps_min: $fpsMin
  unhealthy_seconds: $unhealthyS
  restart_cooldown_seconds: $cooldown
  between_games_recal: $($recal.ToString().ToLower())

logs_dir: "./logs"
"@
Set-Content -LiteralPath $companionCfg -Value $yaml -Encoding Ascii
Write-Host "Wrote $companionCfg"

$bridgeArgs = @("-m", "companion", "bridge")
if ($DryRunBridge) { $bridgeArgs += "--dry-run" }

$bridgeEnabled = if ($null -ne $bridge.enabled) { [bool]$bridge.enabled } else { $true }
if ($bridgeEnabled) {
  Write-Host "Starting bridge (new window)..."
  Start-Process -FilePath $venvPy -ArgumentList $bridgeArgs -WorkingDirectory $CompanionDir
} else {
  Write-Host "bridge.enabled=false - skip" -ForegroundColor Yellow
}

# --- 3) Kiosk / URLs ---
Write-Banner "3/3 Displays (TV + iPad)"
$tvUrl = Expand-UrlTemplate $(if ($kiosk.tv_url) { [string]$kiosk.tv_url } else { "{no3.url}/tv" }) $No3Url
$playUrl = Expand-UrlTemplate $(if ($kiosk.play_url) { [string]$kiosk.play_url } else { "{no3.url}/play" }) $No3Url

Write-Host ""
Write-Host "iPad (players) - open No3 play UI on the tablet:" -ForegroundColor Green
Write-Host "  $playUrl" -ForegroundColor White
Write-Host "  Room must match: $Room"
Write-Host "  (Script cannot launch the iPad app - bookmark or scan QR below.)"
Write-Host ""
Write-Host "TV match view URL:" -ForegroundColor Green
Write-Host "  $tvUrl"

try {
  $qrScript = @"
try:
 import qrcode
 qr = qrcode.QRCode(border=1)
 qr.add_data(r'''$playUrl''')
 qr.make(fit=True)
 qr.print_ascii(invert=True)
except Exception:
 pass
"@
  & $venvPy -c $qrScript 2>$null
} catch { }

$kioskOn = (-not $NoKiosk) -and ($(if ($null -ne $kiosk.enabled) { [bool]$kiosk.enabled } else { $true }))
$openTv = if ($null -ne $kiosk.open_tv) { [bool]$kiosk.open_tv } else { $true }
$openPlay = if ($null -ne $kiosk.open_play) { [bool]$kiosk.open_play } else { $false }
$browser = if ($kiosk.browser) { [string]$kiosk.browser } else { "msedge" }
$extra = if ($kiosk.extra_args) { [string]$kiosk.extra_args } else { "" }

if ($kioskOn -and $browser -ne "none") {
  $browserExe = Find-Browser $browser
  if (-not $browserExe -and $browser -eq "msedge") { $browserExe = Find-Browser "chrome" }
  if ($browserExe) {
    if ($openTv) {
      $browserArgs = @("--new-window", "--kiosk", $tvUrl)
      if ($extra) { $browserArgs = @($extra -split '\s+') + $browserArgs }
      Write-Host "Opening TV kiosk: $tvUrl"
      Start-Process -FilePath $browserExe -ArgumentList $browserArgs
    }
    if ($openPlay) {
      Write-Host "Opening play URL on this PC: $playUrl"
      Start-Process -FilePath $browserExe -ArgumentList @($playUrl)
    }
  } else {
    Write-Host "Browser '$browser' not found - open TV URL manually: $tvUrl" -ForegroundColor Yellow
  }
} else {
  Write-Host "Kiosk disabled - open TV URL manually if needed."
}

Write-Banner "Board stack launched"
Write-Host "Keep the bridge window open while playing."
Write-Host "Fix misreads on the iPad (tap dart -> pick segment) or in Autodarts Board Manager."
Write-Host "Docs: docs/BOARD-STATION.md"
Write-Host ""
