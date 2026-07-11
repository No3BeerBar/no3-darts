# No3 Darts - setup venv + deps + vision calibration
# Safe for Windows PowerShell 5.1
#
# Usage (from detection folder):
#   powershell -ExecutionPolicy Bypass -File .\scripts\setup-and-calibrate.ps1
#   powershell -ExecutionPolicy Bypass -File .\scripts\setup-and-calibrate.ps1 -SkipCalibrate
#   powershell -ExecutionPolicy Bypass -File .\scripts\setup-and-calibrate.ps1 -ApiKey xai-xxx

param(
    [switch]$SkipCalibrate,
    [string]$ApiKey = ""
)

$ErrorActionPreference = "Continue"

# detection\scripts -> detection
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

Write-Host ""
Write-Host "========================================"
Write-Host " No3 detector - setup + calibrate"
Write-Host " Folder: $Root"
Write-Host "========================================"
Write-Host ""

if (-not (Test-Path (Join-Path $Root "requirements.txt"))) {
    Write-Host "ERROR: requirements.txt not found in $Root" -ForegroundColor Red
    Write-Host "Run this from the detection folder after git pull."
    exit 1
}

# --- Find Python ---
$pyCmd = $null
if (Get-Command python -ErrorAction SilentlyContinue) {
    $pyCmd = "python"
} elseif (Get-Command py -ErrorAction SilentlyContinue) {
    $pyCmd = "py"
} else {
    Write-Host "ERROR: Python not found. Install 3.11+ and tick Add to PATH." -ForegroundColor Red
    exit 1
}
Write-Host "Using: $pyCmd"
try {
    if ($pyCmd -eq "py") {
        & py -3 --version
    } else {
        & python --version
    }
} catch {
    Write-Host "ERROR: Could not run Python." -ForegroundColor Red
    exit 1
}

# --- venv ---
$venvPy = Join-Path $Root ".venv\Scripts\python.exe"
if (-not (Test-Path $venvPy)) {
    Write-Host "Creating .venv ..."
    if ($pyCmd -eq "py") {
        & py -3 -m venv .venv
    } else {
        & python -m venv .venv
    }
}
if (-not (Test-Path $venvPy)) {
    Write-Host "ERROR: Failed to create .venv\Scripts\python.exe" -ForegroundColor Red
    exit 1
}
Write-Host "venv OK: $venvPy"

Write-Host "Upgrading pip ..."
& $venvPy -m pip install --upgrade pip

Write-Host "Installing requirements.txt ..."
& $venvPy -m pip install -r (Join-Path $Root "requirements.txt")
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: pip install -r requirements.txt failed" -ForegroundColor Red
    exit 1
}

Write-Host "Installing opencv-python (GUI) ..."
& $venvPy -m pip uninstall -y opencv-python-headless
& $venvPy -m pip install "opencv-python>=4.9.0"

Write-Host "Ensuring rich, requests, yaml, numpy ..."
& $venvPy -m pip install "rich>=13.7.0" "requests>=2.31.0" "PyYAML>=6.0.1" "numpy>=1.26.0"

Write-Host "Verifying imports ..."
& $venvPy -c "import rich, cv2, numpy, yaml, requests; print('OK')"
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: import check failed" -ForegroundColor Red
    exit 1
}
Write-Host "Imports OK" -ForegroundColor Green

# config.yaml
$cfg = Join-Path $Root "config.yaml"
$cfgEx = Join-Path $Root "config.example.yaml"
if (-not (Test-Path $cfg)) {
    if (Test-Path $cfgEx) {
        Copy-Item $cfgEx $cfg
        Write-Host "Created config.yaml from example - edit no3_api_url if needed."
    }
}

$calibDir = Join-Path $Root "calib"
if (-not (Test-Path $calibDir)) {
    New-Item -ItemType Directory -Path $calibDir | Out-Null
}

if ($SkipCalibrate) {
    Write-Host ""
    Write-Host "Setup done (skipped calibrate)."
    Write-Host "  .\scripts\run-detector.bat"
    exit 0
}

if ($ApiKey -ne "") {
    $env:XAI_API_KEY = $ApiKey
}

if (-not $env:XAI_API_KEY) {
    Write-Host ""
    Write-Host "NOTE: XAI_API_KEY not set - OpenCV auto will be used if vision fails."
    Write-Host "  setx XAI_API_KEY xai-your-key"
    Write-Host "  (open a NEW terminal after setx)"
    Write-Host ""
}

Write-Host ""
Write-Host "Calibrating cameras 0 1 2 ..."
Write-Host "For each cam: check ellipse on outer double, press Y to save / N to skip."
Write-Host ""

# One simple command line - no array splatting (breaks older PS)
$calCmd = @(
    "-m", "no3_detect", "calibrate-vision",
    "--cameras", "0", "1", "2",
    "--ids", "cam0", "cam1", "cam2",
    "--outdir", ".\calib",
    "--method", "vision-or-auto",
    "--continue-on-error"
)
& $venvPy @calCmd

Write-Host ""
Write-Host "========================================"
Write-Host " Done. Next:"
Write-Host "   1. Check calib\cam0.json cam1.json cam2.json"
Write-Host "   2. .\scripts\run-detector.bat"
Write-Host "   3. Click camera window, empty board, press B, throw"
Write-Host "========================================"
Write-Host ""
