// DolphinWorks' interface: talks to app/server.py (the /api routes) and listens to its events.
'use strict';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));
let state = null;
let selected = null;

const ICONS = {
  build: '<svg viewBox="0 0 24 24"><path d="M14.7 3.3a4.5 4.5 0 0 0-5.6 5.6L3 15l3 3 6.1-6.1a4.5 4.5 0 0 0 5.6-5.6l-2.6 2.6-2.4-.6-.6-2.4z"/></svg>',
  run: '<svg viewBox="0 0 24 24"><path d="M7 4.5v15l12.5-7.5z"/></svg>',
  pad: '<svg viewBox="0 0 24 24"><path d="M7 7h10a5 5 0 0 1 4.9 6l-.8 4a2.6 2.6 0 0 1-4.6 1L15 16H9l-1.5 2a2.6 2.6 0 0 1-4.6-1l-.8-4A5 5 0 0 1 7 7zm0 3v1.5H5.5V13H7v1.5h1.5V13H10v-1.5H8.5V10zm8.75 0a1 1 0 1 0 0 2 1 1 0 0 0 0-2zm2 2.5a1 1 0 1 0 0 2 1 1 0 0 0 0-2z"/></svg>',
  edit: '<svg viewBox="0 0 24 24"><path d="M4 16.5V20h3.5L18 9.5 14.5 6zM20.7 6.8a1 1 0 0 0 0-1.4l-2.1-2.1a1 1 0 0 0-1.4 0L15.5 5 19 8.5z"/></svg>',
  folder: '<svg viewBox="0 0 24 24" style="width:16px;height:16px;vertical-align:-3px"><path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4.6l2 2h8.4A1.5 1.5 0 0 1 21 8.5v9A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5z"/></svg>',
};

async function api(path, body) {
  const options = body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
  const res = await fetch(path, options);
  return res.json();
}

