const state = {
  files: [],
  running: false,
  outputFolder: '',
  format: 'mp4',
  formatLabel: 'MP4',
  mode: 'copy',
  acceleration: 'auto',
  quality: 'balanced'
};

const $ = s => document.querySelector(s);
const VIDEO_FORMATS = [
  ['mp4', 'MP4'], ['hevc', 'H.265'], ['av1', 'AV1'], ['mkv', 'MKV'],
  ['mov', 'MOV'], ['webm', 'WebM'], ['avi', 'AVI'], ['flv', 'FLV'],
  ['mpegts', 'MPEG-TS'], ['m4v', 'M4V'], ['wmv', 'WMV'], ['3gp', '3GP'],
  ['mpg', 'MPEG'], ['ogv', 'OGV'], ['prores', 'ProRes'], ['gif', 'GIF']
];
const AUDIO_FORMATS = [
  ['mp3', 'MP3'], ['aac', 'AAC'], ['m4a', 'M4A'], ['wav', 'WAV'],
  ['flac', 'FLAC'], ['ogg', 'OGG'], ['opus', 'Opus']
];
const ENCODERS = [
  ['auto', 'Auto'], ['nvenc', 'NVIDIA NVENC'], ['qsv', 'Intel QSV'],
  ['amf', 'AMD AMF'], ['cpu', 'CPU']
];
const QUALITIES = [['fast', 'Fast'], ['balanced', 'Balanced'], ['quality', 'Quality']];
const QUALITY_NOTES = {
  fast: 'Lowest latency, larger files.',
  balanced: 'Balanced speed and compression.',
  quality: 'Best fidelity, slower encode.'
};
const OUTPUT_EXT = { mpegts: 'ts', hevc: 'mp4', h265: 'mp4', av1: 'mp4', prores: 'mov', aac: 'm4a' };
const TERMINAL = ['Done', 'Error', 'Cancelled'];
const RING_LEN = 97.4;

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0, n = bytes;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i ? 1 : 0)} ${u[i]}`;
}

function uuid() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function outputExt(format) {
  return OUTPUT_EXT[format] || format;
}

async function resolvePath(file) {
  try {
    const p = await window.fastConvert.pathForFile(file);
    if (p) return p;
  } catch {}
  return file.path;
}

function makeChips(container, pairs, key, onPick) {
  pairs.forEach(([value, label]) => {
    const b = document.createElement('button');
    b.className = 'chip';
    b.dataset.v = value;
    b.textContent = label;
    if (state[key] === value) b.classList.add('active');
    b.onclick = () => {
      state[key] = value;
      container.querySelectorAll('.chip').forEach(c => c.classList.toggle('active', c === b));
      if (onPick) onPick(value, label);
    };
    container.appendChild(b);
  });
}

const formatRail = $('#formatRail');
makeChips(formatRail, VIDEO_FORMATS, 'format');
{
  const div = document.createElement('div');
  div.style.cssText = 'width:1px;align-self:stretch;background:var(--line);margin:2px 6px';
  formatRail.appendChild(div);
}
makeChips(formatRail, AUDIO_FORMATS, 'format', (v, label) => {
  state.formatLabel = label;
  $('#formatPreview').textContent = label.toUpperCase();
});
makeChips($('#encoderRail'), ENCODERS, 'acceleration');
makeChips($('#qualityRail'), QUALITIES, 'quality', v => {
  $('#qualityNote').textContent = QUALITY_NOTES[v];
});

document.querySelectorAll('.opt').forEach(opt => {
  opt.onclick = () => {
    state.mode = opt.dataset.mode;
    document.querySelectorAll('.opt').forEach(o => o.classList.toggle('active', o === opt));
  };
});

function render() {
  const has = state.files.length > 0;
  $('#queue').classList.toggle('hidden', !has);
  $('#countLabel').textContent = `${state.files.length} file${state.files.length === 1 ? '' : 's'}`;
  $('#fileList').innerHTML = state.files.map(f => `
    <div class="file" id="row-${f.id}">
      <div class="ext-badge">${esc(extOf(f.name))}</div>
      <div class="finfo">
        <div class="fname" title="${esc(f.name)}">${esc(f.name)}</div>
        <div class="fmeta">${formatBytes(f.size)}</div>
      </div>
      <div class="fbar" id="barwrap-${f.id}"><i id="bar-${f.id}"></i></div>
      <div class="fstats"><div id="speed-${f.id}"></div><div class="eta" id="eta-${f.id}"></div></div>
      <div class="status-pill" id="state-${f.id}">Waiting</div>
    </div>`).join('');
  updateDockButtons();
}

function extOf(name) {
  const e = name.split('.').pop() || '?';
  return e.slice(0, 4);
}

async function addFiles(paths) {
  let added = false;
  for (const p of paths) {
    if (!p || state.files.some(x => x.path === p)) continue;
    const name = p.split(/[\\/]/).pop();
    let size = 0;
    try { size = (await window.fastConvert.statFile(p)).size || 0; } catch {}
    state.files.push({ id: uuid(), path: p, name, size });
    added = true;
  }
  if (added) render();
  else render();
}

function setPill(id, text, cls) {
  const el = $(`#state-${id}`);
  if (!el) return;
  el.textContent = text;
  el.className = `status-pill${cls ? ' ' + cls : ''}`;
}

