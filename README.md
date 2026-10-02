# OpenGC

**GameCube Development Environment**

An open-source development environment for Nintendo GameCube homebrew: a game engine, a
toolchain, and builders that produce both from source.

> **In active development.** To report a bug, open an issue on the relevant project's repository.

## Components

| Component | Description | Installation |
|---|---|---|
| **[Octave-libogc](https://github.com/myuu-151/Octave-Libogc)**<br>Engine | 3D game engine with a scene editor and Lua scripting. Packages projects as bootable GameCube disc images. | Download the latest release, or build from source with `Build Octave.bat`. |
| **[gekko-toolchain](https://github.com/myuu-151/gekko-toolchain)**<br>Toolchain | Cross-compiler, linker and GameCube libraries: devkitPro's toolchain, distributed as a single archive (unofficial). | Extract the latest release and run `Install.bat`. |

## Getting started

1. **Install the toolchain:** [gekko-toolchain](https://github.com/myuu-151/gekko-toolchain), or
   devkitPro's [`gamecube-dev`](https://devkitpro.org/wiki/Getting_Started).
2. **Install the engine:** [Octave-libogc](https://github.com/myuu-151/Octave-Libogc).
3. **Build a project:** create it in the Octave editor and package it for GameCube. The output is
   a disc image (`.iso`).

## Running a build

- **Emulator:** load the disc image in [Dolphin](https://dolphin-emu.org).
- **Hardware:** copy the disc image to an SD card and launch it with
  [Swiss](https://github.com/emukidid/swiss-gc).

## Sources

Forks of the toolchain's components are maintained to keep their sources available:
[libogc](https://github.com/myuu-151/libogc) ·
[libfat](https://github.com/myuu-151/libfat) ·
[gamecube-tools](https://github.com/myuu-151/gamecube-tools) ·
[devkitppc-rules](https://github.com/myuu-151/devkitppc-rules) ·
[buildscripts](https://github.com/myuu-151/buildscripts) ·
[gcc](https://github.com/myuu-151/gcc) ·
[newlib](https://github.com/myuu-151/newlib) ·
[Swiss](https://github.com/myuu-151/swiss-gc-libogc)

---

*OpenGC is not affiliated with Nintendo or devkitPro. GameCube is a trademark of Nintendo.*
