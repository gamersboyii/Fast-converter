# FastConvert

A fast, fully local Windows media converter. Drop in any video or audio file, pick a format, convert. Electron provides the interface; FFmpeg does the heavy lifting as native child processes — so speed is limited only by your CPU, GPU and storage.

**Made by Jeet — free for everyone, forever, no limits.**

---

## Why FastConvert

| | FastConvert | Typical online converters |
|---|---|---|
| File size limits | None | 100 MB–2 GB |
| Privacy | 100% local, nothing uploaded | Uploaded to a server |
| Speed | Native FFmpeg + GPU encoding | Server queue |
| Batch conversion | Unlimited files | Usually paid-only |

## Features

- **Drag & drop anywhere** in the window, or `Ctrl+O` to browse
- **Multi-file queue** with per-file live progress, encoding speed and ETA timer
- **Fast copy / remux mode** — stream-copies tracks into a new container with no re-encode; near-instant when codecs are compatible (e.g. MKV → MP4)
- **Hardware acceleration** — auto-detects NVIDIA NVENC, Intel Quick Sync and AMD AMF; falls back to optimized CPU encoders
- **Large-file friendly** — streams from disk, never loads media into RAM
- **Fully local** — no accounts, no telemetry, no uploads

### Format support

Any input FFmpeg accepts can be converted. Output targets:

| Category | Formats |
|---|---|
| Video containers | MP4, MKV, MOV, WebM, AVI, FLV, MPEG-TS, M4V, WMV, 3GP, MPEG, OGV, ProRes (MOV), GIF |
| Video codecs | H.264, H.265/HEVC, AV1, VP9, Theora, ProRes, WMV2 |
| Audio | MP3, AAC, M4A, WAV, FLAC, OGG (Opus), Opus |

## How it works

```
+----------------+        +------------------+       +----------------+
|  index.html    |        |   preload.js     |       |    main.js     |
|  renderer.js   | <----> |  contextBridge   | <---> |  Electron main |
|  styles.css    |  IPC   |  window.fast-    |  IPC  |  spawns FFmpeg |
+----------------+        |  Convert API     |       +-------+--------+
                          +------------------+              |
                                                       ffmpeg / ffprobe
                                                       child processes
```

1. Files are added via dialog or drag & drop (`webUtils.getPathForFile` resolves dropped paths).
2. On Convert, each file becomes a job: `{id, input, output, format, mode, quality, acceleration}`.
3. The main process probes the file with `ffprobe`, detects available hardware encoders once, then spawns `ffmpeg` with `-progress pipe:1`.
4. Progress, speed and ETA are parsed every 0.5 s and pushed back to the renderer by job id.
5. Jobs run concurrently; each row updates independently. Cancel kills the child process immediately.

## Getting started

Requirements: **Windows 10/11**, **Node.js 20+**. No other dependencies — everything is vanilla HTML/CSS/JS.

```bash
git clone <your-repo-url>
cd FastConvert-source-v1.1
npm install
npm start
```

FFmpeg binaries are required for actual conversion:

- **Development**: place `ffmpeg.exe` + `ffprobe.exe` in `bin/`, or set `FFMPEG_BIN` / `FFPROBE_BIN` environment variables.
- Or run `./BUILD-WINDOWS.ps1 -SlimFfmpeg` once to download them automatically.

## Building an installer

```powershell
Set-ExecutionPolicy -Scope Process Bypass

# Downloads slim FFmpeg essentials into bin/, audits sizes, packages NSIS + portable:
./BUILD-WINDOWS.ps1 -SlimFfmpeg

# Optional extra squeeze (~40% smaller exes; may trigger AV heuristics):
./BUILD-WINDOWS.ps1 -CompressBinaries
```

Output lands in `dist/`: `FastConvert-<version>.exe` (installer) and `FastConvert-<version>-portable.exe`.

### Keeping the build small

A 1 GB+ installer almost always means a fat FFmpeg build or stray files in `bin/`. The build script audits this automatically:

| Cause | Typical size | Fix |
|---|---|---|
| "Full" FFmpeg build with every codec/library | 400–900 MB | Use `-SlimFfmpeg` (essentials build) |
| Extra DLLs, docs, `ffplay.exe` in `bin/` | 100–300 MB | Keep only `ffmpeg.exe` + `ffprobe.exe` |
| Electron runtime | ~100 MB compressed | Unavoidable baseline |

Expected result: **180–260 MB installer/portable**.

Slim sources if you prefer manual setup:
- [gyan.dev](https://www.gyan.dev/ffmpeg/builds/) — *release essentials* (recommended)
- [BtbN FFmpeg Builds](https://github.com/BtbN/FFmpeg-Builds/releases) — `win64-gpl` static

Note on licensing: check your chosen FFmpeg build's license (GPL/LGPL) before redistributing. FastConvert itself is MIT.

## Performance tips

- Container changes (MKV → MP4, MOV → MP4...) with compatible streams: keep **Fast copy / remux**. It is near-instant.
- Codec changes: leave the encoder on **Auto** — the app prefers NVIDIA → Intel → AMD → CPU.
- **Quality: Fast** uses speed-tuned CRF/presets; **Quality** maximizes fidelity at slower speeds.
- ETA is computed from FFmpeg's reported `speed` against remaining duration.

## Project structure

```
FastConvert-source-v1.1/
├── src/
│   ├── main.js          Electron main process: window, jobs, progress parsing
│   ├── preload.js       Secure context bridge (window.fastConvert API)
│   ├── renderer.js      All UI logic and state
│   ├── index.html       Single-page markup, inline SVG icons
│   ├── styles.css       Design system: dark cinematic theme, bento grid, dock
│   └── fonts/           Self-hosted Geist + Geist Mono variable woff2
├── bin/                 ffmpeg.exe + ffprobe.exe (not committed)
├── BUILD-WINDOWS.ps1    Build pipeline with binary size audit
└── package.json         Electron config + electron-builder settings
```

Security model: `contextIsolation` and `sandbox` are enabled; the page has zero Node access and communicates exclusively through the small preload bridge.

## License

MIT. Media conversion is performed by FFmpeg, which is separately licensed — see the note above.