function toast(text) {
  const t = $('#toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 2600);
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const project = () => state && state.projects.find((p) => p.id === selected);
const image = (p, kind) => `/api/image?id=${p.id}&kind=${kind}&v=${encodeURIComponent(p.last_build || '')}`;

// --- state ---------------------------------------------------------------------------------------

async function refresh() {
  state = await api('/api/state');
  if (!state.projects.find((p) => p.id === selected)) {
    const saved = state.projects.find((p) => (p.octp || p.iso) === state.selected);
    selected = (saved || state.projects[0] || {}).id ?? null;
  }
  render();
}

function render() {
  renderList();
  renderDetail();
  renderRight();
  renderPages();
  renderStatus();
  geckoStatus();
}

function renderList() {
  const q = $('#search').value.trim().toLowerCase();
  const list = state.projects.filter((p) => !q || p.title.toLowerCase().includes(q) || p.name.toLowerCase().includes(q));
  $('#projectList').innerHTML = list.map((p) => `
    <div class="pitem ${p.id === selected ? 'active' : ''}" data-id="${p.id}">
      ${p.banner ? `<div class="pthumb" style="background-image:url('${image(p, 'banner')}')"></div>`
                 : `<div class="pthumb">${esc(p.title[0] || '?')}</div>`}
      <div style="min-width:0"><div class="ptitle">${esc(p.title)}</div>
        <div class="pmeta">${p.folder ? esc(p.folder) : 'GameCube · ISO · ' + (!p.octp ? 'Disc image' : p.engine.includes('custom') ? 'Custom code' : 'Octave Engine')}</div></div>
    </div>`).join('') || '<div class="empty">No projects found.</div>';
}

function renderDetail() {
  const p = project();
  if (!p) {
    $('#detail').innerHTML = '<div class="empty">Choose a project, or make one in the Octave editor.</div>';
    return;
  }
  const busy = !!state.busy;
  $('#detail').innerHTML = `
    <div class="banner" style="${p.banner ? `--art:url('${image(p, 'banner')}')` : ''}"></div>
    <div class="dtitle"><div><h2>${esc(p.title)}</h2><div class="path">${esc(p.root)}</div></div>
      <button class="btn" data-act="folder">${ICONS.folder} Open Folder</button></div>
    <div class="tags"><span class="tag">GameCube</span><span class="tag">ISO</span><span class="tag">${esc(p.engine)}</span></div>
    <div class="actions">
      <button class="action blue" data-act="build" ${busy || !p.octp ? 'disabled' : ''} ${p.octp ? '' : 'title="A disc image on its own: nothing to build"'}>${ICONS.build}<div><b>Build</b><span>Disc image</span></div></button>
      <button class="action green" data-act="run" ${p.built ? '' : 'disabled'}>${ICONS.run}<div><b>Run in Dolphin</b><span>${esc(state.profile)} profile</span></div></button>
      <button class="action purple" data-act="deploy" ${p.built && !busy ? '' : 'disabled'}>${ICONS.pad}<div><b>Run on Hardware</b><span>Via SD card</span></div></button>
      <button class="action gray" data-act="editor" ${p.octp ? '' : 'disabled'}>${ICONS.edit}<div><b>Open in Editor</b><span>Octave</span></div></button>
    </div>
    <div class="info-row">
      <div class="subcard"><h3>Project Details</h3><dl class="kv">
        <dt>Name</dt><dd>${esc(p.title)}</dd>
        <dt>Platform</dt><dd>Nintendo GameCube</dd>
        <dt>Output</dt><dd title="${esc(p.iso)}">${esc(p.iso.split(/[\\/]/).slice(-3).join('\\'))}</dd>
        <dt>Engine</dt><dd>${esc(p.engine)}</dd>
        <dt>Last Build</dt><dd>${esc(p.last_build || 'not built yet')}</dd>
        <dt>Size</dt><dd>${p.size_mb ? p.size_mb + ' MB' : '-'}</dd>
      </dl></div>
      <div class="subcard"><h3>${p.screenshot ? 'Screenshot' : 'Artwork'}</h3>
        <div class="shot" style="${p.screenshot || p.banner ? `background-image:url('${image(p, p.screenshot ? 'screenshot' : 'banner')}')` : ''}"></div></div>
    </div>`;
}

function renderRight() {
  $('#toolchain').innerHTML = state.toolchains.map((t) => `<option value="${esc(t.path)}" ${t.path === state.toolchain ? 'selected' : ''}>${esc(t.label)}</option>`).join('')
    || '<option>None installed</option>';
  $('#buildType').value = state.build_type;
  $('#sdLog').checked = !!state.sd_log;
  $('#geckoLog').checked = !!state.gecko_log;
  // a Debug (GDB) build: GDB has the Gecko to itself, no log on it
  $('#geckoLog').disabled = state.build_type === 'Debug (GDB)';
  $('#geckoLog').closest('label').title = state.build_type === 'Debug (GDB)' ? 'Not in a Debug (GDB) build: GDB has the Gecko to itself'
    : 'The log, live over a USB Gecko: watch it on the Debug page';
  $('#profile').value = state.profile;
  // every Dolphin found: its version, and where it is when two share one
  const versions = state.dolphins.map((d) => d.version);
  $('#dolphinVersion').innerHTML = state.dolphins.length ? state.dolphins.map((d) => {
    const where = versions.filter((v) => v === d.version).length > 1 ? ` (${d.where})` : '';
    return `<option value="${esc(d.path)}" ${state.dolphin && d.path === state.dolphin.path ? 'selected' : ''}>${esc(d.version + where)}</option>`;
  }).join('') : '<option>Not installed</option>';
  $('#dolphinVersion').disabled = !state.dolphins.length;
  $('#dolphinVersion').title = state.dolphin ? state.dolphin.path
    + (state.dolphin.profiles ? '' : '\nNo Fast/Accurate profiles: dolphinworks.bat installs a Dolphin with them') : '';
  $('#gecko').innerHTML = state.gecko ? `<span class="ok" title="USB Gecko detected on ${esc(state.gecko)}">● ${esc(state.gecko)}</span>` : '<span class="bad">○ Not connected</span>';
  const sd = state.sd_cards.map((c) => `<option value="${c.drive}" ${c.drive === state.sd_card ? 'selected' : ''}>${c.drive}\\ ${esc(c.label)} (${c.free_gb} GB free)</option>`).join('')
    || '<option value="">No SD card</option>';
  $('#sdSelect').innerHTML = sd;
  $('#sdSelect2').innerHTML = sd;
  const p = project();
  $('#moreOptions').disabled = !(p && p.builder);
  $('#moreOptions').title = p && p.builder ? `Opens ${p.builder.split(/[\\/]/).pop()}: its data steps and options` : 'This project has no builder of its own';
}

function renderPages() {
  const p = project();
  $('#buildCard').innerHTML = p ? `
    <h2>${esc(p.title)}</h2>
    <table class="table"><tr><th>Toolchain</th><td>${esc((state.toolchains.find((t) => t.path === state.toolchain) || {}).label || 'none')}</td></tr>
      <tr><th>Build type</th><td>${esc(state.build_type)}${state.build_type === 'Diagnostic' ? ' (memory census, flicker detector; slower)'
        : state.build_type === 'Debug (GDB)' ? ' (the debug stub: on the console it waits at its start for GDB, Debug page)' : ''}</td></tr>
      <tr><th>SD log</th><td>${state.sd_log ? 'on: the game writes its log to the SD card' : 'off'}</td></tr>
      <tr><th>Gecko log</th><td>${state.gecko_log ? 'on: the log, live over the USB Gecko (the Debug page)' : 'off'}</td></tr>
      <tr><th>Engine</th><td>${esc(state.octave || 'not installed')}</td></tr>
      <tr><th>Output</th><td>${esc(p.iso)}</td></tr></table>
    <div class="row2" style="margin-top:12px"><button class="btn primary" data-act="build" ${state.busy ? 'disabled' : ''}>Build</button>
      <button class="btn" id="moreOptions2" ${p.builder ? '' : 'disabled'}>More build options...</button></div>` : '<div class="empty">Choose a project first.</div>';
  const b2 = $('#moreOptions2');
  if (b2) b2.onclick = () => $('#moreOptions').click();
  $$('.profile').forEach((el) => el.classList.toggle('active', el.dataset.profile === state.profile));
  $('#geckoBig').innerHTML = state.gecko ? `<p class="ok">● Connected on ${esc(state.gecko)}</p>` : '<p class="bad">○ Not connected</p>';
  // the packages: what every project needs, then what only some work needs (missing is fine there)
  const row = (p) => {
    const status = p.ok ? '<span class="ok">● Installed</span>'
      : p.group === 'optional' ? '<span class="muted">○ Not installed</span>' : '<span class="err">○ Missing</span>';
    const fix = p.ok ? '' : p.fix ? `<code class="fix">${esc(p.fix)}</code>`
      : p.link ? `<a class="fix" href="${esc(p.link)}" target="_blank">Get it</a>` : '';
    return `<tr><td>${esc(p.name)}<div class="purpose">${esc(p.purpose || '')}</div></td><td>${status}</td>
      <td class="muted">${esc(p.where || '')}${fix}</td></tr>`;
  };
  const ours = [
    // the toolchain in use: "Toolchain (devkitPro)" or "Toolchain (gekko-toolchain)", its version and folder
    (() => {
      const t = state.toolchains.find((x) => x.path === state.toolchain) || state.toolchains[0];
      const [kind, ...version] = t ? t.label.split(' ') : [];
      return { name: t ? `Toolchain (${kind})` : 'Toolchain', ok: !!t, where: t && `${version.join(' ')}: ${t.path}`,
               purpose: 'Compiling and linking for the GameCube' };
    })(),
    { name: 'Engine (Octave-libogc)', ok: state.octave, where: state.octave && `${state.octave_version || ''}: ${state.octave}`,
      purpose: 'Building the games' },
    { name: 'Emulator (Dolphin)', ok: state.dolphin, where: state.dolphin && `${state.dolphin.version}: ${state.dolphin.path}`,
      purpose: 'Running them on PC' },
  ];
  const others = state.packages || [];
  const table = (rows) => `<table class="table packages"><tr><th>Package</th><th>Status</th><th>Where</th></tr>${rows.map(row).join('')}</table>`;
  $('#packagesCard').innerHTML = `<h2>Required</h2>${table(ours.concat(others.filter((p) => p.group === 'required')))}
    <h2 class="later">Optional</h2>${table(others.filter((p) => p.group === 'optional'))}`;
  $('#settingsCard').innerHTML = `<table class="table">
    <tr><th>Projects</th><td>
      <div class="roots">${(state.project_roots || []).map((r) => `<div class="root">
        <span class="root-path${r.exists ? '' : ' muted'}">${esc(r.path)}</span>
        ${r.default ? '<span class="muted">default</span>' : ''}
        <button class="btn small" data-remove-root="${esc(r.path)}">Remove</button></div>`).join('')
        || '<span class="muted">No folders: add one below.</span>'}</div>
      <div class="roots-foot"><button class="btn small" id="addRoot">+ Add folder...</button>
        <span class="muted">${state.projects.length} projects found</span></div></td></tr>
    ${pathRow('Toolchain', 'toolchain', state.toolchain)}
    ${pathRow('Engine', 'octave', state.octave)}
    ${pathRow('Dolphin', 'dolphin', state.dolphin && state.dolphin.path)}</table>
    <p class="muted">DolphinWorks ${esc(state.version)}</p>`;
  $('#topStatus').innerHTML = [
    ['Toolchain', state.toolchains.length], ['Engine', state.octave], ['Dolphin', state.dolphin], ['USB Gecko', state.gecko],
  ].map(([n, ok]) => `<span class="chip"><span class="dot ${ok ? '' : 'off'}"></span>${n}</span>`).join('');
}

// a Settings row for a folder DolphinWorks finds by itself, or that's set by hand
function pathRow(label, kind, path) {
  const custom = state.custom_paths && state.custom_paths[kind];
  return `<tr><th>${label}</th><td><div class="root">
    <span class="root-path${path ? '' : ' muted'}">${esc(path || 'Not found')}</span>
    <span class="muted">${custom ? 'set' : 'found'}</span>
    ${custom ? `<button class="btn small" data-reset-path="${kind}" title="Find it automatically again">Auto</button>` : ''}
    <button class="btn small" data-set-path="${kind}">Change...</button></div></td></tr>`;
}

function renderStatus() {
  const p = project();
  $('#statusDot').className = 'dot' + (state.busy ? ' busy' : '');
  $('#statusText').textContent = state.busy ? state.busy + '...' : 'Ready';
  $('#statusProject').textContent = p ? '› ' + p.title : '';
  const t = state.toolchains.find((x) => x.path === state.toolchain);
  $('#statusInfo').textContent = `DolphinWorks ${state.version}  |  ${t ? t.label : 'no toolchain'}`
    + `  |  ${state.octave ? 'Octave ' + (state.octave_version || '') : 'no Octave'}`
    + `  |  ${state.dolphin ? 'Dolphin ' + state.dolphin.version : 'no Dolphin'}`;
}

// --- log -----------------------------------------------------------------------------------------

function logLine(e) {
  const log = $('#log');
  const atBottom = log.scrollTop + log.clientHeight >= log.scrollHeight - 30;
  const div = document.createElement('div');
  div.className = 'l ' + (e.level || 'info');
  div.innerHTML = `<span class="t">[${esc(e.time)}]</span>${esc(e.text)}`;
  log.appendChild(div);
  while (log.childElementCount > 3000) log.firstChild.remove();
  if (atBottom) log.scrollTop = log.scrollHeight;
}

// --- the USB Gecko console (Debug page) ----------------------------------------------------------

let gecko = { connected: false, port: null, rx: 0, tx: 0, error: null };
let geckoLeftOff = false;                            // disconnected by hand: no connecting by itself again

function geckoLine(e) {
  const log = $('#gcLog');
  const atBottom = log.scrollTop + log.clientHeight >= log.scrollHeight - 30;
  const div = document.createElement('div');
  div.className = 'l ' + (e.source || 'cube');
  div.innerHTML = `<span class="t">[${esc(e.time)}]</span>${esc(e.text)}`;
  log.appendChild(div);
  while (log.childElementCount > 5000) log.firstChild.remove();
  if (atBottom) log.scrollTop = log.scrollHeight;
}

function geckoStatus(s) {
  if (s) gecko = { ...gecko, ...s };
  const kb = (n) => n >= 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} B`;
  $('#gcDot').className = 'dot' + (gecko.connected ? '' : ' off');
  $('#gcStatus').textContent = gecko.connected ? `Connected on ${gecko.port}`
    : gecko.error || (state && state.gecko ? `Not connected (the Gecko is on ${state.gecko})` : 'No USB Gecko plugged in');
  $('#gcCounts').textContent = gecko.connected ? `received ${kb(gecko.rx)} · sent ${kb(gecko.tx)}` : '';
  $('#gcConnect').textContent = gecko.connected ? 'Disconnect' : 'Connect';
  $('#gcConnect').disabled = !gecko.connected && !(state && state.gecko);
  $('#gcInput').disabled = !gecko.connected;
  if (state && state.gecko) $('#gdbHow').textContent = `powerpc-eabi-gdb.exe game.elf\n(gdb) target remote \\\\.\\${state.gecko}`;
  // Start GDB: for the selected project's .elf, with a Gecko plugged in
  const p = state && project();
  $('#startGdb').disabled = !(p && p.elf && state.gecko);
  $('#gdbFor').textContent = !p ? 'Choose a project first.'
    : !p.elf ? `${p.title}: no .elf yet (build it; GDB needs its symbols).`
    : !state.gecko ? 'Plug in the USB Gecko.' : `For ${p.title}: ${p.elf.split(/[\\/]/).pop()}`;
}

// opening the Debug page connects, if a Gecko is plugged in and it wasn't disconnected by hand
function geckoAuto() {
  if ($('#page-debug').classList.contains('active') && !gecko.connected && !geckoLeftOff && state && state.gecko)
    api('/api/gecko_connect', {}).then((r) => { geckoStatus(r); if (!r.ok) toast(r.message); });
}

function bindGecko() {
  $('#gcConnect').onclick = async () => {
    const r = await api(gecko.connected ? '/api/gecko_disconnect' : '/api/gecko_connect', {});
    geckoLeftOff = gecko.connected;
    geckoStatus(r);
    if (!r.ok && r.message) toast(r.message);
  };
  $('#gcForm').onsubmit = async (e) => {
    e.preventDefault();
    const text = $('#gcInput').value;
    if (!text.trim()) return;
    const r = await api('/api/gecko_send', { text });
    if (r.ok) $('#gcInput').value = '';
    else toast(r.message || 'Not sent.');
    geckoStatus(r);
  };
  $('#gcClear').onclick = () => { $('#gcLog').innerHTML = ''; };
  $('#startGdb').onclick = async () => {
    const p = project();
    const r = await api('/api/gdb', { id: p && p.id });
    geckoLeftOff = true;                             // (GDB has the port: no reconnecting by itself)
    geckoStatus(r);
    toast(r.message || (r.ok ? 'GDB started' : 'That did not work.'));
  };
  $('#gcSave').onclick = () => {
    const text = $$('#gcLog .l').map((l) => l.textContent).join('\r\n') + '\r\n';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    a.download = `gecko-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };
  // the counts, while connected (they change with every line)
  setInterval(() => { if (gecko.connected && $('#page-debug').classList.contains('active')) api('/api/state').then((s) => geckoStatus(s.gecko_console)); }, 2000);
}

