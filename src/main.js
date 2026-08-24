const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn, execFile } = require('child_process');

app.commandLine.appendSwitch('disable-http-cache');

let mainWindow;
const jobs = new Map();

function findBinary(name) {
  const ext = process.platform === 'win32' ? '.exe' : '';
  const candidates = [];
  if (process.env[`${name.toUpperCase()}_BIN`]) candidates.push(process.env[`${name.toUpperCase()}_BIN`]);
  candidates.push(path.join(process.resourcesPath || '', 'bin', `${name}${ext}`));
  candidates.push(path.join(__dirname, '..', 'bin', `${name}${ext}`));
  candidates.push(`${name}${ext}`);
  for (const candidate of candidates) {
    try {
      if (candidate.includes(path.sep) && fs.existsSync(candidate)) return candidate;
    } catch {}
  }
  return `${name}${ext}`;
}

const ffmpeg = findBinary('ffmpeg');
const ffprobe = findBinary('ffprobe');

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 880,
    minWidth: 1020,
    minHeight: 700,
    backgroundColor: '#07080b',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true
    }
  });
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
}

function run(binary, args) {
  return new Promise((resolve, reject) => {
    execFile(binary, args, { windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) reject(new Error(stderr || stdout || error.message));
      else resolve({ stdout, stderr });
    });
  });
}

async function probe(file) {
  const { stdout } = await run(ffprobe, [
    '-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file
  ]);
  return JSON.parse(stdout);
}

async function encoderInfo() {
  try {
    const { stdout } = await run(ffmpeg, ['-hide_banner', '-encoders']);
    return {
      nvenc: /h264_nvenc/.test(stdout) || /hevc_nvenc/.test(stdout),
      hevc_nvenc: /hevc_nvenc/.test(stdout),
      qsv: /h264_qsv/.test(stdout) || /hevc_qsv/.test(stdout),
      hevc_qsv: /hevc_qsv/.test(stdout),
      amf: /h264_amf/.test(stdout) || /hevc_amf/.test(stdout),
      hevc_amf: /hevc_amf/.test(stdout),
      av1_nvenc: /av1_nvenc/.test(stdout),
      libx265: /libx265/.test(stdout),
      libaom: /libaom-av1/.test(stdout) || /libsvtav1/.test(stdout),
      libsvtav1: /libsvtav1/.test(stdout)
    };
  } catch {
    return {
      nvenc: false, hevc_nvenc: false, qsv: false, hevc_qsv: false,
      amf: false, hevc_amf: false, av1_nvenc: false,
      libx265: false, libaom: false, libsvtav1: false
    };
  }
}

const AUDIO_ONLY = new Set(['mp3', 'aac', 'm4a', 'wav', 'flac', 'ogg', 'opus']);

function isAudioOnly(format) {
  return AUDIO_ONLY.has(format);
}

function chooseVideoEncoder(format, acceleration, enc) {
  // Special containers / codecs
  if (format === 'gif') return 'gif';
  if (format === 'webm') {
    if (acceleration === 'nvenc' && enc.av1_nvenc) return 'av1_nvenc';
    return 'libvpx-vp9';
  }
  if (format === 'ogv') return 'libtheora';
  if (format === 'av1') {
    if (acceleration === 'nvenc' && enc.av1_nvenc) return 'av1_nvenc';
    if (enc.libsvtav1) return 'libsvtav1';
    if (enc.libaom) return 'libaom-av1';
    return 'libsvtav1';
  }
  if (format === 'hevc' || format === 'h265') {
    if (acceleration === 'cpu') return enc.libx265 ? 'libx265' : 'libx264';
    if (acceleration === 'nvenc' && enc.hevc_nvenc) return 'hevc_nvenc';
    if (acceleration === 'qsv' && enc.hevc_qsv) return 'hevc_qsv';
    if (acceleration === 'amf' && enc.hevc_amf) return 'hevc_amf';
    if (enc.hevc_nvenc) return 'hevc_nvenc';
    if (enc.hevc_qsv) return 'hevc_qsv';
    if (enc.hevc_amf) return 'hevc_amf';
    return enc.libx265 ? 'libx265' : 'libx264';
  }
  if (format === 'prores') return 'prores_ks';
  if (format === 'wmv') return 'wmv2';

  // Standard H.264 path
  if (acceleration === 'cpu') return 'libx264';
  if (acceleration === 'nvenc' && enc.nvenc) return 'h264_nvenc';
  if (acceleration === 'qsv' && enc.qsv) return 'h264_qsv';
  if (acceleration === 'amf' && enc.amf) return 'h264_amf';
  if (enc.nvenc) return 'h264_nvenc';
  if (enc.qsv) return 'h264_qsv';
  if (enc.amf) return 'h264_amf';
  return 'libx264';
}

function outputExt(format) {
  const map = {
    mpegts: 'ts',
    hevc: 'mp4',
    h265: 'mp4',
    av1: 'mp4',
    prores: 'mov',
    aac: 'm4a'
  };
  return map[format] || format;
}

