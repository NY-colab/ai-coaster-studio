@echo off
setlocal
cd /d "%~dp0"
if not exist "%~dp0runtime\node.exe" (
  echo Portable Node runtime is missing. Unzip the complete release first.
  pause
  exit /b 1
)
"%~dp0runtime\node.exe" "%~dp0launcher.mjs"
if errorlevel 1 (
  echo Startup failed. Check data\startup.log.
  pause
  exit /b 1
)
