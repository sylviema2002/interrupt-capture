@echo off
cd /d "%~dp0"
set "NODE_EXE=node"
where node >nul 2>nul
if errorlevel 1 (
  if exist "C:\Program Files\nodejs\node.exe" (
    set "NODE_EXE=C:\Program Files\nodejs\node.exe"
  ) else (
    echo Cannot find Node.js.
    echo Please install Node.js, or ask your AI assistant to configure a Node.js runtime.
    pause
    exit /b 1
  )
)
"%NODE_EXE%" windows-sync-service-v3.js
if errorlevel 1 (
  echo.
  echo Interrupt Capture helper stopped with an error.
  pause
)
