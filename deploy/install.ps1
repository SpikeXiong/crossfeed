# Crossfeed · Windows PowerShell 一键安装
# Encoding: UTF-8 with BOM (Windows PowerShell 5.1 无 BOM 会按系统 ANSI/GBK 读，中文注释会炸解析)
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
  [string]$BindHost = "0.0.0.0"
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
$NpmCmd      = $null

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

# PS 5.1: $ErrorActionPreference does not stop native commands. Check $LASTEXITCODE.
function Assert-NativeExit {
  param([string]$Label)
  if ($LASTEXITCODE -ne 0) {
    Write-Err "$Label 失败（exit $LASTEXITCODE）。"
    exit $LASTEXITCODE
  }
}

# Node 22 ships npm.ps1; "& npm install" makes that shim drop the first letter → Unknown command "pm".
# Always invoke npm.cmd. See https://github.com/npm/cli/issues/8528
function Resolve-NpmCmd {
  $app = Get-Command npm.cmd -ErrorAction SilentlyContinue
  if ($app -and $app.Path -and ($app.Path -like "*.cmd")) { return $app.Path }
  $npm = Get-Command npm -ErrorAction SilentlyContinue
  if ($npm -and $npm.Path) {
    $sibling = Join-Path (Split-Path -Parent $npm.Path) "npm.cmd"
    if (Test-Path $sibling) { return $sibling }
  }
  foreach ($root in @(${env:ProgramFiles}, ${env:ProgramFiles(x86)})) {
    if (-not $root) { continue }
    $candidate = Join-Path $root "nodejs\npm.cmd"
    if (Test-Path $candidate) { return $candidate }
  }
  return $null
}

function Invoke-Npm {
  param(
    [Parameter(Mandatory = $true)]
    [string[]]$NpmArgs,
    [string]$FailLabel = ""
  )
  if (-not $script:NpmCmd -or ($script:NpmCmd -like "*.ps1")) {
    Write-Err "拒绝调用 npm.ps1（Node 22 shim 会把 install 收成 pm）。需要 npm.cmd。"
    exit 1
  }
  # Splat a string[] so "@jackwener/opencli" stays one argument (not PS splat).
  # PS 5.1 + ErrorAction Stop: native stderr becomes a terminating NativeCommandError.
  $prev = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    & $script:NpmCmd @NpmArgs
  } finally {
    $ErrorActionPreference = $prev
  }
  if ($FailLabel) { Assert-NativeExit $FailLabel }
}

