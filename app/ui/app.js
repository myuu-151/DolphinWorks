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
let artV = 0;                                      // (bumped by an edit: the pictures again)
const image = (p, kind, extra = '') => `/api/image?id=${p.id}&kind=${kind}${extra}&v=${encodeURIComponent(p.last_build || '')}.${artV}`;
// the list's picture: the game's memory card icon (its first frame), else an icon.png beside it, else its art
const thumb = (p) => p.card && p.card.icon ? `<div class="pthumb icon pixel" style="background-image:url('${image(p, 'card_icon', '&frame=0')}')"></div>`
  : p.icon || p.banner ? `<div class="pthumb${p.icon ? ' icon' : ''}" style="background-image:url('${image(p, p.icon ? 'icon' : 'banner')}')"></div>`
  : `<div class="pthumb">${esc(p.title[0] || '?')}</div>`;

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
      ${thumb(p)}
      <div style="min-width:0"><div class="ptitle">${esc(p.title)}</div>
        <div class="pmeta">${p.folder ? esc(p.folder) : 'GameCube · ISO · ' + (!p.octp ? 'Disc image' : p.engine.includes('custom') ? 'Custom code' : 'Octave Engine')}</div></div>
    </div>`).join('') || '<div class="empty">No projects found.</div>';
}

function renderDetail() {
  const p = project();
  if (!p) {
    $('#detail').innerHTML = '<div class="empty">Choose a project, or make one: + New project, above.</div>';
    return;
  }
  const busy = !!state.busy;
  $('#detail').innerHTML = `
    <div class="banner" style="${p.banner ? `--art:url('${image(p, 'banner')}')` : ''}"></div>
    <div class="dtitle"><div><h2 id="ptitle" title="Click to rename (here in DolphinWorks only)">${esc(p.title)}<span class="rename" aria-hidden="true">✎</span></h2><div class="path">${esc(p.root)}</div></div>
      <button class="btn" data-act="folder">${ICONS.folder} Open Folder</button></div>
    <div class="tags"><span class="tag">GameCube</span><span class="tag">ISO</span><span class="tag">${esc(p.engine)}</span></div>
    <div class="actions">
      <button class="action blue" data-act="build" ${busy || !p.octp ? 'disabled' : ''} ${p.octp ? '' : 'title="A disc image on its own: nothing to build"'}>${ICONS.build}<div><b>Build</b><span>Disc image</span></div></button>
      <button class="action green" data-act="run" ${p.built ? '' : 'disabled'}>${ICONS.run}<div><b>Run in Dolphin</b><span>${esc(state.profile)} profile</span></div></button>
      <button class="action purple" data-act="deploy" ${p.built && !busy ? '' : 'disabled'}>${ICONS.pad}<div><b>Run on Hardware</b><span>Via SD card</span></div></button>
      <button class="action gray" data-act="editor" ${p.octp ? '' : 'disabled'}>${ICONS.edit}<div><b>Open in Editor</b><span>Octave</span></div></button>
    </div>
    <div class="info-row">${discCards(p)}</div>`;
}

// --- what the disc says about itself, and what its saves show: all editable ----------------------
// Text: click it, type, Enter (Esc cancels). Pictures: click, choose one (it's fitted: 96 x 32, 32 x 32).
// Written into the disc image in place, and into the project's own files so the next build keeps it.

const LIMITS = { game_id: 6, name: 63, short_title: 31, short_maker: 31, title: 63, maker: 63, description: 127,
                 card_title: 31, card_description: 31 };
const fileName = (path) => String(path || '').split(/[\\/]/).pop();

function editable(field, value, extra = '') {
  return `<dd class="edit${extra}" data-field="${field}" title="Click to edit (up to ${LIMITS[field]} characters)">${esc(value) || '<i>none</i>'}</dd>`;
}

function picture(which, url, label, cls, frames = 1) {
  return `<button class="pic ${cls}" data-pic="${which}" title="${label}: click to replace it with a picture of your own"
    style="--frames:${frames};${url ? `background-image:url('${url}')` : ''}">${url ? '' : '<i>none</i>'}<span>Replace…</span></button>`;
}

function discCards(p) {
  const d = p.disc, b = p.bnr, c = p.card;
  const octave = !!p.octp;
  const details = `<div class="subcard"><h3>Project Details</h3><dl class="kv">
      ${d ? `<dt>Game ID</dt>${editable('game_id', d.game_id, ' mono')}
             <dt>Disc Name</dt>${editable('name', d.name)}
             <dt>Region</dt><dd title="${esc(d.region)}">${esc(d.region)}</dd>
             <dt>Disc</dt><dd>${d.disc} (version 1.0${d.version})</dd>`
          : '<dt>Disc</dt><dd>not built yet</dd>'}
      <dt>Output</dt><dd title="${esc(p.iso)}">${esc(p.iso.split(/[\\/]/).slice(-3).join('\\'))}</dd>
      <dt>Engine</dt><dd>${esc(p.engine)}</dd>
      <dt>Last Build</dt><dd>${esc(p.last_build || 'not built yet')}</dd>
      <dt>Size</dt><dd>${p.size_mb ? p.size_mb + ' MB' : '-'}</dd>
    </dl>${d && octave ? '<p class="note">Octave writes the game ID (GOCT01) and the name back at its next build.</p>' : ''}</div>`;
  const banner = `<div class="subcard"><h3>Disc Banner</h3>${b ? `
      ${picture('banner', image(p, 'disc_banner'), 'The banner Swiss and Dolphin show', 'bnr')}
      <dl class="kv">
        <dt>Title</dt>${editable('title', b.title)}
        <dt>Maker</dt>${editable('maker', b.maker)}
        <dt>Description</dt>${editable('description', b.description, ' wrap')}
        <dt>Short Title</dt>${editable('short_title', b.short_title)}
        <dt>Short Maker</dt>${editable('short_maker', b.short_maker)}
      </dl>
      <p class="note">${octave ? (p.built ? 'Saved in the disc image and in the project\'s opening.bnr, so builds keep it.'
                                          : 'From the project\'s opening.bnr: its builds put it on the disc.')
                               : 'Saved in the disc image.'}</p>`
      : `<p class="note">${octave ? 'No banner yet: the build gives the disc Octave\'s.' : 'This disc has no banner (no opening.bnr).'}</p>`}</div>`;
  // (always there: when nothing is found, why)
  let card = `<div class="subcard wide"><h3>Memory Card</h3><p class="note">${octave && !p.saves
    ? `This game doesn't save: nothing in its scripts or code writes one (System.WriteSave, SYS_WriteSave), so the memory card
       has nothing of it to show. Once it saves, its saves can have an icon and banner here.`
    : octave
    ? `No save info yet: the game's saves show bare on the memory card screen. Generate makes it (Scripts/SaveInfo.lua: an icon and
       banner from the disc banner, the title), which Octave applies at startup; then edit it here.
       <span class="gen-row"><button class="btn" data-gen>Generate</button></span>`
    : 'Nothing to show: this disc doesn\'t carry a save icon or banner as files (save_icon.bin, save_banner.bin). A game that doesn\'t save has none, and one can\'t be added without its project.'}</p></div>`;
  if (c) {
    const frames = c.icon ? Math.max(1, c.icon.frames) : 0;
    const onDisc = (c.icon && c.icon.on_disc) || (c.banner && c.banner.on_disc);
    const where = [...new Set([c.text_in, ...(c.icon ? c.icon.places : []).concat(c.banner ? c.banner.places : [])
      .filter((x) => x.kind !== 'disc').map((x) => x.path)].filter(Boolean))].map(fileName).join(', ');
    card = `<div class="subcard wide"><h3>Memory Card</h3><div class="card-row">
        ${c.icon ? picture('card_icon', image(p, 'card_icon'), c.icon.animates
            ? "The save's icon. To animate it, choose several pictures (a frame each, in name order), an animated GIF, or a strip of frames side by side: 8 frames at most"
            : "The save's icon", frames > 1 ? 'cicon anim' : 'cicon', frames) : ''}
        ${c.banner ? picture('card_banner', image(p, 'card_banner'), "The save's banner", 'bnr') : ''}
        <dl class="kv">
          ${c.title != null ? `<dt>Title</dt>${editable('card_title', c.title)}<dt>Description</dt>${editable('card_description', c.description)}` : ''}
          ${c.icon ? `<dt>Icon</dt><dd class="wrap">${frames > 1 ? `Animated, ${frames} frames` : 'Still'}<span class="dim">${c.icon.animates
            ? ' · click it for a new one: several pictures, a GIF or a strip animate it' : " · this game's code takes a still icon"}</span></dd>` : ''}
        </dl></div>
      <p class="note">What the memory card screen shows beside the game's saves${where ? ` (from ${esc(where)})` : ''}.
        ${!where ? 'Saved in the disc image.' : onDisc ? 'Pictures are saved in the disc image too; the title and description go in at the next build.'
                 : 'Edits go in at the next build.'}
        ${where && octave && !state.busy ? '<a class="link" data-act="build">Build now</a>' : ''}</p></div>`;
  }
  return details + banner + card;
}

const loadImage = (file) => new Promise((ok, fail) => {
  const img = new Image();
  img.onload = () => ok(img);
  img.onerror = () => fail(new Error('Not a picture.'));
  img.src = URL.createObjectURL(file);
});

// A picture fitted to w x h: scaled to cover it, the middle kept. From a source's (sx, sy, sw, sh) part.
function fitted(source, w, h, sx = 0, sy = 0, sw = source.displayWidth || source.width, sh = source.displayHeight || source.height) {
  const scale = Math.max(w / sw, h / sh);
  const canvas = Object.assign(document.createElement('canvas'), { width: w, height: h });
  const g = canvas.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(source, sx, sy, sw, sh, (w - sw * scale) / 2, (h - sh * scale) / 2, sw * scale, sh * scale);
  const bytes = g.getImageData(0, 0, w, h).data;
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

// The frames in what was chosen: several pictures (one a frame, in name order), an animated GIF / WebP / PNG,
// or a strip of square frames side by side; else the one picture.
async function framesOf(files, w, h, animate) {
  if (animate && files.length > 1) {
    const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    const out = [];
    for (const f of sorted) out.push(fitted(await loadImage(f), w, h));
    return out;
  }
  const file = files[0];
  if (animate && 'ImageDecoder' in window && /^image\/(gif|webp|png|apng)$/.test(file.type)) {
    try {
      const decoder = new ImageDecoder({ data: await file.arrayBuffer(), type: file.type });
      await decoder.tracks.ready;
      await decoder.completed;
      const count = decoder.tracks.selectedTrack.frameCount;
      if (count > 1) {
        const out = [];
        for (let i = 0; i < count; i++) {
          const { image: frame } = await decoder.decode({ frameIndex: i });
          out.push(fitted(frame, w, h));
          frame.close();
        }
        decoder.close();
        return out;
      }
      decoder.close();
    } catch (e) { /* (not animated, or not decodable that way: as a picture) */ }
  }
  const img = await loadImage(file);
  const n = img.width / img.height;
  if (animate && n >= 2 && Number.isInteger(n)) {                 // a strip: n square frames
    return Array.from({ length: n }, (_, i) => fitted(img, w, h, i * img.height, 0, img.height, img.height));
  }
  return [fitted(img, w, h)];
}

async function replacePicture(which, files) {
  const p = project();
  const [w, h] = which === 'card_icon' ? [32, 32] : [96, 32];
  let frames;
  try { frames = await framesOf(files, w, h, which === 'card_icon'); } catch (e) { return toast(e.message); }
  let note = '';
  if (frames.length > 8) {                         // (the card plays 8 at most: 8 spread over them)
    note = ` ${frames.length} frames: every ${(frames.length / 8).toFixed(1).replace('.0', '')}th kept (8 at most).`;
    frames = Array.from({ length: 8 }, (_, i) => frames[Math.floor(i * frames.length / 8)]);
  }
  let r = await api('/api/picture', { id: p.id, which, frames });
  let build = false;
  // A game whose code takes a still icon: its code changed to take frames too, then built (the disc has it all)
  if (!r.ok && r.fixable && confirm(`${p.title}'s code takes a still memory card icon only.

