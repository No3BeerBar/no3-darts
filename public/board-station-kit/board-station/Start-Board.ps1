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
  Exit codes:
    0 = ok
    1 = script error (see step + message; photo this window)
    3 = Autodarts not running and no exe/.lnk found
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
$script:Step = "init"

function Set-Step([string]$Name) {
  $script:Step = $Name
}

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

function Test-VenvPythonRuns([string]$Py, [string]$Code) {
  # Real invoke - Test-Path is not enough (dead leftover .venv / Store stub).
  # Catch "not recognized as the name of a cmdlet" so callers can recreate.
  if (-not $Py) { return $false }
  if (-not (Test-Path -LiteralPath $Py)) { return $false }
  $prev = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $out = & $Py -c $Code 2>$null
    if ($LASTEXITCODE -ne 0) { return $false }
    if ($Code -eq "print('ok')") {
      $text = ($out | Out-String)
      return ($text -match "ok")
    }
    return $true
  } catch {
    return $false
  } finally {
    $ErrorActionPreference = $prev
  }
}

function Get-DeadVenvHint([string]$Py) {
  return ("Companion venv python.exe is not recognized or will not run:`n  $Py`nDelete C:\No3Darts\Board1\autodarts-companion\.venv and re-run Board1-FixMe.bat")
}

# Ensure-CompanionVenv must return a single python.exe path. Native pip/venv
# stdout is extra pipeline output in PS 5.1 and would otherwise become $venvPy.
function Receive-PythonPath([object]$Value) {
  if ($null -eq $Value) {
    throw "Companion venv python path missing after ensure. PHOTO THIS WINDOW."
  }
  $path = $Value
  if ($Value -is [array]) {
    $path = $Value[-1]
  }
  $path = [string]$path
  if (-not $path -or $path -notmatch '(?i)[\\/]python\.exe$') {
    throw ("Companion venv python path missing after ensure (got: $path). PHOTO THIS WINDOW.")
  }
  return $path
}

function Get-PythonFileDiag([string]$Py, [string]$ScriptPath) {
  $pyExists = Test-Path -LiteralPath $Py
  $pyLen = "n/a"
  if ($pyExists) {
    try { $pyLen = [string](Get-Item -LiteralPath $Py).Length } catch { $pyLen = "error" }
  }
  $scriptExists = Test-Path -LiteralPath $ScriptPath
  return @(
    "  python.exe Test-Path=$pyExists length=$pyLen",
    "  python.exe: $Py",
    "  load-config.py Test-Path=$scriptExists",
    "  load-config.py: $ScriptPath"
  ) -join "`n"
}

function Get-LoadConfigFailMessage {
  param(
    [string]$Py,
    [string]$ScriptPath,
    [string]$ConfigPath,
    [int]$ExitCode,
    [string]$StdErr,
    [string]$ExceptionMessage
  )
  $err = $StdErr
  if ($err -and $err.Length -gt 800) { $err = $err.Substring(0, 800) + "..." }
  $parts = @(
    "Failed to load config (load-config.py / PyYAML / config.yaml) - not a dead venv. Do not delete .venv if pip just succeeded."
    "  python exit=$ExitCode"
    "  config: $ConfigPath"
    (Get-PythonFileDiag $Py $ScriptPath)
  )
  if ($ExceptionMessage) {
    $parts += "  exception: $ExceptionMessage"
  }
  if ($err -and $err.Trim()) {
    $parts += "  python stderr:"
    $parts += $err.Trim()
  }
  $parts += "  PHOTO THIS WINDOW. Then in cmd run: dir python.exe / python -c print('ok') / python load-config.py config.yaml"
  return ($parts -join "`n")
}

