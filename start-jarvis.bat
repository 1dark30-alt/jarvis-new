@echo off
title Jarvis V5
set "PATH=%USERPROFILE%\apps\nodejs;%USERPROFILE%\apps\PortableGit\cmd;%PATH%"
cd /d "%~dp0"

REM Kill any stale dev server first — a hung old process serves stale code
REM (hot-reload silently stops working on OneDrive-watched paths)
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /r /c:":3000 .*LISTENING" 2^>nul') do (
  echo Killing stale server PID %%P ...
  taskkill /F /PID %%P >nul 2>&1
)
taskkill /F /IM electron.exe >nul 2>&1

echo Starting Jarvis...
npm run dev
echo.
echo Jarvis stopped.
pause
