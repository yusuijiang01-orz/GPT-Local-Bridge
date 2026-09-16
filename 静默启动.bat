@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

where node >nul 2>nul || exit /b 1
set NEED_INSTALL=0
if not exist "node_modules\electron\dist\electron.exe" set NEED_INSTALL=1
if not exist "node_modules\@modelcontextprotocol\sdk\package.json" set NEED_INSTALL=1
if not exist "node_modules\zod\package.json" set NEED_INSTALL=1

if "%NEED_INSTALL%"=="1" (
  call npm install
  if errorlevel 1 exit /b 1
)

start "GPT Local Bridge" /min "%ComSpec%" /c "cd /d ""%~dp0"" && call npm run start:silent"
exit /b 0
