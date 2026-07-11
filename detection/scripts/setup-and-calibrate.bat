@echo off
REM One-shot: venv + pip install + vision calibrate (all 3 cams)
cd /d "%~dp0.."

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-and-calibrate.ps1" %*
if errorlevel 1 (
  echo.
  echo Setup failed.
  pause
  exit /b 1
)
echo.
pause