`
      + `Change its code (${r.fixable}) to take an animated one too, and build it?`)) {
    r = await api('/api/picture', { id: p.id, which, frames, fix_code: true });
    build = r.ok;
  }
  artV++;
  await refresh();
  if (build) {
    toast(`Animated icon: ${frames.length} frames. ${r.fixable || 'Its code'} changed: building it…`);
    return act('build');
  }
  toast(r.ok ? (frames.length > 1 ? `Animated icon: ${frames.length} frames.` : 'Picture replaced.') + note + (r.message ? ' ' + r.message : '')
             : r.message || 'That did not work.');
}

function bindDiscCards() {
  const chooser = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/*', hidden: true });
  document.body.append(chooser);
  chooser.onchange = () => { if (chooser.files.length) replacePicture(chooser.dataset.which, chooser.files); chooser.value = ''; };
  $('#detail').addEventListener('click', (e) => {
    if (e.target.closest('[data-gen]')) {
      const p = project();
      api('/api/generate_card', { id: p.id }).then(async (r) => {
        artV++;
        await refresh();
        toast(r.ok ? 'Memory card info made: Scripts/SaveInfo.lua. Edit it here; Build puts it in the game.' : r.message || 'That did not work.');
      });
      return;
    }
    const pic = e.target.closest('.pic');
    if (pic) {
      chooser.dataset.which = pic.dataset.pic;
      chooser.multiple = pic.dataset.pic === 'card_icon';   // (the icon's frames: several pictures)
      chooser.click();
      return;
    }
    const dd = e.target.closest('dd.edit');
    if (!dd || dd.isContentEditable) return;
    const field = dd.dataset.field;
    const p = project();
    const old = { game_id: p.disc && p.disc.game_id, name: p.disc && p.disc.name, card_title: p.card && p.card.title,
                  card_description: p.card && p.card.description }[field] ?? (p.bnr && p.bnr[field]) ?? '';
    dd.textContent = old;
    dd.contentEditable = 'plaintext-only';
    dd.focus();
    document.getSelection().selectAllChildren(dd);
    let done = false;
    const finish = async (save) => {
      if (done) return;
      done = true;
      dd.contentEditable = 'false';
      const value = dd.textContent.replace(/\s+/g, ' ').trim();
      if (!save || value === old) return renderDetail();
      const r = await api('/api/disc_text', { id: p.id, field, value });
      await refresh();
      toast(r.ok ? 'Saved.' : r.message || 'That did not work.');
    };
    dd.onbeforeinput = (k) => {                      // (no longer than its place in the disc)
      const extra = (k.data || '').length - document.getSelection().toString().length;
      if (k.inputType.startsWith('insert') && dd.textContent.length + extra > LIMITS[field]) k.preventDefault();
    };
    dd.onkeydown = (k) => {
      if (k.key === 'Enter') { k.preventDefault(); finish(true); }
      else if (k.key === 'Escape') { k.preventDefault(); finish(false); }
    };
    dd.onblur = () => finish(true);
  });
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
    ${pathRow('Dolphin', 'dolphin', state.dolphin && state.dolphin.path)}
    <tr><th>Code editor</th><td><select id="ideSelect" class="ide-select">
      <option value="auto" ${state.ide === 'auto' ? 'selected' : ''}>Automatic (${esc(['VS Code', 'Cursor', 'Visual Studio'].find((n) => (state.ides || []).includes(n)) || 'none found')})</option>
      ${['Cursor', 'VS Code', 'Visual Studio'].map((n) => `<option value="${n}" ${state.ide === n ? 'selected' : ''} ${(state.ides || []).includes(n) ? '' : 'disabled'}>${n}${(state.ides || []).includes(n) ? '' : ' (not installed)'}</option>`).join('')}
      </select><div class="purpose">What the Content page's Open in IDE opens (Cursor and VS Code get Octave's Lua API too)</div></td></tr></table>
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
  bindDiscCards();
  bindEngine();
  // Rename: click the title, type, Enter (Esc cancels; empty: its own name again). DolphinWorks' name only.
  $('#detail').addEventListener('click', (e) => {
    const h = e.target.closest('#ptitle');
    if (!h || h.isContentEditable) return;
    const p = project();
    h.textContent = p.title;
    h.contentEditable = 'plaintext-only';
    h.focus();
    document.getSelection().selectAllChildren(h);
    let done = false;
    const finish = async (save) => {
      if (done) return;
      done = true;
      h.contentEditable = 'false';
      const title = h.textContent.trim();
      if (save && title !== p.title) {
        await api('/api/rename', { id: p.id, title });
        await refresh();
        toast(title && title !== p.own_title ? `Renamed: ${title}` : `Back to its own name: ${p.own_title}`);
      } else {
        renderDetail();
      }
    };
    h.onkeydown = (k) => {
      if (k.key === 'Enter') { k.preventDefault(); finish(true); }
      else if (k.key === 'Escape') { k.preventDefault(); finish(false); }
    };
    h.onblur = () => finish(true);
  });
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
      if (C.runAfterBuild && e.title.startsWith('Build')) { C.runAfterBuild = false; if (e.ok) setTimeout(() => act('run'), 300); }
      refresh();
      if ($('#page-engine').classList.contains('active')) loadEngine(true);
      if ($('#page-content').classList.contains('active')) loadContent();
    } else if (e.kind === 'refresh') refresh();
    else if (e.kind === 'gecko') geckoLine(e);
    else if (e.kind === 'gecko_status') geckoStatus(e);
  };
}

// --- the engine page ----------------------------------------------------------------------------
// Octave-libogc: its version against the newest release, what's built and what's stale (its own builder,
// Tools/builder.py --status, says), building the parts ticked, updating, the editor.

let engine = null;

async function loadEngine(fresh) {
  engine = await api('/api/engine' + (fresh ? '?fresh' : ''));
  renderEngine();
  if (!engine.latest) setTimeout(() => api('/api/engine').then((e) => { engine = e; renderEngine(); }), 3000);
}

const when = (t) => t ? new Date(t * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '';

function renderEngine() {
  const card = $('#engineCard');
  if (!engine || !engine.octave) {
    card.innerHTML = '<div class="empty">No Octave-libogc found: install it from Packages, or set where it is in Settings.</div>';
    return;
  }
  const s = engine.status || {}, latest = engine.latest, busy = !!state.busy;
  const behind = latest && s.version && s.version.replace(/\+.*/, '') !== latest.tag;
  const version = `<b>${esc(s.version || 'unknown')}</b> <span class="muted">${s.git ? 'from source (a git checkout)' : 'a release'}</span>`;
  const update = !latest ? '<span class="muted">asking GitHub for the newest release…</span>'
    : behind ? `<span class="warn">${esc(latest.tag)} is out</span> <a class="fix inline" href="${esc(latest.url)}" target="_blank">what's new</a>`
    : `<span class="ok">● up to date</span> <span class="muted">(newest: ${esc(latest.tag)})</span>`;
  const needs = s.needs || {};
  const parts = engine.parts.map(([key, name, purpose]) => {
    const p = (s.parts || {})[key] || {};
    const state_ = !p.built ? '<span class="err">○ Not built</span>'
      : p.stale ? `<span class="warn">● Source changed since${p.to_compile ? ` (${p.to_compile} files)` : ''}</span>`
      : '<span class="ok">● Built</span>';
    const tick = !p.built || p.stale;
    return `<tr><td><label class="check"><input type="checkbox" data-part="${key}" ${tick ? 'checked' : ''}> ${esc(name)}</label>
      <div class="purpose">${esc(purpose)}</div></td><td>${state_}</td><td class="muted">${esc(when(p.time))}</td></tr>`;
  }).join('');
  const need = (ok, name, fix) => `<span class="${ok ? 'ok' : 'err'}">${ok ? '●' : '○'} ${esc(name)}</span>${ok ? '' : ` <span class="muted">${esc(fix)}</span>`}`;
  card.innerHTML = `
    <table class="table engine-head">
      <tr><th>Version</th><td>${version}</td></tr>
      <tr><th>Newest</th><td>${update}
        <button class="btn small" data-engine="update" ${busy ? 'disabled' : ''}>${s.git ? 'Update (git pull)' : behind ? `Update to ${esc(latest.tag)}` : 'Reinstall'}</button></td></tr>
      <tr><th>Where</th><td>${esc(engine.octave)} <button class="btn small" data-engine="folder">${ICONS.folder} Open folder</button></td></tr>
    </table>
    <h2 class="later">Build it ${s.old_builder ? '' : '<span class="muted small">(its own builder, Tools/builder.py, without its window)</span>'}</h2>
    ${s.old_builder ? '<p class="muted">This Octave is older than its builder\'s DolphinWorks mode: update it first.</p>' : `
    <table class="table packages engine-parts"><tr><th>Part</th><th>State</th><th>Built</th></tr>${parts}</table>
    <p class="needs">Needs: ${need(needs.toolchain, needs.toolchain_label || 'GameCube toolchain', 'devkitPro or gekko-toolchain (Packages)')}
      · ${need(needs.msbuild, 'Visual Studio C++', 'for the editor and Windows program')}
      · ${need(needs.vulkan, 'Vulkan SDK', 'for the shaders, the editor and Windows program')}</p>
    ${engine.editor_running ? '<p class="warn">The editor is open: close it before building the editor (its file is in use).</p>' : ''}
    <div class="row2"><button class="btn primary" data-engine="build" ${busy ? 'disabled' : ''}>Build ticked parts</button>
      <button class="btn" data-engine="refresh">Check again</button></div>`}`;
}

