@echo off
REM cheap-cam-portal — Windows one-time setup
setlocal
cd /d "%~dp0.."

REM ---------- locate Python 3 ----------
set "PYBIN="
where py >nul 2>&1 && set "PYBIN=py -3"
if not defined PYBIN where python >nul 2>&1 && set "PYBIN=python"
if not defined PYBIN (
  echo.
  echo Python 3 is required but was not found on your PATH.
  echo.
  echo Install Python from https://www.python.org/downloads/
  echo During install, tick "Add python.exe to PATH".
  echo.
  echo Then double-click setup.bat again.
  echo.
  pause
  exit /b 1
)

%PYBIN% "windows\cli.py" setup
set "RC=%ERRORLEVEL%"
echo.
pause
exit /b %RC%
