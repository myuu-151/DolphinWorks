"""OpenGC Setup: everything needed to make GameCube games, installed in one window.

    Double-click "Setup OpenGC.bat" (or: python tools/setup.py)

Into one folder (C:\\OpenGC unless another is chosen), each part a tick box:

- the Python packages the builders use: Pillow and numpy (pip, for this user);
- the GameCube toolchain: gekko-toolchain's latest release, unzipped, and DEVKITPRO and DEVKITPPC
  pointed at it as its Install.bat does (left unticked when devkitPro or gekko-toolchain is there);
- the engine: Octave-libogc's latest release, built, unzipped -- or its source, cloned, with its
  own builder opened to build it.

Visual Studio and the Vulkan SDK, needed only to build the engine from source, are large
installers of their own: the window says whether they're there and links to them.

Every step runs in the background without a window of its own; the window shows each step's
progress and a short log, all of it in setup.log in the folder. Run it again to update: what's
there already is left, a newer release replaces an older one.
"""
import ctypes
import json
import os
import queue
import re
import shutil
import subprocess
import sys
import threading
import tkinter as tk
import urllib.request
import webbrowser
import zipfile
from pathlib import Path
from tkinter import filedialog, ttk

HERE = Path(__file__).resolve().parents[1]
SETTINGS = Path(__file__).with_name('.setup.json')            # (not in git)
DEFAULT_ROOT = Path(r'C:\OpenGC')
TOOLCHAIN_REPO, ENGINE_REPO = 'myuu-151/gekko-toolchain', 'myuu-151/Octave-Libogc'
PACKAGES = ('pillow', 'numpy')
NO_WINDOW, LOW_PRIORITY = 0x08000000, 0x4000
# For testing only: OPENGC_NO_ENV=1 leaves the user's environment variables alone.
TOUCH_ENV = not os.environ.get('OPENGC_NO_ENV')


# --- what's there ---------------------------------------------------------------------------------

def toolchain_path(candidate):
    """A toolchain folder from a folder or a DEVKITPRO-style value (/c/devkitPro), or None."""
    if not candidate:
        return None
    if candidate.startswith('/') and len(candidate) > 2 and candidate[2] == '/':
        candidate = f'{candidate[1].upper()}:{candidate[2:]}'
    elif candidate.startswith('/opt/devkitpro'):
        candidate = r'C:\devkitPro'
    path = Path(candidate)
    return path if (path / 'devkitPPC' / 'bin' / 'powerpc-eabi-gcc.exe').exists() else None


def user_env(name):
    try:
        import winreg
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, 'Environment') as key:
            return winreg.QueryValueEx(key, name)[0]
    except OSError:
        return None


def machine_env(name):
    try:
        import winreg
        with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r'SYSTEM\CurrentControlSet\Control\Session Manager\Environment') as key:
            return winreg.QueryValueEx(key, name)[0]
    except OSError:
        return None


def existing_toolchain(root):
    """A GameCube toolchain already there: DEVKITPRO's (this process's, the user's, the machine's),
    C:\\devkitPro, C:\\gekko-toolchain, or the one in the folder."""
    for candidate in (os.environ.get('DEVKITPRO'), user_env('DEVKITPRO'), machine_env('DEVKITPRO'),
                      r'C:\devkitPro', r'C:\gekko-toolchain', str(Path(root) / 'gekko-toolchain')):
        path = toolchain_path(candidate)
        if path:
            return path
    return None


def toolchain_label(path):
    kind = 'gekko-toolchain' if (path / 'VERSIONS.txt').exists() and (path / 'Install.bat').exists() else 'devkitPro'
    version = ''
    try:
        version = next(line.split()[1].split('-')[0] for line in (path / 'VERSIONS.txt').read_text().splitlines()
                       if line.startswith('devkitPPC '))
    except (OSError, StopIteration, IndexError):
        db = path / 'msys2' / 'var' / 'lib' / 'pacman' / 'local'
        found = sorted(m.group(1) for d in (db.iterdir() if db.is_dir() else ())
                       for m in [re.match(r'devkitPPC-(r[0-9.]+)-', d.name)] if m)
        version = found[-1] if found else ''
    return f'{kind} {version}'.strip()


