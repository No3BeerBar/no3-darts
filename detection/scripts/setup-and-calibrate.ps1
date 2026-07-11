# No3 Darts — setup venv + deps + (optional) vision calibration
# Run after git pull from the detection folder or via setup-and-calibrate.bat
#
# Usage:
#   .\scripts\setup-and-calibrate.ps1
#   .\scripts\setup-and-calibrate.ps1 -SkipCalibrate
#   .\scripts\setup-and-calibrate.ps1 -ApiKey "xai-..."
#   .\scripts\setup-and-calibrate.ps1 -Cameras 0,1,2

param(
  [switch]$SkipCalibrate,
  [string]$ApiKey = "",
  [int[]]$Cameras = @(0, 1, 2),
  [string]$Method = "vision-or-auto"
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path (Join-Path $Root "requirements.txt"))) {
  # script lives in detection\scripts → parent is detection
  $Root = $PSScriptRoot
  if (Test-Path (Join-Path (Split-Path $Root -Parent) "requirements.txt")) {
    $Root = Split-Path $Root -Parent
  }
}
Set-Location $Root

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host " No3 detector — setup + calibrate"
Write-Host " Folder: $Root"
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# --- Python ---
$py = $null
foreach ($cmd in @("python", "py")) {
  try {
    $v = & $cmd --version 2>&1
    if ($LASTEXITCODE -eq 0 -or $v -match "Python") {
      $py = $cmd
      Write-Host "Using: $cmd  ($v)" -ForegroundColor Green
      break
    }
  } catch { }
}
if (-not $py) {
  Write-Host "Python not found. Install Python 3.11+ from python.org and check 'Add to PATH'." -ForegroundColor Red
  exit 1
}

# --- venv ---
$venvPy = Join-Path $Root ".venv\Scripts\python.exe"
$venvPip = Join-Path $Root ".venv\Scripts\pip.exe"
if (-not (Test-Path $venvPy)) {
  Write-Host "Creating .venv ..." -ForegroundColor Yellow
  if ($py -eq "py") {
    & py -3 -m venv .venv
  } else {
    & python -m venv .venv
  }
  if (-not (Test-Path $venvPy)) {
    Write-Host "Failed to create .venv" -ForegroundColor Red
    exit 1
  }
} else {
  Write-Host "Found existing .venv" -ForegroundColor Green
}

Write-Host "Upgrading pip ..." -ForegroundColor Yellow
& $venvPy -m pip install --upgrade pip
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "Installing requirements.txt (includes rich, opencv, etc.) ..." -ForegroundColor Yellow
& $venvPy -m pip install -r (Join-Path $Root "requirements.txt")
if ($LASTEXITCODE -ne 0) {
  Write-Host "pip install failed" -ForegroundColor Red
  exit $LASTEXITCODE
}

# Prefer GUI OpenCV on Windows (preview + calibrate windows)
Write-Host "Installing opencv-python (GUI) ..." -ForegroundColor Yellow
& $venvPy -m pip uninstall -y opencv-python-headless 2>$null
& $venvPy -m pip install "opencv-python>=4.9.0"

# Ensure rich is present even if requirements were stale
& $venvPy -m pip install "rich>=13.7.0" "requests>=2.31.0" "PyYAML>=6.0.1" "numpy>=1.26.0"

# Quick import check
Write-Host "Verifying imports ..." -ForegroundColor Yellow
& $venvPy -c "import rich, cv2, numpy, yaml, requests; print('OK: rich', rich.__version__, 'cv2', cv2.__version__)"
if ($LASTEXITCODE -ne 0) {
  Write-Host "Import check failed" -ForegroundColor Red
  exit 1
}

# config.yaml
$cfg = Join-Path $Root "config.yaml"
$cfgEx = Join-Path $Root "config.example.yaml"
if (-not (Test-Path $cfg) -and (Test-Path $cfgEx)) {
  Copy-Item $cfgEx $cfg
  Write-Host "Created config.yaml from example — edit no3_api_url if needed." -ForegroundColor Yellow
}

# calib dir
$calibDir = Join-Path $Root "calib"
if (-not (Test-Path $calibDir)) {
  New-Item -ItemType Directory -Path $calibDir | Out-Null
}

if ($SkipCalibrate) {
  Write-Host ""
  Write-Host "Setup done. Run detector with:" -ForegroundColor Green
  Write-Host "  .\scripts\run-detector.bat"
  Write-Host "Or calibrate with:"
  Write-Host "  .\scripts\setup-and-calibrate.ps1"
  exit 0
}

# API key
if ($ApiKey) {
  $env:XAI_API_KEY = $ApiKey
}
if (-not $env:XAI_API_KEY) {
  Write-Host ""
  Write-Host "XAI_API_KEY not set — will use OpenCV auto if vision fails." -ForegroundColor Yellow
  Write-Host "  setx XAI_API_KEY `"xai-...`"   (then open a NEW terminal)"
  Write-Host "  or: .\scripts\setup-and-calibrate.ps1 -ApiKey `"xai-...`""
  Write-Host ""
}

$ids = @()
for ($i = 0; $i -lt $Cameras.Count; $i++) {
  $ids += "cam$i"
}

Write-Host ""
Write-Host "Calibrating cameras [$($Cameras -join ', ')] method=$Method ..." -ForegroundColor Cyan
Write-Host "For each cam: check ellipse on outer double, press Y to save / N to skip."
Write-Host ""

$camArgs = @()
foreach ($c in $Cameras) { $camArgs += $c }
$idArgs = @()
foreach ($id in $ids) { $idArgs += $id }

& $venvPy -m no3_detect calibrate-vision `
  --cameras @camArgs `
  --ids @idArgs `
  --outdir .\calib `
  --method $Method `
  --continue-on-error

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host " Done. Next:"
Write-Host "   1. Confirm calib\cam0.json cam1.json cam2.json exist"
Write-Host "   2. .\scripts\run-detector.bat"
Write-Host "   3. Click camera window, empty board, press B, throw"
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
