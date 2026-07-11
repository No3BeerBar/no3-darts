@echo off
setlocal EnableExtensions
cd /d "%~dp0.."

set "VENVPY=%CD%\.venv\Scripts\python.exe"

if not exist "%VENVPY%" (
  echo No venv. Running fix-deps first ...
  call "%~dp0fix-deps.bat" nopause
  if errorlevel 1 (
    pause
    exit /b 1
  )
)

REM Auto-repair missing cv2
"%VENVPY%" -c "import cv2" 1>nul 2>nul
if errorlevel 1 (
  echo cv2 missing - running fix-deps ...
  call "%~dp0fix-deps.bat" nopause
  if errorlevel 1 (
    pause
    exit /b 1
  )
)

if not exist "config.yaml" (
  if exist "config.example.yaml" copy /Y config.example.yaml config.yaml >nul
)

echo.
echo ============================================================
echo  No3 detector
echo  Python: %VENVPY%
echo  Keep THIS black window open. Scores print HERE.
echo  Keys on camera window: B=empty  T=force  N=next  Q=quit
echo ============================================================
echo.

"%VENVPY%" -c "import sys,cv2; print('using', sys.executable, 'cv2', cv2.__version__)"
"%VENVPY%" -m no3_detect run --config config.yaml
set ERR=%ERRORLEVEL%

echo.
if %ERR% neq 0 (
  echo Detector exited with error %ERR%.
  echo If you see ModuleNotFoundError: run scripts\fix-deps.bat
)
echo Detector stopped.
pause
exit /b %ERR%
