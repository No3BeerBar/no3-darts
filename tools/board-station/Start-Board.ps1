#Requires -Version 5.1
<#
.SYNOPSIS
  One-script board stack for No. 3: Autodarts Board Manager + companion bridge + optional TV kiosk.

.DESCRIPTION
  Reads config.yaml (copy from config.example.yaml). Starts Board Manager if missing,
  launches the Autodarts → No3 bridge, optionally opens Edge/Chrome kiosk for the TV
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

# Minimal YAML subset reader (enough for our config.example.yaml)
function ConvertFrom-SimpleYaml([string]$Path) {
  $root = @{}
  $stack = New-Object System.Collections.ArrayList
  [void]$stack.Add(@{ Indent = -1; Map = $root; Kind = "map" })
  $pendingKey = $null
  $pendingIndent = 0

  foreach ($raw in Get-Content -LiteralPath $Path) {
    if ($raw -match '^\s*#' -or $raw.Trim() -eq "") { continue }
    if ($raw -notmatch '^(\s*)([^:]+):\s*(.*)$' -and $raw -notmatch '^(\s*)-\s+(.*)$') { continue }

    if ($raw -match '^(\s*)-\s+(.*)$') {
      $indent = $Matches[1].Length
      $val = $Matches[2].Trim().Trim('"').Trim("'")
      while ($stack.Count -gt 1 -and $stack[$stack.Count - 1].Indent -ge $indent) {
        $stack.RemoveAt($stack.Count - 1)
      }
      $parent = $stack[$stack.Count - 1]
      if ($parent.Kind -eq "list") {
        [void]$parent.List.Add($val)
      }
      continue
    }

    $indent = $Matches[1].Length
    $key = $Matches[2].Trim()
    $rest = $Matches[3].Trim()

    while ($stack.Count -gt 1 -and $stack[$stack.Count - 1].Indent -ge $indent) {
      $stack.RemoveAt($stack.Count - 1)
    }
    $parent = $stack[$stack.Count - 1].Map

    if ($rest -eq "" -or $rest -eq "|" -or $rest -eq ">") {
      # nested map or upcoming list
      $child = @{}
      $parent[$key] = $child
      [void]$stack.Add(@{ Indent = $indent; Map = $child; Kind = "map" })
      $pendingKey = $key
      $pendingIndent = $indent
      continue
    }

    # Inline value
    $val = $rest
    if ($val -match '^"(.*)"$') { $val = $Matches[1] }
    elseif ($val -match "^'(.*)'$") { $val = $Matches[1] }
    elseif ($val -eq "true") { $val = $true }
    elseif ($val -eq "false") { $val = $false }
    elseif ($val -match '^-?\d+(\.\d+)?$') { $val = [double]$val }

    # If next lines are list items under this key, convert to list later — handle empty then list:
    $parent[$key] = $val
  }

  # Second pass: promote keys whose following lines were lists.
  # Our parser already handles "- item" when parent Kind is list; fix by re-read for process_names.
  return $root
}

function Read-BoardConfig([string]$Path) {
  # Prefer PowerShell-Yaml if present; else simple parser + fix list keys via regex.
  $text = Get-Content -LiteralPath $Path -Raw
  $cfg = ConvertFrom-SimpleYaml $Path

  # Fix process_names list (simple parser may miss depending on blank nesting)
  if ($text -match '(?ms)process_names:\s*((?:\s*-\s*.+\s*)+)') {
    $names = @()
    foreach ($line in $Matches[1].Trim().Split("`n")) {
      if ($line -match '-\s+(.+)$') {
        $names += $Matches[1].Trim().Trim('"').Trim("'")
      }
    }
    if (-not $cfg.autodarts) { $cfg.autodarts = @{} }
    if ($names.Count -gt 0) { $cfg.autodarts.process_names = $names }
  }
  return $cfg
}

if (-not (Test-Path -LiteralPath $ConfigPath)) {
  if (Test-Path -LiteralPath $Example) {
    Copy-Item -LiteralPath $Example -Destination $ConfigPath
    Write-Host "Created $ConfigPath from example — edit exe_path / no3.url / room_id before relying on it." -ForegroundColor Yellow
  } else {
    throw "Missing config.yaml and config.example.yaml in $Here"
  }
}

$cfg = Read-BoardConfig $ConfigPath
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

Write-Banner "No. 3 Board Station"
Write-Host "  Config:     $ConfigPath"
Write-Host "  Autodarts:  http://${AdHost}:${AdPort}/api/state"
Write-Host "  No3:        $No3Url"
Write-Host "  Room:       $Room"
Write-Host "  Companion:  $CompanionDir"

function Test-AutodartsReady {
  try {
    $r = Invoke-WebRequest -Uri "http://${AdHost}:${AdPort}/api/state" -UseBasicParsing -TimeoutSec 2
    return $r.StatusCode -eq 200
  } catch {
    return $false
  }
}

