@echo off
setlocal
cd /d "%~dp0"
title ProfileDesk Windows Builder
chcp 65001 >nul

echo ProfileDesk Windows build launcher
echo Working directory: %CD%
echo.

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0build-windows.ps1"
set "BUILD_EXIT=%ERRORLEVEL%"

echo.
if not "%BUILD_EXIT%"=="0" (
  echo Build failed with exit code %BUILD_EXIT%.
  echo Review: %~dp0build-windows.log
) else (
  echo Build completed successfully.
  echo Output: %~dp0release
)
echo.
echo This window will remain open until you press a key.
pause >nul
exit /b %BUILD_EXIT%