def engine_version(folder):
    """The engine's release as setup installed it (.opengc-release), 'built here', or None."""
    folder = Path(folder)
    if not (folder / 'Octave.exe').exists() or not (folder / 'Engine' / 'Build' / 'GCN' / 'libEngine.a').exists():
        return 'source' if (folder / '.git').exists() else None
    try:
        return (folder / '.opengc-release').read_text().strip()
    except OSError:
        return 'built here'


def missing_packages():
    missing = []
    for name, module in (('pillow', 'PIL'), ('numpy', 'numpy')):
        try:
            __import__(module)
        except ImportError:
            missing.append(name)
    return missing


def find_vs():
    tool = Path(os.environ.get('ProgramFiles(x86)', r'C:\Program Files (x86)')) / 'Microsoft Visual Studio' / 'Installer' / 'vswhere.exe'
    if not tool.exists():
        return None
    try:
        out = subprocess.run([str(tool), '-latest', '-products', '*', '-requires',
                              'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-property', 'installationPath'],
                             capture_output=True, text=True, creationflags=NO_WINDOW).stdout.strip()
    except OSError:
        return None
    return out or None


def latest_release(repo):
    """(tag, the release's .zip asset's name, its download URL, its size)."""
    with urllib.request.urlopen(f'https://api.github.com/repos/{repo}/releases/latest', timeout=60) as r:
        release = json.load(r)
    asset = next(a for a in release['assets'] if a['name'].endswith('.zip'))
    return release['tag_name'], asset['name'], asset['browser_download_url'], asset['size']


def set_user_env(name, value):
    """A user environment variable set (or removed, for None), as Install.bat does, and every
    program told (so one started from Explorer afterwards sees it)."""
    import winreg
    with winreg.OpenKey(winreg.HKEY_CURRENT_USER, 'Environment', 0, winreg.KEY_SET_VALUE) as key:
        if value is None:
            try:
                winreg.DeleteValue(key, name)
            except OSError:
                pass
        else:
            winreg.SetValueEx(key, name, 0, winreg.REG_SZ, value)
    result = ctypes.c_ulong()
    ctypes.windll.user32.SendMessageTimeoutW(0xFFFF, 0x1A, 0, 'Environment', 0x2, 5000, ctypes.byref(result))


def msys(path):
    p = Path(path).as_posix()
    return f'/{p[0].lower()}{p[2:]}' if len(p) > 1 and p[1] == ':' else p


# --- the window -----------------------------------------------------------------------------------

