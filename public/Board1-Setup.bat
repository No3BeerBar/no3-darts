@echo off
setlocal EnableExtensions
title No.3 Board 1 Setup
color 0C

echo.
echo ============================================================
echo  No.3 Darts — Board 1 Setup
echo  Double-click bootstrap for the mini-PC
echo ============================================================
echo.

REM Production host — bat usually runs from Downloads, not the website folder
set "NO3_URL=https://no3-darts-production.up.railway.app"
set "PS1_URL=%NO3_URL%/Board1-Setup.ps1"
set "PS1_LOCAL=%~dp0Board1-Setup.ps1"
set "PS1_RUN=%TEMP%\No3-Board1-Setup.ps1"

REM Prefer a sibling .ps1 (same folder as this .bat) for offline/dev; else download
if exist "%PS1_LOCAL%" (
  echo  Using local script: %PS1_LOCAL%
  set "PS1_RUN=%PS1_LOCAL%"
) else (
  echo  Downloading setup script...
  echo  %PS1_URL%
  powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$ErrorActionPreference='Stop';" ^
    "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12;" ^
    "Invoke-WebRequest -Uri '%PS1_URL%' -OutFile '%TEMP%\No3-Board1-Setup.ps1' -UseBasicParsing;"
  if errorlevel 1 (
    echo.
    echo  ERROR: Could not download Board1-Setup.ps1 from Railway.
    echo  URL: %PS1_URL%
    pause
    exit /b 1
  )
  set "PS1_RUN=%TEMP%\No3-Board1-Setup.ps1"
)

echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1_RUN%"
set "EXITCODE=%ERRORLEVEL%"
echo.
if not "%EXITCODE%"=="0" (
  echo  Setup finished with exit code %EXITCODE%.
  pause
)
endlocal & exit /b %EXITCODE%
