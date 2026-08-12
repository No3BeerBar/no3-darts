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

function Test-CompanionDeps([string]$Py) {
  # Cheap smoke check - skip pip when runtime imports already work.
  & $Py -c "import yaml,requests,numpy,cv2" 2>$null
  return ($LASTEXITCODE -eq 0)
}

function Install-CompanionDeps([string]$Py, [string]$Dir) {
  Write-Host "Installing companion deps (first run only, may take a few minutes)..." -ForegroundColor Yellow
  Push-Location $Dir
  try {
    & $Py -m pip install --disable-pip-version-check -r requirements.txt
    if ($LASTEXITCODE -ne 0) {
      throw "pip install -r requirements.txt failed (exit $LASTEXITCODE)"
    }
  } finally {
    Pop-Location
  }
}

function Ensure-CompanionVenv([string]$Dir) {
  $py = Join-Path $Dir ".venv\Scripts\python.exe"
  if (-not (Test-Path -LiteralPath $py)) {
    Write-Host "Creating companion venv in $Dir ..."
    Push-Location $Dir
    try {
      python -m venv .venv
    } finally {
      Pop-Location
    }
    $py = Join-Path $Dir ".venv\Scripts\python.exe"
    if (-not (Test-Path -LiteralPath $py)) {
      throw "Failed to create companion venv at $py"
    }
    Install-CompanionDeps $py $Dir
    return $py
  }
  if (-not (Test-CompanionDeps $py)) {
    Write-Host "Companion venv missing runtime deps - repairing..." -ForegroundColor Yellow
    Install-CompanionDeps $py $Dir
    if (-not (Test-CompanionDeps $py)) {
      throw "Companion venv still missing deps after pip install (yaml/requests/numpy/cv2)"
    }
  }
  return $py
}

# Search common Windows locations for Autodarts Board Manager (.exe or .lnk).
# Caps wall time at ~10s so a slow disk never hangs the launcher.
function Find-AutodartsExe {
  $deadline = (Get-Date).AddSeconds(10)

  $quick = @(
    (Join-Path $env:ProgramFiles "Autodarts\Autodarts.exe"),
    (Join-Path ${env:ProgramFiles(x86)} "Autodarts\Autodarts.exe"),
    (Join-Path $env:ProgramFiles "Autodarts Board Manager\Autodarts.exe"),
    (Join-Path ${env:ProgramFiles(x86)} "Autodarts Board Manager\Autodarts.exe"),
    (Join-Path $env:ProgramFiles "autodarts\Autodarts.exe"),
    (Join-Path ${env:ProgramFiles(x86)} "autodarts\Autodarts.exe"),
    (Join-Path $env:LocalAppData "Autodarts\Autodarts.exe"),
    (Join-Path $env:LocalAppData "Programs\Autodarts\Autodarts.exe"),
    (Join-Path $env:AppData "Autodarts\Autodarts.exe"),
    (Join-Path $env:USERPROFILE "Desktop\Autodarts.lnk"),
    (Join-Path $env:PUBLIC "Desktop\Autodarts.lnk"),
    (Join-Path $env:USERPROFILE "Desktop\Autodarts Board Manager.lnk"),
    (Join-Path $env:PUBLIC "Desktop\Autodarts Board Manager.lnk"),
    (Join-Path $env:AppData "Microsoft\Windows\Start Menu\Programs\Autodarts.lnk"),
    (Join-Path $env:AppData "Microsoft\Windows\Start Menu\Programs\Autodarts Board Manager.lnk"),
    (Join-Path $env:ProgramData "Microsoft\Windows\Start Menu\Programs\Autodarts.lnk"),
    (Join-Path $env:ProgramData "Microsoft\Windows\Start Menu\Programs\Autodarts Board Manager.lnk")
  )
  foreach ($c in $quick) {
    if ($c -and (Test-Path -LiteralPath $c)) { return $c }
  }

  $roots = @(
    $env:ProgramFiles,
    ${env:ProgramFiles(x86)},
    $env:LocalAppData,
    $env:AppData,
    (Join-Path $env:USERPROFILE "Desktop"),
    (Join-Path $env:PUBLIC "Desktop"),
    (Join-Path $env:AppData "Microsoft\Windows\Start Menu\Programs"),
    (Join-Path $env:ProgramData "Microsoft\Windows\Start Menu\Programs")
  ) | Where-Object { $_ } | Select-Object -Unique

  $filters = @("Autodarts*.exe", "*Autodarts*.exe", "Autodarts*.lnk", "*Autodarts*.lnk")
  $exeHit = $null
  $lnkHit = $null

  foreach ($root in $roots) {
    if ((Get-Date) -ge $deadline) { break }
    if (-not (Test-Path -LiteralPath $root)) { continue }
    foreach ($filter in $filters) {
      if ((Get-Date) -ge $deadline) { break }
      try {
        $hits = @(Get-ChildItem -LiteralPath $root -Filter $filter -File -Recurse -Depth 5 -ErrorAction SilentlyContinue |
          Select-Object -First 5)
      } catch {
        $hits = @()
      }
      foreach ($hit in $hits) {
        if (-not $hit) { continue }
        $name = $hit.Name
        if ($name -notmatch '(?i)autodarts') { continue }
        if ($name -match '\.exe$' -and -not $exeHit) { $exeHit = $hit.FullName }
        elseif ($name -match '\.lnk$' -and -not $lnkHit) { $lnkHit = $hit.FullName }
        if ($exeHit) { return $exeHit }
      }
    }
  }

  if ($exeHit) { return $exeHit }
  if ($lnkHit) { return $lnkHit }
  return $null
}

