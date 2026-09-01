@echo off
REM Crossfeed OpenCLI cleanup wrapper (ASCII-only for cmd.exe on Chinese Windows).
REM Double-click, or run: .\deploy\cleanup.bat
REM Deletes %%USERPROFILE%%\.opencli and the global @jackwener/opencli package.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0cleanup.ps1" %*
