export type MediaKind = "video" | "image" | "gif" | "pdf" | "unknown";
export type Quality = "highest" | "high" | "good" | "medium" | "acceptable";
export type VideoCodec = "auto" | "h264" | "h265" | "vp9" | "av1";
export type VideoFormat = "same" | "mp4" | "webm" | "mov" | "mkv" | "gif" | "mp3";
export type ImageFormat = "same" | "jpg" | "png" | "webp" | "avif";
export type ResizeMode = "none" | "width" | "height" | "longedge" | "shortedge" | "percent";
export type OutputLocation = "samefolder" | "subfolder" | "custom";
export type JobStatus = "queued" | "running" | "done" | "failed" | "cancelled";

export interface MediaInfo {
  path: string;
  name: string;
  kind: MediaKind;
  size: number;
  duration: number | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  has_audio: boolean;
  video_codec: string | null;
  audio_codec: string | null;
  bitrate: number | null;
}

export interface Resize {
  mode: ResizeMode;
  value: number;
}

export interface VideoSettings {
  quality: Quality;
  codec: VideoCodec;
  format: VideoFormat;
  hw_accel: boolean;
  resize: Resize;
  fps: number | null;
  remove_audio: boolean;
  target_size_mb: number | null;
  trim_start: number | null;
  trim_end: number | null;
  threads: number;
}
export interface ImageSettings {
  quality: Quality;
  format: ImageFormat;
  resize: Resize;
  keep_metadata: boolean;
}
export interface GifSettings {
  quality: Quality;
  fps: number;
  resize: Resize;
  loop_forever: boolean;
}
export interface PdfSettings {
  quality: Quality;
}
export interface OutputSettings {
  location: OutputLocation;
  subfolder_name: string;
  custom_dir: string;
  name_template: string;
  overwrite_original: boolean;
  trash_original: boolean;
  keep_dates: boolean;
  skip_if_larger: boolean;
}
export interface WatchSettings {
  enabled: boolean;
  folders: string[];
  settle_secs: number;
  videos: boolean;
  images: boolean;
  gifs: boolean;
  pdfs: boolean;
}
export interface Settings {
  version: number;
  watch: WatchSettings;
  video: VideoSettings;
  image: ImageSettings;
  gif: GifSettings;
  pdf: PdfSettings;
  output: OutputSettings;
  concurrency: number;
  notify_on_finish: boolean;
  ffmpeg_path: string | null;
  gs_path: string | null;
}

export interface Job {
  id: string;
  input: MediaInfo;
  output_path: string | null;
  status: JobStatus;
  progress: number;
  output_size: number | null;
  output_width: number | null;
  output_height: number | null;
  error: string | null;
  elapsed_ms: number | null;
  finished_at: number | null;
  larger: boolean;
  speed: number | null;
  eta_secs: number | null;
}

export interface HistoryItem {
  id: string;
  input_path: string;
  input_name: string;
  kind: MediaKind;
  output_path: string;
  input_size: number;
  output_size: number;
  finished_at: number;
  elapsed_ms: number;
}

export interface Tools {
  ffmpeg: string | null;
  ffprobe: string | null;
  ghostscript: string | null;
}

export const QUALITIES: { value: Quality; label: string; hint: string }[] = [
  { value: "highest", label: "Highest", hint: "Near-lossless" },
  { value: "high", label: "High", hint: "Great quality" },
  { value: "good", label: "Good", hint: "Best balance" },
  { value: "medium", label: "Medium", hint: "Smaller" },
  { value: "acceptable", label: "Acceptable", hint: "Smallest" },
];

export interface Estimate {
  path: string;
  size: number | null;
  time: number | null;
  already_small: boolean;
}

export interface InstallEvent {
  tool: "ffmpeg" | "ghostscript" | string;
  phase: "downloading" | "extracting" | "installing" | "done" | "error";
  percent: number | null;
  message: string;
}
