# No3 Darts – Windows mini-PC setup
# Run from the detection folder:
#   Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
#   .\scripts\setup-windows.ps1

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

Write-Host "=== No3 Darts detector setup ===" -ForegroundColor Cyan
Write-Host "Folder: $Root"

# Resolve Python
$py = $null
if (Get-Command python -ErrorAction SilentlyContinue) {
    $py = "python"
} elseif (Get-Command py -ErrorAction SilentlyContinue) {
    $py = "py -3"
} else {
    Write-Host "Python not found. Install 3.11+ from python.org and tick 'Add to PATH'." -ForegroundColor Red
    exit 1
}

Write-Host "Using: $py"
Invoke-Expression "$py --version"

Write-Host "`nCreating virtual environment (.venv)..."
if (-not (Test-Path ".venv")) {
    Invoke-Expression "$py -m venv .venv"
}

$pip = Join-Path $Root ".venv\Scripts\pip.exe"
$python = Join-Path $Root ".venv\Scripts\python.exe"

if (-not (Test-Path $python)) {
    Write-Host "venv python missing" -ForegroundColor Red
    exit 1
}

Write-Host "Installing packages..."
& $python -m pip install --upgrade pip
& $pip install -r (Join-Path $Root "requirements.txt")

# Prefer full OpenCV on Windows for calibrate + preview windows
Write-Host "Installing OpenCV with GUI support..."
& $pip uninstall -y opencv-python-headless 2>$null
& $pip install "opencv-python>=4.9.0"

if (-not (Test-Path (Join-Path $Root "config.yaml"))) {
    Copy-Item (Join-Path $Root "config.example.yaml") (Join-Path $Root "config.yaml")
    Write-Host "Created config.yaml — edit no3_api_url, room_id, cameras." -ForegroundColor Yellow
} else {
    Write-Host "config.yaml already exists (left unchanged)."
}

$calibDir = Join-Path $Root "calib"
if (-not (Test-Path $calibDir)) {
    New-Item -ItemType Directory -Path $calibDir | Out-Null
}

Write-Host "`nRunning geometry self-test..."
& $python -m no3_detect test-geometry

Write-Host "`n=== Setup complete ===" -ForegroundColor Green
Write-Host @"

Next steps:
  1. Edit config.yaml  (Railway URL, room_id, camera sources 0/1/2)
  2. Activate venv:    .\.venv\Scripts\Activate.ps1
  3. List cameras:     python -m no3_detect list-cameras
  4. Calibrate:
       python -m no3_detect calibrate --camera 0 --id cam0 --out .\calib\cam0.json
       python -m no3_detect calibrate --camera 1 --id cam1 --out .\calib\cam1.json
       python -m no3_detect calibrate --camera 2 --id cam2 --out .\calib\cam2.json
  5. Run:              python -m no3_detect run --config config.yaml
     Or double-click:  scripts\run-detector.bat
  6. Optional autostart: .\scripts\install-autostart.ps1

Full guide: WINDOWS.md
"@
