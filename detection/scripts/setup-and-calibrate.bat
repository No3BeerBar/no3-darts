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
echo Calibrating with OpenCV auto (no Grok API) ...
echo For each cam: ellipse should sit on outer double, Y=save N=skip.
echo Tip: 20 should be near TOP of image, or press t later in manual calibrate.
echo.

"%VENVPY%" -m no3_detect calibrate-vision --cameras 0 1 2 --ids cam0 cam1 cam2 --outdir .\calib --method auto --continue-on-error
set ERR=%ERRORLEVEL%

echo.
if %ERR% neq 0 (
  echo Calibrate failed code %ERR%
) else (
  echo Done. Next: scripts\run-detector.bat
  echo Optional Grok later: scripts\calibrate-vision.bat
)
pause
exit /b %ERR%
