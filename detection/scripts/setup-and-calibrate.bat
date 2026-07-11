@echo off
setlocal EnableExtensions
cd /d "%~dp0.."

echo.
echo ========================================
echo  No3 detector - setup + calibrate
echo  Folder: %CD%
echo ========================================
echo.

REM Prefer venv python later; first ensure python exists
where python >nul 2>&1
if errorlevel 1 (
  where py >nul 2>&1
  if errorlevel 1 (
    echo ERROR: Python not found. Install 3.11+ and tick Add to PATH.
    pause
    exit /b 1
  )
  set PYLAUNCH=py -3
) else (
  set PYLAUNCH=python
)

if not exist ".venv\Scripts\python.exe" (
  echo Creating .venv ...
  %PYLAUNCH% -m venv .venv
  if errorlevel 1 (
    echo ERROR: venv create failed
    pause
    exit /b 1
  )
)

set VENVPY=%CD%\.venv\Scripts\python.exe
if not exist "%VENVPY%" (
  echo ERROR: missing %VENVPY%
  pause
  exit /b 1
)

echo Upgrading pip ...
"%VENVPY%" -m pip install --upgrade pip
if errorlevel 1 goto :fail

echo Installing requirements.txt ...
"%VENVPY%" -m pip install -r requirements.txt
if errorlevel 1 goto :fail

echo Installing opencv-python GUI ...
"%VENVPY%" -m pip uninstall -y opencv-python-headless >nul 2>&1
"%VENVPY%" -m pip install "opencv-python>=4.9.0"
if errorlevel 1 goto :fail

echo Ensuring rich requests PyYAML numpy ...
"%VENVPY%" -m pip install "rich>=13.7.0" "requests>=2.31.0" "PyYAML>=6.0.1" "numpy>=1.26.0"
if errorlevel 1 goto :fail

echo Verifying imports ...
"%VENVPY%" -c "import rich, cv2, numpy, yaml, requests; print('OK')"
if errorlevel 1 goto :fail

if not exist "config.yaml" (
  if exist "config.example.yaml" (
    copy /Y config.example.yaml config.yaml >nul
    echo Created config.yaml from example.
  )
)

if not exist "calib" mkdir calib

if "%XAI_API_KEY%"=="" (
  echo.
  echo NOTE: XAI_API_KEY not set - OpenCV auto used if vision fails.
  echo   setx XAI_API_KEY xai-your-key
  echo   then open a NEW command window
  echo.
)

echo.
echo Calibrating cameras 0 1 2 ...
echo For each cam: check ellipse, press Y to save / N to skip.
echo.

"%VENVPY%" -m no3_detect calibrate-vision --cameras 0 1 2 --ids cam0 cam1 cam2 --outdir .\calib --method vision-or-auto --continue-on-error
if errorlevel 1 goto :fail

echo.
echo ========================================
echo  Done. Next:
echo    1. Check calib\cam0.json cam1.json cam2.json
echo    2. scripts\run-detector.bat
echo    3. Empty board, press B, throw
echo ========================================
echo.
pause
exit /b 0

:fail
echo.
echo FAILED. See messages above.
pause
exit /b 1
