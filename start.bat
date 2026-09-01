@echo off
REM Crossfeed · Windows 启动脚本（cmd / 双击）
REM 用法：双击 start.bat，或在 cmd / PowerShell 里 .\start.bat

setlocal
cd /d "%~dp0"

set "CROSSFEED_PORT=4000"
set "CROSSFEED_HOST=0.0.0.0"
set "NODE_ENV=production"

REM 探测 OPENCLI_BIN
if not defined CROSSFEED_OPENCLI_BIN (
  if exist "%USERPROFILE%\.opencli\node_modules\@jackwener\opencli\dist\src\main.js" (
    set "CROSSFEED_OPENCLI_BIN=%USERPROFILE%\.opencli\node_modules\@jackwener\opencli\dist\src\main.js"
  ) else if exist "%USERPROFILE%\.opencli\node_modules\@jackwener\opencli\dist\cli.js" (
    set "CROSSFEED_OPENCLI_BIN=%USERPROFILE%\.opencli\node_modules\@jackwener\opencli\dist\cli.js"
  ) else (
    for /f "delims=" %%i in ('where opencli 2^>nul') do (
      set "CROSSFEED_OPENCLI_BIN=%%i"
      goto :found
    )
  )
)
:found

if not exist "data" mkdir data

echo ===============================================
echo  Crossfeed · 本机信息流
echo  端口  : %CROSSFEED_HOST%:%CROSSFEED_PORT%
echo  后端  : backend\dist\server.js
echo  日志  : data\crossfeed.log
echo  停止  : Ctrl+C，或结束 node 进程
echo ===============================================

node "%~dp0backend\dist\server.js"
endlocal
