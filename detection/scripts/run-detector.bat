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

echo Starting No3 detector...
".venv\Scripts\python.exe" -m no3_detect run --config config.yaml
if errorlevel 1 (
  echo Detector exited with an error.
  pause
)
