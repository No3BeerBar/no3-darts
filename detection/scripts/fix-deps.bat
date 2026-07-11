@echo off
REM Install/repair Python packages into detection\.venv (fixes: no module named cv2 / rich)
setlocal EnableExtensions
cd /d "%~dp0.."

echo.
echo ========================================
echo  No3 detector - fix Python deps
echo  Folder: %CD%
echo ========================================
echo.

where python >nul 2>&1
if errorlevel 1 (
  where py >nul 2>&1
  if errorlevel 1 (
    echo ERROR: Python not found.
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
)

set VENVPY=%CD%\.venv\Scripts\python.exe
if not exist "%VENVPY%" (
  echo ERROR: missing %VENVPY%
  pause
  exit /b 1
)

echo Using: %VENVPY%
"%VENVPY%" --version

echo.
echo Upgrading pip ...
"%VENVPY%" -m pip install --upgrade pip

echo.
echo Installing base requirements ...
"%VENVPY%" -m pip install -r requirements.txt
if errorlevel 1 goto :fail

echo.
echo Installing OpenCV (cv2) - GUI package first ...
REM Install GUI build WITHOUT removing headless first (avoids leaving zero cv2)
"%VENVPY%" -m pip install --upgrade "opencv-python>=4.9.0"
if errorlevel 1 (
  echo GUI opencv-python failed - installing headless fallback ...
  "%VENVPY%" -m pip install --upgrade "opencv-python-headless>=4.9.0"
  if errorlevel 1 goto :fail
) else (
  REM Safe to drop headless only after GUI works
  "%VENVPY%" -m pip uninstall -y opencv-python-headless >nul 2>&1
)

echo.
echo Installing rich requests PyYAML numpy pydantic ...
"%VENVPY%" -m pip install --upgrade "rich>=13.7.0" "requests>=2.31.0" "PyYAML>=6.0.1" "numpy>=1.26.0" "pydantic>=2.6.0" "pydantic-settings>=2.2.0"
if errorlevel 1 goto :fail

echo.
echo Verifying imports with venv python ...
"%VENVPY%" -c "import sys; print(sys.executable); import cv2, rich, numpy, yaml, requests; print('cv2', cv2.__version__); print('rich', rich.__version__); print('ALL OK')"
if errorlevel 1 goto :fail

echo.
echo SUCCESS - always run with:
echo   .venv\Scripts\python.exe -m no3_detect ...
echo or:
echo   scripts\run-detector.bat
echo   scripts\setup-and-calibrate.bat
echo.
pause
exit /b 0

:fail
echo.
echo FAILED. Copy the error text above.
echo Common fix: run THIS bat only, not bare "python".
pause
exit /b 1
