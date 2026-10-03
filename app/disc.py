"""GameCube disc images: what's in them, and editing it in place; and what a game's saves show.

    read_disc(iso)            the header (game id, name, region, version), opening.bnr (the banner Swiss and
                              Dolphin show: a 96 x 32 picture, title, maker, description), and the memory card's
                              icon and banner if the game keeps them on the disc (save_icon.bin, save_banner.bin)
    read_bnr(path, offset)    a banner: the disc's, or a project's own opening.bnr
    bnr_picture(bnr)          its picture as a PNG
    write_header, write_bnr   a text field written in its fixed-size place: nothing else in the disc moves
    read_card(folder, info)   what the memory card screen shows for the game's saves (title, description, icon,
                              banner), from the project's files (Scripts/SaveInfo.lua; SYS_SetSaveInfo in its C++;
                              save_icon.bin, save_banner.bin) and the disc
    card_picture(card, which) the card's icon (its frames side by side) or banner as a PNG
    set_card_text, set_bnr_picture, set_card_picture, make_bnr  the other edits

Only Python's standard library. Formats: the disc header (boot.bin, 0x440 bytes; bi2.bin after it); the FST
(the disc's file table); opening.bnr (BNR1/BNR2: a 96 x 32 RGB5A3 picture at 0x20, then the texts at 0x1820);
GX textures: RGB5A3 (2 bytes a pixel, 4 x 4 tiles), CI8 (1 byte a pixel, 8 x 4 tiles, a 256-colour RGB5A3
palette after them).
"""
import re
import struct
import zlib
from pathlib import Path

REGIONS = {0: 'Japan (NTSC-J)', 1: 'USA (NTSC-U)', 2: 'Europe (PAL)', 3: 'Free', 4: 'Korea'}

# the texts of opening.bnr: (offset in the file, size)
BNR_TEXT = {
    'short_title': (0x1820, 0x20), 'short_maker': (0x1840, 0x20),
    'title': (0x1860, 0x40), 'maker': (0x18A0, 0x40), 'description': (0x18E0, 0x80),
}
# the header's: (offset in the disc, size)
HEADER_TEXT = {'game_id': (0x0, 6), 'name': (0x20, 0x3E0)}


def _text(raw):
    return raw.split(b'\0', 1)[0].decode('latin-1')


def read_disc(iso):
    """What's in a GameCube disc image, or None if it isn't one."""
    iso = Path(iso)
    try:
        with open(iso, 'rb') as f:
            head = f.read(0x440)
            bi2 = f.read(0x2000)
            if len(head) < 0x440 or head[0x1C:0x20] != b'\xc2\x33\x9f\x3d':
                return None
            dol_off, fst_off, fst_size = struct.unpack('>III', head[0x420:0x42C])
            f.seek(fst_off)
            files = _fst_files(f.read(fst_size))
        info = {
            'path': str(iso), 'game_id': _text(head[0:6]), 'disc': head[6] + 1, 'version': head[7],
            'name': _text(head[0x20:0x400]), 'region': REGIONS.get(struct.unpack('>I', bi2[0x18:0x1C])[0], 'Unknown'),
            'size': iso.stat().st_size, 'bnr': None, 'card_icon': None, 'card_banner': None,
        }
        if 'opening.bnr' in files:
            info['bnr'] = read_bnr(iso, *files['opening.bnr'])
        # the memory card's icon and banner, where a game keeps them as files (CCGC does)
        for key, name in (('card_icon', 'save_icon.bin'), ('card_banner', 'save_banner.bin')):
            hit = next((v for k, v in files.items() if k.split('/')[-1].lower() == name), None)
            if hit:
                info[key] = {'offset': hit[0], 'size': hit[1]}
        return info
    except (OSError, struct.error, ValueError):
        return None


def read_bnr(path, offset=0, size=0x1960):
    """A banner (opening.bnr): in a disc image (at offset) or a file of its own. None if it isn't one."""
    try:
        with open(path, 'rb') as f:
            f.seek(offset)
            raw = f.read(size)
    except OSError:
        return None
    if raw[:4] not in (b'BNR1', b'BNR2') or len(raw) < 0x1960:
        return None
    return {'path': str(path), 'offset': offset, 'size': size, 'kind': raw[:4].decode(),
            **{k: _text(raw[o:o + n]) for k, (o, n) in BNR_TEXT.items()}}