function audioArgs(format) {
  if (format === 'gif') return ['-an'];
  if (format === 'webm' || format === 'ogg' || format === 'opus') {
    return ['-c:a', 'libopus', '-b:a', '128k'];
  }
  if (format === 'avi' || format === 'mp3') {
    return ['-c:a', 'libmp3lame', '-b:a', '192k'];
  }
  if (format === 'wav') return ['-c:a', 'pcm_s16le'];
  if (format === 'flac') return ['-c:a', 'flac'];
  if (format === 'aac' || format === 'm4a') return ['-c:a', 'aac', '-b:a', '192k'];
  if (format === 'wmv') return ['-c:a', 'wmav2', '-b:a', '192k'];
  // Default for most video containers
  return ['-c:a', 'aac', '-b:a', '192k'];
}

function videoArgs(format, quality, acceleration, enc) {
  if (format === 'gif') {
    return ['-vf', 'fps=15,scale=1280:-1:flags=lanczos', '-c:v', 'gif', '-loop', '0'];
  }

  const codec = chooseVideoEncoder(format, acceleration, enc);

  // Hardware H.264 / HEVC
  if (['h264_nvenc', 'hevc_nvenc', 'h264_qsv', 'hevc_qsv', 'h264_amf', 'hevc_amf'].includes(codec)) {
    const presets = { fast: 'p1', balanced: 'p4', quality: 'p6' };
    const cq = quality === 'fast' ? '28' : quality === 'quality' ? '20' : '23';
    return ['-c:v', codec, '-preset', presets[quality] || 'p4', '-cq', cq, '-pix_fmt', 'yuv420p'];
  }

  // AV1 hardware / software
  if (codec === 'av1_nvenc') {
    return ['-c:v', 'av1_nvenc', '-cq', quality === 'fast' ? '35' : quality === 'quality' ? '25' : '30', '-pix_fmt', 'yuv420p'];
  }
  if (codec === 'libsvtav1') {
    return ['-c:v', 'libsvtav1', '-crf', quality === 'fast' ? '40' : quality === 'quality' ? '28' : '34', '-preset', quality === 'fast' ? '8' : '6'];
  }
  if (codec === 'libaom-av1') {
    return ['-c:v', 'libaom-av1', '-crf', quality === 'fast' ? '40' : quality === 'quality' ? '28' : '34', '-cpu-used', quality === 'fast' ? '8' : '4'];
  }

  // VP9
  if (codec === 'libvpx-vp9') {
    return ['-c:v', codec, '-deadline', quality === 'fast' ? 'realtime' : 'good', '-cpu-used', quality === 'fast' ? '6' : '2', '-crf', quality === 'quality' ? '30' : '34', '-b:v', '0'];
  }

  // Theora
  if (codec === 'libtheora') {
    return ['-c:v', codec, '-q:v', quality === 'quality' ? '7' : quality === 'balanced' ? '5' : '3'];
  }

  // ProRes
  if (codec === 'prores_ks') {
    return ['-c:v', 'prores_ks', '-profile:v', quality === 'quality' ? '3' : '2', '-pix_fmt', 'yuv422p10le'];
  }

  // WMV
  if (codec === 'wmv2') {
    return ['-c:v', 'wmv2', '-b:v', quality === 'fast' ? '2M' : quality === 'quality' ? '6M' : '4M'];
  }

  // x265
  if (codec === 'libx265') {
    return ['-c:v', 'libx265', '-preset', quality === 'fast' ? 'ultrafast' : quality === 'quality' ? 'medium' : 'veryfast', '-crf', quality === 'quality' ? '22' : quality === 'balanced' ? '26' : '30', '-pix_fmt', 'yuv420p'];
  }

  // Default x264
  return ['-c:v', 'libx264', '-preset', quality === 'fast' ? 'ultrafast' : quality === 'quality' ? 'medium' : 'veryfast', '-crf', quality === 'quality' ? '20' : quality === 'balanced' ? '23' : '28', '-pix_fmt', 'yuv420p'];
}

function buildArgs(job, info, enc) {
  const args = ['-hide_banner', '-y', '-nostdin', '-loglevel', 'warning', '-i', job.input];

  if (isAudioOnly(job.format)) {
    // Audio extraction / conversion
    args.push('-vn', '-map', '0:a:0?');
    if (job.mode === 'copy' && ['aac', 'm4a', 'mp3'].includes(job.format)) {
      // Limited copy support for audio
      args.push('-c:a', 'copy');
    } else {
      args.push(...audioArgs(job.format));
    }
  } else if (job.mode === 'copy') {
    args.push('-map', '0:v:0?', '-map', '0:a:0?', '-c', 'copy');
    if (['mp4', 'm4v', 'mov', 'hevc', 'h265', 'av1'].includes(job.format)) {
      args.push('-movflags', '+faststart');
    }
  } else {
    args.push('-map', '0:v:0?', '-map', '0:a:0?');
    args.push(...videoArgs(job.format, job.quality, job.acceleration, enc));
    args.push(...audioArgs(job.format));
    if (['mp4', 'm4v', 'mov', 'hevc', 'h265', 'av1'].includes(job.format)) {
      args.push('-movflags', '+faststart');
    }
  }

  args.push('-progress', 'pipe:1', '-stats_period', '0.5', job.output);
  return args;
}

