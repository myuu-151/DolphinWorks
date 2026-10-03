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
    const saved = state.projects.find((p) => p.octp === state.selected);
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
}

function renderList() {
  const q = $('#search').value.trim().toLowerCase();
  const list = state.projects.filter((p) => !q || p.title.toLowerCase().includes(q) || p.name.toLowerCase().includes(q));
  $('#projectList').innerHTML = list.map((p) => `
    <div class="pitem ${p.id === selected ? 'active' : ''}" data-id="${p.id}">
      ${p.banner ? `<div class="pthumb" style="background-image:url('${image(p, 'banner')}')"></div>`
                 : `<div class="pthumb">${esc(p.title[0] || '?')}</div>`}
      <div style="min-width:0"><div class="ptitle">${esc(p.title)}</div>
        <div class="pmeta">${p.folder ? esc(p.folder) : 'GameCube · ISO · ' + (p.engine.includes('custom') ? 'Custom code' : 'Octave Engine')}</div></div>
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
    <div class="banner" style="${p.banner ? `background-image:url('${image(p, 'banner')}')` : ''}"></div>
    <div class="dtitle"><div><h2>${esc(p.title)}</h2><div class="path">${esc(p.root)}</div></div>
      <button class="btn" data-act="folder">${ICONS.folder} Open Folder</button></div>
    <div class="tags"><span class="tag">GameCube</span><span class="tag">ISO</span><span class="tag">${esc(p.engine)}</span></div>
    <div class="actions">
      <button class="action blue" data-act="build" ${busy ? 'disabled' : ''}>${ICONS.build}<div><b>Build</b><span>Disc image</span></div></button>
      <button class="action green" data-act="run" ${p.built ? '' : 'disabled'}>${ICONS.run}<div><b>Run in Dolphin</b><span>${esc(state.profile)} profile</span></div></button>
      <button class="action purple" data-act="deploy" ${p.built && !busy ? '' : 'disabled'}>${ICONS.pad}<div><b>Run on Hardware</b><span>Via SD card</span></div></button>
      <button class="action gray" data-act="editor">${ICONS.edit}<div><b>Open in Editor</b><span>Octave</span></div></button>
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
  $('#profile').value = state.profile;
  $('#dolphinVersion').innerHTML = state.dolphin ? `${esc(state.dolphin.version)} ${state.dolphin.profiles ? '' : '<span class="muted">(no profiles)</span>'}` : '<span class="bad">not installed</span>';
  $('#gecko').innerHTML = state.gecko ? `<span class="ok">● Detected</span> <span class="muted">${esc(state.gecko)}</span>` : '<span class="bad">○ Not connected</span>';
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
      <tr><th>Build type</th><td>${esc(state.build_type)}${state.build_type === 'Diagnostic' ? ' (memory census, flicker detector; slower)' : ''}</td></tr>
      <tr><th>SD log</th><td>${state.sd_log ? 'on: the game writes its log to the SD card' : 'off'}</td></tr>
      <tr><th>Engine</th><td>${esc(state.octave || 'not installed')}</td></tr>
      <tr><th>Output</th><td>${esc(p.iso)}</td></tr></table>
    <div class="row2" style="margin-top:12px"><button class="btn primary" data-act="build" ${state.busy ? 'disabled' : ''}>Build</button>
      <button class="btn" id="moreOptions2" ${p.builder ? '' : 'disabled'}>More build options...</button></div>` : '<div class="empty">Choose a project first.</div>';
  const b2 = $('#moreOptions2');
  if (b2) b2.onclick = () => $('#moreOptions').click();
  $$('.profile').forEach((el) => el.classList.toggle('active', el.dataset.profile === state.profile));
  $('#geckoBig').innerHTML = state.gecko ? `<p class="ok">● Connected on ${esc(state.gecko)}</p>` : '<p class="bad">○ Not connected</p>';
  const row = (name, ok, where) => `<tr><td>${name}</td><td>${ok ? '<span class="ok">● Installed</span>' : '<span class="bad">○ Missing</span>'}</td><td class="muted">${esc(where || '')}</td></tr>`;
  $('#packagesCard').innerHTML = `<table class="table"><tr><th>Package</th><th>Status</th><th>Where</th></tr>
    ${row('GameCube toolchain', state.toolchains.length, state.toolchains.map((t) => t.label).join(', '))}
    ${row('Engine (Octave-libogc)', state.octave, state.octave)}
    ${row('Emulator (Dolphin)', state.dolphin, state.dolphin && `${state.dolphin.version}: ${state.dolphin.path}`)}
    </table>`;
  $('#settingsCard').innerHTML = `<table class="table">
    <tr><th>Projects</th><td>
      <div class="roots">${(state.project_roots || []).map((r) => `<div class="root">
        <span class="root-path${r.exists ? '' : ' muted'}">${esc(r.path)}</span>
        ${r.default ? '<span class="muted">default</span>'
                    : `<button class="btn small" data-remove-root="${esc(r.path)}">Remove</button>`}</div>`).join('')}</div>
      <div class="roots-foot"><button class="btn small" id="addRoot">+ Add folder...</button>
        <span class="muted">${state.projects.length} projects found</span></div></td></tr>
    <tr><th>Toolchain</th><td>${esc(state.toolchain || 'none')}</td></tr>
    <tr><th>Engine</th><td>${esc(state.octave || 'none')}</td></tr>
    <tr><th>Dolphin</th><td>${esc(state.dolphin ? state.dolphin.path : 'none')}</td></tr></table>
    <p class="muted">DolphinWorks ${esc(state.version)}</p>`;
  $('#topStatus').innerHTML = [
    ['Toolchain', state.toolchains.length], ['Engine', state.octave], ['Dolphin', state.dolphin], ['USB Gecko', state.gecko],
  ].map(([n, ok]) => `<span class="chip"><span class="dot ${ok ? '' : 'off'}"></span>${n}</span>`).join('');
}

function renderStatus() {
  const p = project();
  $('#statusDot').className = 'dot' + (state.busy ? ' busy' : '');
  $('#statusText').textContent = state.busy ? state.busy + '...' : 'Ready';
  $('#statusProject').textContent = p ? '› ' + p.title : '';
  const t = state.toolchains.find((x) => x.path === state.toolchain);
  $('#statusInfo').textContent = `DolphinWorks ${state.version}  |  ${t ? t.label : 'no toolchain'}  |  Octave engine`;
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
  };
}