function Test-ProcessRunning([string[]]$Names) {
  foreach ($n in $Names) {
    if (-not $n) { continue }
    $base = [System.IO.Path]::GetFileNameWithoutExtension($n)
    if (Get-Process -Name $base -ErrorAction SilentlyContinue) { return $true }
  }
  return $false
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
    Write-Host "exe_path is empty in config.yaml — start Autodarts Board Manager manually," -ForegroundColor Yellow
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
    Write-Host "Board Manager not ready after ${ReadyTimeout}s — bridge will retry." -ForegroundColor Yellow
  }
} else {
  Write-Host "start_if_missing=false and Board Manager not up — continuing anyway." -ForegroundColor Yellow
}

# Sync companion config from board-station (so bridge picks up same No3/health)
Write-Banner "2/3 Companion bridge"
if (-not (Test-Path -LiteralPath $CompanionDir)) {
  throw "Companion dir missing: $CompanionDir"
}

$companionCfg = Join-Path $CompanionDir "config.yaml"
$companionExample = Join-Path $CompanionDir "config.example.yaml"
if (-not (Test-Path -LiteralPath $companionCfg) -and (Test-Path -LiteralPath $companionExample)) {
  Copy-Item $companionExample $companionCfg
}

# Write a small overlay config the bridge understands
$apiKey = if ($no3.camera_api_key) { [string]$no3.camera_api_key } else { "" }
$exeEsc = if ($ExePath) { $ExePath.Replace('\', '\\') } else { "" }
$healthEnabled = if ($null -ne $health.enabled) { [bool]$health.enabled } else { $true }
$fpsMin = if ($health.fps_min) { $health.fps_min } else { 5.0 }
$unhealthyS = if ($health.unhealthy_seconds) { $health.unhealthy_seconds } else { 15.0 }
$cooldown = if ($health.restart_cooldown_seconds) { $health.restart_cooldown_seconds } else { 60.0 }
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
Set-Content -LiteralPath $companionCfg -Value $yaml -Encoding UTF8
Write-Host "Wrote $companionCfg"

$venvPy = Join-Path $CompanionDir ".venv\Scripts\python.exe"
if (-not (Test-Path -LiteralPath $venvPy)) {
  Write-Host "Creating companion venv…"
  Push-Location $CompanionDir
  try {
    python -m venv .venv
    & $venvPy -m pip install -r requirements.txt
  } finally {
    Pop-Location
  }
}

$bridgeArgs = @("-m", "companion", "bridge")
if ($DryRunBridge) { $bridgeArgs += "--dry-run" }

$bridgeEnabled = if ($null -ne $bridge.enabled) { [bool]$bridge.enabled } else { $true }
if ($bridgeEnabled) {
  Write-Host "Starting bridge (new window)…"
  Start-Process -FilePath $venvPy -ArgumentList $bridgeArgs -WorkingDirectory $CompanionDir
} else {
  Write-Host "bridge.enabled=false — skip" -ForegroundColor Yellow
}

# --- 3) Kiosk / URLs ---
Write-Banner "3/3 Displays (TV + iPad)"
$tvUrl = Expand-UrlTemplate $(if ($kiosk.tv_url) { [string]$kiosk.tv_url } else { "{no3.url}/tv" }) $No3Url
$playUrl = Expand-UrlTemplate $(if ($kiosk.play_url) { [string]$kiosk.play_url } else { "{no3.url}/play" }) $No3Url

Write-Host ""
Write-Host "iPad (players) — open No3 play UI on the tablet:" -ForegroundColor Green
Write-Host "  $playUrl" -ForegroundColor White
Write-Host "  Room must match: $Room"
Write-Host "  (Script cannot launch the iPad app — bookmark or scan QR below.)"
Write-Host ""
Write-Host "TV match view URL:" -ForegroundColor Green
Write-Host "  $tvUrl"

# Optional ASCII QR via qrcode if python has it — best-effort skip
try {
  $qrScript = @"
try:
 import qrcode
 qr = qrcode.QRCode(border=1)
 qr.add_data('$playUrl')
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

if ($kioskOn -and $browser -ne "none") {
  $exe = Find-Browser $browser
  if (-not $exe -and $browser -eq "msedge") { $exe = Find-Browser "chrome" }
  if ($exe) {
    if ($openTv) {
      $args = @("--new-window", "--kiosk", $tvUrl)
      if ($extra) { $args = $extra.Split(" ") + $args }
      Write-Host "Opening TV kiosk: $tvUrl"
      Start-Process -FilePath $exe -ArgumentList $args
    }
    if ($openPlay) {
      Write-Host "Opening play URL on this PC: $playUrl"
      Start-Process -FilePath $exe -ArgumentList @($playUrl)
    }
  } else {
    Write-Host "Browser '$browser' not found — open TV URL manually: $tvUrl" -ForegroundColor Yellow
  }
} else {
  Write-Host "Kiosk disabled — open TV URL manually if needed."
}

Write-Banner "Board stack launched"
Write-Host "Keep the bridge window open while playing."
Write-Host "Fix misreads on the iPad (tap dart → pick segment) or in Autodarts Board Manager."
Write-Host "Docs: docs/BOARD-STATION.md"
Write-Host ""
