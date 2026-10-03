@echo off
rem Builds app\DolphinWorks.exe (the app's window, with app.ico) with Visual Studio's compiler.
rem The WebView2 SDK (its header and static loader) comes from NuGet into packages\, once.
setlocal
cd /d "%~dp0"
set WV2=packages\webview2\build\native
if not exist "%WV2%\include\WebView2.h" (
  echo Getting the WebView2 SDK from NuGet...
  if not exist packages mkdir packages
  powershell -NoProfile -Command "Invoke-WebRequest https://www.nuget.org/api/v2/package/Microsoft.Web.WebView2 -OutFile packages\webview2.zip; Expand-Archive -Force packages\webview2.zip packages\webview2" || exit /b 1
)
set VSWHERE=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe
for /f "usebackq delims=" %%i in (`"%VSWHERE%" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath`) do set VS=%%i
if not defined VS (echo Visual Studio with C++ is needed. & exit /b 1)
call "%VS%\VC\Auxiliary\Build\vcvars64.bat" >nul
rc /nologo /fo launcher.res launcher.rc || exit /b 1
cl /nologo /O1 /W3 /MT /EHsc /std:c++17 /I "%WV2%\include" launcher.cpp launcher.res /Fe:..\DolphinWorks.exe ^
   /link /SUBSYSTEM:WINDOWS "%WV2%\x64\WebView2LoaderStatic.lib" user32.lib ole32.lib shell32.lib dwmapi.lib advapi32.lib gdi32.lib || exit /b 1
del launcher.obj launcher.res
echo Built ..\DolphinWorks.exe
