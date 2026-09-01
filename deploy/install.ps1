# Crossfeed · Windows PowerShell 一键安装
# 用法（在解压后的目录，用 PowerShell 跑）：
#   .\deploy\install.ps1                       全套（含开机自启）
#   .\deploy\install.ps1 -OpenCliOnly          只装 OpenCLI + Adapter
#   .\deploy\install.ps1 -Uninstall            卸掉本机服务（不动 OpenCLI / 登录态）
#   .\deploy\install.ps1 -NoAutostart          装但不注册开机自启
#   .\deploy\install.ps1 -Port 4000            指定端口
#
# 要求：Windows 10/11、PowerShell 5.1+、Node.js ≥ 21、npm、本机 Chrome / Edge
# 不需要管理员权限（任务计划注册在当前用户下）
[CmdletBinding()]
param(
  [switch]$OpenCliOnly,
  [switch]$Uninstall,
  [switch]$NoAutostart,
  [int]$Port = 4000,
  [string]$Host = "0.0.0.0"
)

# 自身防御：临时对本进程解除 Execution Policy（不影响系统/用户级 policy）。
# 如果机器 policy 太严连 Set-ExecutionPolicy 都禁止，用 deploy/install.bat 包装器也能跑。
try { Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force } catch { }
$ErrorActionPreference = "Stop"

# ---------------------------------------------------------------
#  路径
# ---------------------------------------------------------------
$ScriptDir   = Split-Path -Parent $MyInvocation.MyCommand.Definition
$Root        = Resolve-Path (Join-Path $ScriptDir "..")
$Label       = "Crossfeed"
$TaskName    = "Crossfeed"
$OpenCliHome = Join-Path $env:USERPROFILE ".opencli"
$OpenCliBin  = $null
$LogDir      = Join-Path $env:LOCALAPPDATA "Crossfeed"
$LogFile     = Join-Path $LogDir "crossfeed.log"
$NodeBin     = $null

# OpenCLI 适配器包（从仓库 deploy/opencli-clis/ 同步到 ~/.opencli/clis/）
$ClisBundle  = Join-Path $Root "deploy\opencli-clis"
$OpenCliPkg  = "@jackwener/opencli"

# ---------------------------------------------------------------
#  输出
# ---------------------------------------------------------------
function Write-Info  { param([string]$m) Write-Host $m -ForegroundColor Cyan }
function Write-Ok    { param([string]$m) Write-Host $m -ForegroundColor Green }
function Write-Warn  { param([string]$m) Write-Host $m -ForegroundColor DarkGray }
function Write-Err   { param([string]$m) Write-Host $m -ForegroundColor Red }

# ---------------------------------------------------------------
#  Chrome 探测
# ---------------------------------------------------------------
function Test-Chrome {
  $candidates = @(
    "${env:ProgramFiles}\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles}\Microsoft\Edge\Application\msedge.exe",
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
  )
  foreach ($p in $candidates) {
    if ($p -and (Test-Path $p)) { return $true }
  }
  $cmd = Get-Command chrome.exe -ErrorAction SilentlyContinue
  if ($cmd) { return $true }
  $cmd = Get-Command msedge.exe -ErrorAction SilentlyContinue
  if ($cmd) { return $true }
  return $false
}

# ---------------------------------------------------------------
#  局域网 IP
# ---------------------------------------------------------------
function Get-LanIp {
  try {
    $ips = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop |
      Where-Object { $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*" } |
      Sort-Object -Property PrefixLength -Descending
    if ($ips) { return $ips[0].IPAddress }
  } catch { }
  # 兜底：ipconfig
  $out = ipconfig
  foreach ($line in $out) {
    if ($line -match "IPv4") {
      $ip = ($line -split ":", 2)[1].Trim()
      if ($ip -match "^\d+\.\d+\.\d+\.\d+$") { return $ip }
    }
  }
  return ""
}

# ---------------------------------------------------------------
#  Node / npm 探测
# ---------------------------------------------------------------
function Assert-Node {
  $node = Get-Command node -ErrorAction SilentlyContinue
  if (-not $node) {
    Write-Err "找不到 node。请先装 Node.js ≥ 21 (https://nodejs.org/)"
    exit 1
  }
  $script:NodeBin = $node.Path
  $ver = & node -v
  $major = [int]($ver.TrimStart("v").Split(".")[0])
  if ($major -lt 21) {
    Write-Err "Crossfeed 需要 Node ≥ 21（当前 $ver）。"
    exit 1
  }
  Write-Ok "Node $ver ($($script:NodeBin))"
}

# ---------------------------------------------------------------
#  OpenCLI 安装
# ---------------------------------------------------------------
function Resolve-OpenCliBin {
  $main = Join-Path $OpenCliHome "node_modules\@jackwener\opencli\dist\src\main.js"
  $cli  = Join-Path $OpenCliHome "node_modules\@jackwener\opencli\dist\cli.js"
  if (Test-Path $main) { return $main }
  if (Test-Path $cli)  { return $cli }
  $cmd = Get-Command opencli -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Path }
  return $null
}

function Install-OpenCliPkg {
  if (-not (Test-Path $OpenCliHome)) { New-Item -ItemType Directory -Path $OpenCliHome | Out-Null }
  $pkg = Join-Path $OpenCliHome "package.json"
  if (-not (Test-Path $pkg)) {
    '{"name":"opencli-user-runtime","private":true,"type":"module"}' | Set-Content -Path $pkg -Encoding UTF8
  }
  Write-Info "==> 安装 $OpenCliPkg → $OpenCliHome"
  Push-Location $OpenCliHome
  try { & npm install --no-fund --no-audit $OpenCliPkg | Out-Null }
  finally { Pop-Location }
  # 全局（失败不挡）
  & npm install -g --no-fund --no-audit $OpenCliPkg *> $null
}

