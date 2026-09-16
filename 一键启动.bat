@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

where node >nul 2>nul || (
  echo [错误] 未找到 Node.js 20+。
  pause
  exit /b 1
)

set NEED_INSTALL=0
if not exist "node_modules\electron\dist\electron.exe" set NEED_INSTALL=1
if not exist "node_modules\@modelcontextprotocol\sdk\package.json" set NEED_INSTALL=1
if not exist "node_modules\zod\package.json" set NEED_INSTALL=1

if "%NEED_INSTALL%"=="1" (
  echo [GPT Local Bridge] 检测到依赖缺失，正在安装/更新...
  call npm install
  if errorlevel 1 (
    echo [错误] npm install 失败。
    pause
    exit /b 1
  )
)

call npm start
exit /b %errorlevel%
