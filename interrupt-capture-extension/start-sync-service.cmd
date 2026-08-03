@echo off
cd /d "%~dp0"
set "NODE_EXE=node"
where node >nul 2>nul
if errorlevel 1 (
  if exist "C:\Program Files\nodejs\node.exe" (
    set "NODE_EXE=C:\Program Files\nodejs\node.exe"
  ) else (
    echo Cannot find Node.js.
    echo Please install Node.js, or add node.exe to PATH.
    pause
    exit /b 1
  )
)
"%NODE_EXE%" feishu-sync-service.js
if errorlevel 1 (
  echo.
  echo Sync service stopped with an error.
  pause
)
