@echo off
REM Install cv2 + deps into detection\.venv ONLY
REM Usage: double-click OR: scripts\fix-deps.bat
REM        scripts\fix-deps.bat nopause   (for use from other bats)
setlocal EnableExtensions
cd /d "%~dp0.."

set NOPAUSE=0
if /I "%~1"=="nopause" set NOPAUSE=1

echo.
echo ========================================
echo  No3 - fix deps (cv2 / rich)
echo  Working dir: %CD%
echo ========================================
echo.

REM --- find a bootstrap Python to create venv ---
set PYBOOT=
where python >nul 2>&1 && set PYBOOT=python
if not defined PYBOOT (
  where py >nul 2>&1 && set PYBOOT=py
)
if not defined PYBOOT (
  echo ERROR: No system Python on PATH.
  echo Install from https://www.python.org/downloads/windows/
  echo Tick: Add python.exe to PATH
  goto :fail
)

if not exist ".venv\Scripts\python.exe" (
  echo Creating .venv with %PYBOOT% ...
  if /I "%PYBOOT%"=="py" (
    py -3 -m venv .venv
  ) else (
    python -m venv .venv
  )
)

if not exist ".venv\Scripts\python.exe" (
  echo ERROR: .venv\Scripts\python.exe was not created.
  goto :fail
)

REM Always use absolute path into THIS folder's venv
set "VENVPY=%CD%\.venv\Scripts\python.exe"
echo VENV python:
"%VENVPY%" -c "import sys; print(sys.executable); print(sys.version)"
if errorlevel 1 goto :fail

echo.
echo [1/4] pip upgrade
"%VENVPY%" -m pip install --upgrade pip setuptools wheel
if errorlevel 1 goto :fail

echo.
echo [2/4] requirements.txt
if exist "requirements.txt" (
  "%VENVPY%" -m pip install -r requirements.txt
  if errorlevel 1 goto :fail
)

echo.
echo [3/4] force-install OpenCV as cv2
REM Do NOT uninstall anything first - avoids ending with zero opencv
"%VENVPY%" -m pip install --upgrade --force-reinstall "opencv-python>=4.9.0"
if errorlevel 1 (
  echo opencv-python failed, trying headless ...
  "%VENVPY%" -m pip install --upgrade --force-reinstall "opencv-python-headless>=4.9.0"
  if errorlevel 1 goto :fail
)

echo.
echo [4/4] other packages
"%VENVPY%" -m pip install --upgrade "rich>=13.7.0" "requests>=2.31.0" "PyYAML>=6.0.1" "numpy>=1.26.0" "pydantic>=2.6.0" "pydantic-settings>=2.2.0"
if errorlevel 1 goto :fail

echo.
echo --- pip show opencv ---
"%VENVPY%" -m pip show opencv-python opencv-python-headless 2>nul

echo.
echo --- import test (must use venv) ---
"%VENVPY%" -c "import sys; print('exe=', sys.executable); import cv2; print('cv2=', cv2.__version__); import rich; print('rich=OK'); print('SUCCESS')"
if errorlevel 1 (
  echo.
  echo import cv2 FAILED even after install.
  echo If error mentions DLL: install Microsoft Visual C++ Redistributable
  echo   https://aka.ms/vs/17/release/vc_redist.x64.exe
  goto :fail
)

echo.
echo ========================================
echo  DEPS OK
echo  ALWAYS run commands like this:
echo    %CD%\.venv\Scripts\python.exe -m no3_detect ...
echo  NOT bare:  python -m no3_detect ...
echo ========================================
echo.
if %NOPAUSE%==0 pause
exit /b 0

:fail
echo.
echo FAILED.
if %NOPAUSE%==0 pause
exit /b 1