function bindEngine() {
  $('#engineCard').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-engine]');
    if (!b || b.disabled) return;
    const what = b.dataset.engine;
    if (what === 'refresh') return loadEngine(true);
    if (what === 'folder') return api('/api/engine_folder', {});
    if (what === 'update') {
      const s = engine.status || {};
      if (!s.git && !confirm(`Replace Octave-libogc ${s.version || ''} in ${engine.octave} with ${engine.latest ? engine.latest.tag : 'the newest release'}?`
          + '\n\nIt downloads the release (about 230 MB), unpacks it beside this one, and swaps it in. Close the editor first.')) return;
      $('#log').innerHTML = '';
      const r = await api('/api/engine_update', {});
      if (!r.ok) toast(r.busy ? `Busy: ${r.busy}` : 'That did not start.');
      return;
    }
    if (what === 'build') {
      const parts = $$('#engineCard [data-part]').filter((c) => c.checked).map((c) => c.dataset.part);
      $('#log').innerHTML = '';
      const r = await api('/api/engine_build', { parts });
      if (!r.ok) toast(r.message || (r.busy ? `Busy: ${r.busy}` : 'That did not start.'));
    }
  });
}

// --- content: the game's files, its assets and its code -------------------------------------------
// A tree of the project's folders (build output left out); a file opens on the right: code in an editor
// (CodeMirror) that completes Octave's Lua API (read from the installed engine) and the game's asset names;
// a picture or a sound in Raw/ shows, plays, and has its asset's settings (octkit's, Raw/assets.json).

