@echo off
title Stop Social Platform Server
echo Stopping Social Platform File Upload Server...
echo.

REM Add Node.js to PATH if not already there
set "PATH=%PATH%;C:\Program Files\nodejs"

REM Find and stop Node.js processes running server.js
for /f "tokens=2" %%a in ('tasklist /FI "IMAGENAME eq node.exe" /FO LIST 2^>nul ^| findstr /I "PID"') do (
    wmic process where "ProcessId=%%a" get CommandLine 2>nul | findstr /I "server.js" >nul
    if %errorlevel% equ 0 (
        taskkill /F /PID %%a >nul 2>&1
        echo Stopped server process (PID: %%a)
    )
)

echo.
echo Server stopped.
timeout /t 2 >nul

