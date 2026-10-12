@echo off
setlocal
rem Use Windows PowerShell's own modules even when launched from PowerShell 7.
set "PSModulePath="
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0START-LITE.ps1"
if errorlevel 1 pause