const C = { project: null, data: null, open: null, editor: null, dirty: false, folds: {}, api: null, scroll: {} };
const TEXT_EXT = ['.lua', '.cpp', '.c', '.h', '.hpp', '.inl', '.ini', '.md', '.json', '.py', '.txt', '.octp', '.glsl', '.bat'];
const IMAGE_EXT = ['.png', '.jpg', '.jpeg', '.bmp', '.webp', '.tga'];
const AUDIO_EXT = ['.wav', '.ogg', '.mp3', '.flac'];
const MODEL_EXT = ['.glb', '.gltf', '.obj', '.blend'];
const VIDEO_EXT = ['.mp4', '.mov', '.webm', '.mkv', '.avi', '.m4v'];
const ext = (path) => (path.match(/\.[^./]+$/) || [''])[0].toLowerCase();
const kb = (n) => n == null ? '' : n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB` : `${(n / 1048576).toFixed(1)} MB`;

async function loadContent(keepOpen = true) {
  if (!state) await refresh();               // (opened at start: the projects first)
  const p = project();
  $('#contentTitle').textContent = p ? `· ${p.title}` : '';
  $('#cRootHint').textContent = '';
  const projectOnly = ['#cNewScript', '#cAddFiles', '#cConvert'];
  projectOnly.forEach((b) => { $(b).disabled = !p || !p.octp; });
  $('#page-content [data-act="build"]').disabled = !p || !p.octp;
  $('.cdrop-hint').style.display = p && p.octp && C.mode !== 'disc' ? '' : 'none';
  $('#cMode').style.display = p && p.octp ? '' : 'none';
  if (!p) {
    C.project = null;
    $('#cTree').innerHTML = '<div class="empty">Choose a game in Projects.</div>';
    $('#cPane').innerHTML = '';
    return;
  }
  if (C.project !== p.id) C.mode = p.octp ? (new URLSearchParams(location.search).get('mode') || 'project') : 'disc';   // (another game: its project first; ?mode=disc)
  if (!p.octp) C.mode = 'disc';                // (a disc image alone: its disc is all there is)
  $$('#cMode button').forEach((b) => b.classList.toggle('on', b.dataset.mode === (C.mode || 'project')));
  if (C.mode === 'disc') return loadDisc(p);
  if (C.project !== p.id) { C.project = p.id; C.open = null; C.dirty = false; }
  if (!C.api) api('/api/luaapi').then((a) => { C.api = a; });
  const r = await api('/api/content?id=' + encodeURIComponent(p.id));
  if (!r.ok) { $('#cTree').innerHTML = `<div class="empty">${esc(r.message)}</div>`; return; }
  C.data = r;
  $('#cRootHint').textContent = r.kind === 'cpp' ? 'C++ and Lua' : 'Lua';
  if (C.open && C.open.startsWith('disc:')) C.open = null;
  renderTree();
  const asked = new URLSearchParams(location.search).get('open');   // ?open=Scripts/Game.lua: that file
  if (asked && !C.opened) { C.opened = true; openFile(asked, true); }
  else if (keepOpen && C.open && !C.dirty) openFile(C.open, true);
  else if (!C.open) renderPaneEmpty();
}

const assetOf = (path) => C.data && C.data.assets.find((a) => 'Raw/' + a.source === path);
const sourceOf = (path) => C.data && C.data.assets.find((a) => a.path === path || (a.outputs && a.path &&      // (a model's every part)
  a.path.slice(0, a.path.lastIndexOf('/')) === path.slice(0, path.lastIndexOf('/')) && a.outputs.includes(path.split('/').pop().replace(/\.oct$/, ''))));
const STATE = { ready: ['ok', 'ready'], changed: ['warn', 'changed'], new: ['new', 'new'] };

function renderTree() {
  const row = (e, depth) => {
    const pad = `style="padding-left:${8 + depth * 14}px"`;
    if (e.dir) {
      const open = C.folds[e.path] !== false;
      return `<div class="crow dir${open ? ' open' : ''}" data-dir="${esc(e.path)}" draggable="true" ${pad}><span class="caret">${open ? '▾' : '▸'}</span>${esc(e.name)}</div>`
        + (open ? e.children.map((c) => row(c, depth + 1)).join('') : '');
    }
    const a = assetOf(e.path), s = sourceOf(e.path);
    const badge = a ? `<span class="cbadge ${STATE[a.state][0]}" title="${esc(a.asset)}: ${STATE[a.state][1]}">${esc(a.asset)}</span>`
      : s ? `<span class="cbadge from" title="Made from Raw/${esc(s.source)}">from ${esc(s.source.split('/').pop())}</span>` : '';
    const icon = IMAGE_EXT.includes(ext(e.path)) ? '▣' : AUDIO_EXT.includes(ext(e.path)) ? '♪' : MODEL_EXT.includes(ext(e.path)) ? '▲'
      : VIDEO_EXT.includes(ext(e.path)) ? '▶' : ext(e.path) === '.ttf' ? 'Aa'
      : ext(e.path) === '.oct' ? '◆'
      : TEXT_EXT.includes(ext(e.path)) ? '‹›' : '·';
    return `<div class="crow file${C.open === e.path ? ' sel' : ''}" data-file="${esc(e.path)}" draggable="true" ${pad}>
      <span class="cicon">${icon}</span><span class="cname">${esc(e.name)}</span>${badge}</div>`;
  };
  $('#cTree').innerHTML = C.data.tree.map((e) => row(e, 0)).join('') || '<div class="empty">No files.</div>';
}

function renderPaneEmpty() {
  const n = C.data.assets.length, pending = C.data.assets.filter((a) => a.state !== 'ready').length;
  $('#cPane').innerHTML = `<div class="cwelcome"><h3>${esc(project().title)}</h3>
    <p>Pick a file on the left. Code opens here to edit (Ctrl+S saves). A file in Raw/ (a picture, sound, model, video or font) shows the asset it becomes, its settings, and the Lua that uses it.</p>
    <p class="muted">${n ? `${n} file${n > 1 ? 's' : ''} in Raw/${pending ? `, ${pending} to convert` : ', all converted'}.` : 'Nothing in Raw/ yet: drop art, sound or models anywhere on this page.'}</p>
    ${C.data.tree.some((e) => e.path === 'build.py') ? '<p class="muted">build.py runs on every Build, after the assets.</p>'
      : `<p><button class="btn" id="cBuildPy">+ Build step (build.py)</button></p>
         <p class="muted">Python that runs on every Build, after Raw/ is converted: for what the game makes for itself, as Sonic Pipe Dream's scripts did (data as Lua tables, pictures cut or recoloured, levels from a file). Octave's octkit is there to import.</p>`}</div>`;
  const b = $('#cBuildPy');
  if (b) b.onclick = async () => {
    const r = await api('/api/new_build_py', { id: project().id });
    if (!r.ok) return toast(r.message);
    await loadContent();
    openFile(r.path);
  };
}

async function openFile(path, quiet) {
  if (C.dirty && C.open !== path && !confirm(`${C.open} has changes that aren't saved. Leave them?`)) return;
  if (C.editor && C.open) C.scroll[C.open] = C.editor.getScrollInfo().top;
  C.open = path;
  C.dirty = false;
  C.editor = null;
  renderTree();
  const p = project(), e = ext(path), pane = $('#cPane');
  const url = `/api/file?id=${encodeURIComponent(p.id)}&path=${encodeURIComponent(path)}`;
  if (TEXT_EXT.includes(e)) {
    const r = await api(url);
    if (!r.ok) { pane.innerHTML = `<div class="empty">${esc(r.message)}</div>`; return; }
    C.fileTime = r.time;
    pane.innerHTML = `<div class="ceditor-head"><b>${esc(path)}</b><span class="cdirty" id="cDirty"></span>
      <span class="spacer"></span><button class="btn small" id="cSave">Save</button>
      <button class="btn small" id="cCode" title="Open it in VS Code, else Visual Studio (with Octave's headers and API set up)">Open in IDE</button>
      <button class="btn small primary" id="cRun" title="Save, build, run in Dolphin">Build ▸ Run</button></div>
      <div class="ceditor" id="cEditor"></div>`;
    const mode = e === '.lua' ? 'lua' : ['.cpp', '.c', '.h', '.hpp', '.inl', '.glsl'].includes(e) ? 'text/x-c++src' : null;
    C.editor = CodeMirror($('#cEditor'), {
      value: r.text, mode, lineNumbers: true, indentUnit: 4, tabSize: 4, indentWithTabs: false, matchBrackets: true,
      autoCloseBrackets: true, styleActiveLine: true, extraKeys: {
        'Ctrl-S': () => saveFile(), 'Ctrl-Space': (cm) => showLuaHint(cm, true),
        Tab: (cm) => (cm.somethingSelected() ? cm.indentSelection('add') : cm.replaceSelection('    ', 'end')),
      },
    });
    C.editor.on('change', () => { if (!C.dirty) { C.dirty = true; $('#cDirty').textContent = '● not saved'; } });
    if (e === '.lua') C.editor.on('inputRead', (cm, change) => {
      const ch = change.text.join('');
      if (/^[.:"\w]$/.test(ch)) showLuaHint(cm, false);
    });
    if (C.scroll[path]) C.editor.scrollTo(0, C.scroll[path]);
    $('#cSave').onclick = () => saveFile();
    $('#cCode').onclick = async () => {
      if (C.dirty && !(await saveFile())) return;
      const x = await api('/api/open_code', { id: p.id, path });
      toast(x.ok ? `Opening it in ${x.editor}` : x.message);
    };
    $('#cRun').onclick = async () => { if (await saveFile()) { await act('build'); C.runAfterBuild = true; } };
    if (!quiet) C.editor.focus();
    return;
  }
  const a = assetOf(path), s = sourceOf(path);
  if (a) return renderAssetPane(path, a, url);
  if (e === '.oct') {
    pane.innerHTML = `<div class="cinfo"><h3>${esc(path.split('/').pop())}</h3>
      <p>${s ? `Made by octkit from <a class="link" data-file-link="Raw/${esc(s.source)}">Raw/${esc(s.source)}</a>: change that file, or its settings, and Convert.`
               : 'An Octave asset made in the editor (or by a script): DolphinWorks leaves it as it is.'}</p>
      <dl class="kv"><dt>Name</dt><dd>${esc(path.split('/').pop().replace(/\.oct$/, ''))}</dd>
      <dt>In Lua</dt><dd><code>LoadAsset("${esc(path.split('/').pop().replace(/\.oct$/, ''))}")</code></dd></dl></div>`;
    return;
  }
  pane.innerHTML = `<div class="cinfo"><h3>${esc(path)}</h3><p class="muted">Not something DolphinWorks edits.</p></div>`;
}

// The lines that play a video full screen, in a script's Create (self: the script's node, a canvas or widget).
function videoSnippet(name) {
  return `local video = self:CreateChild("VideoQuad")
video:SetAnchorMode(AnchorMode.FullStretch)
video:SetMargins(0.0, 0.0, 0.0, 0.0)
video:SetVideoClip(LoadAsset("${name}"))
video:PlayVideo()`;
}

function renderAssetPane(path, a, url) {
  const s = a.settings, e = ext(path), pane = $('#cPane');
  const sel = (key, options) => `<select data-set="${key}">${options.map(([v, label]) => `<option value="${v}" ${String(s[key]) === String(v) ? 'selected' : ''}>${label}</option>`).join('')}</select>`;
  const chk = (key) => `<input type="checkbox" data-set="${key}" ${s[key] ? 'checked' : ''}>`;
  const num = (key, step, min, max) => `<input type="number" data-set="${key}" value="${s[key]}" step="${step}" min="${min}" max="${max}">`;
  const preview = a.kind === 'texture' ? `<div class="cpreview"><img src="${url}&raw=1" alt=""></div>`
    : a.kind === 'video' ? `<div class="cpreview video"><video controls src="${url}&raw=1"></video></div>`
    : a.kind === 'font' ? `<div class="cpreview font"><style>@font-face { font-family: "dwpreview"; src: url("${url}&raw=1"); }</style>
        <div style="font-family: dwpreview">Hello, GameCube! 0123456789</div></div>`
    : a.kind === 'mesh' ? `<div class="cparts">${(a.outputs || []).length ? (a.outputs || []).map((o) => `<span class="cpart ${o.slice(0, 2)}">${esc(o)}</span>`).join('')
                                                                              : '<span class="muted">Not converted yet.</span>'}</div>`
    : `<div class="cpreview audio"><audio controls src="${url}&raw=1"></audio></div>`;
  const settings = a.kind === 'font' ? ''
    : a.kind === 'video' ? `
      <dt>Preset</dt><dd>${sel('preset', [['custom', 'Custom (the size and rate below)'], ['ntsc', 'NTSC: 640 × 480, 29.97 fps'], ['pal', 'PAL: 640 × 528, 25 fps']])}</dd>
      ${s.preset === 'custom' ? `
      <dt>Width</dt><dd>${num('width', 16, 16, 1024)} <span class="muted">pixels, a multiple of 16</span></dd>
      <dt>Height</dt><dd>${num('height', 16, 0, 1024)} <span class="muted">0: keep its shape</span></dd>
      <dt>Frame rate</dt><dd>${num('fps', 1, 1, 60)} <span class="muted">fps</span></dd>` : ''}
      <dt>Quality</dt><dd>${num('quality', 1, 2, 31)} <span class="muted">JPEG: 2 best … 31 smallest</span></dd>
      <dt>Audio</dt><dd>${sel('audio_channels', [[2, 'Stereo'], [1, 'Mono']])}</dd>
      ${s.native_audio ? '' : `<dt>Sample rate</dt><dd>${sel('sample_rate', [[11025, '11 kHz'], [22050, '22 kHz'], [32000, '32 kHz'], [44100, '44.1 kHz'], [48000, '48 kHz']])}</dd>`}
      <dt>Keep the source's</dt><dd><label class="check">${chk('native_resolution')} size</label>
        <label class="check">${chk('native_fps')} frame rate</label> <label class="check">${chk('native_audio')} audio rate</label></dd>`
    : a.kind === 'mesh' ? `
      <dt>Scale</dt><dd>${num('scale', 0.1, 0.001, 1000)}</dd>
      <dt>Lighting</dt><dd><label class="check">${chk('lit')} lit by the scene's lights</label></dd>
      <dt>Faces</dt><dd>${sel('cull', [['back', 'Front only (back faces hidden)'], ['none', 'Both sides']])}</dd>
      <dt>Textures</dt><dd>${sel('filter', [['linear', 'Linear (smooth)'], ['nearest', 'Nearest (pixel art)']])}</dd>`
    : a.kind === 'texture' ? `
      <dt>Filter</dt><dd>${sel('filter', [['linear', 'Linear (smooth)'], ['nearest', 'Nearest (pixel art)']])}</dd>
      <dt>Wrap</dt><dd>${sel('wrap', [['repeat', 'Repeat'], ['clamp', 'Clamp'], ['mirror', 'Mirror']])}</dd>
      <dt>Mipmaps</dt><dd><label class="check">${chk('mipmaps')} smaller copies for when it's far away (3D)</label></dd>
      <dt>Quality</dt><dd><label class="check">${chk('force_hq')} keep full size on the console</label></dd>
      <dt>Downsample</dt><dd>${sel('downsample', [[1, 'Full size'], [2, 'Half'], [3, 'Quarter']])}</dd>`
    : `
      <dt>As</dt><dd>${sel('mode', [['effect', 'Sound effect (in memory, plays instantly)'], ['music', 'Music (streamed from the disc)']])}</dd>
      <dt>Rate</dt><dd>${sel('rate', [[11025, '11 kHz'], [22050, '22 kHz'], [32000, '32 kHz'], [44100, '44.1 kHz']])}</dd>
      <dt>Volume</dt><dd>${num('volume', 0.05, 0, 4)}</dd>
      ${s.mode === 'music' ? `<dt>Quality</dt><dd>${num('quality', 1, 0, 10)} <span class="muted">Vorbis 0–10</span></dd>`
                           : `<dt>Pitch</dt><dd>${num('pitch', 0.05, 0.1, 4)}</dd><dt>Copies</dt><dd>${num('max_instances', 1, 0, 32)} <span class="muted">at once (0: any)</span></dd>`}`;
  pane.innerHTML = `<div class="casset">
    <div class="casset-head"><h3>${esc(path.split('/').pop())}</h3>
      <span class="cbadge ${STATE[a.state][0]}">${STATE[a.state][1]}</span>
      <span class="spacer"></span><button class="btn small" id="cConvertOne" ${a.state === 'ready' ? 'disabled' : ''}>Convert</button></div>
    ${preview}
    <dl class="kv casset-kv">
      <dt>Asset</dt><dd><input data-set="name" value="${esc(s.name)}" spellcheck="false"></dd>
      <dt>In Lua</dt><dd>${a.kind === 'video' ? `<pre class="csnippet" id="cLuaLine">${esc(videoSnippet(s.name))}</pre>`
        : a.kind === 'font' ? `<code id="cLuaLine">text:SetFont(LoadAsset("${esc(s.name)}"))</code>`
        : `<code id="cLuaLine">${a.kind === 'mesh' ? `node:SetStaticMesh(LoadAsset("${esc(a.asset)}"))` : `LoadAsset("${esc(s.name)}")`}</code>`}
        <button class="btn small" id="cCopyLua">Copy</button></dd>
      ${settings}
      <dt>Size</dt><dd>${kb(a.source_size)} here${a.size ? ` · ${kb(a.size)} as an asset (before the console cook)` : ''}</dd>
    </dl>
    <p class="note">${a.kind === 'video' ? 'Cooked by Octave itself when it converts (its own importer, run headless, with these settings): JPEG frames and the audio, played from the disc. Smaller, slower and lower quality all cost less disc and less work for the console. Paste the lines above into the Create of a script (Game.lua, say), then Build.'
      : a.kind === 'font' ? 'Imported by Octave itself when it converts (its own importer, run headless).'
      : a.kind === 'mesh' ? `A mesh for each of its materials (SM_…), each material (M_…), and a texture for each picture in it (T_…), its scene baked flat. ${ext(path) === '.blend' ? 'Read by Blender itself (Packages), exported as glTF.' : ''}`
      : a.kind === 'texture' ? 'The GameCube format is chosen when it builds, from the picture\'s transparency: none, cut-out, or smooth.'
      : s.mode === 'music' ? 'Music is Vorbis, made at this quality, and streamed from the disc as it plays: it costs almost no memory.'
      : 'A sound effect is kept as 16-bit PCM in memory, so it starts the instant it\'s played.'}</p></div>`;
  pane.querySelectorAll('[data-set]').forEach((el) => el.onchange = async () => {
    const key = el.dataset.set;
    let value = el.type === 'checkbox' ? el.checked : el.value;
    if (['downsample', 'rate', 'max_instances', 'quality', 'width', 'height', 'fps', 'audio_channels', 'sample_rate'].includes(key)) value = parseInt(value, 10);
    if (['volume', 'pitch', 'scale'].includes(key)) value = parseFloat(value);
    const r = await api('/api/asset_settings', { id: project().id, source: a.source, settings: { [key]: value } });
    if (!r.ok) return toast(r.message);
    const box = pane.querySelector('.casset'), media = pane.querySelector('video, audio');
    C.keepView = { path, scroll: box ? box.scrollTop : 0, time: media ? media.currentTime : 0, playing: media ? !media.paused : false };
    await loadContent();
  });
  $('#cCopyLua').onclick = () => { navigator.clipboard.writeText($('#cLuaLine').textContent); toast('Copied'); };
  if (C.keepView && C.keepView.path === path) {               // (redrawn for a setting: where it was)
    const box = pane.querySelector('.casset'), media = pane.querySelector('video, audio'), keep = C.keepView;
    if (box) box.scrollTop = keep.scroll;
    if (media && keep.time) {
      media.addEventListener('loadedmetadata', () => { media.currentTime = keep.time; if (keep.playing) media.play().catch(() => {}); }, { once: true });
    }
  }
  C.keepView = null;
  $('#cConvertOne').onclick = () => $('#cConvert').click();
}

async function saveFile(force) {
  if (!C.editor || !C.open) return false;
  let r = await api('/api/save_file', { id: project().id, path: C.open, text: C.editor.getValue(), base_time: C.fileTime, force: !!force });
  if (r.conflict) {
    // changed on disk since it opened (another program, a script, Claude): yours over it, or its back here
    if (confirm(`${C.open} changed on disk since you opened it here.\n\nOK: save yours over it.\nCancel: load the one on disk instead (your changes here are dropped).`)) {
      return saveFile(true);
    }
    C.dirty = false;
    await openFile(C.open, true);
    toast(`Loaded ${C.open.split('/').pop()} from disk`);
    return false;
  }
  if (!r.ok) { toast(r.message || 'Not saved.'); return false; }
  C.fileTime = r.time;
  C.dirty = false;
  const d = $('#cDirty');
  if (d) d.textContent = '';
  toast(`Saved ${C.open.split('/').pop()}`);
  return true;
}

// Autocomplete: Octave's API, from the installed engine. "X." a table's functions or an enum's values;
// ":" any class's methods; LoadAsset(" the game's assets; else globals, tables and Lua's words.
const LUA_WORDS = ['and', 'break', 'do', 'else', 'elseif', 'end', 'false', 'for', 'function', 'if', 'in', 'local', 'nil',
  'not', 'or', 'repeat', 'return', 'then', 'true', 'until', 'while', 'self', 'print', 'pairs', 'ipairs', 'string', 'math', 'table', 'tostring', 'tonumber'];

function showLuaHint(cm, forced) {
  const A = C.api;
  if (!A) return;
  cm.showHint({ completeSingle: false, hint: () => {
    const cur = cm.getCursor(), line = cm.getLine(cur.line).slice(0, cur.ch);
    const fn = (name, info, where) => ({ text: name, displayText: `${name}(${(info.args || []).join(', ')})`, where, doc: info.doc });
    let m, list = [], from;
    if ((m = line.match(/(?:LoadAsset|GetAsset|AsyncLoadAsset)\(\s*"(\w*)$/))) {
      from = CodeMirror.Pos(cur.line, cur.ch - m[1].length);
      const names = new Set(C.data.assets.map((a) => a.asset));
      const walk = (es) => es.forEach((e) => e.dir ? walk(e.children) : e.path.endsWith('.oct') && names.add(e.name.replace(/\.oct$/, '')));
      walk(C.data.tree);
      list = [...names].filter((n) => n.toLowerCase().startsWith(m[1].toLowerCase())).sort().map((n) => ({ text: n, displayText: n, where: 'asset' }));
    } else if ((m = line.match(/([A-Za-z_]\w*)\.(\w*)$/))) {
      from = CodeMirror.Pos(cur.line, cur.ch - m[2].length);
      const t = A.tables[m[1]], en = A.enums[m[1]];
      if (t) list = Object.keys(t).map((k) => fn(k, t[k], m[1]));
      else if (en) list = en.map((k) => ({ text: k, displayText: k, where: m[1] }));
      list = list.filter((x) => x.text.toLowerCase().startsWith(m[2].toLowerCase()));
    } else if ((m = line.match(/:(\w*)$/))) {
      from = CodeMirror.Pos(cur.line, cur.ch - m[1].length);
      const seen = new Map();
      for (const [cls, c] of Object.entries(A.classes)) for (const [k, info] of Object.entries(c.methods)) {
        if (k.toLowerCase().startsWith(m[1].toLowerCase()) && !seen.has(k)) seen.set(k, fn(k, info, cls));
        else if (seen.has(k)) seen.get(k).where = 'Node…';
      }
      list = [...seen.values()].sort((a, b) => a.text.localeCompare(b.text));
    } else if ((m = line.match(/([A-Za-z_]\w*)$/)) && (forced || m[1].length >= 2)) {
      from = CodeMirror.Pos(cur.line, cur.ch - m[1].length);
      const words = [...Object.keys(A.tables).map((k) => ({ text: k, displayText: k, where: 'table' })),
        ...Object.keys(A.enums).map((k) => ({ text: k, displayText: k, where: 'enum' })),
        ...Object.entries(A.globals).map(([k, info]) => fn(k, info, 'global')),
        ...LUA_WORDS.map((k) => ({ text: k, displayText: k, where: 'Lua' }))];
      list = words.filter((x) => x.text.toLowerCase().startsWith(m[1].toLowerCase()) && x.text !== m[1]);
    } else return null;
    if (!list.length) return null;
    list = list.slice(0, 80).map((x) => ({ ...x, render: (el) => {
      el.innerHTML = `<span class="hname">${esc(x.displayText)}</span><span class="hwhere">${esc(x.where || '')}</span>`;
      if (x.doc) el.title = x.doc;
    } }));
    return { list, from, to: cur };
  } });
}

async function addFiles(files, folder) {
  const p = project();
  if (!p || !p.octp || !files.length) return;
  const read = (f) => new Promise((ok) => { const r = new FileReader(); r.onload = () => ok({ name: f.name, data: r.result.split(',')[1] }); r.readAsDataURL(f); });
  const out = [];
  for (const f of files) out.push(await read(f));
  const r = await api('/api/add_files', { id: p.id, folder: folder || '', files: out });
  if (!r.ok) return toast(r.message || 'Not added.');
  toast(`Added to Raw/${folder ? folder + '/' : ''}: ${r.added.join(', ')}. Convert (or Build) makes them assets.`);
  C.folds['Raw'] = true;
  await loadContent();
}

function rawFolderOf(path) {
  // a folder in Raw/ (or a file in one): where dropped files go
  if (!path || !path.startsWith('Raw')) return '';
  const parts = path.split('/').slice(1);
  if (ext(path)) parts.pop();
  return parts.join('/');
}

// Refresh: the files again, and the open file from disk (unless it has unsaved changes here).
async function refreshContent(quietly) {
  if (C.open && C.editor && !C.dirty) {
    const r = await api(`/api/file?id=${encodeURIComponent(project().id)}&path=${encodeURIComponent(C.open)}`);
    if (r.ok && r.time !== C.fileTime) {
      const cur = C.editor.getCursor(), top = C.editor.getScrollInfo().top;
      C.editor.setValue(r.text);
      C.editor.setCursor(cur);
      C.editor.scrollTo(0, top);
      C.dirty = false;
      C.fileTime = r.time;
      const d = $('#cDirty');
      if (d) d.textContent = '';
      toast(`${C.open.split('/').pop()} changed on disk: reloaded`);
    }
  }
  const keep = C.editor ? C.open : null;
  await loadContent(!keep);
  if (!quietly && !keep) toast('Refreshed');
}

async function moveFile(from, toDir) {
  const p = project();
  const r = await api('/api/move_file', { id: p.id, path: from, to: toDir });
  if (!r.ok) return toast(r.message);
  if (C.open === from) C.open = r.path;
  else if (C.open && C.open.startsWith(from + '/')) C.open = r.path + C.open.slice(from.length);
  C.folds[toDir] = true;
  toast(`Moved to ${toDir || 'the project'}/`);
  await loadContent();
}

function contentMenu(x, y, target) {
  // target: { path, dir } of the row right-clicked, or null (the panel itself: the project's folder)
  const p = project();
  if (!p || !p.octp) return;
  const dir = target ? (target.dir ? target.path : target.path.split('/').slice(0, -1).join('/')) : '';
  const items = [
    ['New folder…', async () => {
      const name = prompt(`A new folder in ${dir || 'the project'}/:`, 'New folder');
      if (!name) return;
      const r = await api('/api/new_folder', { id: p.id, path: (dir ? dir + '/' : '') + name.trim() });
      if (!r.ok) return toast(r.message);
      C.folds[dir] = true;
      await loadContent();
    }],
    ['New script…', async () => {
      const name = prompt('A new Lua script (a node script: Create and Tick). Its name:', 'Player');
      if (!name) return;
      const r = await api('/api/new_script', { id: p.id, name: name.trim(), folder: dir.startsWith('Scripts') ? dir : 'Scripts' });
      if (!r.ok) return toast(r.message);
      C.folds['Scripts'] = true;
      await loadContent();
      openFile(r.path);
    }],
    ['Add files here…', () => { C.dropFolder = rawFolderOf(dir.startsWith('Raw') ? dir + '/' : 'Raw/'); $('#cAddFiles').click(); }],
  ];
  if (target) {
    items.push(null, ['Rename…', async () => {
      const old = target.path.split('/').pop();
      const name = prompt('New name:', old);
      if (!name || name === old) return;
      const r = await api('/api/rename_file', { id: p.id, path: target.path, name: name.trim() });
      if (!r.ok) return toast(r.message);
      if (C.open === target.path) C.open = r.path;
      await loadContent();
    }], ['Delete…', async () => {
      if (C.open === target.path && C.dirty && !confirm('It has unsaved changes here. Delete anyway?')) return;
      if (!confirm(`Delete ${target.path}${target.dir ? ' and everything in it' : ''}? It goes to the Recycle Bin.`)) return;
      const r = await api('/api/delete_file', { id: p.id, path: target.path });
      if (!r.ok) return toast(r.message);
      if (C.open && (C.open === target.path || C.open.startsWith(target.path + '/'))) { C.open = null; C.editor = null; C.dirty = false; }
      await loadContent();
      toast('Deleted (in the Recycle Bin)');
    }]);
  }
  items.push(null, ['Show in Explorer', () => api('/api/reveal_file', { id: p.id, path: target ? target.path : '' })],
             ['Refresh', () => refreshContent()]);
  const menu = $('#cMenu');
  menu.innerHTML = items.map((it, i) => it ? `<div class="cmenu-item" data-i="${i}">${esc(it[0])}</div>` : '<div class="cmenu-sep"></div>').join('');
  menu.querySelectorAll('[data-i]').forEach((el) => el.onclick = () => { menu.classList.remove('show'); items[+el.dataset.i][1](); });
  const page = $('#page-content').getBoundingClientRect();
  menu.style.left = `${x - page.left}px`;
  menu.style.top = `${y - page.top}px`;
  menu.classList.add('show');
  const r = menu.getBoundingClientRect();                       // (kept on the page)
  if (r.right > window.innerWidth - 8) menu.style.left = `${x - page.left - r.width}px`;
  if (r.bottom > window.innerHeight - 8) menu.style.top = `${y - page.top - r.height}px`;
}

// --- the Disc view: what's on the disc image (its file table, and the program) ----------------------

async function loadDisc(p) {
  if (C.project !== p.id) { C.project = p.id; C.open = null; C.dirty = false; C.editor = null; }
  const r = await api('/api/disc_files?id=' + encodeURIComponent(p.id));
  if (!r.ok) { $('#cTree').innerHTML = `<div class="empty">${esc(r.message)}</div>`; $('#cPane').innerHTML = ''; return; }
  // the flat list as a tree: folders first
  const root = { dirs: {}, files: [] };
  for (const f of r.files) {
    const parts = f.path.split('/');
    let at = root;
    for (const part of parts.slice(0, -1)) at = at.dirs[part] = at.dirs[part] || { dirs: {}, files: [] };
    at.files.push(f);
  }
  C.discFiles = r.files;
  const total = r.files.reduce((n, f) => n + f.size, 0);
  $('#cRootHint').textContent = `${r.files.length} files · ${kb(total)}`;
  const rows = (node, prefix, depth) => Object.keys(node.dirs).sort((a, b) => a.localeCompare(b)).map((name) => {
    const path = prefix + name, open = C.folds['disc:' + path] === true, sub = node.dirs[name];
    const size = C.discFiles.filter((f) => f.path.startsWith(path + '/')).reduce((n, f) => n + f.size, 0);
    return `<div class="crow dir${open ? ' open' : ''}" data-disc-dir="${esc(path)}" style="padding-left:${8 + depth * 14}px">
      <span class="caret">${open ? '▾' : '▸'}</span>${esc(name === '&&SystemData' ? 'System' : name)}<span class="cbadge from">${kb(size)}</span></div>`
      + (open ? rows(sub, path + '/', depth + 1) : '');
  }).join('') + node.files.map((f) => {
    const name = f.path.split('/').pop();
    const icon = IMAGE_EXT.includes(ext(name)) ? '▣' : AUDIO_EXT.includes(ext(name)) ? '♪' : ext(name) === '.oct' ? '◆'
      : ext(name) === '.dol' ? '⚙' : ext(name) === '.bnr' ? '▭' : TEXT_EXT.includes(ext(name)) ? '‹›' : '·';
    return `<div class="crow file${C.open === 'disc:' + f.path ? ' sel' : ''}" data-disc-file="${esc(f.path)}" style="padding-left:${8 + depth * 14}px">
      <span class="cicon">${icon}</span><span class="cname">${esc(name)}</span><span class="cbadge from">${kb(f.size)}</span></div>`;
  }).join('');
  $('#cTree').innerHTML = rows(root, '', 0) || '<div class="empty">Nothing on it.</div>';
  if (!C.open || !C.open.startsWith('disc:')) renderDiscWelcome(p, r);
}

function renderDiscWelcome(p, r) {
  const octave = r.files.filter((f) => f.path.endsWith('.oct')).length;
  $('#cPane').innerHTML = `<div class="cwelcome"><h3>${esc(p.title)}: the disc</h3>
    <p>What's on <code>${esc(r.iso.split(/[\\/]/).pop())}</code>: its file table, and the program and header the GameCube boots from. Click a file to see it; Extract copies any file, or a whole folder, out.</p>
    <p class="muted">${r.files.length} files${octave ? `, ${octave} of them Octave assets` : ''}. ${p.octp ? 'This is what the last Build put on it: Project, above, is what you work on.' : 'A disc image on its own: no project to change, only the files on it.'}</p>
    <p><button class="btn" data-extract="">Extract everything…</button></p></div>`;
}

async function openDiscFile(path) {
  const p = project();
  C.open = 'disc:' + path;
  C.editor = null;
  $$('#cTree .crow.sel').forEach((r) => r.classList.remove('sel'));
  const row = $(`#cTree [data-disc-file="${CSS.escape(path)}"]`);
  if (row) row.classList.add('sel');
  const r = await api(`/api/disc_file?id=${encodeURIComponent(p.id)}&path=${encodeURIComponent(path)}`);
  if (!r.ok) { $('#cPane').innerHTML = `<div class="empty">${esc(r.message)}</div>`; return; }
  const name = path.split('/').pop(), e = ext(name);
  const raw = `/api/disc_file?id=${encodeURIComponent(p.id)}&path=${encodeURIComponent(path)}&raw=1`;
  const preview = name === 'opening.bnr' && p.bnr ? `<div class="cpreview"><img class="pixel-big" src="${image(p, 'disc_banner')}" alt=""></div>`
    : IMAGE_EXT.includes(e) ? `<div class="cpreview"><img src="${raw}" alt=""></div>`
    : AUDIO_EXT.includes(e) ? `<div class="cpreview audio"><audio controls src="${raw}"></audio></div>` : '';
  const what = r.asset ? `An Octave asset: <b>${esc(r.asset.type)}</b> <code>${esc(r.asset.name)}</code> (asset version ${r.asset.version}), as the packager cooked it for the console.`
    : name === 'main.dol' ? 'The program itself, as the GameCube runs it.'
    : name === 'boot.bin' ? 'The disc header: its game ID, name, and where the program and file table are.'
    : name === 'bi2.bin' ? 'The rest of the header: region, memory size.'
    : name === 'apploader.img' ? 'The apploader: what loads the program off the disc.'
    : name === 'opening.bnr' ? 'The banner Swiss and Dolphin show for the disc.' : '';
  $('#cPane').innerHTML = `<div class="casset"><div class="casset-head"><h3>${esc(name)}</h3><span class="spacer"></span>
      <button class="btn small" data-extract="${esc(path)}">Extract…</button></div>
    ${preview}
    <dl class="kv casset-kv"><dt>On the disc</dt><dd><code>${esc(path.replace('&&SystemData/', ''))}</code></dd>
      <dt>Size</dt><dd>${kb(r.size)} (${r.size.toLocaleString()} bytes)</dd>
      <dt>Where</dt><dd>offset 0x${r.offset.toString(16).toUpperCase()}</dd>
      ${r.asset ? `<dt>In Lua</dt><dd><code>LoadAsset("${esc(r.asset.name)}")</code></dd>` : ''}</dl>
    ${what ? `<p class="note">${what}</p>` : ''}</div>`;
}

async function extractFromDisc(path) {
  const r = await api('/api/disc_extract', { id: project().id, path });
  if (r.cancelled) return;
  toast(r.ok ? `Extracted ${r.count} file${r.count > 1 ? 's' : ''} to ${r.folder}` : r.message || 'Not extracted.');
}

function bindContent() {
  $('#cRefresh').onclick = () => refreshContent();
  $('#cMode').addEventListener('click', (e) => {
    const b = e.target.closest('[data-mode]');
    if (!b || C.mode === b.dataset.mode) return;
    if (C.dirty && !confirm(`${C.open} has changes that aren't saved. Leave them?`)) return;
    C.mode = b.dataset.mode;
    C.open = null; C.editor = null; C.dirty = false;
    loadContent(false);
  });
  $('#cTree').addEventListener('click', (e) => {
    const d = e.target.closest('[data-disc-dir]'), f = e.target.closest('[data-disc-file]');
    if (d) { const k = 'disc:' + d.dataset.discDir; C.folds[k] = !C.folds[k]; loadDisc(project()); }
    else if (f) openDiscFile(f.dataset.discFile);
  });
  document.addEventListener('click', (e) => { const x = e.target.closest('[data-extract]'); if (x) extractFromDisc(x.dataset.extract); });
  // right-click: the row's menu, or the panel's
  $('.cfiles').addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (C.mode === 'disc') {
      const row = e.target.closest('[data-disc-dir], [data-disc-file]');
      const path = row ? (row.dataset.discDir || row.dataset.discFile) : '';
      const menu = $('#cMenu'), page = $('#page-content').getBoundingClientRect();
      menu.innerHTML = `<div class="cmenu-item" data-x="1">${row ? (row.dataset.discDir ? 'Extract this folder…' : 'Extract…') : 'Extract everything…'}</div>
        <div class="cmenu-sep"></div><div class="cmenu-item" data-r="1">Refresh</div>`;
      menu.querySelector('[data-x]').onclick = () => { menu.classList.remove('show'); extractFromDisc(path); };
      menu.querySelector('[data-r]').onclick = () => { menu.classList.remove('show'); loadContent(); };
      menu.style.left = `${e.clientX - page.left}px`;
      menu.style.top = `${e.clientY - page.top}px`;
      menu.classList.add('show');
      return;
    }
    const row = e.target.closest('[data-dir], [data-file]');
    contentMenu(e.clientX, e.clientY, row ? { path: row.dataset.dir || row.dataset.file, dir: !!row.dataset.dir } : null);
  });
  document.addEventListener('click', (e) => { if (!e.target.closest('#cMenu')) $('#cMenu').classList.remove('show'); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('#cMenu').classList.remove('show'); });
  // drag a row onto a folder (or the panel: the project's folder) to move it there
  const tree = $('#cTree');
  tree.addEventListener('dragstart', (e) => {
    const row = e.target.closest('[data-dir], [data-file]');
    if (!row) return;
    C.dragging = row.dataset.dir || row.dataset.file;
    e.dataTransfer.setData('text/x-dw-path', C.dragging);
    e.dataTransfer.effectAllowed = 'move';
  });
  tree.addEventListener('dragend', () => { C.dragging = null; $$('.crow.drop-into').forEach((r) => r.classList.remove('drop-into')); });
  tree.addEventListener('dragover', (e) => {
    if (!C.dragging) return;
    e.preventDefault();
    e.stopPropagation();
    $$('.crow.drop-into').forEach((r) => r.classList.remove('drop-into'));
    const row = e.target.closest('[data-dir], [data-file]');
    const dir = row ? (row.dataset.dir || row.dataset.file.split('/').slice(0, -1).join('/')) : '';
    const dirRow = dir && tree.querySelector(`[data-dir="${CSS.escape(dir)}"]`);
    if (dirRow) dirRow.classList.add('drop-into');
  });
  tree.addEventListener('drop', (e) => {
    if (!C.dragging) return;
    e.preventDefault();
    e.stopPropagation();
    $$('.crow.drop-into').forEach((r) => r.classList.remove('drop-into'));
    const row = e.target.closest('[data-dir], [data-file]');
    const dir = row ? (row.dataset.dir || row.dataset.file.split('/').slice(0, -1).join('/')) : '';
    const from = C.dragging;
    C.dragging = null;
    if (dir === from || dir.startsWith(from + '/') || from.split('/').slice(0, -1).join('/') === dir) return;
    moveFile(from, dir);
  });
  // a file changed on disk (another program, a script): the open one reloads by itself, if not edited here
  window.addEventListener('focus', () => { if ($('#page-content').classList.contains('active') && C.open) refreshContent(true); });

  $('#cTree').addEventListener('click', (e) => {
    const d = e.target.closest('[data-dir]'), f = e.target.closest('[data-file]');
    if (d) { C.folds[d.dataset.dir] = !(C.folds[d.dataset.dir] !== false); C.dropFolder = rawFolderOf(d.dataset.dir + '/'); renderTree(); }
    else if (f) { C.dropFolder = rawFolderOf(f.dataset.file); openFile(f.dataset.file); }
  });
  $('#cPane').addEventListener('click', (e) => { const l = e.target.closest('[data-file-link]'); if (l) openFile(l.dataset.fileLink); });
  $('#cConvert').onclick = async () => {
    const p = project();
    if (!p || !p.octp) return;
    const r = await api('/api/convert', { id: p.id });
    if (!r.ok) toast(r.busy ? `Busy: ${r.busy}` : 'That did not start.');
  };
  $('#cNewScript').onclick = async () => {
    const p = project();
    if (!p || !p.octp) return;
    const name = prompt('A new Lua script (a node script: Create and Tick). Its name:', 'Player');
    if (!name) return;
    const r = await api('/api/new_script', { id: p.id, name: name.trim() });
    if (!r.ok) return toast(r.message);
    C.folds['Scripts'] = true;
    await loadContent();
    openFile(r.path);
  };
  const chooser = Object.assign(document.createElement('input'), { type: 'file', multiple: true, hidden: true });
  document.body.append(chooser);
  $('#cAddFiles').onclick = () => chooser.click();
  chooser.onchange = () => { addFiles([...chooser.files], C.dropFolder); chooser.value = ''; };
  // drop anywhere on the page
  const page = $('#page-content'), drop = $('#cDrop');
  let depth = 0;
  page.addEventListener('dragenter', (e) => { if (!C.dragging && e.dataTransfer.types.includes('Files')) { depth++; $('#cDropWhere').textContent = 'Raw/' + (C.dropFolder ? C.dropFolder + '/' : ''); drop.classList.add('show'); } });
  page.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; drop.classList.remove('show'); } });
  page.addEventListener('dragover', (e) => e.preventDefault());
  page.addEventListener('drop', (e) => { e.preventDefault(); depth = 0; drop.classList.remove('show'); addFiles([...e.dataTransfer.files], C.dropFolder); });
  window.addEventListener('beforeunload', (e) => { if (C.dirty) { e.preventDefault(); e.returnValue = ''; } });
}

