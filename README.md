# OpenGC

**GameCube Development Environment

Everything here builds from source with a one-click builder window, and every disc image can be
rebuilt by anyone from these repos. It's a set of projects by myuu-151, collected in one place,
the way devkitPro collects its own.

> **In active development.** All of it is a work in progress. Found a bug? Report it as a ticket
> on that project's Issues page: what happened, what you expected, and how to make it happen
> again if you can.

## Getting started

1. **The toolchain.** Install [gekko-toolchain](https://github.com/myuu-151/gekko-toolchain)
   (unzip, run `Install.bat`), or devkitPro's own with `gamecube-dev`
   ([devkitpro.org](https://devkitpro.org/wiki/Getting_Started)). Every builder has a
   **GameCube toolchain** switch to pick between them.
2. **The engine.** Download [Octave-libogc](https://github.com/myuu-151/Octave-Libogc)'s release,
   or clone it and run `Build Octave.bat`.
3. **A game.** Clone it beside Octave-libogc and run its `Build ... .bat`. The disc image is
   ready for Dolphin, or for a GameCube through Swiss.

## The engine

| Repo | What it is |
|---|---|
| [Octave-libogc](https://github.com/myuu-151/Octave-Libogc) | A fork of the Octave 3D engine for the GameCube (and Wii), on the original libogc: editor, Lua scripting, GX renderer, disc streaming, packaging to a bootable ISO. `Build Octave.bat` builds it from source. |

## The toolchain

| Repo | What it is |
|---|---|
| [gekko-toolchain](https://github.com/myuu-151/gekko-toolchain) | devkitPro's GameCube toolchain for Windows in one zip (unofficial): devkitPPC, libogc, libfat, gamecube-tools, and the `make` and shell its makefiles use. |

Its sources, forked so they stay available: [libogc](https://github.com/myuu-151/libogc),
[libfat](https://github.com/myuu-151/libfat),
[gamecube-tools](https://github.com/myuu-151/gamecube-tools),
[devkitppc-rules](https://github.com/myuu-151/devkitppc-rules),
[buildscripts](https://github.com/myuu-151/buildscripts) (how devkitPPC is built),
[gcc](https://github.com/myuu-151/gcc) and [newlib](https://github.com/myuu-151/newlib).
Swiss, which boots the disc images on a GameCube, is kept too:
[swiss-gc-libogc](https://github.com/myuu-151/swiss-gc-libogc).

## The games

| Game | GameCube | Also |
|---|---|---|
| **Sonic Pipe Dream**: a 3D half-pipe racer born from Sonic 2's special stage | [SonicPipeDream-GC](https://github.com/myuu-151/SonicPipeDream-GC) | [Windows](https://github.com/myuu-151/SonicPipeDream) |
| **Castle Crashers**: a native reimplementation, built from your own Steam copy | [Castle-Crashers-GC](https://github.com/myuu-151/Castle-Crashers-GC) | [Windows (the engine)](https://github.com/myuu-151/Castle-Crashers-Recomp) |
| **Bejeweled 2**: its Classic mode, built from your own Steam copy | [BJ2GC](https://github.com/myuu-151/BJ2GC) | |

Each has a builder: `Build Sonic Pipe Dream.bat`, `Build CCGC.bat`, `Build BJ2GC.bat`. Games built
from a copy you own make their data from it; none of the original game's files are in these repos.

*GameCube is a trademark of Nintendo. OpenGC isn't affiliated with Nintendo, or with devkitPro.
Each project keeps its own licence.*
