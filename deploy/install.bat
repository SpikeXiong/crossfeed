@echo off
REM Crossfeed · Windows 安装包装器（绕开 PowerShell Execution Policy 拦截）
REM 双击运行，或在 cmd / PowerShell 里 .\deploy\install.bat
REM 内部用 -ExecutionPolicy Bypass 调 install.ps1（不影响系统 policy）
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" %*
