@echo off
rem DolphinWorks Setup: installs what's needed to make GameCube games (the Python packages, the toolchain, the engine).
cd /d "%~dp0"
where pyw >nul 2>nul && (start "" pyw -3 tools\setup.py & exit /b)
where pythonw >nul 2>nul && (start "" pythonw tools\setup.py & exit /b)
echo DolphinWorks Setup needs Python 3.
where winget >nul 2>nul || goto manual
choice /m "Install Python 3 now (winget)"
if errorlevel 2 goto manual
winget install -e --id Python.Python.3.13 --accept-package-agreements --accept-source-agreements
echo.
echo Python is installed. Run "gcsuite.bat" again.
pause
exit /b
:manual
echo Download it from https://www.python.org/downloads/ (tick "Add python.exe to PATH"), then run this again.
start "" https://www.python.org/downloads/
pause
