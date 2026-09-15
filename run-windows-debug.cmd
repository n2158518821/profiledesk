@echo off
setlocal
cd /d "%~dp0"

set "PROFILEDESK_EXE=%CD%\release\win-unpacked\ProfileDesk.exe"
set "PROFILEDESK_LOG=%CD%\profiledesk-windows-debug.log"

if not exist "%PROFILEDESK_EXE%" (
  echo Cannot find: %PROFILEDESK_EXE%
  echo Run build-windows.cmd first.
  pause
  exit /b 1
)

echo Starting ProfileDesk in safe mode...
echo Debug output: %PROFILEDESK_LOG%
set ELECTRON_ENABLE_LOGGING=1
set ELECTRON_ENABLE_STACK_DUMPING=1
"%PROFILEDESK_EXE%" --safe-mode --enable-logging --v=1 > "%PROFILEDESK_LOG%" 2>&1

echo.
echo ProfileDesk exited. Send these two logs when troubleshooting:
echo %PROFILEDESK_LOG%
echo %%APPDATA%%\profiledesk\startup.log
pause
