"""DolphinWorks: the development hub (prototype).

    Run app\\DolphinWorks.exe (or: python app/server.py)

A local web app in its own window: this file serves the interface (app/ui) on 127.0.0.1 and does
the work behind it -- finding the projects (every Octave project, .octp, under C:\\DolphinWorks\\Projects
and the folders added in Settings), building them with Octave (the toolchain chosen, devkitPro's or
gekko-toolchain), running the disc image in Dolphin (Fast or Accurate), opening the editor,
copying the disc image to an SD card, and watching for a USB Gecko and SD cards. DolphinWorks.exe
runs it with --no-window and shows it in its own window (WebView2), ending it when that closes; run
directly, it opens Microsoft Edge in app mode, with a profile of its own, and closing that stops it.

Only Python's standard library: nothing to install.
"""
import base64
import ctypes
import hashlib
import json
import os
import queue
import re
import shutil
import socket
import subprocess
import sys
import threading
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import disc

HERE = Path(__file__).resolve().parent
UI = HERE / 'ui'
STATE = HERE / '.state.json'                       # the user's choices (not in git)
DOCUMENTS = Path.home() / 'Documents'
DW_ROOT = Path(r'C:\DolphinWorks')                 # where dolphinworks.bat installs
NO_WINDOW, LOW_PRIORITY = 0x08000000, 0x4000
VERSION = '0.2 (prototype)'
BUILD_OUTPUT = re.compile(r'\\(Packaged|Intermediate)\\', re.I)   # a build's copy of the project: never listed


# --- state ----------------------------------------------------------------------------------------

def load_state():
    try:
        return json.loads(STATE.read_text())
    except (OSError, ValueError):
        return {}


def save_state(**changes):
    state = load_state()
    state.update(changes)
    STATE.write_text(json.dumps(state, indent=1))
    return state


# --- what's on this PC ----------------------------------------------------------------------------

def toolchain_path(candidate):
    if not candidate:
        return None
    if candidate.startswith('/') and len(candidate) > 2 and candidate[2] == '/':
        candidate = f'{candidate[1].upper()}:{candidate[2:]}'
    elif candidate.startswith('/opt/devkitpro'):
        candidate = r'C:\devkitPro'
    path = Path(candidate)
    return path if (path / 'devkitPPC' / 'bin' / 'powerpc-eabi-gcc.exe').exists() else None


def toolchain_label(path):
    kind = 'gekko-toolchain' if (path / 'VERSIONS.txt').exists() else 'devkitPro'
    version = ''
    try:
        version = next(l.split()[1].split('-')[0] for l in (path / 'VERSIONS.txt').read_text().splitlines()
                       if l.startswith('devkitPPC '))
    except (OSError, StopIteration, IndexError):
        db = path / 'msys2' / 'var' / 'lib' / 'pacman' / 'local'
        found = sorted(m.group(1) for d in (db.iterdir() if db.is_dir() else ())
                       for m in [re.match(r'devkitPPC-(r[0-9.]+)-', d.name)] if m)
        version = found[-1] if found else ''
    return f'{kind} {version}'.strip()


def find_toolchains():
    found = []
    for candidate in (os.environ.get('DEVKITPRO'), r'C:\devkitPro', r'C:\gekko-toolchain',
                      str(DW_ROOT / 'gekko-toolchain'), *load_state().get('toolchain_folders', [])):
        path = toolchain_path(candidate)
        if path and all(path.resolve() != p.resolve() for p in found):
            found.append(path)
    return found


def octave_version(folder):
    """The engine's release: as setup installed it, else its git tag ("v2.2", or "v2.2+3" three commits on)."""
    try:
        key = ('octave', str(folder).lower(), (folder / 'Octave.exe').stat().st_mtime)
    except OSError:
        return None
    if key not in VERSIONS:
        version = None
        try:
            version = (folder / '.dolphinworks-release').read_text().strip()
        except OSError:
            try:
                out = subprocess.run(['git', '-C', str(folder), 'describe', '--tags', '--match', 'v*'], capture_output=True,
                                     text=True, timeout=10, creationflags=NO_WINDOW).stdout.strip()
                m = re.match(r'(v[0-9.]+)(?:-([0-9]+)-g[0-9a-f]+)?$', out)
                version = m and m.group(1) + (f'+{m.group(2)}' if m.group(2) else '')
            except (OSError, subprocess.SubprocessError):
                pass
        VERSIONS[key] = version
    return VERSIONS[key]


def find_octave():
    for path in (load_state().get('octave'), DW_ROOT / 'Octave-libogc', DOCUMENTS / 'octave-libogc'):
        if path and (Path(path) / 'Octave.exe').exists():
            return Path(path)
    return None


def find_dolphins():
    """Every Dolphin on this PC: DolphinWorks' own, the usual places, and the ones set in Settings."""
    found = []
    st = load_state()
    for path in (st.get('dolphin'), DW_ROOT / 'Dolphin', DOCUMENTS / 'octave-libogc' / 'Dolphin-x64',
                 DOCUMENTS / 'Dolphin-x64', Path.home() / 'Downloads' / 'Dolphin-x64', *st.get('dolphin_folders', [])):
        if path and (Path(path) / 'Dolphin.exe').exists() and all(Path(path).resolve() != p.resolve() for p in found):
            found.append(Path(path))
    return found


def find_dolphin():
    """(folder, has DolphinWorks' Fast and Accurate profiles): the one chosen, else the first found."""
    found = find_dolphins()
    if not found:
        return None, False
    return found[0], (found[0] / 'User-Accurate').is_dir()


VERSIONS = {}                                      # (the exe, its time) -> its version: read once


def dolphin_version(folder):
    try:
        key = (str(folder).lower(), (folder / 'Dolphin.exe').stat().st_mtime)
    except OSError:
        return 'installed'
    if key not in VERSIONS:
        VERSIONS[key] = read_dolphin_version(folder)
    return VERSIONS[key]


def read_dolphin_version(folder):
    try:
        return (folder / '.dolphinworks-release').read_text().strip()
    except OSError:
        try:
            data = (folder / 'Dolphin.exe').read_bytes()
            # its user agent, "Dolphin/2609" or "Dolphin/2609-1"; else the bare version string
            m = (re.search(rb'Dolphin/(2[0-9]{3}(?:-[0-9]+)?)\x00', data) or re.search(rb'\x00(2[0-9]{3}-[0-9]+)\x00', data)
                 or re.search(rb'\x00(2[0-9]{3})\x00[0-9a-f]{40}\x00', data))
            return m.group(1).decode() if m else 'installed'
        except OSError:
            return 'installed'


def usb_gecko():
    """The COM port of an FTDI serial device (the USB Gecko's chip), or None."""
    try:
        import winreg
        with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r'HARDWARE\DEVICEMAP\SERIALCOMM') as key:
            i = 0
            while True:
                name, value, _ = winreg.EnumValue(key, i)
                if 'VCP' in name.upper():
                    return value
                i += 1
    except OSError:
        return None


