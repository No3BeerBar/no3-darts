@echo off
REM Fully automatic v2 calibration — NO mouse clicks
setlocal EnableExtensions
cd /d "%~dp0.."

set "VENVPY=%CD%\.venv\Scripts\python.exe"
if not exist "%VENVPY%" call "%~dp0fix-deps.bat" nopause
"%VENVPY%" -c "import cv2" 1>nul 2>nul
if errorlevel 1 call "%~dp0fix-deps.bat" nopause

if not exist "calib" mkdir calib

if "%XAI_VISION_MODEL%"=="" set XAI_VISION_MODEL=grok-build-0.1

echo.
echo ========================================
echo  No3 v2 AUTO calibrate (no clicking)
echo ========================================
echo  Tries Grok vision if XAI_API_KEY is set,
echo  else OpenCV ellipse auto.
echo  Model: %XAI_VISION_MODEL%
echo ========================================
echo.

if "%XAI_API_KEY%"=="" (
  echo No XAI_API_KEY — using OpenCV only.
  "%VENVPY%" -m no3_detect v2-auto-calibrate --cameras 0 1 2 --ids cam0 cam1 cam2 --outdir .\calib --opencv-only -y --continue-on-error
) else (
  echo Using Grok when possible, OpenCV fallback.
  "%VENVPY%" -m no3_detect v2-auto-calibrate --cameras 0 1 2 --ids cam0 cam1 cam2 --outdir .\calib --model %XAI_VISION_MODEL% -y --continue-on-error
)

echo.
echo Next: scripts\run-detector.bat
echo Empty board, press B, throw.
pause
