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
echo  Camera pictures are separate; scores print HERE.
echo  Click a camera window, empty the board, press B, then throw.
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