def sd_cards():
    """Removable drives: [{'drive': 'F:', 'label': ..., 'free_gb': ...}]."""
    k32 = ctypes.windll.kernel32
    mask, out = k32.GetLogicalDrives(), []
    for i in range(26):
        if not mask & (1 << i):
            continue
        root = f'{chr(65 + i)}:\\'
        if k32.GetDriveTypeW(root) != 2:                # DRIVE_REMOVABLE
            continue
        label = ctypes.create_unicode_buffer(64)
        if not k32.GetVolumeInformationW(root, label, 64, None, None, None, None, 0):
            continue                                     # (a reader with no card)
        free = ctypes.c_ulonglong()
        k32.GetDiskFreeSpaceExW(root, None, None, ctypes.byref(free))
        out.append({'drive': root[:2], 'label': label.value or 'SD card', 'free_gb': round(free.value / 2**30, 1)})
    return out


# --- projects -------------------------------------------------------------------------------------

def project_name(octp):
    try:
        for line in octp.read_text(errors='replace').splitlines():
            if line.startswith('name='):
                return line[5:].strip()
    except OSError:
        pass
    return octp.stem


def repo_root(octp):
    """The project's repository: the nearest folder above the .octp holding .git or a README."""
    for folder in (octp.parent, *octp.parent.parents):
        if (folder / '.git').exists() or (folder / 'README.md').exists():
            return folder
        if folder == DOCUMENTS or len(folder.parts) <= 2:
            break
    return octp.parent


def find_art(root):
    """(banner, screenshot) paths for a project, from its README's first image and its docs."""
    banner = screenshot = None
    readme = root / 'README.md'
    if readme.exists():
        for m in re.finditer(r'!\[[^\]]*\]\(([^)\s]+)\)|<img[^>]*src="([^"]+)"', readme.read_text(errors='replace')):
            path = root / (m.group(1) or m.group(2))
            if path.exists() and path.suffix.lower() in ('.png', '.jpg', '.jpeg', '.webp'):
                if banner is None:
                    banner = path
                elif screenshot is None and 'builder' not in path.name.lower():
                    screenshot = path
    for name in ('docs/header.png', 'art/readme.png', 'docs/banner.png'):
        if banner is None and (root / name).exists():
            banner = root / name
    return banner, screenshot


DEFAULT_ROOTS = [DW_ROOT / 'Projects']             # more are added in Settings


def project_roots():
    """The folders searched for projects: the defaults (unless removed), then the user's own."""
    st = load_state()
    hidden = [h.lower() for h in st.get('hidden_roots', [])]
    return [p for p in DEFAULT_ROOTS if str(p).lower() not in hidden] + [Path(p) for p in st.get('project_roots', [])]


def pick_folder(title='Choose a folder with Octave projects'):
    """Windows' folder picker (Tk's, in a process of its own so it never blocks the server)."""
    code = ('import sys, tkinter, tkinter.filedialog as fd; r = tkinter.Tk(); r.withdraw(); '
            'r.attributes("-topmost", True); '
            'print(fd.askdirectory(parent=r, title=sys.argv[1], mustexist=True) or "")')
    out = subprocess.run([sys.executable, '-c', code, title], capture_output=True, text=True, creationflags=NO_WINDOW)
    return out.stdout.strip() or None


# the paths set in Settings: (title of the picker, what the folder must hold)
PATHS = {
    'toolchain': ('Choose the toolchain folder (devkitPro or gekko-toolchain)', r'devkitPPC\bin\powerpc-eabi-gcc.exe'),
    'octave': ('Choose the Octave-libogc folder', 'Octave.exe'),
    'dolphin': ('Choose the Dolphin folder', 'Dolphin.exe'),
}


def set_path(kind, folder=None):
    """Sets the toolchain, engine or Dolphin folder: (ok, message)."""
    title, needs = PATHS[kind]
    folder = folder or pick_folder(title)
    if not folder:
        return False, None
    folder = Path(folder).resolve()
    if not (folder / needs).exists():
        return False, f'{folder} has no {needs}.'
    if kind in ('toolchain', 'dolphin'):                        # kept in the Quick Settings list too
        extra = load_state().get(f'{kind}_folders', [])
        if str(folder).lower() not in [e.lower() for e in extra]:
            save_state(**{f'{kind}_folders': extra + [str(folder)]})
    save_state(**{kind: str(folder)})
    return True, str(folder)


def disc_image(octp, name):
    """The project's disc image: where Octave packages it (Packaged\\GameCube), or beside the project
    (where some projects keep theirs); the newer if both. Not built yet: the Packaged path."""
    packaged = octp.parent / 'Packaged' / 'GameCube' / f'{name}.iso'
    found = [p for p in (packaged, octp.parent / f'{name}.iso') if p.exists()]
    return max(found, key=lambda p: p.stat().st_mtime) if found else packaged


def gamecube_disc_name(iso):
    """The name in a GameCube disc image's header, or None if it isn't one (no GameCube magic)."""
    try:
        with open(iso, 'rb') as f:
            head = f.read(0x60)
    except OSError:
        return None
    if len(head) < 0x60 or head[0x1C:0x20] != b'\xc2\x33\x9f\x3d':
        return None
    return head[0x20:0x60].split(b'\0', 1)[0].decode('latin-1').strip() or iso.stem


def scan_disc_images(roots, projects):
    """GameCube disc images that aren't a project's own (homebrew, tests): listed to run in Dolphin or put on
    an SD card; no Build, no editor."""
    inside = [Path(p['root']).resolve() for p in projects]
    seen, found = set(), []
    for base in roots:
        if not base.is_dir():
            continue
        for depth in ('*.iso', '*/*.iso', '*/*/*.iso'):
            for iso in base.glob(depth):
                key = str(iso.resolve()).lower()
                if key in seen or BUILD_OUTPUT.search(str(iso)) or any(iso.resolve().is_relative_to(r) for r in inside):
                    continue
                seen.add(key)
                title = gamecube_disc_name(iso)
                if not title:
                    continue
                stat = iso.stat()
                found.append({
                    'id': '', 'name': iso.stem, 'title': title, 'octp': None, 'kind': 'disc',
                    'root': str(iso.parent), 'iso': str(iso), 'built': True,
                    'last_build': time.strftime('%Y-%m-%d %H:%M', time.localtime(stat.st_mtime)),
                    'size_mb': round(stat.st_size / 2**20, 1), 'screenshot': None,
                    # its pictures, if it has them beside it: banner.png (the art up top), icon.png (the list's)
                    'banner': str(iso.parent / 'banner.png') if (iso.parent / 'banner.png').exists() else None,
                    'icon': str(iso.parent / 'icon.png') if (iso.parent / 'icon.png').exists() else None,
                    'builder': None, 'engine': 'Disc image', 'modified': stat.st_mtime,
                    'elf': str(iso.with_suffix('.elf')) if iso.with_suffix('.elf').exists() else None,
                })
    return found


