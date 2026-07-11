@echo off
REM OpenCV-only calibration (no Grok / no API key needed)
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

echo.
echo OpenCV auto calibrate cameras 0 1 2 (no Grok API)...
echo Assumes 20 is near the TOP of each image; press Y/N per cam.
echo.

"%VENVPY%" -m no3_detect calibrate-vision --cameras 0 1 2 --ids cam0 cam1 cam2 --outdir .\calib --method auto --continue-on-error
echo.
pause