function Sync-Adapters {
  if (-not (Test-Path $ClisBundle)) {
    Write-Err "仓库里没有 $ClisBundle，无法同步 Crossfeed Adapter。"
    exit 1
  }
  Write-Info "==> 同步 Adapter → $OpenCliHome\clis"
  $dst = Join-Path $OpenCliHome "clis"
  if (Test-Path $dst) { Remove-Item -Recurse -Force $dst }
  New-Item -ItemType Directory -Path $dst -Force | Out-Null
  Copy-Item -Recurse -Force (Join-Path $ClisBundle "*") $dst
}

function Verify-OpenCli {
  $bin = Resolve-OpenCliBin
  if (-not $bin) {
    Write-Err "OpenCLI 装完后仍找不到入口。"
    exit 1
  }
  Write-Info "==> 探测 Adapter 列表"
  $out = & node $bin list -f json 2>$null
  if (-not $out) {
    Write-Err "opencli list 没有输出。看：$bin"
    exit 1
  }
  Write-Ok "OpenCLI 就绪：$bin"
}

function Ensure-OpenCli {
  Assert-Node
  if (Test-Chrome) { Write-Ok "已找到 Chrome / Edge。" }
  else { Write-Warn "没找到 Chrome / Edge。B 站 / 小红书 / 抖音 / YouTube / X 会抓不到；Hacker News 仍可用。" }

  $env:CROSSFEED_OPENCLI_UPDATE = "1"  # 总是让脚本里检查 + 装
  $bin = Resolve-OpenCliBin
  if ($env:CROSSFEED_OPENCLI_UPDATE -eq "1" -or -not $bin) {
    Install-OpenCliPkg
  } else {
    Write-Warn "OpenCLI 已在：$bin（要升级设 `$env:CROSSFEED_OPENCLI_UPDATE = `"1`"）"
  }
  Sync-Adapters
  Verify-OpenCli
  $script:OpenCliBin = Resolve-OpenCliBin
}

# ---------------------------------------------------------------
#  任务计划
# ---------------------------------------------------------------
function Uninstall-Service {
  $exists = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if ($exists) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false | Out-Null
  }
  $wrapper = Join-Path $Root "start-service.bat"
  if (Test-Path $wrapper) { Remove-Item $wrapper -Force }
  Write-Ok "已卸载本机服务（任务计划 $TaskName）。OpenCLI / 登录态还在。"
}

function Wait-Health {
  param([int]$TimeoutSec = 10)
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $deadline) {
    try {
      $r = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/api/health" -UseBasicParsing -TimeoutSec 1
      if ($r.StatusCode -eq 200) { return $true }
    } catch { }
    Start-Sleep -Milliseconds 250
  }
  return $false
}

function Install-Service {
  Assert-Node
  Uninstall-Service

  # wrapper 脚本：cd 到项目根、设环境变量、跑后端
  if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }
  $wrapper = Join-Path $Root "start-service.bat"
  @"
@echo off
set NODE_ENV=production
set CROSSFEED_HOST=$Host
set CROSSFEED_PORT=$Port
set CROSSFEED_OPENCLI_BIN=$OpenCliBin
cd /d "$Root"
"$NodeBin" "$Root\backend\dist\server.js" > "$LogFile" 2>&1
"@ | Set-Content -Path $wrapper -Encoding ASCII

  # 注册任务计划（ONLOGON = 用户登录时启动，LIMITED = 普通权限）
  $action = New-ScheduledTaskAction -Execute $wrapper
  $trigger = New-ScheduledTaskTrigger -AtLogOn
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Description "Crossfeed · 本机信息流聚合" | Out-Null

  # 立即跑一次
  Start-ScheduledTask -TaskName $TaskName | Out-Null
  return $LogFile
}

# ---------------------------------------------------------------
#  主流程
# ---------------------------------------------------------------
if ($Uninstall) {
  Uninstall-Service
  exit 0
}

if ($OpenCliOnly) {
  Ensure-OpenCli
  exit 0
}

Ensure-OpenCli

Write-Info "==> npm install"
Push-Location $Root
try { & npm install | Out-Null }
finally { Pop-Location }

Write-Info "==> 构建前后端"
Push-Location $Root
try { & npm run build | Out-Null }
finally { Pop-Location }

if (-not (Test-Path (Join-Path $Root "frontend\dist\index.html"))) {
  Write-Err "frontend\dist\index.html 不存在，构建失败。"
  exit 1
}

$dataDir = Join-Path $Root "data"
if (-not (Test-Path $dataDir)) { New-Item -ItemType Directory -Path $dataDir -Force | Out-Null }

$LogHint = ""
if ($NoAutostart) {
  Write-Warn "跳过注册开机自启（-NoAutostart）。手动跑：.\start.bat"
} else {
  $LogHint = Install-Service
}

if (Wait-Health) {
  Write-Ok "Crossfeed 已在本机跑起来。"
} else {
  Write-Err "服务没在 $Port 端口起来。看日志：$LogHint"
  exit 1
}

$ip = Get-LanIp
Write-Host ""
Write-Host "  本机（改站点 / 登录用这个）：  http://127.0.0.1:$Port"
if ($ip) {
  Write-Host "  手机（同一 Wi-Fi）：          http://${ip}:$Port"
}
Write-Host "  OpenCLI：                      $OpenCliBin"
Write-Host "  日志：                         $LogHint"
Write-Host "  卸载服务：                     .\deploy\install.ps1 -Uninstall"
Write-Host ""
Write-Warn "需要登录的站：用 localhost 打开设置扫码。opencli doctor 可自查浏览器。"
