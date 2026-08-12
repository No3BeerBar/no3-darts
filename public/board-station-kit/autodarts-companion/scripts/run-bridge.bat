@echo off
setlocal EnableExtensions
cd /d "%~dp0.."

if not exist ".venv\Scripts\python.exe" (
  echo Creating venv and installing deps...
  python -m venv .venv
  ".venv\Scripts\python.exe" -m pip install -r requirements.txt
)
if not exist "config.yaml" (
  copy /Y config.example.yaml config.yaml >nul
  echo Created config.yaml — edit no3.url / room_id / camera_api_key if needed.
)

echo.
echo ============================================================
echo  Autodarts -^> No3 bridge
echo  Autodarts Board Manager must be running (http://127.0.0.1:3180)
echo  Start a No3 match on the same room — any game mode.
echo  Extra args are passed through, e.g. run-bridge.bat --dry-run
echo ============================================================
echo.

".venv\Scripts\python.exe" -m companion bridge %*
set EXITCODE=%ERRORLEVEL%
if not "%EXITCODE%"=="0" pause
endlocal & exit /b %EXITCODE%
