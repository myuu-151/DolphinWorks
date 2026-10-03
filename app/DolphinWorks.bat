@echo off
rem DolphinWorks: the development hub (prototype). Runs in its own window; closing it ends the app.
cd /d "%~dp0"
where pyw >nul 2>nul && (start "" pyw -3 server.py & exit /b)
where pythonw >nul 2>nul && (start "" pythonw server.py & exit /b)
echo DolphinWorks needs Python 3: run dolphinworks.bat in the folder above to install everything.
pause
