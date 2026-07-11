@echo off
REM Calibrate all cameras with Grok vision (or OpenCV auto fallback)
cd /d "%~dp0.."

if not exist ".venv\Scripts\python.exe" (
  echo Virtual env missing. Run install-from-github.ps1 first.
  pause
  exit /b 1
)

if "%XAI_API_KEY%"=="" (
  echo.
  echo Optional: set XAI_API_KEY for Grok vision calibration.
  echo   setx XAI_API_KEY "xai-..."
  echo Without a key, OpenCV auto-calibration will be used.
  echo.
)

echo Calibrating cameras 0 1 2 with vision-or-auto...
".venv\Scripts\python.exe" -m no3_detect calibrate-vision --cameras 0 1 2 --ids cam0 cam1 cam2 --outdir .\calib --method vision-or-auto --continue-on-error
echo.
pause
