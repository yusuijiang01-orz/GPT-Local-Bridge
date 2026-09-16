@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

echo [GPT Local Bridge] 检查 Node.js...
where node >nul 2>nul || (
  echo [错误] 未找到 Node.js。请先安装 Node.js 20 或更高版本。
  pause
  exit /b 1
)
where npm >nul 2>nul || (
  echo [错误] 未找到 npm。
  pause
  exit /b 1
)

echo [GPT Local Bridge] 安装/更新依赖...
call npm install
if errorlevel 1 goto :error

echo [GPT Local Bridge] 运行语法检查...
call npm run check
if errorlevel 1 goto :error

echo [GPT Local Bridge] 启动控制面板...
call npm start
exit /b %errorlevel%

:error
echo.
echo [错误] 安装或检查失败，请查看上方输出。
pause
exit /b 1