// --- actions -------------------------------------------------------------------------------------

async function act(name) {
  const p = project();
  const body = { id: p && p.id, profile: state.profile, build_type: state.build_type, sd_log: state.sd_log,
                 drive: $('#sdSelect').value || null };
  if (name === 'build' || name === 'deploy') $('#log').innerHTML = '';
  const res = await api('/api/' + name, body);
  if (!res.ok) toast(res.message || (res.busy ? `Busy: ${res.busy}` : 'That did not work.'));
  else if (name === 'run') toast(`Starting Dolphin (${state.profile})`);
  else if (name === 'editor') toast('Opening the Octave editor');
}

function bind() {
  $$('.nav').forEach((b) => b.onclick = () => {
    $$('.nav').forEach((x) => x.classList.toggle('active', x === b));
    $$('.page').forEach((pg) => pg.classList.toggle('active', pg.id === 'page-' + b.dataset.page));
  });
  $('#projectList').onclick = (e) => {
    const item = e.target.closest('.pitem');
    if (!item) return;
    selected = item.dataset.id;
    api('/api/settings', { selected: project().octp });
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
    const rm = e.target.closest('[data-remove-root]');
    if (rm) {
      await api('/api/remove_root', { path: rm.dataset.removeRoot });
      await refresh();
      toast(`${state.projects.length} projects`);
    }
  });
  $('#search').oninput = renderList;
  $('#rescan').onclick = async () => { await api('/api/rescan', {}); await refresh(); toast(`${state.projects.length} projects`); };
  $('#toolchain').onchange = (e) => { api('/api/settings', { toolchain: e.target.value }); state.toolchain = e.target.value; renderStatus(); renderPages(); };
  $('#buildType').onchange = (e) => { state.build_type = e.target.value; api('/api/settings', { build_type: state.build_type }); renderPages(); };
  $('#sdLog').onchange = (e) => { state.sd_log = e.target.checked; api('/api/settings', { sd_log: state.sd_log }); renderPages(); };
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
refresh().then(async () => (await api('/api/history')).forEach(logLine));
