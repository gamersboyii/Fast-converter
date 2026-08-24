param(
  [switch]$SlimFfmpeg,
  [switch]$CompressBinaries
)

$ErrorActionPreference = 'Stop'
Write-Host ''
Write-Host 'FastConvert Windows build' -ForegroundColor Cyan
Write-Host '-------------------------' -ForegroundColor DarkCyan

if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js 20+ is required.' }

New-Item -ItemType Directory -Force -Path '.\bin' | Out-Null

function Get-SlimFfmpeg {
  $url = 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip'
  $zip = Join-Path $env:TEMP 'fastconvert-ffmpeg-essentials.zip'
  $dir = Join-Path $env:TEMP 'fastconvert-ffmpeg-extract'
  Write-Host "Downloading slim FFmpeg essentials build (~90 MB) from gyan.dev..." -ForegroundColor Yellow
  Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing
  if (Test-Path $dir) { Remove-Item $dir -Recurse -Force }
  Expand-Archive -Path $zip -DestinationPath $dir -Force
  $ffmpegSrc = Get-ChildItem $dir -Recurse -Filter 'ffmpeg.exe' | Select-Object -First 1
  $ffprobeSrc = Get-ChildItem $dir -Recurse -Filter 'ffprobe.exe' | Select-Object -First 1
  if (-not $ffmpegSrc -or -not $ffprobeSrc) { throw 'Downloaded archive did not contain ffmpeg.exe / ffprobe.exe.' }
  Copy-Item $ffmpegSrc.FullName '.\bin\ffmpeg.exe' -Force
  Copy-Item $ffprobeSrc.FullName '.\bin\ffprobe.exe' -Force
  Remove-Item $zip -Force
  Remove-Item $dir -Recurse -Force
  Write-Host 'Slim FFmpeg installed into .\bin (only the two required executables).' -ForegroundColor Green
}

$needFfmpeg = -not (Test-Path '.\bin\ffmpeg.exe') -or -not (Test-Path '.\bin\ffprobe.exe')
if ($needFfmpeg -or $SlimFfmpeg) {
  if (-not $needFfmpeg -and $SlimFfmpeg) {
    Write-Host 'Existing FFmpeg found; replacing with slim essentials build (-SlimFfmpeg).' -ForegroundColor Yellow
    Remove-Item '.\bin\ffmpeg.exe', '.\bin\ffprobe.exe' -Force -ErrorAction SilentlyContinue
  }
  Get-SlimFfmpeg
}

Write-Host ''
Write-Host 'Binary audit:' -ForegroundColor Cyan
$total = 0
Get-ChildItem '.\bin' -File | ForEach-Object {
  $mb = [math]::Round($_.Length / 1MB, 1)
  $total += $_.Length
  Write-Host ("  {0,-16} {1,8} MB" -f $_.Name, $mb)
}
$totalMb = [math]::Round($total / 1MB, 1)
Write-Host "  bin/ total      $totalMb MB"

foreach ($exe in @('ffmpeg.exe', 'ffprobe.exe')) {
  $p = ".\bin\$exe"
  if ((Test-Path $p) -and ((Get-Item $p).Length / 1MB) -gt 120) {
    Write-Host "Warning: $exe is larger than 120 MB. This is a full build and will push the" -ForegroundColor Yellow
    Write-Host 'installer toward 1 GB. Rerun with: ./BUILD-WINDOWS.ps1 -SlimFfmpeg' -ForegroundColor Yellow
  }
}

$stray = Get-ChildItem '.\bin' -File | Where-Object { $_.Name -notin @('ffmpeg.exe', 'ffprobe.exe', 'README.txt') }
if ($stray) {
  Write-Host 'Warning: extra files in bin/ will be packed into the installer:' -ForegroundColor Yellow
  $stray | ForEach-Object { Write-Host ("  {0} ({1} MB)" -f $_.Name, [math]::Round($_.Length / 1MB, 1)) -ForegroundColor Yellow }
  Write-Host 'Remove them unless your FFmpeg build requires DLLs:' -ForegroundColor Yellow
  Write-Host ('  Remove-Item .\bin\{0}' -f ($stray.Name -join ',.\bin\')) -ForegroundColor Gray
}

if ($CompressBinaries) {
  if (Get-Command upx -ErrorAction SilentlyContinue) {
    Write-Host 'Compressing binaries with UPX (best/lzma)...' -ForegroundColor Cyan
    & upx --best --lzma '.\bin\ffmpeg.exe', '.\bin\ffprobe.exe' 2>$null
    Write-Host 'Note: UPX-packed executables can trigger heuristic AV warnings.' -ForegroundColor DarkYellow
  } else {
    Write-Host 'UPX not found. Install it (winget install upx.upx) to shrink exes ~40%.' -ForegroundColor Yellow
  }
}

Write-Host ''
Write-Host 'Installing dependencies...' -ForegroundColor Cyan
npm install

Write-Host 'Packaging (electron-builder, maximum compression)...' -ForegroundColor Cyan
npm run dist

Write-Host ''
Write-Host 'Output:' -ForegroundColor Green
if (Test-Path '.\dist') {
  Get-ChildItem '.\dist' -File | Where-Object { $_.Extension -in '.exe' } | ForEach-Object {
    Write-Host ("  {0}  {1} MB" -f $_.Name, [math]::Round($_.Length / 1MB, 1)) -ForegroundColor Green
  }
}
Write-Host 'Build complete.' -ForegroundColor Green