function listen() {
  const events = new EventSource('/api/events');
  events.onmessage = (m) => {
    const e = JSON.parse(m.data);
    if (e.kind === 'line') logLine(e);
    else if (e.kind === 'start') { state.busy = e.title; $('#progress').textContent = ''; render(); }
    else if (e.kind === 'progress') $('#progress').textContent = e.step + (e.total ? ` ${e.done} / ${e.total} MB` : '');
    else if (e.kind === 'done') {
      $('#progress').textContent = '';
      state.busy = null;
      toast(e.ok ? `${e.title}: done` : `${e.title}: failed (see the log)`);
      refresh();
    } else if (e.kind === 'refresh') refresh();
    else if (e.kind === 'gecko') geckoLine(e);
    else if (e.kind === 'gecko_status') geckoStatus(e);
  };
}

// --- actions -------------------------------------------------------------------------------------

async function act(name) {
  const p = project();
  const body = { id: p && p.id, profile: state.profile, build_type: state.build_type, sd_log: state.sd_log, gecko_log: state.gecko_log,
                 drive: $('#sdSelect').value || null, embed: !!host };
  if (name === 'build' || name === 'deploy') $('#log').innerHTML = '';
  const res = await api('/api/' + name, body);
  if (!res.ok) toast(res.message || (res.busy ? `Busy: ${res.busy}` : 'That did not work.'));
  else if (name === 'run' && host && res.pid) startGame(res.pid, res.title);
  else if (name === 'run') toast(`Starting Dolphin (${state.profile})`);
  else if (name === 'editor') toast('Opening the Octave editor');
}

