@echo off
REM Crossfeed Windows launcher (cmd / double-click).
REM Double-click start.bat, or run: .\start.bat
REM This .bat file is ASCII-only so cmd.exe on Chinese Windows does not misparse comments.

setlocal
cd /d "%~dp0"

set "CROSSFEED_PORT=4000"
set "CROSSFEED_HOST=0.0.0.0"
set "NODE_ENV=production"

REM Resolve OPENCLI_BIN
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
echo  Crossfeed
echo  Port : %CROSSFEED_HOST%:%CROSSFEED_PORT%
echo  App  : backend\dist\server.js
echo  Log  : data\crossfeed.log
echo  Stop : Ctrl+C, or end the node process
echo ===============================================

node "%~dp0backend\dist\server.js"
endlocal
