@echo off
setlocal EnableExtensions
cd /d "%~dp0.."

echo.
echo ========================================
echo  No3 - setup + calibrate
echo  Folder: %CD%
echo ========================================
echo.

call "%~dp0fix-deps.bat" nopause
if errorlevel 1 (
  pause
  exit /b 1
)

set "VENVPY=%CD%\.venv\Scripts\python.exe"

if not exist "config.yaml" (
  if exist "config.example.yaml" (
    copy /Y config.example.yaml config.yaml >nul
    echo Created config.yaml
  )
)
if not exist "calib" mkdir calib

if "%XAI_API_KEY%"=="" (
  echo.
  echo NOTE: XAI_API_KEY not set - OpenCV auto if vision fails.
  echo.
)

echo.
echo Using ONLY this Python:
"%VENVPY%" -c "import sys,cv2; print(sys.executable); print('cv2', cv2.__version__)"
if errorlevel 1 (
  echo cv2 still missing after fix-deps.
  pause
  exit /b 1
)

echo.
echo Calibrating cameras 0 1 2 ...
echo Press Y to save each cam / N to skip.
echo.

"%VENVPY%" -m no3_detect calibrate-vision --cameras 0 1 2 --ids cam0 cam1 cam2 --outdir .\calib --method vision-or-auto --continue-on-error
set ERR=%ERRORLEVEL%

echo.
if %ERR% neq 0 (
  echo Calibrate failed code %ERR%
) else (
  echo Done. Next: scripts\run-detector.bat
)
pause
exit /b %ERR%
