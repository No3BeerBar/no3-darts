@echo off
setlocal EnableExtensions
cd /d "%~dp0.."

set "VENVPY=%CD%\.venv\Scripts\python.exe"

if not exist "%VENVPY%" (
  call "%~dp0fix-deps.bat" nopause
  if errorlevel 1 ( pause & exit /b 1 )
)

"%VENVPY%" -c "import cv2" 1>nul 2>nul
if errorlevel 1 (
  call "%~dp0fix-deps.bat" nopause
  if errorlevel 1 ( pause & exit /b 1 )
)

if not exist "config.yaml" (
  if exist "config.example.yaml" copy /Y config.example.yaml config.yaml >nul
)

echo.
echo ============================================================
echo  No3 detector v2 (board-plane / Autodarts-style)
echo  Python: %VENVPY%
echo  Need v2 calib: scripts\calibrate-v2.bat  (4 clicks per cam)
echo  Keys: B=empty board  N=next visit  Q=quit
echo ============================================================
echo.

"%VENVPY%" -c "import sys,cv2; print('using', sys.executable, 'cv2', cv2.__version__)"
"%VENVPY%" -m no3_detect v2-run --config config.yaml
set ERR=%ERRORLEVEL%

echo.
if %ERR% neq 0 (
  echo Detector error %ERR%.
  echo If calib skipped: run scripts\calibrate-v2.bat first.
)
echo Detector stopped.
pause
exit /b %ERR%