# Update autodarts.exe_path in config.yaml; leave every other key untouched.
function Save-ExePathToConfig([string]$Path, [string]$ExePath) {
  if (-not (Test-Path -LiteralPath $Path)) { return }
  $escaped = $ExePath.Replace('\', '\\')
  $content = [IO.File]::ReadAllText($Path)
  $pattern = '(?m)^([ \t]*exe_path:[ \t]*).*$'
  if ($content -notmatch $pattern) {
    Write-Host "Could not update exe_path in config.yaml (key missing) - using discovered path for this run only." -ForegroundColor Yellow
    return
  }
  $updated = [regex]::Replace($content, $pattern, ('${1}"' + $escaped + '"'), 1)
  [IO.File]::WriteAllText($Path, $updated, [Text.Encoding]::ASCII)
  Write-Host "Saved exe_path into config.yaml for next run." -ForegroundColor Green
}

function Write-AutodartsMissingError([string]$AdHost, [int]$AdPort, [string]$ConfigPath) {
  Write-Host ""
  Write-Host "============================================================" -ForegroundColor Red
  Write-Host " ERROR: Autodarts Board Manager not available" -ForegroundColor Red
  Write-Host "============================================================" -ForegroundColor Red
  Write-Host " autodarts.exe_path is empty / missing, and the Board Manager" -ForegroundColor Red
  Write-Host " API is not responding at http://${AdHost}:${AdPort}/api/state" -ForegroundColor Red
  Write-Host ""
  Write-Host " What to do (bar operator):" -ForegroundColor Yellow
  Write-Host "  1. Install / start Autodarts Board Manager on this PC"
  Write-Host "  2. Confirm http://${AdHost}:${AdPort}/api/state opens in a browser"
  Write-Host "  3. Re-run start-board.bat  (or set exe_path in config.yaml)"
  Write-Host ""
  Write-Host " Config file: $ConfigPath"
  Write-Host " Example exe_path:"
  Write-Host '   "C:\\Program Files\\Autodarts\\Autodarts.exe"'
  Write-Host '   "C:\\Users\\Public\\Desktop\\Autodarts.lnk"'
  Write-Host "============================================================" -ForegroundColor Red
  Write-Host ""
}

try {

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
  $exeUsable = $false
  if ($ExePath) {
    if (Test-Path -LiteralPath $ExePath) {
      $exeUsable = $true
    } else {
      Write-Host "exe_path not found: $ExePath" -ForegroundColor Yellow
      Write-Host "Searching common locations for Autodarts..." -ForegroundColor Yellow
      $ExePath = ""
    }
  }

  if (-not $exeUsable) {
    Write-Host "exe_path empty or missing - searching for Autodarts Board Manager..." -ForegroundColor Yellow
    $found = Find-AutodartsExe
    if ($found) {
      $ExePath = $found
      $exeUsable = $true
      Write-Host "Found Autodarts at $ExePath" -ForegroundColor Green
      Save-ExePathToConfig -Path $ConfigPath -ExePath $ExePath
    }
  }

  if ($exeUsable) {
    Write-Host "Starting Board Manager: $ExePath"
    Start-Process -FilePath $ExePath | Out-Null
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
    # Last chance: API may have come up while we searched
    if (Test-AutodartsReady) {
      $ready = $true
      Write-Host "Board Manager already responding on :$AdPort" -ForegroundColor Green
    } else {
      Write-AutodartsMissingError -AdHost $AdHost -AdPort $AdPort -ConfigPath $ConfigPath
      throw "Autodarts Board Manager not found and API not responding on :${AdPort} (AUTODARTS_MISSING)"
    }
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

} catch {
  Write-Host ""
  Write-Host "============================================================" -ForegroundColor Red
  Write-Host " ERROR: Start-Board failed (uncaught)" -ForegroundColor Red
  Write-Host "============================================================" -ForegroundColor Red
  Write-Host $_.Exception.Message -ForegroundColor Red
  if ($_.ScriptStackTrace) {
    Write-Host $_.ScriptStackTrace
  }
  Write-Host "============================================================" -ForegroundColor Red
  Write-Host ""
  exit 1
}