class Setup:
    def __init__(self, root):
        self.root = root
        self.lines = queue.Queue()
        self.busy = False
        self.entries = []
        self.phase = self.step = ''
        root.title('OpenGC Setup')
        root.minsize(700, 560)
        try:
            settings = json.loads(SETTINGS.read_text())
        except (OSError, ValueError):
            settings = {}
        self.folder = tk.StringVar(value=settings.get('folder', str(DEFAULT_ROOT)))
        self.want = {k: tk.BooleanVar(value=True) for k in ('packages', 'toolchain', 'engine')}
        self.from_source = tk.BooleanVar(value=False)
        self.verbose = tk.BooleanVar(value=False)

        pad = {'padx': 10, 'pady': 4}
        ttk.Label(root, text='OpenGC Setup', font=('Segoe UI', 14, 'bold')).pack(anchor='w', **pad)
        ttk.Label(root, text='Everything needed to make GameCube games, in one folder.').pack(anchor='w', padx=10)

        where = ttk.Frame(root)
        where.pack(fill='x', **pad)
        ttk.Label(where, text='Install to', width=12).pack(side='left')
        ttk.Entry(where, textvariable=self.folder).pack(side='left', fill='x', expand=True)
        ttk.Button(where, text='Choose...', command=self.choose).pack(side='left', padx=(6, 0))

        parts = ttk.LabelFrame(root, text='What to install')
        parts.pack(fill='x', **pad)
        self.notes = {}
        for key, title in (('packages', 'Python packages: Pillow and numpy'),
                           ('toolchain', 'GameCube toolchain: gekko-toolchain'),
                           ('engine', 'Engine: Octave-libogc')):
            row = ttk.Frame(parts)
            row.pack(fill='x', padx=6, pady=2)
            ttk.Checkbutton(row, text=title, variable=self.want[key], width=38,
                            command=self.check).pack(side='left')
            note = ttk.Label(row, foreground='#555')
            note.pack(side='left', fill='x', expand=True)
            self.notes[key] = note
        ttk.Checkbutton(parts, text='Build the engine from source instead of its release '
                                    '(needs git, Visual Studio and the Vulkan SDK)',
                        variable=self.from_source, command=self.check).pack(anchor='w', padx=24, pady=(0, 4))

        extra = ttk.LabelFrame(root, text='Only for building the engine from source')
        extra.pack(fill='x', **pad)
        self.extra_notes = {}
        for key, title, url in (('vs', 'Visual Studio with C++', 'https://visualstudio.microsoft.com/'),
                                ('vulkan', 'Vulkan SDK', 'https://vulkan.lunarg.com/sdk/home#windows'),
                                ('git', 'git', 'https://git-scm.com/download/win')):
            row = ttk.Frame(extra)
            row.pack(fill='x', padx=6, pady=2)
            mark = ttk.Label(row, width=3, font=('Segoe UI', 10, 'bold'))
            mark.pack(side='left')
            ttk.Label(row, text=title, width=24).pack(side='left')
            note = ttk.Label(row, foreground='#555')
            note.pack(side='left', fill='x', expand=True)
            ttk.Button(row, text='Get it', command=lambda u=url: webbrowser.open(u)).pack(side='right')
            self.extra_notes[key] = (mark, note)

        buttons = ttk.Frame(root)
        buttons.pack(fill='x', **pad)
        self.install_button = ttk.Button(buttons, text='Install', command=self.install)
        self.install_button.pack(side='left')
        self.editor_button = ttk.Button(buttons, text='Open the Octave editor', command=self.open_editor)
        self.editor_button.pack(side='left', padx=8)
        self.progress = ttk.Progressbar(buttons, mode='indeterminate', length=240, maximum=100)

        self.status = ttk.Label(root, text='')
        self.status.pack(anchor='w', **pad)
        ttk.Checkbutton(root, text='Show every line', variable=self.verbose, command=self.show_log).pack(anchor='w', padx=10)
        frame = ttk.Frame(root)
        frame.pack(fill='both', expand=True, padx=10, pady=(0, 10))
        self.log = tk.Text(frame, height=10, wrap='none', font=('Consolas', 9), state='disabled')
        scroll = ttk.Scrollbar(frame, command=self.log.yview)
        self.log.configure(yscrollcommand=scroll.set)
        scroll.pack(side='right', fill='y')
        self.log.pack(side='left', fill='both', expand=True)

        self.survey(first=True)
        root.after(100, self.pump)

    # --- what's there, and what will be done ------------------------------------------------------

    def survey(self, first=False):
        """Looks at what's installed; on the first look, unticks what needn't be done."""
        root = Path(self.folder.get())
        self.packages_missing = missing_packages()
        self.toolchain = existing_toolchain(root)
        self.engine = engine_version(root / 'Octave-libogc')
        self.vs, self.git = find_vs(), shutil.which('git')
        sdk = os.environ.get('VULKAN_SDK') or user_env('VULKAN_SDK') or machine_env('VULKAN_SDK')
        self.vulkan = sdk if sdk and (Path(sdk) / 'Bin' / 'glslc.exe').exists() else None
        if first:
            self.want['packages'].set(bool(self.packages_missing))
            self.want['toolchain'].set(self.toolchain is None)
            self.want['engine'].set(self.engine is None)
        self.check()

    def check(self):
        root = Path(self.folder.get())
        bad_folder = ' ' in str(root) or not root.is_absolute()
        n = self.notes
        n['packages'].configure(text='installed' if not self.packages_missing else 'to install: ' + ', '.join(self.packages_missing))
        if self.toolchain:
            n['toolchain'].configure(text=f'there already: {toolchain_label(self.toolchain)} ({self.toolchain})'
                                          + ('; installs gekko-toolchain beside it' if self.want['toolchain'].get() else ''))
        else:
            n['toolchain'].configure(text=f'to install into {root / "gekko-toolchain"}')
        source = self.from_source.get()
        if self.engine and self.engine not in ('source',):
            n['engine'].configure(text=f'there already: {self.engine} ({root / "Octave-libogc"})'
                                       + ('; to update' if self.want['engine'].get() else ''))
        else:
            n['engine'].configure(text=('to clone and build in ' if source else 'to install into ') + str(root / 'Octave-libogc'))
        for key, value, missing in (('vs', self.vs, 'not installed'), ('vulkan', self.vulkan, 'not installed'),
                                    ('git', self.git, 'not installed')):
            mark, note = self.extra_notes[key]
            if value:
                mark.configure(text='OK', foreground='#1a7f37')
                note.configure(text=str(value))
            else:
                mark.configure(text='X' if source else '-', foreground='#c62828' if source else '#888')
                note.configure(text=missing + (': needed for building from source' if source else ''))
        problems = []
        if bad_folder:
            problems.append('choose a folder whose path has no spaces (the toolchain needs that)')
        if source and self.want['engine'].get() and not (self.vs and self.vulkan and self.git):
            problems.append('building from source needs git, Visual Studio and the Vulkan SDK (below)')
        anything = any(v.get() for v in self.want.values())
        ok = anything and not problems
        if not self.busy:
            self.install_button.configure(state='normal' if ok else 'disabled')
            self.status.configure(foreground='', text=problems[0][0].upper() + problems[0][1:] + '.' if problems else
                                  ('Ready to install.' if anything else 'Everything is installed. Tick something to reinstall it.'))
        self.editor_button.configure(state='normal' if (root / 'Octave-libogc' / 'Octave.exe').exists() else 'disabled')
        return ok

    def choose(self):
        folder = filedialog.askdirectory(title='Where to install OpenGC (a path without spaces)',
                                         initialdir=self.folder.get())
        if folder:
            self.folder.set(str(Path(folder)))
            self.save()
            self.survey(first=True)

    def save(self):
        try:
            SETTINGS.write_text(json.dumps({'folder': self.folder.get()}))
        except OSError:
            pass

    # --- log and progress -----------------------------------------------------------------------

    def write(self, text):
        self.log.configure(state='normal')
        self.log.insert('end', text)
        self.log.see('end')
        self.log.configure(state='disabled')

    def show_log(self):
        self.log.configure(state='normal')
        self.log.delete('1.0', 'end')
        self.log.insert('end', ''.join(t + '\n' for t, shown in self.entries if shown or self.verbose.get()))
        self.log.see('end')
        self.log.configure(state='disabled')

    def pump(self):
        try:
            while True:
                kind, *rest = self.lines.get_nowait()
                if kind == 'line':
                    text, shown = rest
                    self.entries.append((text, shown))
                    if shown or self.verbose.get():
                        self.write(text + '\n')
                elif kind == 'phase':
                    self.phase = rest[0]
                    self.show_step('starting')
                elif kind == 'step':
                    self.show_step(rest[0])
                elif kind == 'progress':
                    self.show_progress(*rest)
                elif kind == 'done':
                    self.finished(*rest)
        except queue.Empty:
            pass
        self.root.after(100, self.pump)

    def show_step(self, step):
        self.step = step
        self.progress.stop()
        self.progress.configure(mode='indeterminate')
        self.progress.start(12)
        self.status.configure(text=f'{self.phase}: {step}...')

    def show_progress(self, done, total, unit=''):
        if str(self.progress.cget('mode')) != 'determinate':
            self.progress.stop()
            self.progress.configure(mode='determinate')
        percent = 100 * done // max(total, 1)
        self.progress.configure(value=percent)
        self.status.configure(text=f'{self.phase}: {self.step}, {done} of {total}{unit} ({percent}%)')

    def say(self, text, shown=True):
        self.lines.put(('line', text, shown))
        try:
            with open(Path(self.folder.get()) / 'setup.log', 'a', encoding='utf-8') as log:
                log.write(text + '\n')
        except OSError:
            pass

    # --- installing ---------------------------------------------------------------------------------

    def install(self):
        if self.busy or not self.check():
            return
        self.busy = True
        self.save()
        root = Path(self.folder.get())
        root.mkdir(parents=True, exist_ok=True)
        (root / 'setup.log').write_text('', encoding='utf-8')
        self.install_button.configure(state='disabled')
        self.progress.pack(side='right')
        self.entries = []
        self.show_log()
        want = {k: v.get() for k, v in self.want.items()}
        threading.Thread(target=self.run_install, args=(root, want, self.from_source.get()), daemon=True).start()

    def run(self, args, cwd=None, shown=lambda text: False):
        """A step hidden, at low priority; its output to the log. True if it succeeded."""
        startup = subprocess.STARTUPINFO()
        startup.dwFlags |= subprocess.STARTF_USESHOWWINDOW
        startup.wShowWindow = 0
        proc = subprocess.Popen(args, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL,
                                startupinfo=startup, creationflags=NO_WINDOW | LOW_PRIORITY)
        for raw in proc.stdout:
            text = raw.decode('utf-8', 'replace').rstrip('\r\n').split('\r')[-1].rstrip()
            if text:
                self.say(text, shown(text))
        return proc.wait() == 0

    def download(self, url, size, target):
        """A file downloaded with its progress in MB."""
        part = target.with_suffix(target.suffix + '.part')
        total = max(size >> 20, 1)
        with urllib.request.urlopen(url, timeout=60) as response, open(part, 'wb') as out:
            done = 0
            while True:
                block = response.read(1 << 20)
                if not block:
                    break
                out.write(block)
                done += len(block)
                self.lines.put(('progress', min(done >> 20, total), total, ' MB'))
        part.replace(target)

    def unzip(self, archive, into, strip=''):
        """A zip unpacked with its progress in files (strip: a top folder to leave out)."""
        with zipfile.ZipFile(archive) as z:
            members = [i for i in z.infolist() if not i.is_dir()]
            for n, info in enumerate(members, 1):
                name = info.filename[len(strip):] if strip and info.filename.startswith(strip) else info.filename
                target = into / name
                target.parent.mkdir(parents=True, exist_ok=True)
                if target.exists():
                    os.chmod(target, 0o666)                 # (a read-only file from before)
                with z.open(info) as src, open(target, 'wb') as out:
                    shutil.copyfileobj(src, out, 1 << 20)
                if n % 50 == 0 or n == len(members):
                    self.lines.put(('progress', n, len(members), ' files'))

    def packages(self):
        self.lines.put(('step', 'installing ' + ' and '.join(PACKAGES)))
        python = Path(sys.executable)
        if python.name.lower() == 'pythonw.exe' and python.with_name('python.exe').exists():
            python = python.with_name('python.exe')
        ok = self.run([str(python), '-m', 'pip', 'install', '--user', *PACKAGES],
                      shown=lambda t: t.startswith(('Successfully', 'ERROR')))
        if ok:
            self.say('Python packages: ' + ', '.join(PACKAGES))
        return ok

    def toolchain_step(self, root):
        tag, name, url, size = latest_release(TOOLCHAIN_REPO)
        self.lines.put(('step', f'downloading gekko-toolchain {tag}'))
        archive = root / name
        self.download(url, size, archive)
        self.lines.put(('step', 'unpacking it'))
        self.unzip(archive, root)                          # (the zip holds gekko-toolchain/)
        archive.unlink()
        folder = root / 'gekko-toolchain'
        # what its Install.bat does: its MSYS2 pointed at the folder, DEVKITPRO and DEVKITPPC at it
        (folder / 'msys2' / 'etc').mkdir(parents=True, exist_ok=True)
        (folder / 'msys2' / 'tmp').mkdir(parents=True, exist_ok=True)
        (folder / 'msys2' / 'etc' / 'fstab').write_text(
            f'none / cygdrive binary,posix=0,noacl,user 0 0\n{folder}\t/opt/devkitpro\n', newline='\n')
        dkp = msys(folder)
        if TOUCH_ENV:
            current = user_env('DEVKITPRO')
            if current and current != dkp and not user_env('GEKKO_PREVIOUS_DEVKITPRO'):
                set_user_env('GEKKO_PREVIOUS_DEVKITPRO', current)
                set_user_env('GEKKO_PREVIOUS_DEVKITPPC', user_env('DEVKITPPC'))
            set_user_env('DEVKITPRO', dkp)
            set_user_env('DEVKITPPC', dkp + '/devkitPPC')
        self.say(f'gekko-toolchain {tag}: {folder}' + ('' if TOUCH_ENV else ' (environment left alone: OPENGC_NO_ENV)'))
        if TOUCH_ENV:
            self.say(f'DEVKITPRO={dkp}; its Uninstall.bat puts the previous one back')
        return True

    def engine_step(self, root, from_source):
        folder = root / 'Octave-libogc'
        if from_source:
            if not (folder / '.git').exists():
                self.lines.put(('step', 'cloning Octave-libogc'))
                if not self.run(['git', 'clone', '--progress', f'https://github.com/{ENGINE_REPO}.git', str(folder)],
                                shown=lambda t: t.startswith('fatal')):
                    return False
            self.say(f'Octave-libogc source: {folder}; its builder (Build Octave.bat) opens to build it')
            subprocess.Popen(['cmd', '/c', 'start', '', str(folder / 'Build Octave.bat')], cwd=folder,
                             creationflags=NO_WINDOW)
            return True
        tag, name, url, size = latest_release(ENGINE_REPO)
        if engine_version(folder) == tag:
            self.say(f'Octave-libogc {tag}: up to date')
            return True
        self.lines.put(('step', f'downloading Octave-libogc {tag}'))
        archive = root / name
        self.download(url, size, archive)
        self.lines.put(('step', 'unpacking it'))
        self.unzip(archive, folder)
        archive.unlink()
        (folder / '.opengc-release').write_text(tag + '\n')
        self.say(f'Octave-libogc {tag}: {folder}')
        return True

    def run_install(self, root, want, from_source):
        steps = [('packages', 'Python packages', self.packages),
                 ('toolchain', 'GameCube toolchain', lambda: self.toolchain_step(root)),
                 ('engine', 'Engine', lambda: self.engine_step(root, from_source))]
        ok = True
        for key, phase, step in steps:
            if not want[key]:
                continue
            self.say(f'== {phase}')
            self.lines.put(('phase', phase))
            try:
                ok = step()
            except Exception as e:  # noqa: BLE001 (a download or a file: say what)
                self.say(f'{phase} failed: {e}')
                ok = False
            if not ok:
                break
        self.lines.put(('done', ok))

    def finished(self, ok):
        self.busy = False
        self.progress.stop()
        self.progress.configure(mode='determinate', value=0)
        self.progress.pack_forget()
        self.survey(first=True)                            # (what's done now unticked)
        if ok:
            self.status.configure(text='Done. Open the Octave editor to start a project.', foreground='#1a7f37')
            self.write('== Done\n')
        else:
            self.status.configure(text=f'Setup stopped: the log says why (all of it: {Path(self.folder.get()) / "setup.log"}).',
                                  foreground='#c62828')

    def open_editor(self):
        folder = Path(self.folder.get()) / 'Octave-libogc'
        if (folder / 'Octave.exe').exists():
            subprocess.Popen([str(folder / 'Octave.exe')], cwd=folder)


def main():
    root = tk.Tk()
    try:
        ttk.Style().theme_use('vista')
    except tk.TclError:
        pass
    Setup(root)
    root.mainloop()


if __name__ == '__main__':
    main()