function safeName(file, format) {
  const base = path.basename(file, path.extname(file)).replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
  return `${base}.${outputExt(format)}`;
}

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

function parseProgress(lines) {
  const data = {};
  for (const line of lines) {
    const idx = line.indexOf('=');
    if (idx > 0) data[line.slice(0, idx)] = line.slice(idx + 1);
  }
  return data;
}

function parseSpeed(speedStr) {
  if (!speedStr) return 0;
  const m = String(speedStr).match(/([\d.]+)/);
  return m ? Number(m[1]) : 0;
}

function formatEta(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '';
  if (seconds < 60) return `${Math.ceil(seconds)}s`;
  if (seconds < 3600) {
    const m = Math.floor(seconds / 60);
    const s = Math.ceil(seconds % 60);
    return `${m}m ${s}s`;
  }
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

async function startJob(job) {
  const token = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  jobs.set(job.id, { process: null, cancelled: false });
  let info;
  try {
    info = await probe(job.input);
  } catch (e) {
    send('job-error', { id: job.id, error: `Could not read the media: ${e.message}` });
    return;
  }
  const duration = Number(info?.format?.duration || 0);
  const enc = await encoderInfo();
  const args = buildArgs(job, info, enc);
  const proc = spawn(ffmpeg, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const state = jobs.get(job.id);
  if (!state) {
    proc.kill();
    return;
  }
  state.process = proc;
  state.token = token;

  let stdoutBuf = '';
  let stderrBuf = '';
  proc.stdout.on('data', chunk => {
    stdoutBuf += chunk.toString();
    const chunks = stdoutBuf.split('\n');
    stdoutBuf = chunks.pop() || '';
    const p = parseProgress(chunks);
    if (p.out_time_ms) {
      const time = Number(p.out_time_ms) / 1e6;
      const percent = duration ? Math.min(100, (time / duration) * 100) : 0;
      const speed = parseSpeed(p.speed);
      let eta = '';
      if (duration > 0 && speed > 0) {
        const remaining = (duration - time) / speed;
        eta = formatEta(remaining);
      }
      send('job-progress', {
        id: job.id,
        percent,
        speed: p.speed || '',
        time,
        duration,
        size: p.total_size || '',
        eta
      });
    }
  });
  proc.stderr.on('data', chunk => {
    stderrBuf += chunk.toString();
    if (stderrBuf.length > 12000) stderrBuf = stderrBuf.slice(-12000);
  });
  proc.on('error', err => {
    jobs.delete(job.id);
    send('job-error', { id: job.id, error: err.message });
  });
  proc.on('close', code => {
    const current = jobs.get(job.id);
    jobs.delete(job.id);
    if (current?.cancelled) {
      send('job-cancelled', { id: job.id });
      return;
    }
    if (code === 0) send('job-done', { id: job.id, output: job.output });
    else send('job-error', { id: job.id, error: `FFmpeg exited with code ${code}. ${stderrBuf.trim()}` });
  });
}

ipcMain.handle('choose-files', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select media files',
    properties: ['openFile', 'multiSelections'],
    filters: [
      {
        name: 'Media files',
        extensions: [
          'mp4', 'mkv', 'mov', 'avi', 'webm', 'flv', 'ts', 'm4v', 'mpeg', 'mpg',
          '3gp', 'wmv', 'mts', 'm2ts', 'ogv', 'gif', 'mxf', 'vob', 'asf',
          'mp3', 'aac', 'm4a', 'wav', 'flac', 'ogg', 'opus', 'wma'
        ]
      }
    ]
  });
  return result.canceled ? [] : result.filePaths;
});

ipcMain.handle('choose-output-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose output folder',
    properties: ['openDirectory', 'createDirectory']
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('start-jobs', async (_event, jobsToStart) => {
  for (const job of jobsToStart) startJob(job);
  return true;
});

ipcMain.handle('cancel-job', async (_event, id) => {
  const state = jobs.get(id);
  if (state?.process) {
    state.cancelled = true;
    state.process.kill('SIGKILL');
  }
  return true;
});

ipcMain.handle('open-file', async (_event, file) => shell.openPath(file));
ipcMain.handle('show-in-folder', async (_event, file) => shell.showItemInFolder(file));
ipcMain.handle('stat-file', async (_event, file) => {
  try {
    const st = fs.statSync(file);
    return { size: st.size };
  } catch {
    return { size: 0 };
  }
});
ipcMain.handle('system-info', async () => ({
  cpu: os.cpus()[0]?.model || 'Unknown CPU',
  cores: os.cpus().length,
  ffmpeg,
  found: fs.existsSync(ffmpeg)
}));

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
