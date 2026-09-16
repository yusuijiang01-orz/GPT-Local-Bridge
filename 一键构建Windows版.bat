@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

where node >nul 2>nul || (
  echo [错误] 未找到 Node.js 20+。
  pause
  exit /b 1
)

echo [GPT Local Bridge] 安装/更新依赖...
call npm install
if errorlevel 1 goto :error

echo [GPT Local Bridge] 运行语法检查...
call npm run check
if errorlevel 1 goto :error

echo [GPT Local Bridge] 构建 Windows 安装包和 Portable 版本...
call npm run dist:win
if errorlevel 1 goto :error

echo.
echo 构建完成，请查看 dist 目录。
pause
exit /b 0

:error
echo.
echo [错误] 构建失败，请查看上方输出。
pause
exit /b 1
