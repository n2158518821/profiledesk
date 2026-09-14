@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 24 is required. Install it from https://nodejs.org/ first.
  pause
  exit /b 1
)

echo [1/3] Installing dependencies...
call npm install
if errorlevel 1 goto :failed

echo [2/3] Running checks...
call npm run verify
if errorlevel 1 goto :failed

echo [3/3] Building Windows installer and portable package...
call npm run dist:win
if errorlevel 1 goto :failed

echo Build completed. Output: %CD%\release
start "" "%CD%\release"
pause
exit /b 0

:failed
echo Build failed. Review the error output above.
pause
exit /b 1
