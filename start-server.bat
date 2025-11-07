@echo off
title Social Platform File Upload Server
cd /d "%~dp0"
echo ========================================
echo Starting Social Platform File Upload Server
echo ========================================
echo.
echo Server will start on http://localhost:3000
echo Press Ctrl+C to stop the server
echo.
echo ========================================
echo.

REM Add Node.js to PATH if not already there
set "PATH=%PATH%;C:\Program Files\nodejs"

REM Check if Node.js is available
where node >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Node.js not found in PATH
    echo Please install Node.js or update the PATH in this file
    echo.
    pause
    exit /b 1
)

REM Check if dependencies are installed
if not exist "node_modules" (
    echo Installing dependencies...
    call npm install
    if %ERRORLEVEL% NEQ 0 (
        echo ERROR: Failed to install dependencies
        pause
        exit /b 1
    )
    echo.
)

REM Start the server
node server.js

REM Keep window open if server stops
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo Server stopped with an error
    pause
)