def _fst_files(fst):
    """{'path/in/disc': (offset, size)} for every file in the FST."""
    count = struct.unpack('>I', fst[8:12])[0]
    strings = fst[count * 12:]
    out, dirs = {}, [(0, count, '')]               # (index, end, path) of the directories we're in
    for i in range(1, count):
        while dirs and i >= dirs[-1][1]:
            dirs.pop()
        e = fst[i * 12:i * 12 + 12]
        name_off = int.from_bytes(e[1:4], 'big')
        name = strings[name_off:strings.index(b'\0', name_off)].decode('latin-1')
        a, b = struct.unpack('>II', e[4:12])
        path = (dirs[-1][2] + '/' if dirs and dirs[-1][2] else '') + name
        if e[0]:                                   # a directory: its entries run to index b
            dirs.append((i, b, path))
        else:
            out[path] = (a, b)
    return out


# ---- pictures --------------------------------------------------------------------------------------

def _rgb5a3(v):
    if v & 0x8000:                                 # opaque: 5 bits each
        r, g, b = (v >> 10) & 31, (v >> 5) & 31, v & 31
        return (r << 3 | r >> 2, g << 3 | g >> 2, b << 3 | b >> 2, 255)
    a, r, g, b = (v >> 12) & 7, (v >> 8) & 15, (v >> 4) & 15, v & 15
    return (r * 17, g * 17, b * 17, a * 255 // 7)


def _decode_rgb5a3(data, w, h):
    px = [(0, 0, 0, 0)] * (w * h)
    i = 0
    for ty in range(0, h, 4):
        for tx in range(0, w, 4):
            for y in range(4):
                for x in range(4):
                    if i + 2 <= len(data):
                        px[(ty + y) * w + tx + x] = _rgb5a3(struct.unpack('>H', data[i:i + 2])[0])
                    i += 2
    return px


def _decode_ci8(data, w, h, tlut):
    pal = [_rgb5a3(struct.unpack('>H', tlut[j:j + 2])[0]) for j in range(0, min(len(tlut), 512), 2)]
    px = [(0, 0, 0, 0)] * (w * h)
    i = 0
    for ty in range(0, h, 4):
        for tx in range(0, w, 8):
            for y in range(4):
                for x in range(8):
                    if i < len(data):
                        c = data[i]
                        px[(ty + y) * w + tx + x] = pal[c] if c < len(pal) else (0, 0, 0, 0)
                    i += 1
    return px


def _png(w, h, px):
    rows = b''.join(b'\0' + bytes(c for p in px[y * w:(y + 1) * w] for c in p) for y in range(h))
    chunk = lambda kind, data: struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data))
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(rows, 9)) + chunk(b'IEND', b''))


def bnr_picture(bnr):
    """The banner's picture (96 x 32) as a PNG."""
    try:
        with open(bnr['path'], 'rb') as f:
            f.seek(bnr['offset'] + 0x20)
            return _png(96, 32, _decode_rgb5a3(f.read(96 * 32 * 2), 96, 32))
    except (OSError, TypeError):
        return None


# ---- editing ---------------------------------------------------------------------------------------

def _fit(value, size):
    raw = value.encode('latin-1', 'replace')[:size - 1]               # (always a 0 at the end)
    return raw + b'\0' * (size - len(raw))


def write_header(iso, field, value):
    """A field of the disc's header, written into the image: game_id (6 letters and digits) or name."""
    if field == 'game_id':
        value = value.strip().upper()
        if len(value) != 6 or not all(c.isascii() and c.isalnum() for c in value):
            raise ValueError('A game ID is 6 letters and digits, like GOCT01.')
        at, data = 0, value.encode('ascii')
    elif field == 'name':
        at, size = HEADER_TEXT[field]
        data = _fit(' '.join(value.split()), size)
    else:
        raise ValueError(f'Not a field: {field}')
    with open(iso, 'r+b') as f:
        f.seek(at)
        f.write(data)


def write_bnr(bnr, field, value):
    """A text of a banner (title, maker, description, short_title, short_maker), written in its place."""
    if field not in BNR_TEXT:
        raise ValueError(f'Not a field: {field}')
    o, size = BNR_TEXT[field]
    with open(bnr['path'], 'r+b') as f:
        f.seek(bnr['offset'] + o)
        f.write(_fit(' '.join(value.split()), size))


