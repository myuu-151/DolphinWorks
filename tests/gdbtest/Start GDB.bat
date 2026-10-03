@echo off
rem Connects GDB to gdbtest (or any program built with libogc's debug stub) on the GameCube, over the USB Gecko.
rem Boot gdbtest first: it waits for GDB. Close DolphinWorks' Gecko console first (one program at a time can use the port).
setlocal
cd /d "%~dp0"

rem the Gecko's COM port: the FTDI virtual COM port Windows lists
set PORT=
for /f "tokens=3" %%p in ('reg query HKLM\HARDWARE\DEVICEMAP\SERIALCOMM 2^>nul ^| findstr /i "VCP"') do set PORT=%%p
if not defined PORT (
  echo No USB Gecko COM port found. Plug it in; in Device Manager, tick "Load VCP" on its USB Serial Converter.
  pause
  exit /b 1
)

rem GDB: devkitPro's or gekko-toolchain's
set GDB=
for %%d in ("C:\devkitPro" "C:\DolphinWorks\gekko-toolchain" "C:\gekko-toolchain") do (
  if not defined GDB if exist "%%~d\devkitPPC\bin\powerpc-eabi-gdb.exe" set GDB=%%~d\devkitPPC\bin\powerpc-eabi-gdb.exe
)
if not defined GDB (
  echo No powerpc-eabi-gdb found: install gekko-toolchain (with dolphinworks.bat) or devkitPro's gamecube-dev.
  pause
  exit /b 1
)

set ELF=%~1
if "%ELF%"=="" set ELF=gdbtest.elf
echo GDB on %PORT%, debugging %ELF%. Try:  continue  /  break count_frame  /  bt  /  print hp  /  next
echo (press A on the controller to crash on purpose; B breaks into GDB)
echo.
rem (the source folder by a relative path: GDB eats the backslashes of a full Windows one)
"%GDB%" -q -ex "directory source" -ex "set remotetimeout 10" -ex "target remote \\.\%PORT%" "%ELF%"