# PS 5.1-safe invoke: quoted paths, capture stdout/stderr, no call-operator remap.
function Invoke-VenvPythonCapture {
  param(
    [Parameter(Mandatory = $true)][string]$Py,
    [Parameter(Mandatory = $true)][string[]]$ArgumentList
  )
  if (-not $Py -or $Py -notmatch '(?i)python\.exe$') {
    throw ("Refusing to invoke non-python path as venv python:`n  $Py")
  }
  if (-not (Test-Path -LiteralPath $Py)) {
    throw (Get-DeadVenvHint $Py)
  }
  $id = [guid]::NewGuid().ToString("N")
  $outFile = Join-Path $env:TEMP ("no3-board1-py-out-" + $id + ".txt")
  $errFile = Join-Path $env:TEMP ("no3-board1-py-err-" + $id + ".txt")
  $argString = ($ArgumentList | ForEach-Object {
    '"' + (([string]$_).Replace('"', '\"')) + '"'
  }) -join " "
  try {
    $p = Start-Process -FilePath $Py -ArgumentList $argString -Wait -PassThru -NoNewWindow -RedirectStandardOutput $outFile -RedirectStandardError $errFile
    $stdout = ""
    $stderr = ""
    if (Test-Path -LiteralPath $outFile) { $stdout = [IO.File]::ReadAllText($outFile) }
    if (Test-Path -LiteralPath $errFile) { $stderr = [IO.File]::ReadAllText($errFile) }
    $code = 1
    if ($null -ne $p) { $code = $p.ExitCode }
    return @{ ExitCode = $code; StdOut = $stdout; StdErr = $stderr }
  } catch {
    # Live probe only - never remap from English exception text.
    if (-not (Test-VenvPythonRuns $Py "import sys")) {
      throw (Get-DeadVenvHint $Py)
    }
    throw
  } finally {
    Remove-Item -LiteralPath $outFile -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $errFile -Force -ErrorAction SilentlyContinue
  }
}

function Assert-VenvPythonRunnable([string]$Py) {
  if (Test-VenvPythonRuns $Py "import sys") { return }
  throw (Get-DeadVenvHint $Py)
}

function Test-CompanionDeps([string]$Py) {
  # Cheap smoke check - skip pip when runtime imports already work.
  # Continue: native stderr must not become a terminating error under Stop.
  if (-not (Test-VenvPythonRuns $Py "import sys")) { return $false }
  $prev = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    & $Py -c "import yaml,requests,numpy,cv2" 1>$null 2>$null
    return ($LASTEXITCODE -eq 0)
  } catch {
    return $false
  } finally {
    $ErrorActionPreference = $prev
  }
}

function Install-CompanionDeps([string]$Py, [string]$Dir) {
  Write-Host "Installing companion deps (first run only, may take a few minutes)..." -ForegroundColor Yellow
  Push-Location $Dir
  $prev = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    # Out-Host: pip stdout must not become Ensure-CompanionVenv's return value.
    & $Py -m pip install --disable-pip-version-check -r requirements.txt 2>&1 | Out-Host
    if ($LASTEXITCODE -ne 0) {
      throw "pip install -r requirements.txt failed (exit $LASTEXITCODE)"
    }
  } catch {
    # Live probe only - pip stderr with "not recognized" is not a dead venv.
    if (-not (Test-VenvPythonRuns $Py "import sys")) {
      throw (Get-DeadVenvHint $Py)
    }
    throw
  } finally {
    $ErrorActionPreference = $prev
    Pop-Location
  }
  Assert-VenvPythonRunnable $Py
}

function New-CompanionVenv([string]$Dir) {
  Write-Host "Creating companion venv in $Dir ..."
  $venvDir = Join-Path $Dir ".venv"
  if (Test-Path -LiteralPath $venvDir) {
    Write-Host "  Removing broken companion .venv ..."
    Remove-Item -LiteralPath $venvDir -Recurse -Force
  }

  $created = $false
  Push-Location $Dir
  $prev = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $pyCheck = Join-Path $Dir ".venv\Scripts\python.exe"
    Write-Host "  Trying: py -3 -m venv --clear .venv"
    try {
      & py -3 -m venv --clear .venv 2>&1 | Out-Host
    } catch {
      Write-Host ("  py -3 failed: " + $_.Exception.Message)
    }
    if (Test-Path -LiteralPath $pyCheck) { $created = $true }
    if (-not $created) {
      Write-Host "  Trying: python -m venv --clear .venv"
      try {
        & python -m venv --clear .venv 2>&1 | Out-Host
      } catch {
        Write-Host ("  python failed: " + $_.Exception.Message)
      }
      if (Test-Path -LiteralPath $pyCheck) { $created = $true }
    }
  } finally {
    $ErrorActionPreference = $prev
    Pop-Location
  }

  $py = Join-Path $Dir ".venv\Scripts\python.exe"
  if (-not $created -or -not (Test-Path -LiteralPath $py)) {
    throw ("Failed to create companion venv (python.exe missing). Tried py -3 and python.`n  Expected: $py`n  Install Python 3 from https://www.python.org/downloads/ (check Add to PATH), then re-run Board1-FixMe.bat")
  }
  if (-not (Test-VenvPythonRuns $py "print('ok')")) {
    throw ("Companion venv python.exe exists but does not run:`n  $py`n  Delete C:\No3Darts\Board1\autodarts-companion\.venv and re-run Board1-FixMe.bat")
  }
  return $py
}