function updateDockButtons() {
  $('#startBtn').disabled = state.running || !state.files.length;
  $('#clearBtn').disabled = state.running;
}

function setRing(pct) {
  $('#ringFill').style.strokeDashoffset = (RING_LEN * (1 - pct / 100)).toFixed(2);
}

function overallForCurrent(d) {
  const done = state.files.filter(f => TERMINAL.includes(f.status)).length;
  return Math.min(100, Math.round(((done + d.percent / 100) / Math.max(1, state.files.length)) * 100));
}

async function browse() {
  addFiles(await window.fastConvert.chooseFiles());
}

async function pickFolder() {
  const p = await window.fastConvert.chooseOutputFolder();
  if (p) {
    state.outputFolder = p;
    $('#outputFolder').value = p;
  }
}

$('#addBtn').onclick = browse;
$('#dropZone').onclick = browse;
$('#folderBtn').onclick = pickFolder;
$('#destBrowse').onclick = pickFolder;

$('#clearBtn').onclick = () => {
  if (!state.running) {
    state.files = [];
    render();
  }
};

document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') {
    e.preventDefault();
    browse();
  }
});

let dragDepth = 0;
const dz = $('#dropZone');
window.addEventListener('dragenter', e => { e.preventDefault(); dragDepth++; dz.classList.add('drag'); });
window.addEventListener('dragover', e => e.preventDefault());
window.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) dz.classList.remove('drag');
});
window.addEventListener('drop', async e => {
  e.preventDefault();
  dragDepth = 0;
  dz.classList.remove('drag');
  const files = [...e.dataTransfer.files];
  const paths = [];
  for (const f of files) paths.push(await resolvePath(f));
  addFiles(paths.filter(Boolean));
});

$('#startBtn').onclick = async () => {
  if (state.running || !state.files.length) return;
  state.running = true;
  updateDockButtons();

  const folder = (
    state.outputFolder ||
    state.files[0].path.split(/[\\/]/).slice(0, -1).join('/') ||
    '.'
  ).replace(/[\\/]$/, '');

  const jobs = state.files.map(f => {
    const base = f.name.replace(/\.[^.]+$/, '');
    f.status = 'Queued';
    setPill(f.id, 'Queued', '');
    return {
      id: f.id,
      input: f.path,
      output: `${folder}/${base}.${outputExt(state.format)}`,
      format: state.format,
      mode: state.mode,
      quality: state.quality,
      acceleration: state.acceleration
    };
  });

  setRing(0);
  $('#overall').textContent = 'Starting…';
  $('#overallSub').textContent = `${jobs.length} job${jobs.length === 1 ? '' : 's'} · ${state.formatLabel}${state.mode === 'copy' ? ' · remux' : ''}`;
  await window.fastConvert.startJobs(jobs);
};

