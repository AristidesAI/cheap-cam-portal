@echo off
setlocal
cd /d "%~dp0.."
set "PYBIN="
where py >nul 2>&1 && set "PYBIN=py -3"
if not defined PYBIN where python >nul 2>&1 && set "PYBIN=python"
if not defined PYBIN (
  echo Python 3 is required.
  pause
  exit /b 1
)
%PYBIN% "windows\cli.py" install-autostart
set "RC=%ERRORLEVEL%"
echo.
pause
exit /b %RC%
