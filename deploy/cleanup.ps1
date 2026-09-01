# Crossfeed · Windows OpenCLI cleanup
# Encoding: UTF-8 with BOM (Windows PowerShell 5.1 无 BOM 会按系统 ANSI/GBK 读)
#
# 用法：
#   .\deploy\cleanup.bat
#   .\deploy\cleanup.ps1 -Yes
#
# 会删掉：
#   %USERPROFILE%\.opencli          （含坏掉的 junction、runtime、Adapter、登录 cookie）
#   全局 npm 包 @jackwener/opencli
# 不会卸载 Crossfeed 任务计划（那是 .\deploy\install.bat -Uninstall）。
[CmdletBinding()]
param(
  [switch]$Yes
)

try { Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force } catch { }
$ErrorActionPreference = "Stop"

$OpenCliHome = Join-Path $env:USERPROFILE ".opencli"

function Write-Info { param([string]$m) Write-Host $m -ForegroundColor Cyan }
function Write-Ok   { param([string]$m) Write-Host $m -ForegroundColor Green }
function Write-Warn { param([string]$m) Write-Host $m -ForegroundColor DarkGray }
function Write-Err  { param([string]$m) Write-Host $m -ForegroundColor Red }

# Node 22 npm.ps1 + "& npm" → Unknown command "pm". Always use npm.cmd.
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

# Junction-safe recursive delete. Remove-Item -Recurse on a junction can wipe the target
# (e.g. the global npm package). Reparse points are removed as links only.
function Remove-TreeJunctionSafe {
  param([string]$Path)
  if (-not (Test-Path -LiteralPath $Path)) { return }
  $item = Get-Item -LiteralPath $Path -Force
  $reparse = [bool]($item.Attributes -band [IO.FileAttributes]::ReparsePoint)
  if ($reparse) {
    if ($item.PSIsContainer) { cmd.exe /c "rmdir `"$Path`"" | Out-Null }
    else { Remove-Item -LiteralPath $Path -Force }
    return
  }
  if ($item.PSIsContainer) {
    Get-ChildItem -LiteralPath $Path -Force -ErrorAction SilentlyContinue | ForEach-Object {
      Remove-TreeJunctionSafe $_.FullName
    }
    Remove-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue
  } else {
    Remove-Item -LiteralPath $Path -Force
  }
}

Write-Info "Will remove:"
Write-Host "  $OpenCliHome"
Write-Host "  global npm package @jackwener/opencli"
Write-Host ""
if (-not $Yes) {
  $ans = Read-Host "Type YES to continue"
  if ($ans -ne "YES") {
    Write-Warn "Cancelled."
    exit 0
  }
}

if (Test-Path -LiteralPath $OpenCliHome) {
  Write-Info "==> Removing $OpenCliHome (junction-safe)"
  Remove-TreeJunctionSafe $OpenCliHome
} else {
  Write-Warn "No $OpenCliHome"
}

$npmCmd = Resolve-NpmCmd
if ($npmCmd) {
  Write-Info "==> npm uninstall -g @jackwener/opencli"
  $prev = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try { & $npmCmd @("uninstall", "-g", "--no-fund", "--no-audit", "@jackwener/opencli") }
  finally { $ErrorActionPreference = $prev }
  if ($LASTEXITCODE -ne 0) {
    Write-Warn "global uninstall exit $LASTEXITCODE (ok if it was not installed)"
  }
} else {
  Write-Warn "npm.cmd not found; skipped global uninstall"
}

if (Test-Path -LiteralPath $OpenCliHome) {
  Write-Err "Still exists: $OpenCliHome"
  exit 1
}

Write-Ok "OpenCLI user dir cleaned. Next: .\deploy\install.bat -OpenCliOnly"