def disc_details(p, octave):
    """What the disc says about itself -- its header, its banner (opening.bnr: the picture, title, maker and
    description Swiss and Dolphin show) -- and what the memory card shows for its saves (title, description,
    icon, banner). The Project Details, Banner and Memory Card cards show them, and edit them in place."""
    info = disc.read_disc(p['iso']) if p['built'] else None
    folder = Path(p['octp']).parent if p['octp'] else None
    own = folder / 'opening.bnr' if folder else None            # an Octave project's own: what its builds put on the disc
    own_bnr = disc.read_bnr(own, 0, own.stat().st_size) if own and own.exists() else None
    p['disc'] = {k: v for k, v in info.items() if k not in ('bnr', 'card_icon', 'card_banner')} if info else None
    p['bnr'] = (info and info['bnr']) or own_bnr                # (what the disc shows; before a build, the project's)
    p['bnr_places'] = [b for b in ((info or {}).get('bnr'), own_bnr) if b]
    p['bnr_file'] = str(own) if own else None
    p['bnr_default'] = str(octave / 'Standalone' / 'Tools' / 'opening.bnr') if octave else None
    p['card'] = disc.read_card(folder, info)


def edit_banners(project):
    """The banners an edit goes into: the disc's, and an Octave project's own (made if it has none, so the
    next build keeps the edit)."""
    places = list(project['bnr_places'])
    if project['bnr_file'] and not Path(project['bnr_file']).exists():
        disc_bnr = places[0] if places else None
        places.append(disc.make_bnr(project['bnr_file'], disc_bnr, project['bnr_default']))
    if not places:
        raise ValueError('This disc has no banner (opening.bnr): adding one means rebuilding the disc.')
    return places


def edit_text(project, field, value):
    if field in ('game_id', 'name'):
        if not project['disc']:
            raise ValueError('Build it first: there is no disc image yet.')
        disc.write_header(project['iso'], field, value)
    elif field in disc.BNR_TEXT:
        for bnr in edit_banners(project):
            disc.write_bnr(bnr, field, value)
    elif field in ('card_title', 'card_description'):
        disc.set_card_text(project['card'], field[len('card_'):], value)
    else:
        raise ValueError(f'Not a field: {field}')


def edit_picture(project, which, rgba):
    if which == 'banner':
        disc.set_bnr_picture(edit_banners(project), rgba)
    elif which in ('card_icon', 'card_banner'):
        disc.set_card_picture(project['card'], which[len('card_'):], rgba)
    else:
        raise ValueError(f'Not a picture: {which}')


def scan_projects():
    seen, projects = set(), []
    roots = project_roots()
    extra = [Path(p) for p in load_state().get('projects', [])]
    candidates = list(extra)
    for base in roots:
        if not base.is_dir():
            continue
        for depth in ('*.octp', '*/*.octp', '*/*/*.octp', '*/*/*/*.octp'):
            candidates.extend(base.glob(depth))
    for octp in candidates:
        if not octp.exists():
            continue
        # the copy a build makes (Packaged\GameCube\<name>.octp) isn't a project of its own
        if BUILD_OUTPUT.search(str(octp)):
            continue
        key = str(octp.resolve()).lower()
        if key in seen:
            continue
        seen.add(key)
        root = repo_root(octp)
        name = project_name(octp)
        iso = disc_image(octp, name)
        banner, screenshot = find_art(root)
        builders = sorted(root.glob('Build *.bat'))
        projects.append({
            'id': str(len(projects)), 'name': name, 'title': nice_title(root, name), 'octp': str(octp),
            'root': str(root), 'iso': str(iso), 'built': iso.exists(),
            'last_build': time.strftime('%Y-%m-%d %H:%M', time.localtime(iso.stat().st_mtime)) if iso.exists() else None,
            'size_mb': round(iso.stat().st_size / 2**20, 1) if iso.exists() else None,
            'banner': str(banner) if banner else None, 'screenshot': str(screenshot) if screenshot else None,
            'builder': str(builders[0]) if builders else None,
            'elf': str(elf) if (elf := octp.parent / 'Build' / 'GCN' / f'{name}.elf').exists() else None,   # (for GDB)
            'engine': 'Octave Engine' + (' + custom code' if (octp.parent / 'Source').is_dir() else ''),
            'modified': max(octp.stat().st_mtime, iso.stat().st_mtime if iso.exists() else 0),
        })
    projects.extend(scan_disc_images(roots, projects))
    # names given in DolphinWorks (Rename): its own, the project's files untouched
    names = load_state().get('names', {})
    for p in projects:
        p['key'] = (p['octp'] or p['iso']).lower()
        p['own_title'] = p['title']
        if names.get(p['key']):
            p['title'] = names[p['key']]
    projects.sort(key=lambda p: -p['modified'])
    # the same title twice (a clone, the PC version): each told apart by its folder
    titles = [p['title'] for p in projects]
    for p in projects:
        p['folder'] = Path(p['root']).name if titles.count(p['title']) > 1 else ''
    octave = find_octave()
    for p in projects:
        p['id'] = hashlib.sha1(p['key'].encode()).hexdigest()[:12]     # (its own: an edit re-sorts the list)
        disc_details(p, octave)
    return projects


def nice_title(root, name):
    readme = root / 'README.md'
    if readme.exists():
        for line in readme.read_text(errors='replace').splitlines():
            if line.startswith('# '):
                return re.sub(r'\s*\(GameCube\)\s*$', '', line[2:].strip())
    return re.sub(r'(?<=[a-z])(?=[A-Z])', ' ', name)


# --- jobs: one at a time, their output streamed to the window -----------------------------------

class Jobs:
    def __init__(self):
        self.listeners, self.busy, self.history = [], None, []
        self.lock = threading.Lock()

    def emit(self, kind, **data):
        event = {'kind': kind, 'time': time.strftime('%H:%M:%S'), **data}
        with self.lock:
            if kind == 'line':
                self.history = (self.history + [event])[-2000:]
            for q in list(self.listeners):
                q.put(event)

    def start(self, title, work):
        with self.lock:
            if self.busy:
                return False
            self.busy = title
        self.emit('start', title=title)

        def run():
            ok = False
            try:
                ok = work()
            except Exception as e:  # noqa: BLE001 (say what went wrong)
                self.emit('line', text=f'{title} failed: {e}', level='error')
            with self.lock:
                self.busy = None
            self.emit('done', title=title, ok=bool(ok))
        threading.Thread(target=run, daemon=True).start()
        return True


JOBS = Jobs()


# --- the USB Gecko console (the Debug page) --------------------------------------------------------