function Ensure-CompanionVenv([string]$Dir) {
  $py = Join-Path $Dir ".venv\Scripts\python.exe"
  $needCreate = $false
  if (-not (Test-Path -LiteralPath $py)) {
    $needCreate = $true
  } elseif (-not (Test-VenvPythonRuns $py "import sys")) {
    Write-Host "Companion venv python.exe is broken - recreating..." -ForegroundColor Yellow
    $needCreate = $true
  }
  if ($needCreate) {
    $py = Receive-PythonPath (New-CompanionVenv $Dir)
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
  Write-Host " PHOTO THIS WINDOW and send it to No.3 support if you need help." -ForegroundColor Cyan
  Write-Host ""
}

try {

Set-Step "config"
if (-not (Test-Path -LiteralPath $ConfigPath)) {
  if (Test-Path -LiteralPath $Example) {
    Copy-Item -LiteralPath $Example -Destination $ConfigPath
    Write-Host "Created $ConfigPath from example - edit exe_path / no3.url / room_id before relying on it." -ForegroundColor Yellow
  } else {
    throw "Missing config.yaml and config.example.yaml in $Here"
  }
}

# Resolve companion dir early (default) so we can use its venv + PyYAML for config
Set-Step "companion-venv"
$CompanionDirGuess = [System.IO.Path]::GetFullPath((Join-Path $Here "..\autodarts-companion"))
$venvPy = Join-Path $CompanionDirGuess ".venv\Scripts\python.exe"

$venvPy = Receive-PythonPath (Ensure-CompanionVenv $CompanionDirGuess)

# Reliable YAML -> JSON via PyYAML (shipped with companion requirements).
# Invoke-VenvPythonCapture: PS 5.1 call-operator + Out-String hid real errors
# (and remapped them to "dead venv") right after a successful pip install.
Set-Step "load-config"
Assert-VenvPythonRunnable $venvPy
if (-not (Test-Path -LiteralPath $LoadConfigPy)) {
  throw ("Missing load-config.py (kit refresh dropped it?).`n  Expected: $LoadConfigPy`n  Re-run Board1-FixMe.bat to refresh the kit zip from production.")
}
if (-not (Test-Path -LiteralPath $ConfigPath)) {
  throw "Missing config.yaml: $ConfigPath"
}

$cfgJson = ""
$loadExit = -1
$loadErr = ""
try {
  $loaded = Invoke-VenvPythonCapture -Py $venvPy -ArgumentList @($LoadConfigPy, $ConfigPath)
  $cfgJson = ([string]$loaded.StdOut).Trim()
  $loadExit = [int]$loaded.ExitCode
  $loadErr = [string]$loaded.StdErr
} catch {
  # Live probe only - never remap from English "not recognized" text.
  if (-not (Test-VenvPythonRuns $venvPy "import sys")) {
    throw (Get-DeadVenvHint $venvPy)
  }
  throw (Get-LoadConfigFailMessage -Py $venvPy -ScriptPath $LoadConfigPy -ConfigPath $ConfigPath -ExitCode -1 -StdErr "" -ExceptionMessage $_.Exception.Message)
}
if ($loadExit -ne 0 -or [string]::IsNullOrWhiteSpace($cfgJson)) {
  throw (Get-LoadConfigFailMessage -Py $venvPy -ScriptPath $LoadConfigPy -ConfigPath $ConfigPath -ExitCode $loadExit -StdErr $loadErr -ExceptionMessage "")
}
try {
  $cfg = $cfgJson | ConvertFrom-Json
} catch {
  throw (Get-LoadConfigFailMessage -Py $venvPy -ScriptPath $LoadConfigPy -ConfigPath $ConfigPath -ExitCode $loadExit -StdErr $loadErr -ExceptionMessage ("ConvertFrom-Json: " + $_.Exception.Message))
}

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

Set-Step "companion-dir"
$CompanionDir = Join-Path $Here $(if ($bridge.companion_dir) { [string]$bridge.companion_dir } else { "..\autodarts-companion" })
$CompanionDir = [System.IO.Path]::GetFullPath($CompanionDir)
if ($CompanionDir -ne $CompanionDirGuess) {
  $venvPy = Receive-PythonPath (Ensure-CompanionVenv $CompanionDir)
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
Set-Step "autodarts-board-manager"
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
      Write-Host "Using configured Autodarts path: $ExePath"
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
      exit 3
    }
  }
} else {
  if (-not $ExePath -or -not (Test-Path -LiteralPath $ExePath)) {
    $found = Find-AutodartsExe
    if ($found) {
      $ExePath = $found
      Write-Host "Found Autodarts at $ExePath" -ForegroundColor Green
      Save-ExePathToConfig -Path $ConfigPath -ExePath $ExePath
    }
  }
  if (-not (Test-AutodartsReady) -and (-not $ExePath -or -not (Test-Path -LiteralPath $ExePath))) {
    Write-AutodartsMissingError -AdHost $AdHost -AdPort $AdPort -ConfigPath $ConfigPath
    exit 3
  }
  Write-Host "start_if_missing=false and Board Manager not up - continuing anyway." -ForegroundColor Yellow
}

