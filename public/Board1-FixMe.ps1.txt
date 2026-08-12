#Requires -Version 5.1
# No.3 Board 1 Fix Me for the Windows mini-PC (embedded in Board1-FixMe.bat).
# ASCII-only so Windows PowerShell 5.1 never hits UTF-8 / smart-quote parse errors.
# Kills leftover No3/companion/start-board processes and stuck HDMI TV kiosk
# browsers (/tv), ALWAYS refreshes kit from production zip (preserves
# board-station\config.yaml; parks/restores companion .venv only if
# Scripts\python.exe exists and runs). Dead leftover .venv is deleted so
# start-board can recreate it. Starts Autodarts if needed, clears stuck
# takeout/bridge state, launches start-board.bat (companion + TV).
# Always-refresh avoids restarting a stale companion that omits expectedPlayerIndex.

$ErrorActionPreference = "Stop"

$No3Url = "https://no3-darts-production.up.railway.app"
$ZipUrl = "$No3Url/board-station-board1.zip"
$IpadUrl = "$No3Url/play?room=Board%201"
$TvUrl = "$No3Url/tv"
$KitRoot = "C:\No3Darts\Board1"
$ZipPath = Join-Path $env:TEMP "board-station-board1.zip"
$CfgPath = Join-Path $KitRoot "board-station\config.yaml"
$StartBat = Join-Path $KitRoot "board-station\start-board.bat"
$AdHost = "127.0.0.1"
$AdPort = 3180

function Write-Banner([string]$Text) {
  Write-Host ""
  Write-Host "============================================================" -ForegroundColor Cyan
  Write-Host " $Text" -ForegroundColor Cyan
  Write-Host "============================================================" -ForegroundColor Cyan
}

function Write-Fail([string]$Message, [int]$Code) {
  Write-Host ""
  Write-Host "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!" -ForegroundColor Red
  Write-Host " ERROR: Fix Me FAILED" -ForegroundColor Red
  Write-Host "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!" -ForegroundColor Red
  Write-Host ""
  Write-Host " $Message" -ForegroundColor Red
  Write-Host ""
  Write-Host " PHOTO THIS WINDOW and send it to No.3 support." -ForegroundColor Cyan
  Write-Host ""
  Read-Host "Press Enter to exit"
  exit $Code
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

function Test-CompanionVenvHealthy([string]$VenvDir) {
  # Do not preserve a leftover .venv whose python.exe is missing or broken.
  $py = Join-Path $VenvDir "Scripts\python.exe"
  if (-not (Test-Path -LiteralPath $py)) { return $false }
  $prev = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    & $py -c "import sys" 1>$null 2>$null
    return ($LASTEXITCODE -eq 0)
  } catch {
    return $false
  } finally {
    $ErrorActionPreference = $prev
  }
}

function Test-No3LeftoverCommand([string]$Cmd) {
  if (-not $Cmd) { return $false }
  if ($Cmd -match '(?i)Start-Board\.ps1') { return $true }
  if ($Cmd -match '(?i)start-board\.bat') { return $true }
  if ($Cmd -match '(?i)No3-Board1-(Setup|FixMe)') { return $true }
  if ($Cmd -match '(?i)-m(\s)+companion(\s)+bridge') { return $true }
  if ($Cmd -match '(?i)companion\\__main__\.py') { return $true }
  if ($Cmd -match '(?i)autodarts-companion' -and $Cmd -match '(?i)python') { return $true }
  if ($Cmd -match '(?i)Board1-FixMe\.ps1') { return $true }
  # Stuck HDMI kiosk only: Edge/Chrome with No.3 /tv (not random browser tabs).
  $isBrowser = $Cmd -match '(?i)(msedge\.exe|chrome\.exe|microsoft-edge)'
  $isTv = $Cmd -match '(?i)[/\\]tv(\?|#|\s|$)'
  $isNo3 = $Cmd -match '(?i)(no3-darts|railway\.app|127\.0\.0\.1|localhost)'
  if ($isBrowser -and $isTv -and $isNo3) { return $true }
  return $false
}

