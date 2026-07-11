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
echo Auto ellipse is often BAD on dartboards.
echo Recommended: CLICK-FIT on the outer double wire.
echo.
echo Launching click calibrate for cam 0, 1, 2 ...
echo   Click 8-12 points on OUTER DOUBLE, press F, then T on 20, then S
echo.

if not exist "calib" mkdir calib

"%VENVPY%" -m no3_detect calibrate --camera 0 --id cam0 --out .\calib\cam0.json
"%VENVPY%" -m no3_detect calibrate --camera 1 --id cam1 --out .\calib\cam1.json
"%VENVPY%" -m no3_detect calibrate --camera 2 --id cam2 --out .\calib\cam2.json

echo.
echo Done. Next: scripts\run-detector.bat
echo Or re-do one cam: scripts\calibrate-click.bat
pause
exit /b 0