# ---- encoding (pictures from the app: RGBA, already the right size) --------------------------------

def _to_rgb5a3(r, g, b, a):
    if a >= 0xE0:                                  # the 3-bit alpha's top step is as good as opaque: 5 bits
        return 0x8000 | ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)
    return ((a >> 5) << 12) | ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4)


def _pixels(rgba):
    return [tuple(rgba[i:i + 4]) for i in range(0, len(rgba), 4)]


def encode_rgb5a3(rgba, w, h):
    px = _pixels(rgba)
    out = bytearray()
    for ty in range(0, h, 4):
        for tx in range(0, w, 4):
            for y in range(4):
                for x in range(4):
                    out += struct.pack('>H', _to_rgb5a3(*px[(ty + y) * w + tx + x]))
    return bytes(out)


def _palette(px, size=256):
    """At most 256 colours for these pixels (median cut), as RGB5A3 values; and each pixel's index."""
    values = [_to_rgb5a3(*p) for p in px]
    unique = sorted(set(values))
    if len(unique) <= size:
        index = {v: i for i, v in enumerate(unique)}
        return unique + [0] * (size - len(unique)), [index[v] for v in values]
    colours = [_rgb5a3(v) for v in values]         # (what the card would show)
    spread = lambda box, k: max(c[k] for c in box) - min(c[k] for c in box)
    boxes = [list(set(colours))]
    while len(boxes) < size:
        box = max((b for b in boxes if len(b) > 1), key=lambda b: max(spread(b, k) for k in range(4)), default=None)
        if box is None:
            break
        k = max(range(4), key=lambda k: spread(box, k))
        box.sort(key=lambda c: c[k])
        boxes.remove(box)
        boxes += [box[:len(box) // 2], box[len(box) // 2:]]
    pal = [tuple(sum(c[k] for c in b) // len(b) for k in range(4)) for b in boxes]
    cache = {}

    def nearest(c):
        if c not in cache:
            cache[c] = min(range(len(pal)), key=lambda i: sum((c[k] - pal[i][k]) ** 2 for k in range(4)))
        return cache[c]
    return [_to_rgb5a3(*c) for c in pal] + [0] * (size - len(pal)), [nearest(c) for c in colours]


def encode_ci8(frames, w, h):
    """CI8 frames (GX's 8 x 4 tiles) sharing one palette, then the palette: 256 RGB5A3 colours."""
    pal, idx = _palette([p for f in frames for p in _pixels(f)])
    out = bytearray()
    for n in range(len(frames)):
        base = n * w * h
        for ty in range(0, h, 4):
            for tx in range(0, w, 8):
                for y in range(4):
                    for x in range(8):
                        out.append(idx[base + (ty + y) * w + tx + x])
    return bytes(out) + b''.join(struct.pack('>H', v) for v in pal)


# ---- the memory card -------------------------------------------------------------------------------
# What the memory card screen (and Dolphin's memory card manager) shows beside a game's save: a title and a
# description (31 characters each), a 32 x 32 icon -- still (RGB5A3, 2048 bytes) or 1 to 8 CI8 frames and
# their palette, a frame every 12 retraces -- and a 96 x 32 banner (CI8 and its palette, 3584 bytes). Octave
# takes them in System.SetSaveInfo (Lua) or SYS_SetSaveInfo (C++); where a game keeps them is up to it.

CARD_TEXT = 31
SKIP = ('Packaged', 'Intermediate', 'Build', '.git')


def _project_files(folder, name, depth=3):
    found = []
    for d in range(depth + 1):
        for f in folder.glob('*/' * d + name):
            if not any(part in SKIP for part in f.relative_to(folder).parts[:-1]):
                found.append(f)
    return found


def _lua_hex(text, key):
    """A hex blob in SaveInfo.lua -- key = table.concat({ "..", ".." }) or key = "..": (start, end, bytes)."""
    m = re.search(r'(?m)^[ \t]*' + key + r'\s*=\s*(table\.concat\(\{(.*?)\}\)|"([0-9a-fA-F]*)")', text, re.S)
    if not m:
        return None
    hexed = ''.join(re.findall(r'"([0-9a-fA-F]*)"', m.group(2))) if m.group(2) is not None else m.group(3)
    return m.start(1), m.end(1), bytes.fromhex(hexed)


def _icon_frames(size):
    return 0 if size == 2048 else max(1, (size - 512) // 1024)


def read_card(folder, info):
    """The memory card's title, description, icon and banner, and where each is kept (to write it back)."""
    card = {'title': None, 'description': None, 'text_in': None, 'icon': None, 'banner': None}
    places = {'icon': [], 'banner': []}
    frames_arg = None
    if folder:
        folder = Path(folder)
        for lua in _project_files(folder, 'SaveInfo.lua', 2)[:1]:
            text = lua.read_bytes().decode('utf-8', 'replace')
            for key in ('title', 'description'):
                m = re.search(r'(?m)^\s*' + key + r'\s*=\s*"([^"]*)"', text)
                if m:
                    card[key], card['text_in'] = m.group(1), str(lua)
            for key in ('icon', 'banner'):
                hit = _lua_hex(text, key)
                if hit:
                    places[key].append({'kind': 'lua', 'path': str(lua), 'size': len(hit[2])})
        if card['title'] is None:
            for src in _project_files(folder, '*.cpp', 2):
                text = src.read_bytes().decode('utf-8', 'replace')
                m = re.search(r'SYS_SetSaveInfo\(\s*"([^"]*)"\s*,\s*"([^"]*)"\s*,[^,]*,\s*([^,]+?)\s*,', text)
                if m:
                    card['title'], card['description'], card['text_in'] = m.group(1), m.group(2), str(src)
                    frames_arg = m.group(3)                 # (the frame count it passes: 0 is a still icon, always)
                    break
        for key, name in (('icon', 'save_icon.bin'), ('banner', 'save_banner.bin')):
            for f in _project_files(folder, name):
                places[key].append({'kind': 'file', 'path': str(f), 'size': f.stat().st_size})
    if info:
        for key in ('icon', 'banner'):
            spot = info.get('card_' + key)
            if spot:
                places[key].append({'kind': 'disc', 'path': info['path'], 'offset': spot['offset'], 'size': spot['size']})
    for key in ('icon', 'banner'):
        if places[key]:
            size = places[key][0]['size']
            card[key] = {'places': places[key], 'size': size, 'frames': _icon_frames(size) if key == 'icon' else 1,
                         'on_disc': any(p['kind'] == 'disc' for p in places[key]),
                         'in_project': any(p['kind'] != 'disc' for p in places[key])}
    if card['icon']:
        # Whether a new icon can be animated: Lua (System.SetSaveInfo tells frames by the length) can; C++ can if
        # it doesn't pass a fixed 0 frames; a disc on its own only in the room its icon has.
        kinds = {p['kind'] for p in card['icon']['places']}
        card['icon']['animates'] = ('lua' in kinds or ('file' in kinds and folder and frames_arg not in ('0', None))
                                    or (kinds == {'disc'} and card['icon']['size'] != 2048))
    return card if (card['title'] or card['icon'] or card['banner']) else None


def _card_bytes(place, key):
    if place['kind'] == 'lua':
        return _lua_hex(Path(place['path']).read_bytes().decode('utf-8', 'replace'), key)[2]
    with open(place['path'], 'rb') as f:
        f.seek(place.get('offset', 0))
        return f.read(place['size'])


def card_picture(card, which, frame=None):
    """The icon (its frames side by side, or one of them) or the banner, as a PNG."""
    entry = card and card.get(which)
    if not entry:
        return None
    try:
        data = _card_bytes(entry['places'][0], which)
    except (OSError, TypeError, ValueError):
        return None
    if which == 'icon':
        if len(data) == 2048:
            return _png(32, 32, _decode_rgb5a3(data, 32, 32))
        n = _icon_frames(len(data))
        tlut = data[n * 1024:n * 1024 + 512]
        frames = [_decode_ci8(data[i * 1024:(i + 1) * 1024], 32, 32, tlut) for i in range(n)]
        if frame is not None:
            return _png(32, 32, frames[min(frame, n - 1)])
        return _png(32 * n, 32, [frames[x // 32][y * 32 + x % 32] for y in range(32) for x in range(32 * n)])
    if len(data) == 96 * 32 * 2:
        return _png(96, 32, _decode_rgb5a3(data, 96, 32))
    return _png(96, 32, _decode_ci8(data[:3072], 96, 32, data[3072:3584]))


def set_card_text(card, field, value):
    """The card's title or description, written where the game keeps it (the next build takes it)."""
    if not card or not card.get('text_in'):
        raise ValueError("This game's memory card text isn't in a file DolphinWorks can find.")
    value = ''.join(c for c in ' '.join(str(value).split()) if c not in '"\\')[:CARD_TEXT].strip()
    path = Path(card['text_in'])
    text = path.read_bytes().decode('utf-8', 'replace')
    if path.suffix.lower() == '.lua':
        m = re.search(r'(?m)^\s*' + field + r'\s*=\s*"([^"]*)"', text)
        if not m:
            raise ValueError(f'No {field} in {path.name}.')
        start, end = m.span(1)
    else:
        m = re.search(r'SYS_SetSaveInfo\(\s*"([^"]*)"\s*,\s*"([^"]*)"', text)
        if not m:
            raise ValueError(f'No SYS_SetSaveInfo call in {path.name} any more.')
        start, end = m.span(1 if field == 'title' else 2)
    path.write_bytes((text[:start] + value + text[end:]).encode('utf-8'))


def _icon_data(frames):
    """An icon: one frame is a still (RGB5A3, 2048 bytes); more, CI8 frames and their palette."""
    return encode_rgb5a3(frames[0], 32, 32) if len(frames) == 1 else encode_ci8(frames, 32, 32)


def set_bnr_picture(bnrs, rgba):
    """A new banner picture (96 x 32 RGBA bytes), written into each of these banners (the disc's, the project's)."""
    if len(rgba) != 96 * 32 * 4:
        raise ValueError('The banner is 96 x 32.')
    data = encode_rgb5a3(rgba, 96, 32)
    for bnr in bnrs:
        with open(bnr['path'], 'r+b') as f:
            f.seek(bnr['offset'] + 0x20)
            f.write(data)


def set_card_picture(card, key, frames):
    """A new memory card icon (key 'icon', 32 x 32) or banner ('banner', 96 x 32): RGBA bytes, or for the icon a
    list of 1 to 8 frames (more than one animates it: a frame every 12 retraces, in a loop). Written everywhere
    the game keeps it: its project's files and the disc image (in place, where it fits). Returns a note, or None."""
    entry = card and card.get(key)
    if not entry:
        raise ValueError(f"DolphinWorks can't find where this game keeps its memory card {key}.")
    frames = frames if isinstance(frames, list) else [frames]
    w = 32 if key == 'icon' else 96
    if key == 'banner' and len(frames) != 1:
        raise ValueError("The memory card's banner is one picture: only the icon animates.")
    if not 1 <= len(frames) <= 8:
        raise ValueError('An icon has 1 to 8 frames.')
    if any(len(f) != w * 32 * 4 for f in frames):
        raise ValueError(f'The {key} is {w} x 32.')
    n = len(frames)
    if n > 1 and not entry.get('animates') and not entry['in_project']:
        raise ValueError("This disc keeps a still icon: an animated one is a bigger file, and that means rebuilding the disc.")
    if n > 1 and not entry.get('animates'):
        fix = icon_code_fix(card)
        raise StillOnly("This game's code takes a still icon only: it passes SYS_SetSaveInfo 0 frames."
                        + ('' if fix else " DolphinWorks can't see how to change it: have it pass the frame count "
                                          "(save_icon.bin's size: n x 1024 + 512 bytes)."),
                        Path(fix[0]).name if fix else None)
    data = _icon_data(frames) if key == 'icon' else encode_ci8(frames, 96, 32)
    note = None
    for place in entry['places']:
        if place['kind'] == 'lua':
            path = Path(place['path'])
            text = path.read_bytes().decode('utf-8', 'replace')
            start, end, _old = _lua_hex(text, key)
            indent = re.search(r'(?m)^([ \t]*)' + key + r'\s*=', text).group(1)
            nl = '\r\n' if '\r\n' in text else '\n'
            hexed = data.hex()
            blob = ('table.concat({' + nl + ''.join(f'{indent}    "{hexed[i:i + 128]}",{nl}' for i in range(0, len(hexed), 128))
                    + indent + '})')
            text = text[:start] + blob + text[end:]
            # the comment over it, if it says what the picture is: what it is now
            what = ("-- 96 x 32, CI8 in GX's 8 x 4 tiles, then its 256-colour RGB5A3 palette, as hex" if key == 'banner' else
                    "-- 32 x 32, still: RGB5A3 (GX's 4 x 4 tiles), as hex" if n == 1 else
                    f"-- 32 x 32, animated: {n} CI8 frames (GX's 8 x 4 tiles), then their shared RGB5A3 palette, as hex")
            text = re.sub(r'(?m)^([ \t]*)--[^\r\n]*(\r?\n[ \t]*' + key + r'\s*=)',
                          lambda m: m.group(1) + what + ' (from DolphinWorks)' + m.group(2), text, count=1)
            path.write_bytes(text.encode('utf-8'))
            continue
        out = data
        if place['kind'] == 'disc' and len(out) != place['size']:
            # The disc's copy can't change size: what fits in its room. A still there (2048 bytes) gets the first
            # frame; frames there get these frames, round again to fill them.
            if key == 'icon' and place['size'] == 2048:
                out = encode_rgb5a3(frames[0], 32, 32)
                if n > 1:
                    note = 'The disc has room for a still icon: it shows the first frame until the next build.'
            elif key == 'icon':
                room = _icon_frames(place['size'])
                out = encode_ci8([frames[i % n] for i in range(room)], 32, 32)
                if room != n:
                    note = f"The disc's icon has {room} frames: these went in round again to fill them, until the next build."
            else:
                continue
        with open(place['path'], 'r+b' if place['kind'] == 'disc' else 'wb') as f:
            f.seek(place.get('offset', 0))
            f.write(out)
    return note


class StillOnly(ValueError):
    """A game whose code takes a still icon only. fixable: the code file DolphinWorks can change (or None)."""
    def __init__(self, message, fixable=None):
        super().__init__(message)
        self.fixable = fixable


def icon_code_fix(card):
    """How to make a game's C++ take an animated icon: (its file, the new text), or None if it can't be seen.
    Where the code loads save_icon.bin (SYS_AcquireFileData(..."save_icon.bin", ..., data, size)) and passes
    SYS_SetSaveInfo 0 frames: the frames come from the size instead (2048 bytes: a still; n x 1024 + 512: n
    frames), and a check that the size is 2048 lets frames through too."""
    if not card or not card.get('text_in') or not card['text_in'].lower().endswith(('.cpp', '.cc', '.c')):
        return None
    path = Path(card['text_in'])
    text = path.read_bytes().decode('utf-8', 'replace')
    load = re.search(r'SYS_AcquireFileData\(\s*"[^"]*save_icon\.bin"\s*,[^,]*,[^,]*,\s*\w+\s*,\s*(\w+)\s*\)', text)
    call = re.search(r'SYS_SetSaveInfo\(\s*"[^"]*"\s*,\s*"[^"]*"\s*,[^,]*,\s*(0)\s*,', text)
    if not load or not call:
        return None
    size = load.group(1)
    frames = f'({size} == 2048 ? 0u : ({size} - 512) / 1024)'
    text = text[:call.start(1)] + frames + text[call.end(1):]
    ok = f'({size} == 2048 || ({size} > 512 && ({size} - 512) % 1024 == 0 && ({size} - 512) / 1024 <= 8))'
    text = re.sub(r'\b' + size + r'\s*==\s*2048\b(?!\s*\?)', lambda m: ok, text)   # (the check, not the new frames)
    return str(path), text


def make_animated(card):
    """Changes the game's code to take an animated icon (icon_code_fix). Returns the file changed."""
    fix = icon_code_fix(card)
    if not fix:
        raise ValueError("DolphinWorks can't see how to change this game's code for an animated icon.")
    Path(fix[0]).write_bytes(fix[1].encode('utf-8'))
    return fix[0]


def make_bnr(path, start_from=None, default=None):
    """A project's own opening.bnr, made from the disc's banner (what it shows now) or else Octave's default.
    Octave's build puts a project's opening.bnr on the disc as it is."""
    if start_from:
        with open(start_from['path'], 'rb') as f:
            f.seek(start_from['offset'])
            Path(path).write_bytes(f.read(start_from['size']))
    elif default and Path(default).exists():
        Path(path).write_bytes(Path(default).read_bytes())
    else:
        raise ValueError('No banner to start from.')
    return read_bnr(path, 0, Path(path).stat().st_size)