function Stop-No3Leftovers {
  Write-Host "  Looking for leftover No3 / companion / start-board / TV kiosk..."
  $killed = 0
  $procs = @()
  try {
    $procs = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)
  } catch {
    try { $procs = @(Get-WmiObject Win32_Process -ErrorAction SilentlyContinue) } catch { $procs = @() }
  }
  foreach ($p in $procs) {
    if (-not $p) { continue }
    if ($p.ProcessId -eq $PID) { continue }
    $cmd = ""
    try { $cmd = [string]$p.CommandLine } catch { $cmd = "" }
    if (-not (Test-No3LeftoverCommand $cmd)) { continue }
    try {
      Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
      Write-Host ("  Stopped PID {0} ({1})" -f $p.ProcessId, $p.Name)
      $killed++
    } catch { }
  }
  if ($killed -eq 0) {
    Write-Host "  No leftover No3/companion/start-board/TV processes found."
  } else {
    Write-Host ("  Stopped {0} process(es)." -f $killed) -ForegroundColor Green
    Start-Sleep -Seconds 1
  }
}

function Test-KitOk {
  $need = @(
    $StartBat,
    (Join-Path $KitRoot "board-station\Start-Board.ps1"),
    (Join-Path $KitRoot "board-station\load-config.py"),
    (Join-Path $KitRoot "autodarts-companion\companion\bridge.py")
  )
  foreach ($p in $need) {
    if (-not (Test-Path -LiteralPath $p)) { return $false }
  }
  return $true
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

function Get-ExePathFromConfig([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) { return "" }
  $content = [IO.File]::ReadAllText($Path)
  $m = [regex]::Match($content, '(?m)^[ \t]*exe_path:[ \t]*"?([^"\r\n]+)"?[ \t]*$')
  if (-not $m.Success) { return "" }
  $raw = $m.Groups[1].Value.Trim()
  if (-not $raw) { return "" }
  return $raw.Replace('\\', '\')
}

function Save-ExePathToConfig([string]$Path, [string]$ExePath) {
  if (-not (Test-Path -LiteralPath $Path)) { return }
  $escaped = $ExePath.Replace('\', '\\')
  $content = [IO.File]::ReadAllText($Path)
  $pattern = '(?m)^([ \t]*exe_path:[ \t]*).*$'
  if ($content -notmatch $pattern) { return }
  $updated = [regex]::Replace($content, $pattern, ('${1}"' + $escaped + '"'), 1)
  [IO.File]::WriteAllText($Path, $updated, [Text.Encoding]::ASCII)
  Write-Host "  Saved exe_path into config.yaml for next run." -ForegroundColor Green
}

function Write-Board1Config([string]$Path, [string]$ExePath) {
  $exeYaml = ""
  if ($ExePath) {
    $exeYaml = $ExePath.Replace('\', '\\')
  }
  $yaml = @"
# Board station config - Board 1 (production)
# Written by Board1-FixMe

autodarts:
  host: "127.0.0.1"
  port: 3180
  # Set autodarts.exe_path if empty - path to Autodarts.exe or .lnk on THIS PC
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
  [IO.File]::WriteAllText($Path, $yaml, [Text.Encoding]::ASCII)
}

function Test-AutodartsReady {
  try {
    $r = Invoke-WebRequest -Uri "http://${AdHost}:${AdPort}/api/state" -UseBasicParsing -TimeoutSec 2
    return $r.StatusCode -eq 200
  } catch {
    return $false
  }
}

function Ensure-Autodarts {
  if (Test-AutodartsReady) {
    Write-Host "  Autodarts already responding on :$AdPort" -ForegroundColor Green
    return $true
  }
  Write-Host "  Autodarts not responding on :$AdPort - trying to start..."
  $exe = Get-ExePathFromConfig $CfgPath
  if ($exe -and -not (Test-Path -LiteralPath $exe)) {
    Write-Host "  config exe_path not found: $exe" -ForegroundColor Yellow
    $exe = ""
  }
  if (-not $exe) {
    $exe = Find-Autodarts
    if ($exe) {
      Write-Host "  Found Autodarts: $exe" -ForegroundColor Green
      if (Test-Path -LiteralPath $CfgPath) {
        Save-ExePathToConfig -Path $CfgPath -ExePath $exe
      }
    }
  } else {
    Write-Host "  Using config exe_path: $exe"
  }
  if (-not $exe) {
    Write-Host "  Autodarts.exe not found. start-board.bat will try again." -ForegroundColor Yellow
    return $false
  }
  try {
    Start-Process -FilePath $exe | Out-Null
  } catch {
    Write-Host ("  Could not start Autodarts: " + $_.Exception.Message) -ForegroundColor Yellow
    return $false
  }
  $deadline = (Get-Date).AddSeconds(45)
  while ((Get-Date) -lt $deadline) {
    if (Test-AutodartsReady) {
      Write-Host "  Autodarts ready." -ForegroundColor Green
      return $true
    }
    Start-Sleep -Seconds 2
  }
  Write-Host "  Autodarts not ready after 45s - start-board.bat will retry." -ForegroundColor Yellow
  return $false
}

function Clear-StuckTakeoutState {
  Write-Host "  Clearing No3 takeout-ready ack (if any)..."
  try {
    $u = "$No3Url/api/camera/takeout-ready?room=Board%201&consume=1"
    Invoke-WebRequest -Uri $u -UseBasicParsing -TimeoutSec 5 | Out-Null
    Write-Host "  takeout-ready consume OK" -ForegroundColor Green
  } catch {
    Write-Host ("  takeout-ready consume skipped: " + $_.Exception.Message) -ForegroundColor Yellow
  }
  try {
    $body = '{"roomId":"Board 1"}'
    Invoke-WebRequest -Uri "$No3Url/api/camera/takeout-ready" -Method POST -Body $body -ContentType "application/json; charset=utf-8" -UseBasicParsing -TimeoutSec 5 | Out-Null
    Write-Host "  takeout-ready POST OK" -ForegroundColor Green
  } catch {
    Write-Host ("  takeout-ready POST skipped: " + $_.Exception.Message) -ForegroundColor Yellow
  }

  if (-not (Test-AutodartsReady)) {
    Write-Host "  Autodarts not up - skip local reset probes."
    return
  }
  Write-Host "  Probing Autodarts reset/calibrate endpoints..."
  $paths = @(
    "/api/reset",
    "/api/board/reset",
    "/api/calibrate",
    "/api/calibration",
    "/api/board/calibrate",
    "/api/cams/reset",
    "/api/cameras/reset"
  )
  $ok = $false
  foreach ($p in $paths) {
    $uri = "http://${AdHost}:${AdPort}$p"
    foreach ($method in @("POST", "GET")) {
      try {
        $r = Invoke-WebRequest -Uri $uri -Method $method -UseBasicParsing -TimeoutSec 2
        if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 300) {
          Write-Host ("  AD reset OK via {0} {1}" -f $method, $p) -ForegroundColor Green
          $ok = $true
          break
        }
      } catch { }
    }
    if ($ok) { break }
  }
  if (-not $ok) {
    Write-Host "  No AD reset endpoint accepted (OK if Board Manager has no HTTP reset)." -ForegroundColor Yellow
  }
}

function Refresh-Kit {
  Write-Host "  Downloading kit zip..."
  Write-Host "  $ZipUrl"
  try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -Uri $ZipUrl -OutFile $ZipPath -UseBasicParsing
  } catch {
    Write-Fail ("Could not download board-station-board1.zip`n  URL: $ZipUrl`n  Detail: " + $_.Exception.Message) 1
  }

  $cfgBackup = Join-Path $env:TEMP "no3-board1-config-fixme-backup.yaml"
  $hadCfg = $false
  if (Test-Path -LiteralPath $CfgPath) {
    Copy-Item -LiteralPath $CfgPath -Destination $cfgBackup -Force
    $hadCfg = $true
    Write-Host "  Backed up board-station\config.yaml (exe_path preserved)."
  }

  $venvSrc = Join-Path $KitRoot "autodarts-companion\.venv"
  $venvBackup = Join-Path $env:TEMP "no3-board1-venv-fixme-backup"
  $hadVenv = $false
  if (Test-Path -LiteralPath $venvSrc) {
    if (-not (Test-CompanionVenvHealthy $venvSrc)) {
      Write-Host "  Companion .venv python.exe missing/broken - not preserving (start-board will recreate)." -ForegroundColor Yellow
      try {
        Remove-Item -LiteralPath $venvSrc -Recurse -Force -ErrorAction SilentlyContinue
      } catch { }
    } else {
      if (Test-Path -LiteralPath $venvBackup) {
        Remove-Item -LiteralPath $venvBackup -Recurse -Force -ErrorAction SilentlyContinue
      }
      try {
        Move-Item -LiteralPath $venvSrc -Destination $venvBackup -Force
        $hadVenv = $true
        Write-Host "  Parked companion .venv so pip is not re-run."
      } catch {
        Write-Host "  Could not park .venv - will recreate if needed." -ForegroundColor Yellow
        $hadVenv = $false
      }
    }
  }

  foreach ($name in @("board-station", "autodarts-companion")) {
    $p = Join-Path $KitRoot $name
    if (Test-Path -LiteralPath $p) {
      Remove-Item -LiteralPath $p -Recurse -Force
    }
  }
  Expand-Archive -LiteralPath $ZipPath -DestinationPath $KitRoot -Force

  if ($hadVenv -and (Test-Path -LiteralPath $venvBackup)) {
    $venvDest = Join-Path $KitRoot "autodarts-companion\.venv"
    try {
      if (Test-Path -LiteralPath $venvDest) {
        Remove-Item -LiteralPath $venvDest -Recurse -Force -ErrorAction SilentlyContinue
      }
      Move-Item -LiteralPath $venvBackup -Destination $venvDest -Force
      if (Test-CompanionVenvHealthy $venvDest) {
        Write-Host "  Restored companion .venv." -ForegroundColor Green
      } else {
        Write-Host "  Restored .venv python.exe is broken - deleting so start-board recreates it." -ForegroundColor Yellow
        Remove-Item -LiteralPath $venvDest -Recurse -Force -ErrorAction SilentlyContinue
      }
    } catch {
      Write-Host "  Could not restore .venv - start-board will recreate." -ForegroundColor Yellow
    }
  }

  if ($hadCfg -and (Test-Path -LiteralPath $cfgBackup)) {
    $cfgDir = Split-Path -Parent $CfgPath
    if (-not (Test-Path -LiteralPath $cfgDir)) {
      New-Item -ItemType Directory -Force -Path $cfgDir | Out-Null
    }
    Copy-Item -LiteralPath $cfgBackup -Destination $CfgPath -Force
    Write-Host "  Restored board-station\config.yaml." -ForegroundColor Green
  }

  if (-not (Test-Path -LiteralPath $StartBat)) {
    Write-Fail ("Missing start-board.bat after unzip.`n  Expected: $StartBat`n  Re-download: $ZipUrl") 1
  }
}

function Copy-FixMeToKit {
  $dest = Join-Path $KitRoot "Board1-FixMe.bat"
  $src = $env:NO3_FIXME_BAT
  if ($src -and (Test-Path -LiteralPath $src)) {
    try {
      Copy-Item -LiteralPath $src -Destination $dest -Force
      Write-Host "  Copied Fix Me to $dest" -ForegroundColor Green
      return
    } catch {
      Write-Host ("  Could not copy Fix Me bat: " + $_.Exception.Message) -ForegroundColor Yellow
    }
  }
  if (Test-Path -LiteralPath $dest) {
    Write-Host "  Fix Me already present at $dest"
  } else {
    Write-Host "  Tip: keep Board1-FixMe.bat in $KitRoot for next time." -ForegroundColor Yellow
  }
}

Write-Banner "No.3 Darts - Board 1 Fix Me"

Write-Host "[1/6] Stopping leftover No3 / companion / start-board / TV kiosk..."
Stop-No3Leftovers

Write-Host "[2/6] Checking Python..."
if (-not (Test-Python)) {
  Write-Fail "Python 3 was not found on PATH.`n Fix: install from https://www.python.org/downloads/ (check Add to PATH), then re-run Board1-FixMe.bat" 1
}

Write-Host "[3/6] Refreshing kit from production (always)..."
New-Item -ItemType Directory -Force -Path $KitRoot | Out-Null
Refresh-Kit
if (-not (Test-KitOk)) {
  Write-Fail ("Kit still incomplete after refresh.`n  Expected start-board.bat + load-config.py + companion bridge.py under $KitRoot`n  Re-download: $ZipUrl") 1
}
$bridgePy = Join-Path $KitRoot "autodarts-companion\companion\bridge.py"
try {
  $bridgeText = [IO.File]::ReadAllText($bridgePy)
  if ($bridgeText -match 'expectedPlayerIndex') {
    Write-Host "  Companion bridge includes expectedPlayerIndex (seat lock OK)." -ForegroundColor Green
  } else {
    Write-Host "  WARNING: bridge.py missing expectedPlayerIndex - production zip may be stale." -ForegroundColor Yellow
    Write-Host "  PHOTO THIS WINDOW if camera posts keep getting HTTP 409." -ForegroundColor Yellow
  }
} catch {
  Write-Host ("  WARNING: could not read bridge.py for seat-lock check: " + $_.Exception.Message) -ForegroundColor Yellow
}

if (-not (Test-Path -LiteralPath $CfgPath)) {
  Write-Host "  No config.yaml - writing Board 1 defaults..."
  $exe = Find-Autodarts
  Write-Board1Config -Path $CfgPath -ExePath $exe
} else {
  Write-Host "  Keeping existing board-station\config.yaml (exe_path preserved)."
  $exePath = Get-ExePathFromConfig $CfgPath
  if (-not $exePath) {
    $found = Find-Autodarts
    if ($found) { Save-ExePathToConfig -Path $CfgPath -ExePath $found }
  }
}

Copy-FixMeToKit

Write-Host "[4/6] Starting Autodarts if needed (:$AdPort)..."
Ensure-Autodarts | Out-Null

Write-Host "[5/6] Clearing stuck takeout / bridge state..."
Clear-StuckTakeoutState

Write-Host "[6/6] Starting board station (bridge + TV kiosk)..."
Write-Banner "Starting Board Station"
Write-Host "  iPad: $IpadUrl"
Write-Host "  TV:   $TvUrl"
Write-Host "  Kit:  $KitRoot"
Write-Host ""

$boardDir = Join-Path $KitRoot "board-station"
Push-Location $boardDir
$code = 0
try {
  & cmd.exe /c "`"$StartBat`""
  $code = $LASTEXITCODE
  if ($null -eq $code) { $code = 0 }
} catch {
  Pop-Location
  Write-Fail ("Failed to launch start-board.bat`n  Path: $StartBat`n  Detail: " + $_.Exception.Message) 1
}
Pop-Location

Write-Host ""
if ($code -ne 0) {
  Write-Host "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!" -ForegroundColor Red
  Write-Host " ERROR: start-board.bat failed with exit code $code" -ForegroundColor Red
  Write-Host "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!" -ForegroundColor Red
  Write-Host "  Path: $StartBat"
  Write-Host "  Look at the Board Station / PowerShell messages above."
  Write-Host "  You can re-run start-board.bat from:"
  Write-Host "    $boardDir"
  Write-Host ""
  Write-Host " PHOTO THIS WINDOW and send it to No.3 support." -ForegroundColor Cyan
  Write-Host ""
  Read-Host "Press Enter to close"
  exit $code
}

Write-Banner "SUCCESS - Board 1 should be back"
Write-Host ""
Write-Host "  iPad URL (bookmark this):" -ForegroundColor Green
Write-Host "    $IpadUrl" -ForegroundColor White
Write-Host ""
Write-Host "  TV URL:" -ForegroundColor Green
Write-Host "    $TvUrl" -ForegroundColor White
Write-Host ""
Write-Host "  Leave the bridge window open while playing." -ForegroundColor Yellow
Write-Host "  Fix Me copy: $KitRoot\Board1-FixMe.bat"
Write-Host ""
Read-Host "Press Enter to close"
exit 0
