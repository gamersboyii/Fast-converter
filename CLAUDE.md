# CLAUDE.md

Guidance for AI coding agents working on this repository.

## What this is

FastConvert is a Windows desktop media converter. Electron renders the UI; FFmpeg does all media work as external child processes. Fully local, nothing is uploaded. MIT licensed.

- **Stack**: Vanilla JavaScript, HTML and CSS. No React, no Tailwind, no bundler, no renderer runtime dependencies.
- **Node target**: Node.js 20+. **Electron**: 37.x.
- **Fonts**: Self-hosted Geist and Geist Mono variable woff2 in `src/fonts/` (~113 KB total). The app must stay fully offline-capable; never add CDN or network asset references.

## Commands

```bash
npm install        # installs electron + electron-builder only
npm start          # run the app (requires node_modules)
npm run dev        # run with console logging
npm run dist       # package NSIS installer + portable exe into dist/
./BUILD-WINDOWS.ps1 -SlimFfmpeg      # download slim FFmpeg, audit bin/, package
./BUILD-WINDOWS.ps1 -CompressBinaries # additionally UPX-compress the exes
```

There is no lint or test setup. Verify changes with `node --check src/<file>.js` for syntax and by running `npm start`.

## File map

| File | Role |
|---|---|
| `src/main.js` | Main process: window, FFmpeg binary discovery, job spawning, progress parsing, IPC handlers |
| `src/preload.js` | Context bridge exposing the `window.fastConvert` API |
| `src/renderer.js` | All UI logic and state. Single global `state` object |
| `src/index.html` | Single-page markup, inline SVG icons only |
| `src/styles.css` | Complete design system (dark cinematic theme, glass surfaces, bento grid, dock) |
| `bin/` | Must contain ONLY `ffmpeg.exe`, `ffprobe.exe`, `README.txt` at packaging time |
| `BUILD-WINDOWS.ps1` | Build pipeline with binary size audit |
| `dist/` | Build output (gitignored) |

## Architecture notes

### Binary discovery (`findBinary`)
Order: env var (`FFMPEG_BIN`/`FFPROBE_BIN`) → `process.resourcesPath/bin` (packaged) → `<project>/bin` (dev) → PATH. `system-info` IPC returns a `found` boolean so the UI can show a red engine chip when FFmpeg is missing.

### Job pipeline
Renderer builds job objects `{id, input, output, format, mode, quality, acceleration}` → `start-jobs` IPC → main probes with ffprobe, detects hardware encoders once per job via `-encoders` output regex, spawns ffmpeg with `-progress pipe:1 -stats_period 0.5`. Progress events (`job-progress`, `job-done`, `job-error`, `job-cancelled`) are pushed to the renderer by job id. Multiple jobs run concurrently; each row updates independently.

### Renderer <-> preload contract (do not break casually)
```
pathForFile(file)      chooseFiles()         chooseOutputFolder()
startJobs(jobs)        cancelJob(id)         openFile(f)  showInFolder(f)
statFile(f)            systemInfo()
onProgress/onDone/onError/onCancelled  -> event subscriptions by job id
```

## Critical gotchas

1. **Drag & drop paths**: Electron >= 32 removed `File.path`. Always resolve dropped files through `preload.pathForFile()` which wraps `webUtils.getPathForFile()`.
2. **Installer size discipline**: the 1 GB+ problem comes from fat FFmpeg builds and stray DLLs in `bin/`. Keep only the two executables. `electronLanguages: ["en-US"]`, `asar: true` and `compression: maximum` are set in `package.json` — do not remove them.
3. **Context isolation + sandbox are ON**. Renderer code must go through the preload bridge only; no node integration in the page.
4. **DOM id contract**: `renderer.js` queries many element ids (`#queue`, `#fileList`, `#ringFill`, `#overall`, `#state-*`, `#bar-*`, etc.). If you rename an id in `index.html`, update `renderer.js` in the same change.
5. **Queue placement**: the queue section lives inside the hero, directly under the CTA buttons, hidden until files exist. Keep it there unless the owner asks otherwise.
6. **No comments policy** in shipped JS/CSS; keep code comment-free and self-explanatory.

## Style rules for UI changes

- Dark theme tokens live in `:root` of `styles.css`; reuse them instead of hardcoding colors.
- Buttons follow strict contrast: white background = near-black text; ghost buttons use light text on translucent dark.
- Motion uses CSS keyframes/WAAPI and IntersectionObserver only. Do not introduce GSAP, framer-motion or any animation library.
- Never add emojis to UI text, logs or commits.
