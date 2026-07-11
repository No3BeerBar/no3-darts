@echo off
REM Optional: Grok vision calib (needs XAI_API_KEY). Falls back to OpenCV on failure.
setlocal EnableExtensions
cd /d "%~dp0.."

set "VENVPY=%CD%\.venv\Scripts\python.exe"
if not exist "%VENVPY%" call "%~dp0fix-deps.bat" nopause
"%VENVPY%" -c "import cv2" 1>nul 2>nul
if errorlevel 1 call "%~dp0fix-deps.bat" nopause

if not exist "%VENVPY%" (
  echo ERROR: no venv
  pause
  exit /b 1
)

if "%XAI_API_KEY%"=="" (
  echo.
  echo XAI_API_KEY not set. Grok will be skipped; OpenCV used.
  echo   setx XAI_API_KEY xai-your-key
  echo.
)

if "%XAI_VISION_MODEL%"=="" set XAI_VISION_MODEL=grok-build-0.1

echo Model: %XAI_VISION_MODEL%
echo Using: %VENVPY%
"%VENVPY%" -c "import sys,cv2; print(sys.executable); print('cv2', cv2.__version__)"

echo.
echo Grok once then OpenCV fallback if needed ...
"%VENVPY%" -m no3_detect calibrate-vision --cameras 0 1 2 --ids cam0 cam1 cam2 --outdir .\calib --method vision-or-auto --model %XAI_VISION_MODEL% --continue-on-error
pause