class GeckoConsole:
    """COM port <-> the page: a thread reads what the GameCube sends (each line to the page as a 'gecko' event),
    send() writes to it. One program at a time can have the port: disconnect() frees it (for GDB, say)."""

    class _Timeouts(ctypes.Structure):
        _fields_ = [(n, ctypes.c_ulong) for n in ('ReadIntervalTimeout', 'ReadTotalTimeoutMultiplier',
                    'ReadTotalTimeoutConstant', 'WriteTotalTimeoutMultiplier', 'WriteTotalTimeoutConstant')]

    def __init__(self):
        self.lock = threading.Lock()
        self.handle, self.port, self.error = None, None, None
        self.rx = self.tx = 0
        self.history = []                    # the latest lines, for a page opened later
        self.k32 = ctypes.WinDLL('kernel32', use_last_error=True)
        self.k32.CreateFileW.restype = ctypes.c_void_p

    def status(self):
        return {'connected': self.handle is not None, 'port': self.port, 'rx': self.rx, 'tx': self.tx, 'error': self.error}

    def _line(self, text, source):
        event = {'text': text, 'source': source}             # source: 'cube' (the GameCube), 'pc' (sent), 'info'
        with self.lock:
            self.history = (self.history + [dict(event, time=time.strftime('%H:%M:%S'))])[-3000:]
        JOBS.emit('gecko', **event)

    def connect(self, port=None):
        port = port or usb_gecko()
        if not port:
            return False, 'No USB Gecko: plug it in (and tick Load VCP for it in Device Manager).'
        if self.handle is not None:
            return True, f'Already connected on {self.port}'
        handle = self.k32.CreateFileW(rf'\\.\{port}', 0x80000000 | 0x40000000, 0, None, 3, 0, None)
        if handle in (None, ctypes.c_void_p(-1).value):
            err = ctypes.get_last_error()
            return False, f'{port} is in use by another program.' if err == 5 else f'Could not open {port} (error {err}).'
        self.k32.SetCommTimeouts(ctypes.c_void_p(handle), ctypes.byref(self._Timeouts(1, 0, 100, 0, 500)))
        self.k32.PurgeComm(ctypes.c_void_p(handle), 0x000F)
        self.handle, self.port, self.error, self.rx, self.tx = handle, port, None, 0, 0
        self._line(f'Connected to the USB Gecko on {port}', 'info')
        threading.Thread(target=self._read, args=(handle,), daemon=True).start()
        JOBS.emit('gecko_status', **self.status())
        return True, f'Connected on {port}'

    def disconnect(self, reason=None):
        handle, self.handle = self.handle, None
        if handle is not None:
            self.k32.CloseHandle(ctypes.c_void_p(handle))
            self.error = reason
            self._line(reason or f'Disconnected from {self.port}', 'info')
            JOBS.emit('gecko_status', **self.status())

    def send(self, text):
        handle = self.handle
        if handle is None:
            return False
        data = (text.rstrip('\r\n') + '\n').encode('latin-1', 'replace')
        done = ctypes.c_ulong()
        ok = self.k32.WriteFile(ctypes.c_void_p(handle), data, len(data), ctypes.byref(done), None)
        if ok and done.value:
            self.tx += done.value
            self._line(text.rstrip('\r\n'), 'pc')
            return True
        return False

    def _read(self, handle):
        buf, got, pending = ctypes.create_string_buffer(4096), ctypes.c_ulong(), b''
        while self.handle == handle:
            if not self.k32.ReadFile(ctypes.c_void_p(handle), buf, 4096, ctypes.byref(got), None):
                if self.handle == handle:                 # (not a disconnect of ours: the Gecko went away)
                    self.disconnect(f'Lost the USB Gecko on {self.port} (unplugged?)')
                return
            if got.value:
                self.rx += got.value
                pending += buf.raw[:got.value]
                while b'\n' in pending:
                    line, pending = pending.split(b'\n', 1)
                    self._line(line.decode('latin-1').rstrip('\r'), 'cube')
                if len(pending) > 4096:                   # (a very long line with no end: show it anyway)
                    self._line(pending.decode('latin-1'), 'cube')
                    pending = b''


GECKO = GeckoConsole()


def find_gdb():
    """powerpc-eabi-gdb: the chosen toolchain's, else any installed."""
    for base in [chosen_toolchain(), *find_toolchains()]:
        if base and (base / 'devkitPPC' / 'bin' / 'powerpc-eabi-gdb.exe').exists():
            return base / 'devkitPPC' / 'bin' / 'powerpc-eabi-gdb.exe'
    return None


def start_gdb(project):
    """GDB in a window of its own, on the project's .elf, connected to the USB Gecko (the console lets go of
    the port first: one program at a time can have it). The game must be running, built with the debug stub."""
    port, gdb = usb_gecko(), find_gdb()
    elf = Path(project['elf']) if project.get('elf') else None
    if not elf:
        return {'ok': False, 'message': 'No .elf for this project: build it first (GDB needs its symbols).'}
    if not port:
        return {'ok': False, 'message': 'No USB Gecko plugged in.'}
    if not gdb:
        return {'ok': False, 'message': 'No powerpc-eabi-gdb: install gekko-toolchain or devkitPro.'}
    GECKO.disconnect(f'Disconnected: GDB has {port} now')
    start_apart([str(gdb), '-q', '-ex', f'directory {(elf.parent / "source").as_posix()}',   # (forward slashes: GDB eats backslashes)
                      '-ex', 'set remotetimeout 10',
                      '-ex', rf'target remote \\.\{port}',
                      # (a reminder of the usual commands, as DolphinWorks' Debug page lists them)
                      '-ex', r'echo \nCommands: continue (c) | Ctrl+C pauses | bt | break <function> | print <variable> | '
                             r'next | step | finish | info locals | quit\n',
                      str(elf)], elf.parent, 0x00000010)                    # CREATE_NEW_CONSOLE: its own window
    JOBS.emit('line', text=f'GDB on {port}: {elf.name}', level='info')
    return {'ok': True, 'message': f'GDB started on {port}', **GECKO.status()}
SOURCE_LINE = re.compile(r'^\s*[\w.+-]+\.(?:cpp|c)$')


def msys(path):
    p = Path(path).as_posix()
    return f'/{p[0].lower()}{p[2:]}' if len(p) > 1 and p[1] == ':' else p


# Octave's packaging chatter: never an error, even where it says so.
NOISE = re.compile(r'stream failed|failed to open file|_mkdir error|cannot be copied onto itself|'
                   r'cannot find the file specified|cannot unload asset', re.I)


def level_of(text):
    low = text.lower()
    if NOISE.search(low):
        return 'info'
    if re.search(r'\berror\b|failed|undefined reference', low):
        return 'error'
    if 'warning' in low:
        return 'warning'
    if text.startswith(('GCN ISO written', 'GameCube disc image ready', 'Finished packaging')):
        return 'success'
    return 'info'


