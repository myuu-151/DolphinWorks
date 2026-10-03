@echo off
rem Builds app\DolphinWorks.exe (the launcher, with app.ico) with Visual Studio's compiler.
setlocal
cd /d "%~dp0"
set VSWHERE=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe
for /f "usebackq delims=" %%i in (`"%VSWHERE%" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath`) do set VS=%%i
if not defined VS (echo Visual Studio with C++ is needed. & exit /b 1)
call "%VS%\VC\Auxiliary\Build\vcvars64.bat" >nul
rc /nologo /fo launcher.res launcher.rc || exit /b 1
cl /nologo /O1 /W3 /MT launcher.c launcher.res /Fe:..\DolphinWorks.exe /link /SUBSYSTEM:WINDOWS user32.lib || exit /b 1
del launcher.obj launcher.res
echo Built ..\DolphinWorks.exe