// --- the game screen -----------------------------------------------------------------------------
// In DolphinWorks.exe (WebView2), a game run from the app plays inside it: the page says where #screen
// is, and the window puts Dolphin's game window there. In a browser, Dolphin just opens its own window.

const host = window.chrome && window.chrome.webview;
let game = null;                                     // { pid, title } while a game is in the app

function startGame(pid, title) {
  if (game) host.postMessage({ type: 'stop' });      // one game at a time
  game = { pid, title };
  $('#screenTitle').textContent = title;
  $('#screenStatus').textContent = `Dolphin ${state.dolphin ? state.dolphin.version : ''}, ${state.profile} profile`;
  $('#screenWait').hidden = false;
  $('#screenCard').hidden = false;
  $('#runCards').hidden = true;
  $('.nav[data-page="run"]').click();
  placeScreen();
}

function endGame(message) {
  game = null;
  $('#screenCard').hidden = true;
  $('#runCards').hidden = false;
  if (message) toast(message);
}

// where the screen is, in the window's pixels, or hidden when the Run page isn't showing
function placeScreen() {
  if (!host || !game) return;
  const visible = $('#page-run').classList.contains('active') && !$('#screenCard').hidden;
  const r = $('#screen').getBoundingClientRect(), k = window.devicePixelRatio;
  host.postMessage({ type: 'embed', pid: game.pid, visible: visible && r.width > 0 ? 1 : 0,
                     x: Math.round(r.left * k), y: Math.round(r.top * k), w: Math.round(r.width * k), h: Math.round(r.height * k) });
}

