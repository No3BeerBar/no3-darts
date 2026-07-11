@echo off
setlocal EnableExtensions
cd /d "%~dp0.."

echo.
echo ========================================
echo  No3 detector - setup + calibrate
echo  Folder: %CD%
echo ========================================
echo.

REM Step 1: deps (includes cv2)
call "%~dp0fix-deps.bat"
if errorlevel 1 exit /b 1

set VENVPY=%CD%\.venv\Scripts\python.exe

if not exist "config.yaml" (
  if exist "config.example.yaml" (
    copy /Y config.example.yaml config.yaml >nul
    echo Created config.yaml from example.
  )
)

if not exist "calib" mkdir calib

if "%XAI_API_KEY%"=="" (
  echo.
  echo NOTE: XAI_API_KEY not set - OpenCV auto used if vision fails.
  echo   setx XAI_API_KEY xai-your-key
  echo.
)

echo.
echo Calibrating cameras 0 1 2 with:
echo   %VENVPY%
echo For each cam: check ellipse, press Y to save / N to skip.
echo.

"%VENVPY%" -m no3_detect calibrate-vision --cameras 0 1 2 --ids cam0 cam1 cam2 --outdir .\calib --method vision-or-auto --continue-on-error
if errorlevel 1 (
  echo.
  echo Calibrate failed.
  pause
  exit /b 1
)

echo.
echo ========================================
echo  Done. Next:
echo    1. Check calib\cam0.json cam1.json cam2.json
echo    2. scripts\run-detector.bat
echo    3. Empty board, press B, throw
echo ========================================
echo.
pause
exit /b 0
