@echo off
setlocal EnableExtensions
cd /d "%~dp0.."

if not exist ".venv\Scripts\python.exe" (
  python -m venv .venv
  ".venv\Scripts\python.exe" -m pip install -r requirements.txt
)
if not exist "config.yaml" copy /Y config.example.yaml config.yaml >nul

echo.
echo Autodarts -^> No3 bridge
echo Autodarts Board Manager must be running and detecting.
echo No3 match must be open on the same room.
echo.
".venv\Scripts\python.exe" -m companion bridge
pause
