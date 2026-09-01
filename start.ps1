# Crossfeed · Windows 启动脚本（PowerShell）
# 用法：.\start.ps1
# Windows 默认 Execution Policy 可能会拦截；推荐双击 start.bat 走 cmd 路径
try { Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force } catch { }
$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Definition
Set-Location $Root

if (-not $env:CROSSFEED_PORT) { $env:CROSSFEED_PORT = "4000" }
if (-not $env:CROSSFEED_HOST) { $env:CROSSFEED_HOST = "0.0.0.0" }
$env:NODE_ENV = "production"

if (-not $env:CROSSFEED_OPENCLI_BIN) {
  $candidates = @(
    (Join-Path $env:USERPROFILE ".opencli\node_modules\@jackwener\opencli\dist\src\main.js"),
    (Join-Path $env:USERPROFILE ".opencli\node_modules\@jackwener\opencli\dist\cli.js")
  )
  foreach ($p in $candidates) {
    if (Test-Path $p) {
      $env:CROSSFEED_OPENCLI_BIN = $p
      break
    }
  }
  if (-not $env:CROSSFEED_OPENCLI_BIN) {
    $cmd = Get-Command opencli -ErrorAction SilentlyContinue
    if ($cmd) { $env:CROSSFEED_OPENCLI_BIN = $cmd.Path }
  }
}

if (-not (Test-Path "data")) { New-Item -ItemType Directory -Path "data" | Out-Null }

Write-Host "==============================================="
Write-Host " Crossfeed · 本机信息流"
Write-Host " 端口  : $($env:CROSSFEED_HOST):$($env:CROSSFEED_PORT)"
Write-Host " 后端  : backend\dist\server.js"
Write-Host " 日志  : data\crossfeed.log"
Write-Host " 停止  : Ctrl+C"
Write-Host "==============================================="

& node (Join-Path $Root "backend\dist\server.js")
