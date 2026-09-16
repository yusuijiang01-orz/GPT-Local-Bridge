@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

where node >nul 2>nul || exit /b 1
if not exist "node_modules\electron\dist\electron.exe" (
  call npm install
  if errorlevel 1 exit /b 1
)

start "GPT Local Bridge" /min "%ComSpec%" /c "cd /d ""%~dp0"" && call npm run start:silent"
exit /b 0
