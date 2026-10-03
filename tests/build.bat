@echo off
rem Builds the hardware test programs (geckotest, gdbtest) with the GameCube toolchain and wraps each in a
rem bootable disc image: tests\geckotest\geckotest.iso, tests\gdbtest\gdbtest.iso (+ gdbtest.elf, for GDB).
setlocal
cd /d "%~dp0"

rem the toolchain: devkitPro's or gekko-toolchain's (both have make in their msys2)
set TC=
for %%d in ("C:\devkitPro" "C:\DolphinWorks\gekko-toolchain" "C:\gekko-toolchain") do (
  if not defined TC if exist "%%~d\devkitPPC\bin\powerpc-eabi-gcc.exe" if exist "%%~d\msys2\usr\bin\bash.exe" set TC=%%~d
)
if not defined TC (
  echo No GameCube toolchain found: run dolphinworks.bat to install gekko-toolchain, or install devkitPro's gamecube-dev.
  pause
  exit /b 1
)
set DEVKITPRO=/opt/devkitpro
set DEVKITPPC=/opt/devkitpro/devkitPPC
set CHERE_INVOKING=1
rem (CHERE_INVOKING: msys2's shell stays in the folder it's started in)

for %%t in (geckotest gdbtest) do (
  echo Building %%t...
  pushd "%~dp0%%t"
  "%TC%\msys2\usr\bin\bash.exe" -lc make || (popd & exit /b 1)
  popd
)
py -3 make_iso.py geckotest\geckotest.dol --name "DolphinWorks USB Gecko test" --id DWGT01 || exit /b 1
py -3 make_iso.py gdbtest\gdbtest.dol --name "DolphinWorks GDB test" --id DWGD01 || exit /b 1
echo.
echo Done: geckotest\geckotest.iso and gdbtest\gdbtest.iso