// --- new project ----------------------------------------------------------------------------------
// A game made in code, from Octave's Template (Lua or C++), in one of the project folders (or one chosen).

function bindNewProject() {
  const dialog = $('#newDialog');
  const fillWhere = (extra) => {
    const roots = (state.project_roots || []).map((r) => r.path);
    if (extra && !roots.includes(extra)) roots.unshift(extra);
    $('#newWhere').innerHTML = roots.map((r) => `<option value="${esc(r)}" ${r === extra ? 'selected' : ''}>${esc(r)}</option>`).join('');
  };
  $('#newProject').onclick = () => {
    $('#newError').textContent = '';
    $('#newName').value = '';
    fillWhere();
    dialog.showModal();
    $('#newName').focus();
  };
  $('#newCancel').onclick = () => dialog.close();
  $('#newBrowse').onclick = async () => {
    const r = await api('/api/pick_folder', { title: 'Where to make the new project' });
    if (r.ok) fillWhere(r.path);
  };
  $('#newForm').onsubmit = async (e) => {
    e.preventDefault();
    const name = $('#newName').value.trim();
    const kind = document.querySelector('input[name="newKind"]:checked').value;
    $('#newCreate').disabled = true;
    const r = await api('/api/new_project', { name, kind, where: $('#newWhere').value });
    $('#newCreate').disabled = false;
    if (!r.ok) { $('#newError').textContent = r.message || 'That did not work.'; return; }
    dialog.close();
    await refresh();
    const made = state.projects.find((p) => (p.octp || '').toLowerCase() === r.octp.toLowerCase());
    if (made) { selected = made.id; render(); }
    $('.nav[data-page="projects"]').click();
    toast(`${name} made: Build it, then Run in Dolphin.`);
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
    if (b.dataset.page === 'engine') loadEngine();
    if (b.dataset.page === 'content') loadContent();
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
  // Settings: which code editor Open in IDE opens
  $('#settingsCard').addEventListener('change', async (e) => {
    if (e.target.id !== 'ideSelect') return;
    state.ide = e.target.value;
    await api('/api/settings', { ide: state.ide });
    toast(state.ide === 'auto' ? 'Code editor: automatic' : `Code editor: ${state.ide}`);
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
  bindNewProject();
  bindContent();
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
