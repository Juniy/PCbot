@echo off
REM PCbot startup script - starts server in new window, keeps this window open
cd /d "%~dp0"

chcp 65001 >nul
title PCbot

echo ========================================
echo   PCbot - Automation Workhorse System
echo ========================================
echo.

where bun >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Bun not found! Please install: https://bun.sh
    pause
    exit /b 1
)

echo [OK] Bun found: 
for /f %%i in ('bun --version') do set BUN_VER=%%i
echo   v%BUN_VER%
echo.
echo [OK] Project directory: %CD%
if exist src\index.ts (
    echo [OK] src/index.ts found
) else (
    echo [ERROR] src/index.ts not found in %CD%
    pause
    exit /b 1
)
echo.

echo ========================================
echo  Starting PCbot server in new window...
echo ========================================
echo   Web UI:      http://localhost:51898
echo   Webhook:     POST http://localhost:51897/webhook
echo   Chat API:    POST http://localhost:51898/api/chat
echo.
echo  Server window will open and show live logs.
echo  Close server window to shutdown, or press Ctrl+C.
echo.

start "PCbot Server" cmd /k "bun run src/index.ts --serve"

echo [OK] Server started in new window.
echo.
echo Press any key to close this window (server keeps running)...
pause >nul