# PS 5.1 Set-Content -Encoding UTF8 writes a BOM; npm then EJSONPARSE's package.json.
function Write-Utf8NoBom {
  param([string]$Path, [string]$Text)
  $enc = New-Object System.Text.UTF8Encoding $false
  [System.IO.File]::WriteAllText($Path, $Text, $enc)
}

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
  $node = Get-Command node.exe -CommandType Application -ErrorAction SilentlyContinue
  if (-not $node) { $node = Get-Command node -ErrorAction SilentlyContinue }
  if (-not $node) {
    Write-Err "找不到 node。请先装 Node.js ≥ 21 (https://nodejs.org/)"
    exit 1
  }
  $script:NodeBin = $node.Path
  if (-not $script:NodeBin) { $script:NodeBin = $node.Definition }
  if ($script:NodeBin -like "*.ps1") {
    $exe = Join-Path (Split-Path -Parent $script:NodeBin) "node.exe"
    if (Test-Path $exe) { $script:NodeBin = $exe }
  }

  $script:NpmCmd = Resolve-NpmCmd
  if (-not $script:NpmCmd) {
    Write-Err "找不到 npm.cmd。请先装 Node.js（https://nodejs.org/）"
    exit 1
  }

  $prev = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try { $ver = & $script:NodeBin -v } finally { $ErrorActionPreference = $prev }
  $major = [int]($ver.TrimStart("v").Split(".")[0])
  if ($major -lt 21) {
    Write-Err "Crossfeed 需要 Node ≥ 21（当前 $ver）。"
    exit 1
  }
  Write-Ok "Node $ver ($($script:NodeBin))"
  Write-Ok "npm $($script:NpmCmd)"
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
  $pkgJson = '{"name":"opencli-user-runtime","private":true,"type":"module"}'
  if (-not (Test-Path $pkg)) {
    Write-Utf8NoBom $pkg $pkgJson
  } else {
    $bytes = [System.IO.File]::ReadAllBytes($pkg)
    if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) {
      Write-Warn "去掉 $pkg 的 UTF-8 BOM（npm 无法解析）。"
      $text = [System.Text.Encoding]::UTF8.GetString($bytes, 3, $bytes.Length - 3)
      Write-Utf8NoBom $pkg $text
    }
  }
  Write-Info "==> 安装 $OpenCliPkg → $OpenCliHome"
  Push-Location $OpenCliHome
  try {
    Invoke-Npm -NpmArgs @("install", "--no-fund", "--no-audit", $OpenCliPkg) `
      -FailLabel "npm install $OpenCliPkg → $OpenCliHome"
  } finally { Pop-Location }
  # 全局（失败不挡；后端走 ~/.opencli 入口）
  Invoke-Npm -NpmArgs @("install", "-g", "--no-fund", "--no-audit", $OpenCliPkg)
  if ($LASTEXITCODE -ne 0) {
    Write-Warn "全局 npm 没装上 opencli 命令，不影响：后端会走 $OpenCliHome"
  }
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

function Get-NativeStdout {
  param(
    [Parameter(Mandatory = $true)][string]$File,
    [string[]]$NativeArgs
  )
  # PS 5.1 + $ErrorActionPreference Stop treats native stderr as terminating.
  # opencli list writes warnings (missing YAML adapters) to stderr but JSON to stdout.
  $prev = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $raw = & $File @NativeArgs 2>&1
  } finally {
    $ErrorActionPreference = $prev
  }
  $lines = New-Object System.Collections.Generic.List[string]
  foreach ($item in @($raw)) {
    if ($item -is [System.Management.Automation.ErrorRecord]) {
      $msg = [string]$item
      if ($msg) { Write-Warn $msg }
    } else {
      $s = [string]$item
      if ($s) { [void]$lines.Add($s) }
    }
  }
  return ($lines -join "`n")
}

function Verify-OpenCli {
  $bin = Resolve-OpenCliBin
  if (-not $bin) {
    Write-Err "OpenCLI 装完后仍找不到入口。看上面的 npm 输出，以及 $OpenCliHome\node_modules\@jackwener\opencli"
    exit 1
  }
  Write-Info "==> 探测 Adapter 列表"
  $out = Get-NativeStdout -File $script:NodeBin -NativeArgs @($bin, "list", "-f", "json")
  $jsonish = $out -match '\[|\{'
  if (-not $jsonish) {
    Write-Err "opencli list 没有 JSON 输出。看：$bin"
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

  # Use a string array (not a here-string): PS 5.1 can misparse indented here-string openers.
  $lines = @(
    '@echo off',
    'set NODE_ENV=production',
    ('set CROSSFEED_HOST=' + $BindHost),
    ('set CROSSFEED_PORT=' + $Port),
    ('set CROSSFEED_OPENCLI_BIN=' + $OpenCliBin),
    ('cd /d "' + $Root + '"'),
    ('"' + $NodeBin + '" "' + $Root + '\backend\dist\server.js" > "' + $LogFile + '" 2>&1')
  )
  $content = ($lines -join "`r`n")
  [System.IO.File]::WriteAllText($wrapper, $content, [System.Text.Encoding]::ASCII)

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
try {
  Invoke-Npm -NpmArgs @("install") -FailLabel "npm install"
} finally { Pop-Location }

Write-Info "==> 构建前后端"
Push-Location $Root
try {
  Invoke-Npm -NpmArgs @("run", "build") -FailLabel "npm run build"
} finally { Pop-Location }

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
