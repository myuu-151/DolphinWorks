# OpenGC

**GameCube Development Environment**

An open-source development environment for Nintendo GameCube homebrew: a game engine, a
toolchain, and builders that produce both from source.

> **In active development.** To report a bug, open an issue on the relevant project's repository.

## Contents

- [Components](#components)
- [Requirements](#requirements)
- [Getting started](#getting-started)
- [Running a build](#running-a-build)
- [Sources](#sources)

## Components

### Engine: [Octave-libogc](https://github.com/myuu-151/Octave-Libogc)

A 3D game engine for the GameCube, forked from Octave.

- Scene editor and Lua scripting
- GX renderer, disc streaming and memory card saves
- Packages projects as bootable GameCube disc images

**Installation:** download the latest release, or build from source with `Build Octave.bat`.

### Toolchain: [gekko-toolchain](https://github.com/myuu-151/gekko-toolchain)

The cross-compiler, linker and libraries that build GameCube programs. It is devkitPro's
toolchain, distributed as a single archive (unofficial).

- devkitPPC (GCC, binutils, newlib)
- libogc, libfat and gamecube-tools
- The build tools its makefiles require

**Installation:** extract the latest release and run `Install.bat`.

## Requirements

| Requirement | Purpose |
|---|---|
| Windows 10 or later | Host platform for the editor, the builders and gekko-toolchain |
| gekko-toolchain, or devkitPro's [`gamecube-dev`](https://devkitpro.org/wiki/Getting_Started) | Building GameCube programs |
| Python 3 | Running the builders |
| Visual Studio with C++, and the Vulkan SDK | Building the engine from source only |

## Getting started

1. **Install the toolchain:** gekko-toolchain, or devkitPro's `gamecube-dev`.
2. **Install the engine:** Octave-libogc.
3. **Build a project:** create it in the Octave editor and package it for GameCube. The output is
   a disc image (`.iso`).

## Running a build

| Target | Method |
|---|---|
| Emulator | Load the disc image in [Dolphin](https://dolphin-emu.org). |
| Hardware | Copy the disc image to an SD card and launch it with [Swiss](https://github.com/emukidid/swiss-gc). |

## Sources

Forks of the toolchain's components are maintained to keep their sources available.

| Component | Repository |
|---|---|
| libogc | [myuu-151/libogc](https://github.com/myuu-151/libogc) |
| libfat | [myuu-151/libfat](https://github.com/myuu-151/libfat) |
| gamecube-tools | [myuu-151/gamecube-tools](https://github.com/myuu-151/gamecube-tools) |
| devkitPPC rules | [myuu-151/devkitppc-rules](https://github.com/myuu-151/devkitppc-rules) |
| devkitPPC build scripts | [myuu-151/buildscripts](https://github.com/myuu-151/buildscripts) |
| GCC | [myuu-151/gcc](https://github.com/myuu-151/gcc) |
| newlib | [myuu-151/newlib](https://github.com/myuu-151/newlib) |
| Swiss | [myuu-151/swiss-gc-libogc](https://github.com/myuu-151/swiss-gc-libogc) |

---

*OpenGC is not affiliated with Nintendo or devkitPro. GameCube is a trademark of Nintendo.*