# --- 2) Companion bridge ---
Set-Step "companion-bridge"
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
  # Kill any old companion bridge windows so dart3/takeout fixes actually load.
  # Stale bridges keep posting with the previous seat-lock / takeout logic.
  Set-Step "kill-old-bridge"
  Write-Host "Stopping any old companion bridge processes..."
  $killed = 0
  try {
    Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
      Where-Object {
        $_.Name -match '^(python|pythonw)\.exe$' -and
        $_.CommandLine -and
        $_.CommandLine -match 'companion' -and
        $_.CommandLine -match 'bridge'
      } |
      ForEach-Object {
        try {
          Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop
          $killed++
          Write-Host ("  stopped pid {0}" -f $_.ProcessId)
        } catch {
          Write-Host ("  could not stop pid {0}: {1}" -f $_.ProcessId, $_.Exception.Message) -ForegroundColor Yellow
        }
      }
  } catch {
    Write-Host "  (skip kill-old-bridge: $($_.Exception.Message))" -ForegroundColor Yellow
  }
  if ($killed -eq 0) {
    Write-Host "  no old bridge process found"
  } else {
    Start-Sleep -Seconds 1
  }

  Write-Host "Starting bridge (new window)..."
  Start-Process -FilePath $venvPy -ArgumentList $bridgeArgs -WorkingDirectory $CompanionDir
} else {
  Write-Host "bridge.enabled=false - skip" -ForegroundColor Yellow
}

# --- 3) Kiosk / URLs ---
Set-Step "displays-kiosk"
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

Set-Step "done"
Write-Banner "Board stack launched"
Write-Host "Keep the bridge window open while playing."
Write-Host "Fix misreads on the iPad (tap dart -> pick segment) or in Autodarts Board Manager."
Write-Host "Docs: docs/BOARD-STATION.md"
Write-Host ""

} catch {
  Write-Host ""
  Write-Host "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!" -ForegroundColor Red
  Write-Host " ERROR: Start-Board FAILED" -ForegroundColor Red
  Write-Host "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!" -ForegroundColor Red
  Write-Host ""
  Write-Host " Step:      $($script:Step)" -ForegroundColor Yellow
  Write-Host " Error:     $($_.Exception.Message)" -ForegroundColor Red
  if ($_.InvocationInfo.PositionMessage) {
    Write-Host " Location:  $($_.InvocationInfo.PositionMessage.Trim())"
  }
  if ($_.ScriptStackTrace) {
    Write-Host $_.ScriptStackTrace
  }
  Write-Host ""
  Write-Host " PHOTO THIS WINDOW and send it to No.3 support." -ForegroundColor Cyan
  Write-Host ""
  exit 1
}
