@echo off
setlocal EnableExtensions
cd /d "%~dp0.."

echo.
echo ========================================
echo  No3 - setup + OpenCV calibrate
echo  (Grok optional - use calibrate-vision.bat)
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

echo.
echo Using:
"%VENVPY%" -c "import sys,cv2; print(sys.executable); print('cv2', cv2.__version__)"
if errorlevel 1 (
  echo cv2 still missing.
  pause
  exit /b 1
)

echo.
echo Running FULLY AUTO v2 calibrate (no mouse clicks)...
echo.

if not exist "calib" mkdir calib

if "%XAI_API_KEY%"=="" (
  "%VENVPY%" -m no3_detect v2-auto-calibrate --cameras 0 1 2 --ids cam0 cam1 cam2 --outdir .\calib --opencv-only -y --continue-on-error
) else (
  if "%XAI_VISION_MODEL%"=="" set XAI_VISION_MODEL=grok-build-0.1
  "%VENVPY%" -m no3_detect v2-auto-calibrate --cameras 0 1 2 --ids cam0 cam1 cam2 --outdir .\calib --model %XAI_VISION_MODEL% -y --continue-on-error
)

echo.
echo Done. Next: scripts\run-detector.bat
echo Manual 4-click only if auto fails: scripts\calibrate-v2.bat
pause
exit /b 0
