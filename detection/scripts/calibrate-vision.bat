@echo off
setlocal EnableExtensions
cd /d "%~dp0.."

set "VENVPY=%CD%\.venv\Scripts\python.exe"

if not exist "%VENVPY%" (
  call "%~dp0fix-deps.bat" nopause
)

"%VENVPY%" -c "import cv2" 1>nul 2>nul
if errorlevel 1 (
  call "%~dp0fix-deps.bat" nopause
)

if not exist "%VENVPY%" (
  echo ERROR: no venv python
  pause
  exit /b 1
)

echo Using:
"%VENVPY%" -c "import sys,cv2; print(sys.executable); print('cv2', cv2.__version__)"
if errorlevel 1 (
  echo ERROR: cv2 not importable. Run scripts\fix-deps.bat
  pause
  exit /b 1
)

if "%XAI_API_KEY%"=="" (
  echo XAI_API_KEY not set - OpenCV auto fallback may be used.
)

echo Calibrating 0 1 2 ...
"%VENVPY%" -m no3_detect calibrate-vision --cameras 0 1 2 --ids cam0 cam1 cam2 --outdir .\calib --method vision-or-auto --continue-on-error
pause
