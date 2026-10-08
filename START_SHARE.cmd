@echo off
cd /d "%~dp0"
"%~dp0runtime\node.exe" "%~dp0share-launcher.mjs"
if errorlevel 1 pause
