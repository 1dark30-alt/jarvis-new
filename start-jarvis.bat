@echo off
title Jarvis V5
set "PATH=%USERPROFILE%\apps\nodejs;%USERPROFILE%\apps\PortableGit\cmd;%PATH%"
cd /d "%~dp0"

REM If the dev server is already running, just open the web UI
netstat -ano | findstr /r /c:":3000 .*LISTENING" >nul 2>&1
if %errorlevel%==0 (
  echo Jarvis is already running - opening the web UI...
  start "" "http://127.0.0.1:3000"
  timeout /t 2 >nul
  exit /b 0
)

echo Starting Jarvis...
npm run dev
echo.
echo Jarvis stopped.
pause
