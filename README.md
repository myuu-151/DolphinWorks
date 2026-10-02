# OpenGC

**GameCube Development Environment**

Make your own GameCube games, for free. Everything is open source and builds from source with a
one-click builder.

> **In active development.** Found a bug? Open a ticket on that project's Issues page.

## What's in it

| | What it does | Get it |
|---|---|---|
| **[Octave-libogc](https://github.com/myuu-151/Octave-Libogc)**<br>the engine | Where you make the game: a 3D editor, Lua scripting, and one click to package it as a GameCube disc image. | Download its release, or clone it and run `Build Octave.bat` |
| **[gekko-toolchain](https://github.com/myuu-151/gekko-toolchain)**<br>the toolchain | What turns code into a program the GameCube runs: the compiler and the GameCube libraries (devkitPro's, in one zip). | Download its release, unzip, run `Install.bat` |

## Make a game in three steps

1. **Install the toolchain:** [gekko-toolchain](https://github.com/myuu-151/gekko-toolchain), or
   devkitPro's own [`gamecube-dev`](https://devkitpro.org/wiki/Getting_Started) if you prefer it.
2. **Get the engine:** [Octave-libogc](https://github.com/myuu-151/Octave-Libogc).
3. **Make your game** in Octave's editor, then package it for the GameCube. You get an `.iso`.

## Play it

- **On a PC:** open the `.iso` in the [Dolphin](https://dolphin-emu.org) emulator.
- **On a GameCube:** copy the `.iso` to an SD card and boot it with
  [Swiss](https://github.com/emukidid/swiss-gc).

## Sources

The toolchain is built from these, kept as forks so they stay available:
[libogc](https://github.com/myuu-151/libogc) ·
[libfat](https://github.com/myuu-151/libfat) ·
[gamecube-tools](https://github.com/myuu-151/gamecube-tools) ·
[devkitppc-rules](https://github.com/myuu-151/devkitppc-rules) ·
[buildscripts](https://github.com/myuu-151/buildscripts) ·
[gcc](https://github.com/myuu-151/gcc) ·
[newlib](https://github.com/myuu-151/newlib) ·
[Swiss](https://github.com/myuu-151/swiss-gc-libogc)

---

*Not affiliated with Nintendo or devkitPro. GameCube is a trademark of Nintendo.*
