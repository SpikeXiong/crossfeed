@echo off
REM Crossfeed Windows installer wrapper (bypasses PowerShell Execution Policy).
REM Double-click, or run: .\deploy\install.bat
REM Invokes install.ps1 with -ExecutionPolicy Bypass (does not change system policy).
REM This .bat file is ASCII-only so cmd.exe on Chinese Windows does not misparse comments.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" %*
