"""Wraps a GameCube program (.dol) in a bootable disc image (.iso), for loaders that only list disc images.
The same layout as Octave's Package Project -> GameCube (Engine/Source/Editor/ActionManager.cpp,
BuildGameCubeIso): boot.bin, bi2.bin, Octave's open-source apploader, the DOL, and an FST holding one file:
opening.bnr, the banner Swiss and Dolphin show (if there is one: beside the DOL, or --banner).
Usage: py make_iso.py game.dol [out.iso] [--name "Disc name"] [--id DWGT01] [--banner opening.bnr]"""
import argparse
import struct
from pathlib import Path

HERE = Path(__file__).resolve().parent
APPLOADER = HERE / 'gcn_apploader.img'          # Octave-libogc's open-source (public domain) apploader
ap = argparse.ArgumentParser()
ap.add_argument('dol')
ap.add_argument('iso', nargs='?')
ap.add_argument('--name', default='DolphinWorks USB Gecko test')
ap.add_argument('--id', default='DWGT01', help='6 characters: game id (4) + maker (2)')
ap.add_argument('--banner', help="the disc's banner (a BNR1 file); default: opening.bnr beside the DOL, if there")
args = ap.parse_args()
dol = Path(args.dol)
iso = Path(args.iso) if args.iso else dol.with_suffix('.iso')
name = args.name.encode('latin-1')[:0x3E0]
game_id = args.id.encode('ascii')[:6].ljust(6, b'0')


def align(v, a):
    return (v + a - 1) & ~(a - 1)


apploader, program = APPLOADER.read_bytes(), dol.read_bytes()
banner_file = Path(args.banner) if args.banner else dol.parent / 'opening.bnr'
banner = banner_file.read_bytes() if banner_file.exists() else b''
dol_off = align(0x2440 + len(apploader), 0x100)
fst_off = align(dol_off + len(program), 0x100)
if banner:
    # the root directory (its entries run to index 2), then the one file; then the names
    names = b'opening.bnr\0'
    bnr_off = align(fst_off + 24 + len(names), 0x20)
    fst = struct.pack('>IIIIII', 0x01000000, 0, 2, 0, bnr_off, len(banner)) + names
    end = bnr_off + len(banner)
else:
    fst = struct.pack('>III', 0x01000000, 0, 1)    # the root directory alone: no files on the disc
    end = fst_off + len(fst)
image = bytearray(align(end, 0x20))

# boot.bin: the game id and maker, the GameCube disc magic, the name, where the DOL and FST are
image[0:6] = game_id
struct.pack_into('>I', image, 0x1C, 0xC2339F3D)
image[0x20:0x20 + len(name)] = name
struct.pack_into('>IIII', image, 0x420, dol_off, fst_off, len(fst), len(fst))
# bi2.bin: what the console's boot ROM needs (24 MB simulated memory, NTSC) -- zeros crash at the logo
struct.pack_into('>II', image, 0x440, 0, 0x01800000)
struct.pack_into('>II', image, 0x440 + 0x18, 1, 1)
image[0x2440:0x2440 + len(apploader)] = apploader
image[dol_off:dol_off + len(program)] = program
image[fst_off:fst_off + len(fst)] = fst
if banner:
    image[bnr_off:bnr_off + len(banner)] = banner
iso.write_bytes(image)
print(f'{iso} ({len(image)} bytes): DOL at 0x{dol_off:x}, FST at 0x{fst_off:x}' + (f', banner at 0x{bnr_off:x}' if banner else ', no banner'))
