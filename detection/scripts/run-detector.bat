@echo off
REM No3 Darts detector – double-click or use from Startup folder
cd /d "%~dp0.."

if not exist ".venv\Scripts\python.exe" (
  echo Virtual env missing. Run scripts\setup-windows.ps1 first.
  pause
  exit /b 1
)

if not exist "config.yaml" (
  echo config.yaml missing. Copy config.example.yaml and edit it.
  pause
  exit /b 1
)

echo.
echo ============================================================
echo  No3 detector — keep THIS black window open
echo  Camera windows are separate (video + mask).
echo.
echo  FORCE TEST:
echo    1. Click a camera window
echo    2. Empty board, press B
echo    3. Stick a dart in, press T
echo    4. Look HERE for FORCE HIT / POST dart
echo ============================================================
echo.
".venv\Scripts\python.exe" -m no3_detect run --config config.yaml
if errorlevel 1 (
  echo Detector exited with an error.
  pause
)
echo.
echo Detector stopped.
pause