// the build log's height: dragged by the bar above it, down to just its title; remembered
function logHeight(px) {
  const panel = $('#logPanel'), head = panel.querySelector('.log-head').offsetHeight + 2;
  const max = Math.max(head, $('.content').clientHeight * 0.7);
  const h = Math.round(Math.min(Math.max(px, head), max));
  const collapsed = h < head + 40;
  panel.style.height = (collapsed ? head : h) + 'px';
  panel.classList.toggle('collapsed', collapsed);
  return collapsed ? head : h;
}

(function () {
  const bar = $('#logSplit');
  try { const saved = Number(localStorage.getItem('logHeight')); if (saved) requestAnimationFrame(() => logHeight(saved)); } catch (e) {}
  bar.addEventListener('pointerdown', (e) => {
    const start = e.clientY, from = $('#logPanel').offsetHeight;
    bar.setPointerCapture(e.pointerId);
    bar.classList.add('dragging');
    const move = (m) => logHeight(from + start - m.clientY);
    const up = () => {
      bar.classList.remove('dragging');
      bar.removeEventListener('pointermove', move);
      bar.removeEventListener('pointerup', up);
      try { localStorage.setItem('logHeight', String($('#logPanel').offsetHeight)); } catch (e) {}
    };
    bar.addEventListener('pointermove', move);
    bar.addEventListener('pointerup', up);
  });
  bar.addEventListener('dblclick', () => {                 // double-click: shut it, or open it again
    const h = logHeight($('#logPanel').classList.contains('collapsed') ? 180 : 0);
    try { localStorage.setItem('logHeight', String(h)); } catch (e) {}
  });
})();

