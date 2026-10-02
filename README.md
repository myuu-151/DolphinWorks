# OpenGC

**GameCube Development Environment**

A free, open-source engine and toolchain for GameCube homebrew. Everything builds from source
with a one-click builder.

> **In active development.** Found a bug? Open a ticket on that project's Issues page.

## Getting started

1. Install [gekko-toolchain](https://github.com/myuu-151/gekko-toolchain) (or devkitPro's
   [`gamecube-dev`](https://devkitpro.org/wiki/Getting_Started)).
2. Get [Octave-libogc](https://github.com/myuu-151/Octave-Libogc): download its release, or clone
   it and run `Build Octave.bat`.
3. Make your game in Octave's editor and package it as a disc image for Dolphin or a GameCube.

## What's in it

- **[Octave-libogc](https://github.com/myuu-151/Octave-Libogc)**: the engine. A GameCube fork of
  Octave with an editor, Lua scripting and ISO packaging.
- **[gekko-toolchain](https://github.com/myuu-151/gekko-toolchain)**: devkitPro's GameCube
  toolchain for Windows in one zip (unofficial).
- **Sources**, kept as forks: [libogc](https://github.com/myuu-151/libogc),
  [libfat](https://github.com/myuu-151/libfat),
  [gamecube-tools](https://github.com/myuu-151/gamecube-tools),
  [devkitppc-rules](https://github.com/myuu-151/devkitppc-rules),
  [buildscripts](https://github.com/myuu-151/buildscripts),
  [gcc](https://github.com/myuu-151/gcc), [newlib](https://github.com/myuu-151/newlib), and
  [Swiss](https://github.com/myuu-151/swiss-gc-libogc) for booting discs on a GameCube.

*Not affiliated with Nintendo or devkitPro. GameCube is a trademark of Nintendo.*
