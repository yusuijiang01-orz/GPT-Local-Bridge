@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

where node >nul 2>nul || exit /b 1
if not exist "node_modules\electron\dist\electron.exe" exit /b 0

call npm run stop
exit /b %errorlevel%
