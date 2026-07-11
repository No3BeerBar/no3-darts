@echo off
REM Best calibration for oblique cameras: click outer double wire
setlocal EnableExtensions
cd /d "%~dp0.."

set "VENVPY=%CD%\.venv\Scripts\python.exe"
if not exist "%VENVPY%" call "%~dp0fix-deps.bat" nopause
"%VENVPY%" -c "import cv2" 1>nul 2>nul
if errorlevel 1 call "%~dp0fix-deps.bat" nopause

if not exist "calib" mkdir calib

echo.
echo ========================================
echo  CLICK-FIT calibration (oblique cams)
echo ========================================
echo  For EACH camera:
echo    1. Click 8-12 points on the OUTER DOUBLE wire
echo    2. Press F to fit ellipse
echo    3. Move mouse to middle of 20, press T
echo    4. Press S to save
echo    U=undo  C=clear  Q=quit
echo ========================================
echo.

echo === Camera 0 / cam0 ===
"%VENVPY%" -m no3_detect calibrate --camera 0 --id cam0 --out .\calib\cam0.json
if errorlevel 1 echo cam0 skipped or failed

echo === Camera 1 / cam1 ===
"%VENVPY%" -m no3_detect calibrate --camera 1 --id cam1 --out .\calib\cam1.json
if errorlevel 1 echo cam1 skipped or failed

echo === Camera 2 / cam2 ===
"%VENVPY%" -m no3_detect calibrate --camera 2 --id cam2 --out .\calib\cam2.json
if errorlevel 1 echo cam2 skipped or failed

echo.
echo Done. Check calib\cam0.json cam1.json cam2.json
echo Then: scripts\run-detector.bat
echo.
pause
