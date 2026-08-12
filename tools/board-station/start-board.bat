@echo off
setlocal EnableExtensions
cd /d "%~dp0"

echo.
echo  No. 3 Board Station - starting stack...
echo.

REM Prefer PowerShell 5+ (Windows mini-PC). Extra args forwarded.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start-Board.ps1" %*
set EXITCODE=%ERRORLEVEL%
if not "%EXITCODE%"=="0" (
  echo.
  echo Start-Board failed with exit %EXITCODE%.
  echo PHOTO this window if you need help.
  if "%EXITCODE%"=="3" echo Exit 3 = Autodarts missing / not running.
  pause
)
endlocal & exit /b %EXITCODE%