def run_logged(args, cwd, env):
    startup = subprocess.STARTUPINFO()
    startup.dwFlags |= subprocess.STARTF_USESHOWWINDOW
    startup.wShowWindow = 0
    proc = subprocess.Popen(args, cwd=cwd, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                            stdin=subprocess.DEVNULL, startupinfo=startup, creationflags=NO_WINDOW | LOW_PRIORITY)
    compiled = 0
    for raw in proc.stdout:
        text = raw.decode('utf-8', 'replace').rstrip('\r\n').split('\r')[-1].rstrip()
        if not text:
            continue
        if SOURCE_LINE.match(text):
            compiled += 1
            JOBS.emit('progress', step=f'compiling ({compiled} files)')
        elif text.startswith('linking'):
            JOBS.emit('progress', step='linking')
        elif text.startswith('GCN ISO'):
            JOBS.emit('progress', step='writing the disc image')
        JOBS.emit('line', text=text, level=level_of(text))
    return proc.wait() == 0


def build(project, options):
    octave, dkp = find_octave(), chosen_toolchain()
    if not octave:
        JOBS.emit('line', text='No Octave-libogc: install it with dolphinworks.bat.', level='error')
        return False
    if not dkp:
        JOBS.emit('line', text='No GameCube toolchain: install gekko-toolchain or devkitPro.', level='error')
        return False
    iso = Path(project['octp']).parent / 'Packaged' / 'GameCube' / f'{project["name"]}.iso'   # where Octave writes it
    env = dict(os.environ)
    env['PATH'] = os.pathsep.join([str(dkp / 'devkitPPC' / 'bin'), str(dkp / 'tools' / 'bin'),
                                   str(dkp / 'msys2' / 'usr' / 'bin'), env.get('PATH', '')])
    env['DEVKITPRO'], env['DEVKITPPC'] = msys(dkp), msys(dkp / 'devkitPPC')
    env['OCTAVE'] = octave.as_posix()
    env['SDLOG'] = '1' if options.get('sd_log') else ''
    env['GDB'] = '1' if options.get('build_type') == 'Debug (GDB)' else ''          # (the debug stub: waits for GDB)
    env['GECKOLOG'] = '1' if options.get('gecko_log') and not env['GDB'] else ''    # (GDB has the Gecko to itself)
    env['DIAG'] = '1' if options.get('build_type') == 'Diagnostic' else ''
    # They're compile flags, and make can't tell when they change: switched since this project's last
    # build (or unknown), its compiled code is made again -- its Intermediate/GCN cleared, as a whole
    # (deleting some of what's in it, the .d files say, left stale objects that crashed a game).
    flags = ' '.join(f'{k}={env[k]}' for k in ('SDLOG', 'GECKOLOG', 'DIAG', 'GDB'))
    built_with = load_state().get('build_flags', {})
    if built_with.get(project['octp']) != flags:
        intermediate = Path(project['octp']).parent / 'Intermediate' / 'GCN'
        if intermediate.is_dir():
            JOBS.emit('line', text=f'Build options changed ({flags}): compiling it all again', level='info')
            shutil.rmtree(intermediate, ignore_errors=True)
    JOBS.emit('line', text=f'Using toolchain: {toolchain_label(dkp)} ({dkp})', level='info')
    JOBS.emit('line', text=f'Building project: {project["title"]}', level='info')
    JOBS.emit('progress', step='packaging the assets')
    start = time.time()
    try:
        iso.unlink()
    except OSError:
        pass
    run_logged([str(octave / 'Octave.exe'), '-headless', '-project', Path(project['octp']).as_posix(),
                '-build', 'GameCube'], octave, env)
    if not iso.exists():
        JOBS.emit('line', text='Build failed: no disc image was made (the lines above say why).', level='error')
        return False
    save_state(build_flags={**load_state().get('build_flags', {}), project['octp']: flags})
    JOBS.emit('line', text='Build successful!', level='success')
    if env['GDB']:
        JOBS.emit('line', text='A Debug (GDB) build: on the console it waits at its start, the screen black, for GDB '
                                '(Debug page: Start GDB, then "continue").', level='info')
    JOBS.emit('line', text=f'Output: {iso} ({iso.stat().st_size / 2**20:.1f} MB)', level='success')
    JOBS.emit('line', text=f'Total time: {time.time() - start:.1f}s', level='info')
    rescan()                                         # (the new build's date and size, before "done")
    return True


def chosen_toolchain():
    found, chosen = find_toolchains(), load_state().get('toolchain')
    for p in found:
        if chosen and p.resolve() == Path(chosen).resolve():
            return p
    return found[0] if found else None


def deploy(project, drive):
    iso = Path(project['iso'])
    target = Path(drive + '\\') / iso.name
    total = iso.stat().st_size
    JOBS.emit('line', text=f'Copying {iso.name} to {drive}', level='info')
    with open(iso, 'rb') as src, open(target.with_suffix('.part'), 'wb') as out:
        done = 0
        while True:
            block = src.read(4 << 20)
            if not block:
                break
            out.write(block)
            done += len(block)
            JOBS.emit('progress', step=f'copying to {drive}', done=done >> 20, total=total >> 20)
    if target.exists():
        target.unlink()
    target.with_suffix('.part').rename(target)
    JOBS.emit('line', text=f'On the SD card: {target}. Boot it with Swiss.', level='success')
    return True


BREAKAWAY = 0x01000000                             # CREATE_BREAKAWAY_FROM_JOB


def start_apart(args, cwd=None, flags=0x00000008, startupinfo=None, stay=True):
    """Starts a program; stay: it outlives the app (out of DolphinWorks.exe's job, which ends with the app).
    Where breaking away isn't allowed (an older DolphinWorks.exe, or no job at all), it starts as before."""
    if stay:
        try:
            return subprocess.Popen(args, cwd=cwd, creationflags=flags | BREAKAWAY, startupinfo=startupinfo)
        except OSError:
            pass
    return subprocess.Popen(args, cwd=cwd, creationflags=flags, startupinfo=startupinfo)


def launch(args, cwd=None, minimized=False, stay=True):
    startup = None
    if minimized:
        # its first window opens minimized: a game run from the app shows only once DolphinWorks.exe has
        # taken its window in (it would sit on the desktop meanwhile, while Dolphin starts the game)
        startup = subprocess.STARTUPINFO()
        startup.dwFlags |= subprocess.STARTF_USESHOWWINDOW
        startup.wShowWindow = 7                                     # SW_SHOWMINNOACTIVE
    return start_apart(args, cwd, 0x00000008, startup, stay)        # DETACHED_PROCESS


# a game run from the app: no "stop the emulation?" question (the app's Stop, or closing the app, ends
# it), the game in a window of its own (which DolphinWorks.exe puts in its Run page), and no pausing
# when that window loses focus (it's inside the app, which has it)
RUN_CONFIG = ['-C', 'Dolphin.Interface.ConfirmStop=False', '-C', 'Dolphin.Display.RenderToMain=False',
              '-C', 'Dolphin.Interface.PauseOnFocusLost=False']