if (host) {
  host.addEventListener('message', (e) => {
    const m = e.data;
    if (!game || m.pid !== game.pid) return;
    if (m.type === 'shown') $('#screenWait').hidden = true;
    else if (m.type === 'ended') endGame(`${game.title}: Dolphin closed`);
  });
  new ResizeObserver(placeScreen).observe($('#screen'));
  window.addEventListener('resize', placeScreen);
}

function bind() {
  $$('.nav').forEach((b) => b.onclick = () => {
    $$('.nav').forEach((x) => x.classList.toggle('active', x === b));
    $$('.page').forEach((pg) => pg.classList.toggle('active', pg.id === 'page-' + b.dataset.page));
    placeScreen();                                   // (the game shows only on the Run page)
    geckoAuto();                                     // (opening Debug connects the Gecko)
  });
  $('#stopGame').onclick = () => { if (game) host.postMessage({ type: 'stop', pid: game.pid }); };
  $('#popOut').onclick = () => {
    if (!game) return;
    host.postMessage({ type: 'popout', pid: game.pid });
    endGame(`${game.title} is in its own window now`);
  };
  $('#projectList').onclick = (e) => {
    const item = e.target.closest('.pitem');
    if (!item) return;
    selected = item.dataset.id;
    api('/api/settings', { selected: project().octp || project().iso });
    render();
  };
  document.body.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (b && !b.disabled) act(b.dataset.act);
  });
  // Settings: the folders searched for projects
  $('#settingsCard').addEventListener('click', async (e) => {
    if (e.target.closest('#addRoot')) {
      const res = await api('/api/add_root', {});
      if (res.ok) { await refresh(); toast(`Added ${res.path}: ${state.projects.length} projects`); }
      else if (!res.cancelled) toast(res.message || 'That did not work.');
    }
    const set = e.target.closest('[data-set-path]');
    if (set) {
      const res = await api('/api/set_path', { kind: set.dataset.setPath });
      if (res.ok) { await refresh(); toast(`Using ${res.path}`); }
      else if (!res.cancelled) toast(res.message || 'That did not work.');
    }
    const reset = e.target.closest('[data-reset-path]');
    if (reset) {
      await api('/api/reset_path', { kind: reset.dataset.resetPath });
      await refresh();
      toast('Found automatically');
    }
    const rm = e.target.closest('[data-remove-root]');
    if (rm) {
      await api('/api/remove_root', { path: rm.dataset.removeRoot });
      await refresh();
      toast(`${state.projects.length} projects`);
    }
  });
  $('#search').oninput = renderList;
  $('#rescan').onclick = async () => { await api('/api/rescan', {}); await refresh(); toast(`${state.projects.length} projects`); };
  $('#dolphinVersion').onchange = async (e) => { await api('/api/settings', { dolphin: e.target.value }); await refresh(); };
  $('#toolchain').onchange = (e) => { api('/api/settings', { toolchain: e.target.value }); state.toolchain = e.target.value; renderStatus(); renderPages(); };
  $('#buildType').onchange = (e) => { state.build_type = e.target.value; api('/api/settings', { build_type: state.build_type }); renderRight(); renderPages(); };
  $('#sdLog').onchange = (e) => { state.sd_log = e.target.checked; api('/api/settings', { sd_log: state.sd_log }); renderPages(); };
  $('#geckoLog').onchange = (e) => { state.gecko_log = e.target.checked; api('/api/settings', { gecko_log: state.gecko_log }); renderPages(); };
  $('#profile').onchange = (e) => { state.profile = e.target.value; api('/api/settings', { profile: state.profile }); render(); };
  $$('.profile').forEach((el) => el.onclick = () => { $('#profile').value = el.dataset.profile; $('#profile').onchange({ target: $('#profile') }); });
  $('#sdSelect').onchange = (e) => api('/api/settings', { sd_card: e.target.value });
  $('#sdSelect2').onchange = (e) => { $('#sdSelect').value = e.target.value; api('/api/settings', { sd_card: e.target.value }); };
  $('#refreshHw').onclick = refresh;
  $('#moreOptions').onclick = () => act('builder');
  $('#clearLog').onclick = () => { $('#log').innerHTML = ''; };
  $('#logFilter').onchange = (e) => $('#log').classList.toggle('important', e.target.value === 'important');
  setInterval(async () => {                  // the USB Gecko and SD cards, as they come and go
    if (!state || state.busy) return;
    const s = await api('/api/state');
    if (s.gecko !== state.gecko || JSON.stringify(s.sd_cards) !== JSON.stringify(state.sd_cards)) { state = s; render(); }
  }, 4000);
}

bind();
const startPage = new URLSearchParams(location.search).get('page');       // ?page=settings opens on that page
if (startPage) $(`.nav[data-page="${startPage}"]`)?.click();
if (!location.search.includes('snapshot')) listen();      // (a still picture of the page: no live events)
bindGecko();
refresh().then(async () => {
  (await api('/api/history')).forEach(logLine);
  (await api('/api/gecko_history')).forEach(geckoLine);
  geckoStatus(state.gecko_console);
  geckoAuto();
});
