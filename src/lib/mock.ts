/* Browser preview mode: fakes the Tauri backend so the UI can be developed / screenshotted in Chrome. */
import type { HistoryItem, Job, MediaInfo, Settings, Tools } from "./types";

type Handler = (e: { payload: unknown }) => void;
const listeners: Record<string, Handler[]> = {};
export function mockListen(event: string, h: Handler) {
  (listeners[event] ??= []).push(h);
  return Promise.resolve(() => { listeners[event] = (listeners[event] ?? []).filter((x) => x !== h); });
}
function emit(event: string, payload: unknown) { for (const h of listeners[event] ?? []) h({ payload }); }

const defaults: Settings = {
  version: 2,
  video: { quality: "good", codec: "auto", format: "same", hw_accel: true, resize: { mode: "none", value: 0 }, fps: null, remove_audio: false, target_size_mb: null, trim_start: null, trim_end: null, threads: 0 },
  image: { quality: "good", format: "same", resize: { mode: "none", value: 0 }, keep_metadata: false },
  gif: { quality: "good", fps: 15, resize: { mode: "width", value: 640 }, loop_forever: true },
  pdf: { quality: "good" },
  output: { location: "samefolder", subfolder_name: "compressed", custom_dir: "", name_template: "{name}_compressed", overwrite_original: false, trash_original: false, keep_dates: true, skip_if_larger: false },
  concurrency: 2, notify_on_finish: true, ffmpeg_path: null, gs_path: null,
};
let settings: Settings = structuredClone(defaults);
const jobs: Record<string, Job> = {};
const history: HistoryItem[] = [];

const SAMPLES: MediaInfo[] = [
  { path: "/Users/demo/Movies/Product launch keynote.mp4", name: "Product launch keynote.mp4", kind: "video", size: 412_338_112, duration: 754, width: 3840, height: 2160, fps: 29.97, has_audio: true, video_codec: "h264", audio_codec: "aac", bitrate: 4_300_000 },
  { path: "/Users/demo/Pictures/IMG_4821.HEIC", name: "IMG_4821.HEIC", kind: "image", size: 3_918_221, duration: null, width: 4032, height: 3024, fps: null, has_audio: false, video_codec: null, audio_codec: null, bitrate: null },
  { path: "/Users/demo/Desktop/Q3 Investor Deck.pdf", name: "Q3 Investor Deck.pdf", kind: "pdf", size: 28_411_002, duration: null, width: null, height: null, fps: null, has_audio: false, video_codec: null, audio_codec: null, bitrate: null },
  { path: "/Users/demo/Downloads/screen-recording.mov", name: "screen-recording.mov", kind: "video", size: 96_223_400, duration: 63, width: 2560, height: 1600, fps: 60, has_audio: false, video_codec: "hevc", audio_codec: null, bitrate: null },
  { path: "/Users/demo/Pictures/hero-banner.png", name: "hero-banner.png", kind: "image", size: 6_120_000, duration: null, width: 2880, height: 1620, fps: null, has_audio: false, video_codec: null, audio_codec: null, bitrate: null },
  { path: "/Users/demo/Downloads/reaction.gif", name: "reaction.gif", kind: "gif", size: 8_812_000, duration: 4.2, width: 800, height: 450, fps: 20, has_audio: false, video_codec: null, audio_codec: null, bitrate: null },
];
const THUMBS: Record<string, string> = {
  [SAMPLES[0].path]: "https://picsum.photos/seed/keynote/640/400",
  [SAMPLES[1].path]: "https://picsum.photos/seed/heic/640/400",
  [SAMPLES[2].path]: "https://picsum.photos/seed/deck/640/400",
  [SAMPLES[3].path]: "https://picsum.photos/seed/screen/640/400",
  [SAMPLES[4].path]: "https://picsum.photos/seed/hero/640/400",
  [SAMPLES[5].path]: "https://picsum.photos/seed/gif/640/400",
};

function uuid() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }

export const mockApi = {
  getTools: async (): Promise<Tools> => ({ ffmpeg: "/opt/homebrew/bin/ffmpeg", ffprobe: "/opt/homebrew/bin/ffprobe", ghostscript: null }),
  probePaths: async (paths: string[]) => paths.length ? SAMPLES.filter((s) => paths.includes(s.path)) : SAMPLES,
  getSettings: async () => structuredClone(settings),
  saveSettings: async (s: Settings) => { settings = s; },
  startCompression: async (files: MediaInfo[]) => {
    const created: Job[] = files.map((f) => ({ id: uuid(), input: f, output_path: null, status: "queued", progress: 0, output_size: null, output_width: null, output_height: null, error: null, elapsed_ms: null, finished_at: null, larger: false, speed: null, eta_secs: null }));
    for (const j of created) jobs[j.id] = j;
    const demo = new URLSearchParams(location.search).get("demo");
    if (demo === "done" || demo === "running") {
      // Static snapshot for screenshots (headless Chrome throttles timers).
      created.forEach((j, i) => {
        const ratio = j.input.kind === "pdf" ? 0.22 : j.input.kind === "video" ? 0.35 : 0.48;
        const isDone = demo === "done" ? j.input.kind !== "pdf" : i < 2;
        const isFail = demo === "done" && j.input.kind === "pdf";
        const isRun = demo === "running" && (i === 2 || i === 3);
        jobs[j.id] = isDone
          ? { ...j, status: "done", progress: 100, output_size: Math.round(j.input.size * ratio), output_path: j.input.path.replace(/(\.[^.]+)$/, "_compressed$1"), output_width: j.input.width, output_height: j.input.height, elapsed_ms: 4200 + i * 900, finished_at: Date.now() }
          : isFail ? { ...j, status: "failed", error: "Ghostscript not found. Install it (brew install ghostscript) to compress PDFs." }
          : isRun ? { ...j, status: "running", progress: i === 2 ? 63 : 18, speed: i === 2 ? 4.2 : 1.7, eta_secs: i === 2 ? 95 : 1900 }
          : j;
      });
      setTimeout(() => { for (const j of created) emit("job:update", jobs[j.id]); }, 0);
      return created;
    }
    let delay = 0;
    for (const j of created) {
      const start = Date.now() + delay;
      delay += 900;
      const dur = 3000 + Math.random() * 3000;
      const tick = () => {
        const t = Date.now();
        if (t < start) return void setTimeout(tick, 100);
        const p = Math.min(100, ((t - start) / dur) * 100);
        if (p < 100) {
          jobs[j.id] = { ...jobs[j.id], status: "running", progress: p };
          emit("job:update", jobs[j.id]);
          setTimeout(tick, 120);
        } else {
          const ratio = j.input.kind === "pdf" ? 0.22 : j.input.kind === "video" ? 0.35 : 0.48;
          const failed = j.input.kind === "pdf";
          jobs[j.id] = failed
            ? { ...jobs[j.id], status: "failed", progress: 0, error: "Ghostscript not found. Install it (brew install ghostscript) to compress PDFs." }
            : { ...jobs[j.id], status: "done", progress: 100, output_size: Math.round(j.input.size * ratio), output_path: j.input.path.replace(/(\.[^.]+)$/, "_compressed$1"), output_width: j.input.width, output_height: j.input.height, elapsed_ms: Math.round(dur), finished_at: Date.now() };
          if (!failed) history.push({ id: j.id, input_path: j.input.path, input_name: j.input.name, kind: j.input.kind, output_path: jobs[j.id].output_path!, input_size: j.input.size, output_size: jobs[j.id].output_size!, finished_at: Date.now(), elapsed_ms: Math.round(dur) });
          emit("job:update", jobs[j.id]);
        }
      };
      setTimeout(tick, 50);
    }
    return created;
  },
  estimate: async (files: MediaInfo[]) => files.map((f) => {
    const ratio = f.kind === "pdf" ? 0.3 : f.kind === "video" ? (f.video_codec === "hevc" ? 0.92 : 0.35) : 0.5;
    return { path: f.path, size: Math.round(f.size * ratio), time: f.kind === "video" ? (f.duration ?? 60) / 20 : 2, already_small: ratio > 0.9 };
  }),
  listJobs: async () => Object.values(jobs),
  cancelJob: async (id: string) => { if (jobs[id]) { jobs[id] = { ...jobs[id], status: "cancelled" }; emit("job:update", jobs[id]); } },
  cancelAll: async () => { for (const id in jobs) if (jobs[id].status === "running" || jobs[id].status === "queued") { jobs[id] = { ...jobs[id], status: "cancelled" }; emit("job:update", jobs[id]); } },
  removeJob: async (id: string) => { delete jobs[id]; emit("jobs:changed", null); },
  clearFinished: async () => { for (const id in jobs) if (jobs[id].status !== "running" && jobs[id].status !== "queued") delete jobs[id]; emit("jobs:changed", null); },
  getHistory: async () => history,
  clearHistory: async () => { history.length = 0; },
  thumbnail: async (path: string) => THUMBS[path] ?? null,
  appDirs: async () => ({}),
};
export const mockConvertFileSrc = (p: string) => p;
