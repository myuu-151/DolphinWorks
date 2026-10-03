# Hardware tests

Two small GameCube programs that check your setup on a real console, through a USB Gecko. Each comes as
a disc image to boot with Swiss: put it on the SD card with DolphinWorks' **Run on Hardware**.

| Test | What it checks |
|---|---|
| **geckotest.iso**<br>DolphinWorks USB Gecko test | The USB Gecko link, both ways. The GameCube sends a line every second; what you send it comes back as `echo: ...`. Open DolphinWorks' **Debug** page to see it. |
| **gdbtest.iso**<br>DolphinWorks GDB test | GDB on real hardware. It waits for GDB, then counts frames in `count_frame()`. **A** crashes on purpose (GDB should stop on the bad line), **B** breaks into GDB. Press **Start GDB** on the Debug page, or run `Start GDB.bat`. |

## Before you start

- The USB Gecko goes in **memory card slot A**, its USB cable in the PC.
- Windows needs FTDI's driver as a COM port: in Device Manager, open the Gecko's **USB Serial Converter**,
  and on its **Advanced** tab tick **Load VCP**, then replug it. It then shows as **USB Serial Port (COMx)**.
- Only one program can use the Gecko's port at a time: DolphinWorks' console lets go of it when GDB starts.

## Using GDB with gdbtest

```
(gdb) continue              run the program
(gdb) break count_frame     stop every frame
(gdb) print hp              read a variable (set var hp = 999 to change it)
(gdb) bt                    where it stopped (the call stack)
(gdb) next / step           one line at a time
```

Press **A** on the controller and GDB should stop on the line in `crash_here()` that writes to NULL.

## Building them

`build.bat` builds both with the GameCube toolchain (gekko-toolchain or devkitPro) and makes the disc
images with `make_iso.py`. It's the same disc layout as Octave-libogc's Package Project, with its
open-source apploader (`gcn_apploader.img`, public domain).

In your own program, the debug stub is two lines plus `-ldb` (see `gdbtest/source/gdbtest.c`):

```c
#include <debug.h>
DEBUG_Init(GDBSTUB_DEVICE_USB, 0);   // the USB Gecko in slot A (EXI channel 0)
_break();                            // wait for GDB here
```