if os.environ.get('DOLPHINWORKS_MUTE'):              # (tests: no sound)
    RUN_CONFIG += ['-C', 'Dolphin.DSP.Volume=0']


# --- the HTTP side -------------------------------------------------------------------------------

# --- what else a GameCube project needs (the Packages page) ----------------------------------------

def python_package(name):
    """A Python package's version, in the Python the builders use (this one), or None."""
    try:
        from importlib.metadata import version
        return version(name)
    except Exception:
        return None


def visual_studio():
    """(name, folder) of a Visual Studio with the C++ tools, or None."""
    vswhere = Path(os.environ.get('ProgramFiles(x86)', r'C:\Program Files (x86)')) / 'Microsoft Visual Studio' / 'Installer' / 'vswhere.exe'
    if not vswhere.exists():
        return None
    try:
        out = subprocess.run([str(vswhere), '-latest', '-products', '*', '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
                              '-format', 'json'], capture_output=True, text=True, timeout=15, creationflags=NO_WINDOW).stdout
        found = json.loads(out or '[]')
    except (OSError, ValueError, subprocess.SubprocessError):
        return None
    if not found:
        return None
    vs = found[0]
    return vs.get('displayName', 'Visual Studio'), vs.get('installationPath', '')


def vulkan_sdk():
    """(version, folder) of the Vulkan SDK, or None: its VULKAN_SDK variable (as saved, too: the app may have
    started before it was set), else the newest in C:\\VulkanSDK."""
    folder = os.environ.get('VULKAN_SDK')
    if not folder:
        try:
            import winreg
            for root, key in ((winreg.HKEY_CURRENT_USER, 'Environment'),
                              (winreg.HKEY_LOCAL_MACHINE, r'SYSTEM\CurrentControlSet\Control\Session Manager\Environment')):
                try:
                    with winreg.OpenKey(root, key) as k:
                        folder = winreg.QueryValueEx(k, 'VULKAN_SDK')[0]
                        break
                except OSError:
                    pass
        except ImportError:
            pass
    if not folder:
        versions = sorted(Path(r'C:\VulkanSDK').glob('*/Include/vulkan')) if Path(r'C:\VulkanSDK').is_dir() else []
        folder = str(versions[-1].parent.parent) if versions else None
    if not folder or not Path(folder).is_dir():
        return None
    return Path(folder).name, folder


def ftdi_driver():
    """The FTDI serial driver (the USB Gecko's): (installed, what's there). It has two halves, the bus (ftdibus)
    and the COM port (ftdiport); installed, each sits in Windows' driver store (copied into System32\\drivers
    only once the Gecko is first plugged in)."""
    store = Path(os.environ.get('SystemRoot', r'C:\Windows')) / 'System32' / 'DriverStore' / 'FileRepository'
    found = {}
    for half in ('ftdibus', 'ftdiport'):
        for folder in sorted(store.glob(f'{half}.inf_*')):
            if not folder.is_dir():
                continue
            try:
                raw = (folder / f'{half}.inf').read_bytes()
                text = raw.decode('utf-16') if raw[:2] in (b'\xff\xfe', b'\xfe\xff') else raw.decode('latin-1')
                ver = re.search(r'DriverVer\s*=\s*[^,]*,\s*([0-9.]+)', text)
                found[half] = ver.group(1) if ver else 'installed'
            except OSError:
                found[half] = 'installed'
    if not found:
        return False, ''
    if len(found) == 1:
        missing = 'ftdiport' if 'ftdibus' in found else 'ftdibus'
        return False, f'{next(iter(found))} {next(iter(found.values()))} only: install {missing}.inf too'
    return True, f"{found['ftdibus']} (bus and COM port)"


PACKAGES_CACHE = {}


def other_packages():
    """Python and the rest, checked once a minute at most (Visual Studio's check takes a moment)."""
    if time.time() - PACKAGES_CACHE.get('at', 0) > 60:
        vs, vk, ftdi = visual_studio(), vulkan_sdk(), ftdi_driver()
        pil, np = python_package('pillow'), python_package('numpy')
        PACKAGES_CACHE.update(at=time.time(), list=[
            {'name': 'Python 3', 'group': 'required', 'ok': True, 'where': f'{sys.version.split()[0]}: {Path(sys.executable).parent}',
             'purpose': 'The app and the builders'},
            {'name': 'Pillow', 'group': 'required', 'ok': bool(pil), 'where': pil or '', 'purpose': "Making the games' assets",
             'fix': 'py -m pip install pillow'},
            {'name': 'numpy', 'group': 'required', 'ok': bool(np), 'where': np or '', 'purpose': "Making the games' assets",
             'fix': 'py -m pip install numpy'},
            {'name': 'Visual Studio (C++)', 'group': 'optional', 'ok': bool(vs), 'where': ': '.join(vs) if vs else '',
             'purpose': 'Building the engine from source', 'link': 'https://visualstudio.microsoft.com/'},
            {'name': 'Vulkan SDK', 'group': 'optional', 'ok': bool(vk), 'where': ': '.join(vk) if vk else '',
             'purpose': 'Building the engine from source', 'link': 'https://vulkan.lunarg.com/sdk/home#windows'},
            {'name': 'USB Gecko driver (FTDI)', 'group': 'optional', 'ok': ftdi[0], 'where': ftdi[1],
             'purpose': 'The USB Gecko as a COM port', 'link': 'https://ftdichip.com/drivers/vcp-drivers/'},
        ])
    return PACKAGES_CACHE['list']


def state_payload():
    toolchains = find_toolchains()
    chosen = chosen_toolchain()
    dolphin, profiles = find_dolphin()
    octave = find_octave()
    st = load_state()
    return {
        'version': VERSION,
        'packages': other_packages(),
        'projects': PROJECTS,
        'custom_paths': {kind: bool(st.get(kind)) for kind in PATHS},
        'project_roots': [{'path': str(p), 'default': p in DEFAULT_ROOTS, 'exists': p.is_dir()} for p in project_roots()],
        'selected': st.get('selected'),
        'toolchains': [{'path': str(p), 'label': toolchain_label(p)} for p in toolchains],
        'toolchain': str(chosen) if chosen else None,
        'octave': str(octave) if octave else None,
        'octave_version': octave_version(octave) if octave else None,
        'dolphin': {'path': str(dolphin), 'version': dolphin_version(dolphin), 'profiles': profiles} if dolphin else None,
        'dolphins': [{'path': str(p), 'version': dolphin_version(p), 'where': p.parent.name,
                      'profiles': (p / 'User-Accurate').is_dir()} for p in find_dolphins()],
        'profile': st.get('profile', 'Fast'),
        'build_type': st.get('build_type', 'Release'),
        'sd_log': st.get('sd_log', False),
        'gecko_log': st.get('gecko_log', False),
        'gecko': usb_gecko(),
        'sd_cards': sd_cards(),
        'sd_card': st.get('sd_card'),
        'busy': JOBS.busy,
        'gecko_console': GECKO.status(),
    }