function finishRun(title) {
  state.running = false;
  updateDockButtons();
  $('#overall').textContent = title;
}

function checkAllFinished(title, sub) {
  if (state.files.length && state.files.every(f => TERMINAL.includes(f.status))) {
    finishRun(title);
    $('#overallSub').textContent = sub;
    setRing(100);
  }
}

function historyAdd(kind, text) {
  $('#historyWrap').classList.remove('hidden');
  const h = document.createElement('div');
  h.className = `hitem ${kind}`;
  h.textContent = text;
  const hist = $('#history');
  hist.prepend(h);
  while (hist.children.length > 30) hist.lastChild.remove();
}

window.fastConvert.onProgress(d => {
  const row = state.files.find(f => f.id === d.id);
  if (!row) return;
  row.status = `${d.percent.toFixed(0)}%`;
  const bar = $(`#bar-${d.id}`);
  const wrap = $(`#barwrap-${d.id}`);
  if (wrap) wrap.classList.add('converting');
  if (bar) bar.style.width = `${d.percent}%`;
  const sp = $(`#speed-${d.id}`);
  const eta = $(`#eta-${d.id}`);
  if (sp) sp.textContent = d.speed || '';
  if (eta) eta.textContent = d.eta ? `ETA ${d.eta}` : '';
  setPill(d.id, `${d.percent.toFixed(0)}%`, 'run');

  const pct = overallForCurrent(d);
  setRing(pct);
  $('#overall').textContent = `${pct}% overall`;
  const parts = [row.name];
  if (d.speed) parts.push(d.speed);
  if (d.eta) parts.push(`ETA ${d.eta}`);
  $('#overallSub').textContent = parts.join(' · ');
});

window.fastConvert.onDone(d => {
  const row = state.files.find(f => f.id === d.id);
  if (!row) return;
  row.status = 'Done';
  const bar = $(`#bar-${d.id}`);
  const wrap = $(`#barwrap-${d.id}`);
  const sp = $(`#speed-${d.id}`);
  const eta = $(`#eta-${d.id}`);
  if (bar) bar.style.width = '100%';
  if (wrap) wrap.classList.remove('converting');
  if (sp) sp.textContent = '';
  if (eta) eta.textContent = '';
  setPill(d.id, 'Done', 'done');
  historyAdd('ok', `${row.name} -> ${d.output}`);
  checkAllFinished('Finished', 'All conversions completed.');
});

window.fastConvert.onError(d => {
  const row = state.files.find(f => f.id === d.id);
  if (!row) return;
  row.status = 'Error';
  const wrap = $(`#barwrap-${d.id}`);
  if (wrap) wrap.classList.remove('converting');
  setPill(d.id, 'Error', 'err');
  historyAdd('err', `${row.name}: ${d.error}`);
  checkAllFinished('Finished with errors', 'Some files failed. See recent activity.');
});

window.fastConvert.onCancelled(d => {
  const row = state.files.find(f => f.id === d.id);
  if (!row) return;
  row.status = 'Cancelled';
  const wrap = $(`#barwrap-${d.id}`);
  if (wrap) wrap.classList.remove('converting');
  setPill(d.id, 'Cancelled', '');
  checkAllFinished('Stopped', 'Conversions cancelled.');
});

const io = new IntersectionObserver(entries => {
  entries.forEach(en => {
    if (en.isIntersecting) {
      en.target.classList.add('in');
      io.unobserve(en.target);
    }
  });
}, { threshold: 0.1 });
document.querySelectorAll('.reveal').forEach(el => io.observe(el));

window.fastConvert.systemInfo().then(info => {
  $('#machine').textContent = `${info.cpu} · ${info.cores} threads`;
  const chip = $('#engineChip');
  const label = $('#engineStatus');
  if (info.found === false) {
    chip.classList.add('bad');
    label.textContent = 'FFmpeg not found in bin/';
  } else {
    label.textContent = 'FFmpeg ready';
  }
}).catch(() => {});

render();
