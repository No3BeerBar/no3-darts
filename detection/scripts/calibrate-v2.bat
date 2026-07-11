@echo off
REM v2 4-click calibration (Autodarts / DeepDarts style)
setlocal EnableExtensions
cd /d "%~dp0.."

set "VENVPY=%CD%\.venv\Scripts\python.exe"
if not exist "%VENVPY%" call "%~dp0fix-deps.bat" nopause
"%VENVPY%" -c "import cv2" 1>nul 2>nul
if errorlevel 1 call "%~dp0fix-deps.bat" nopause

if not exist "calib" mkdir calib

echo.
echo ========================================
echo  No3 v2 calibration - 4 CLICKS per cam
echo ========================================
echo  For each camera click OUTER DOUBLE at:
echo    1) middle of segment 20  (top of board)
echo    2) middle of segment 6   (right)
echo    3) middle of segment 3   (bottom)
echo    4) middle of segment 11  (left)
echo  Then check: orange ring should look ROUND
echo  green bull on bullseye, green line to 20
echo  S=save  R=reset  SPACE=freeze frame
echo ========================================
echo.

echo === cam0 ===
"%VENVPY%" -m no3_detect v2-calibrate --camera 0 --id cam0 --out .\calib\cam0.json
echo === cam1 ===
"%VENVPY%" -m no3_detect v2-calibrate --camera 1 --id cam1 --out .\calib\cam1.json
echo === cam2 ===
"%VENVPY%" -m no3_detect v2-calibrate --camera 2 --id cam2 --out .\calib\cam2.json

echo.
echo Done. Run: scripts\run-detector.bat
pause