PROJECTS = []
TYPES = {'.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml',
         '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.json': 'application/json'}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def send(self, code, body=b'', kind='application/json'):
        self.send_response(code)
        self.send_header('Content-Type', kind)
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)

    def json(self, data, code=200):
        self.send(code, json.dumps(data).encode())

    def do_GET(self):
        url = urllib.parse.urlparse(self.path)
        query = urllib.parse.parse_qs(url.query)
        if url.path == '/api/state':
            return self.json(state_payload())
        if url.path == '/api/history':
            return self.json(JOBS.history)
        if url.path == '/api/gecko_history':
            return self.json(GECKO.history)
        if url.path == '/api/events':
            return self.events()
        if url.path == '/api/image':
            project = by_id(query.get('id', [''])[0])
            kind = query.get('kind', ['banner'])[0]
            if project and kind in ('disc_banner', 'card_icon', 'card_banner'):     # (from the disc and the game's files)
                frame = query.get('frame', [''])[0]
                png = (disc.bnr_picture(project['bnr']) if kind == 'disc_banner' and project.get('bnr')
                       else disc.card_picture(project.get('card'), kind[len('card_'):], int(frame) if frame.isdigit() else None)
                       if kind != 'disc_banner' else None)
                return self.send(200, png, 'image/png') if png else self.send(404)
            path = project and kind in ('banner', 'screenshot', 'icon') and project.get(kind)   # (pictures only)
            if path and Path(path).exists():
                return self.send(200, Path(path).read_bytes(), TYPES.get(Path(path).suffix.lower(), 'image/png'))
            return self.send(404)
        path = UI / ('index.html' if url.path in ('/', '') else url.path.lstrip('/'))
        if path.resolve().is_relative_to(UI.resolve()) and path.is_file():
            return self.send(200, path.read_bytes(), TYPES.get(path.suffix.lower(), 'application/octet-stream'))
        self.send(404)

    def events(self):
        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream')
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        q = queue.Queue()
        with JOBS.lock:
            JOBS.listeners.append(q)
        try:
            while True:
                try:
                    event = q.get(timeout=15)
                    self.wfile.write(f'data: {json.dumps(event)}\n\n'.encode())
                except queue.Empty:
                    self.wfile.write(b': ping\n\n')
                self.wfile.flush()
        except OSError:
            pass
        finally:
            with JOBS.lock:
                JOBS.listeners.remove(q)

    def do_POST(self):
        global PROJECTS
        length = int(self.headers.get('Content-Length') or 0)
        body = json.loads(self.rfile.read(length) or b'{}')
        action = urllib.parse.urlparse(self.path).path.rsplit('/', 1)[-1]
        project = by_id(body.get('id'))
        if action == 'settings':
            save_state(**{k: v for k, v in body.items() if k in
                          ('toolchain', 'dolphin', 'profile', 'build_type', 'sd_log', 'gecko_log', 'sd_card', 'selected')})
            return self.json({'ok': True})
        if action == 'gdb' and project:
            return self.json(start_gdb(project))
        if action == 'rename' and project:
            names = load_state().get('names', {})
            title = ' '.join(str(body.get('title', '')).split())[:120]    # (one line, trimmed)
            if title and title != project['own_title']:
                names[project['key']] = title
            else:
                names.pop(project['key'], None)                         # (empty, or its own: back to its own)
            save_state(names=names)
            PROJECTS = scan_projects()
            return self.json({'ok': True})
        if action in ('disc_text', 'picture') and project:
            if JOBS.busy:
                return self.json({'ok': False, 'message': 'Wait for the build to finish.'})
            try:
                if action == 'disc_text':
                    edit_text(project, body.get('field'), str(body.get('value', '')))
                else:
                    edit_picture(project, body.get('which'), base64.b64decode(body.get('rgba', '')))
            except ValueError as e:
                return self.json({'ok': False, 'message': str(e)})
            except PermissionError:
                return self.json({'ok': False, 'message': 'The disc image is in use (running in Dolphin?): close it and try again.'})
            except OSError as e:
                return self.json({'ok': False, 'message': f'Not written: {e}'})
            finally:
                PROJECTS = scan_projects()
            return self.json({'ok': True})
        if action == 'gecko_connect':
            ok, message = GECKO.connect()
            return self.json({'ok': ok, 'message': message, **GECKO.status()})
        if action == 'gecko_disconnect':
            GECKO.disconnect()
            return self.json({'ok': True, **GECKO.status()})
        if action == 'gecko_send':
            ok = GECKO.send(str(body.get('text', '')))
            return self.json({'ok': ok, 'message': None if ok else 'Not connected to the USB Gecko.', **GECKO.status()})
        if action == 'rescan':
            PROJECTS = scan_projects()
            return self.json({'ok': True})
        if action == 'add_root':
            folder = body.get('path') or pick_folder()
            if not folder:
                return self.json({'ok': False, 'cancelled': True})
            folder = str(Path(folder).resolve())
            if not Path(folder).is_dir():
                return self.json({'ok': False, 'message': f'Not a folder: {folder}'})
            st = load_state()
            hidden = [h for h in st.get('hidden_roots', []) if h.lower() != folder.lower()]
            roots = st.get('project_roots', [])
            if folder.lower() not in [str(p).lower() for p in DEFAULT_ROOTS + [Path(r) for r in roots]]:
                roots = roots + [folder]
            save_state(project_roots=roots, hidden_roots=hidden)     # (a removed default comes back)
            PROJECTS = scan_projects()
            return self.json({'ok': True, 'path': folder})
        if action == 'set_path' and body.get('kind') in PATHS:
            ok, message = set_path(body['kind'], body.get('path'))
            return self.json({'ok': ok, 'path': message} if ok else {'ok': False, 'cancelled': message is None, 'message': message})
        if action == 'reset_path' and body.get('kind') in PATHS:
            st = load_state()
            st.pop(body['kind'], None)
            if body['kind'] in ('toolchain', 'dolphin'):
                st.pop(f'{body["kind"]}_folders', None)
            STATE.write_text(json.dumps(st, indent=1))
            return self.json({'ok': True})
        if action == 'remove_root':
            path = str(body.get('path', '')).lower()
            st = load_state()
            roots = [r for r in st.get('project_roots', []) if r.lower() != path]
            hidden = st.get('hidden_roots', [])
            if path in [str(p).lower() for p in DEFAULT_ROOTS] and path not in [h.lower() for h in hidden]:
                hidden = hidden + [str(next(p for p in DEFAULT_ROOTS if str(p).lower() == path))]
            save_state(project_roots=roots, hidden_roots=hidden)
            PROJECTS = scan_projects()
            return self.json({'ok': True})
        if action == 'build' and project and project.get('octp'):          # (a disc image alone has nothing to build)
            ok = JOBS.start(f'Build {project["title"]}', lambda: build(project, body))
            return self.json({'ok': ok, 'busy': JOBS.busy})
        if action == 'run' and project:
            dolphin, profiles = find_dolphin()
            if not dolphin:
                return self.json({'ok': False, 'message': 'No Dolphin: install it with dolphinworks.bat.'})
            if not Path(project['iso']).exists():
                return self.json({'ok': False, 'message': 'Build it first: there is no disc image yet.'})
            args = [str(dolphin / 'Dolphin.exe')]
            if profiles:
                args += ['-u', str(dolphin / ('User-Accurate' if body.get('profile') == 'Accurate' else 'User'))]
            proc = launch(args + RUN_CONFIG + ['-b', '-e', project['iso']], cwd=dolphin, minimized=bool(body.get('embed')),
                          stay=not body.get('embed'))       # (a game inside the app ends with it)
            JOBS.emit('line', text=f'Running {project["title"]} in Dolphin ({body.get("profile", "Fast")})', level='info')
            return self.json({'ok': True, 'pid': proc.pid, 'title': project['title']})
        if action == 'dolphin':
            dolphin, profiles = find_dolphin()
            if dolphin:
                args = [str(dolphin / 'Dolphin.exe')]
                if profiles:
                    args += ['-u', str(dolphin / ('User-Accurate' if body.get('profile') == 'Accurate' else 'User'))]
                launch(args, cwd=dolphin)
            return self.json({'ok': bool(dolphin)})
        if action == 'editor' and project and project.get('octp'):
            octave = find_octave()
            if not octave:
                return self.json({'ok': False, 'message': 'No Octave-libogc: install it with dolphinworks.bat.'})
            launch([str(octave / 'Octave.exe'), '-project', Path(project['octp']).as_posix()], cwd=octave)
            return self.json({'ok': True})
        if action == 'folder' and project:
            launch(['explorer', project['root']])
            return self.json({'ok': True})
        if action == 'builder' and project and project.get('builder'):
            launch(['cmd', '/c', 'start', '', project['builder']], cwd=project['root'])
            return self.json({'ok': True})
        if action == 'deploy' and project:
            if not Path(project['iso']).exists():
                return self.json({'ok': False, 'message': 'Build it first: there is no disc image yet.'})
            drive = body.get('drive')
            if not drive:
                return self.json({'ok': False, 'message': 'Insert an SD card (or choose one).'})
            return self.json({'ok': JOBS.start(f'Deploy {project["title"]}', lambda: deploy(project, drive))})
        if action == 'setup':
            setup = HERE.parent / 'dolphinworks.bat'
            launch(['cmd', '/c', 'start', '', str(setup)], cwd=setup.parent)
            return self.json({'ok': True})
        self.json({'ok': False, 'message': 'unknown action'}, 404)


