@echo off
REM Calibrate cam0, cam1, cam2 in sequence
cd /d "%~dp0.."

if not exist ".venv\Scripts\python.exe" (
  echo Virtual env missing. Run install-from-github.ps1 first.
  pause
  exit /b 1
)

echo.
echo === No3 calibrate — empty the board, then follow on-screen keys ===
echo     c = center (bull)
echo     r = outer double under mouse
echo     t = point at center of 20
echo     s = save
echo     q = quit
echo.

".venv\Scripts\python.exe" -m no3_detect calibrate --camera 0 --id cam0 --out .\calib\cam0.json
if errorlevel 1 goto fail

".venv\Scripts\python.exe" -m no3_detect calibrate --camera 1 --id cam1 --out .\calib\cam1.json
if errorlevel 1 goto fail

".venv\Scripts\python.exe" -m no3_detect calibrate --camera 2 --id cam2 --out .\calib\cam2.json
if errorlevel 1 goto fail

echo.
echo All three calibrations saved in calib\
pause
exit /b 0

:fail
echo Calibration stopped or failed.
pause
exit /b 1
