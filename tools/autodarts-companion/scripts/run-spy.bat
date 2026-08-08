@echo off
setlocal EnableExtensions
cd /d "%~dp0.."

if not exist ".venv\Scripts\python.exe" (
  echo Creating venv...
  python -m venv .venv
  ".venv\Scripts\python.exe" -m pip install -r requirements.txt
)

if not exist "config.yaml" (
  copy /Y config.example.yaml config.yaml >nul
  echo Created config.yaml
)

echo.
echo Autodarts companion spy
echo Board Manager must be running at http://127.0.0.1:3180
echo.
".venv\Scripts\python.exe" -m companion spy --dump
pause