def by_id(pid):
    return next((p for p in PROJECTS if p['id'] == pid), None)


def rescan():
    global PROJECTS
    PROJECTS = scan_projects()


def find_edge():
    for base in (os.environ.get('ProgramFiles(x86)'), os.environ.get('ProgramFiles'), os.environ.get('LOCALAPPDATA')):
        if base and (Path(base) / 'Microsoft' / 'Edge' / 'Application' / 'msedge.exe').exists():
            return Path(base) / 'Microsoft' / 'Edge' / 'Application' / 'msedge.exe'
    return None


def brand_window(proc):
    """The app's own icon (app.ico, the dolphin leaping from a wave in a D) on its window and taskbar
    button, in place of the badge Edge draws for app windows: the window is found by its title,
    its icons set (sized for its screen's scaling), and set again if Edge puts its own back."""
    user32 = ctypes.windll.user32
    user32.LoadImageW.restype = ctypes.c_void_p
    user32.SendMessageW.restype = ctypes.c_void_p
    user32.SendMessageW.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_void_p, ctypes.c_void_p]
    ico = str(HERE / 'app.ico')
    loaded = {}

    def icon(size):
        if size not in loaded:
            loaded[size] = user32.LoadImageW(None, ico, 1, size, size, 0x10)   # IMAGE_ICON, LR_LOADFROMFILE
        return loaded[size]

    found = []
    callback_type = ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_void_p, ctypes.c_void_p)

    def each(hwnd, _):
        title = ctypes.create_unicode_buffer(64)
        user32.GetWindowTextW(ctypes.c_void_p(hwnd), title, 64)
        cls = ctypes.create_unicode_buffer(64)
        user32.GetClassNameW(ctypes.c_void_p(hwnd), cls, 64)
        if title.value == 'DolphinWorks' and cls.value.startswith('Chrome_WidgetWin') and user32.IsWindowVisible(ctypes.c_void_p(hwnd)):
            found.append(hwnd)
        return True

    callback = callback_type(each)
    while proc.poll() is None:
        found.clear()
        user32.EnumWindows(callback, None)
        for hwnd in found:
            dpi = user32.GetDpiForWindow(ctypes.c_void_p(hwnd)) or 96
            big, small = icon(round(32 * dpi / 96)), icon(round(16 * dpi / 96))
            if big and user32.SendMessageW(hwnd, 0x7F, 1, None) != big:          # WM_GETICON, ICON_BIG
                user32.SendMessageW(hwnd, 0x80, 1, big)                          # WM_SETICON, ICON_BIG
                user32.SendMessageW(hwnd, 0x80, 0, small)                        # WM_SETICON, ICON_SMALL
        time.sleep(2)


def main():
    global PROJECTS
    try:
        (DW_ROOT / 'Projects').mkdir(parents=True, exist_ok=True)   # the default home for projects
    except OSError:
        pass
    PROJECTS = scan_projects()
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0))
        port = s.getsockname()[1]
    server = ThreadingHTTPServer(('127.0.0.1', port), Handler)
    server.daemon_threads = True
    threading.Thread(target=server.serve_forever, daemon=True).start()
    url = f'http://127.0.0.1:{port}/'
    if '--no-window' in sys.argv:
        print(url, flush=True)
        try:
            while True:
                time.sleep(3600)
        except KeyboardInterrupt:
            return
    edge = find_edge()
    if not edge:
        import webbrowser
        webbrowser.open(url)
        while True:
            time.sleep(3600)
    profile = HERE / '.window'
    # a window of its own (its own Edge profile), the size of the design; closing it ends the app
    proc = subprocess.Popen([str(edge), f'--app={url}', f'--user-data-dir={profile}', '--window-size=1440,960',
                             '--no-first-run', '--disable-features=Translate'])
    threading.Thread(target=brand_window, args=(proc,), daemon=True).start()
    proc.wait()
    server.shutdown()


if __name__ == '__main__':
    main()
