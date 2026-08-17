# Feather — plan

Cross-platform (macOS / Windows / Linux) offline media compressor. Tauri 2 (Rust) + React/TS.
Goal: everything Compresto does, plus what it lacks — Windows/Linux day one,
before/after quality compare, transparent per-file settings, open source-friendly stack.

## Architecture
- `src-tauri/`  Rust: job queue, ffmpeg/ffprobe/gs wrappers, progress events, settings + history (JSON).
- `src/`        React UI: drop zone, file list, settings panel, results, history.
- Binaries: dev uses system `ffmpeg`/`ffprobe`/`gs`; release ships ffmpeg (LGPL build) as a Tauri
  sidecar. Ghostscript is AGPL → never bundled; detected on system, user prompted to install.
- Binary paths are injected via a single `Tools` struct — never hardcoded at call sites.

## Milestones
- [x] M0  Scaffold, `tauri dev` opens.
- [x] M1–M6 core done (see README); M7 partially (folder watching ✓).
- [ ] M1  Vertical slice: drop 1 video → ffmpeg → live progress → result card (before/after size, savings %).
- [ ] M2  Job queue: batch, bounded concurrency, per-file status, cancel, pause/resume.
- [ ] M3  File types: images (jpg/png/webp/avif, resize, quality), GIF (video→gif 2-pass palette, gif optimize),
          PDF (Ghostscript presets: screen/ebook/printer/prepress).
- [ ] M4  Video options: quality presets (CRF / -q:v for HW encoders), H.264/H.265/VP9/AV1, HW accel toggle
          (videotoolbox / nvenc / qsv / amf), resize (w/h/long/short edge), fps, remove audio, trim,
          target file size (2-pass), extract mp3, video→gif.
- [ ] M5  Output: custom folder / subfolder / same folder, filename template ({name}{quality}{resolution}…),
          replace / trash original, keep dates + metadata, collision handling.
- [ ] M6  Persistence: settings, presets (named), history with stats. Notifications. Before/after compare view.
- [ ] M7  System: tray/menu-bar mode, global shortcut, folder monitoring (notify crate, settle time),
          clipboard paste, deep link `feather://compress?…`, "Open with" file association.
- [ ] M8  Windows + Linux builds in CI, auto-update, code signing.

## Better-than-Compresto list
Windows/Linux day one · side-by-side before/after preview with zoom · AV1 + VP9 · per-file overrides from the start ·
estimated output size before compressing · JSON export of history · CLI (`feather compress …`) sharing the same core.
