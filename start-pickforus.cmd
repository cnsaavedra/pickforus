@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  if exist "%LOCALAPPDATA%\pi-node\current\node.exe" (
    set "PATH=%LOCALAPPDATA%\pi-node\current;%SystemRoot%\system32;%SystemRoot%"
  ) else if exist "%ProgramFiles%\nodejs\node.exe" (
    set "PATH=%ProgramFiles%\nodejs;%SystemRoot%\system32;%SystemRoot%"
  )
)

if not exist "node_modules" (
  echo Installing PickForUs dependencies...
  call npm install || exit /b 1
)

if not exist "dist\client\index.html" (
  echo Building PickForUs client...
  call npm run build || exit /b 1
)

if not exist "dist\server\index.js" (
  echo Building PickForUs server...
  call npm run build || exit /b 1
)

echo Starting PickForUs on http://localhost:3000 ...
start "" /b cmd /c "ping -n 2 127.0.0.1 >nul && start http://localhost:3000"
node --no-warnings dist\server\index.js --prod
