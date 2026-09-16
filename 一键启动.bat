@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

where node >nul 2>nul || (
  echo [错误] 未找到 Node.js 20+。
  pause
  exit /b 1
)

if not exist "node_modules\electron\dist\electron.exe" (
  echo [GPT Local Bridge] 首次运行，正在安装依赖...
  call npm install
  if errorlevel 1 (
    echo [错误] npm install 失败。
    pause
    exit /b 1
  )
)

call npm start
exit /b %errorlevel%
