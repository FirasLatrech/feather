import { useMemo, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import type { GifSettings, ImageSettings, MediaKind, OutputSettings, PdfSettings, Settings, VideoSettings } from "../lib/types";
import { Field, NumberInput, QualityPicker, Segmented, Toggle } from "./Controls";
import { ResizeControl } from "./ResizeControl";
import { useStore } from "../store";

type Section = "video" | "image" | "gif" | "pdf" | "output";

export function SettingsPanel({ settings, onChange, kinds, title, subtitle, onReset }: {
  settings: Settings;
  onChange: (fn: (s: Settings) => Settings) => void;
  kinds: MediaKind[];
  title: string;
  subtitle?: string;
  onReset?: () => void;
}) {
  const available = useMemo<Section[]>(() => {
    const s: Section[] = [];
    if (kinds.includes("video")) s.push("video");
    if (kinds.includes("image")) s.push("image");
    if (kinds.includes("gif") || (kinds.includes("video") && settings.video.format === "gif")) s.push("gif");
    if (kinds.includes("pdf")) s.push("pdf");
    s.push("output");
    return s;
  }, [kinds, settings.video.format]);
  const [sec, setSec] = useState<Section>(available[0]);
  const active: Section = available.includes(sec) ? sec : available[0];
  const isMac = navigator.userAgent.includes("Mac");

  const setVideo = (p: Partial<VideoSettings>) => onChange((s) => ({ ...s, video: { ...s.video, ...p } }));
  const setImage = (p: Partial<ImageSettings>) => onChange((s) => ({ ...s, image: { ...s.image, ...p } }));
  const setGif = (p: Partial<GifSettings>) => onChange((s) => ({ ...s, gif: { ...s.gif, ...p } }));
  const setPdf = (p: Partial<PdfSettings>) => onChange((s) => ({ ...s, pdf: { ...s.pdf, ...p } }));
  const setOut = (p: Partial<OutputSettings>) => onChange((s) => ({ ...s, output: { ...s.output, ...p } }));

  const labels: Record<Section, string> = { video: "Video", image: "Image", gif: "GIF", pdf: "PDF", output: "Output" };
  const v = settings.video;

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</h3>
          {subtitle && <div style={{ color: "var(--fg-3)", fontSize: 11.5 }}>{subtitle}</div>}
        </div>
        {onReset && <button className="btn sm ghost" onClick={onReset}>Use defaults</button>}
      </div>
      <div style={{ padding: "10px 14px 0" }}>
        <Segmented value={active} options={available.map((a) => ({ value: a, label: labels[a] }))} onChange={setSec} compact />
      </div>
      <div className="sidebar-body">
        {active === "video" && (
          <>
            <Field label="Quality" hint={v.target_size_mb ? "Ignored while a target size is set." : "CRF-based constant quality."}>
              <QualityPicker value={v.quality} onChange={(quality) => setVideo({ quality })} />
            </Field>
            <Field label="Target file size" hint="Two-pass encode to hit a size. Leave empty to use quality.">
              <div className="inline">
                <NumberInput value={v.target_size_mb} onChange={(target_size_mb) => setVideo({ target_size_mb })} min={0.1} step={0.5} placeholder="auto" suffix="MB" />
                {v.target_size_mb != null && <button className="btn sm ghost" onClick={() => setVideo({ target_size_mb: null })}>Clear</button>}
              </div>
            </Field>
            <Field label="Format">
              <Segmented value={v.format} options={[{ value: "same", label: "Same" }, { value: "mp4", label: "MP4" }, { value: "webm", label: "WebM" }, { value: "mov", label: "MOV" }, { value: "mkv", label: "MKV" }, { value: "gif", label: "GIF" }, { value: "mp3", label: "MP3" }]} onChange={(format) => setVideo({ format })} compact />
            </Field>
            {v.format !== "gif" && v.format !== "mp3" && (
              <>
                <Field label="Codec" hint={v.format === "webm" ? "WebM uses VP9 / AV1." : "H.265 & AV1 are ~30–50% smaller than H.264 at equal quality but slower to encode."}>
                  <Segmented value={v.codec} options={[{ value: "h264", label: "H.264" }, { value: "h265", label: "H.265" }, { value: "vp9", label: "VP9" }, { value: "av1", label: "AV1" }]} onChange={(codec) => setVideo({ codec })} />
                </Field>
                {isMac && (v.codec === "h264" || v.codec === "h265") && (
                  <Field label="Hardware acceleration" row hint="VideoToolbox: much faster, slightly larger files.">
                    <Toggle value={v.hw_accel} onChange={(hw_accel) => setVideo({ hw_accel })} />
                  </Field>
                )}
                <ResizeControl value={v.resize} onChange={(resize) => setVideo({ resize })} />
                <Field label="Frame rate" row>
                  <NumberInput value={v.fps} onChange={(fps) => setVideo({ fps })} min={1} max={240} placeholder="same" suffix="fps" />
                </Field>
                <Field label="Remove audio" row>
                  <Toggle value={v.remove_audio} onChange={(remove_audio) => setVideo({ remove_audio })} />
                </Field>
              </>
            )}
            <Field label="Trim" hint="Seconds from start / to end. Leave empty for the full clip.">
              <div className="inline">
                <NumberInput value={v.trim_start} onChange={(trim_start) => setVideo({ trim_start })} min={0} step={0.1} placeholder="start" suffix="s" />
                <span style={{ color: "var(--fg-3)" }}>→</span>
                <NumberInput value={v.trim_end} onChange={(trim_end) => setVideo({ trim_end })} min={0} step={0.1} placeholder="end" suffix="s" />
              </div>
            </Field>
            {v.format === "gif" && <div className="notice info">GIF options are in the GIF tab.</div>}
          </>
        )}

        {active === "image" && (
          <>
            <Field label="Quality">
              <QualityPicker value={settings.image.quality} onChange={(quality) => setImage({ quality })} />
            </Field>
            <Field label="Format" hint="WebP and AVIF are 30–60% smaller than JPEG. PNG stays lossless.">
              <Segmented value={settings.image.format} options={[{ value: "same", label: "Same" }, { value: "jpg", label: "JPG" }, { value: "png", label: "PNG" }, { value: "webp", label: "WebP" }, { value: "avif", label: "AVIF" }]} onChange={(format) => setImage({ format })} />
            </Field>
            <ResizeControl value={settings.image.resize} onChange={(resize) => setImage({ resize })} presets={[4096, 2560, 2048, 1920, 1600, 1280, 1024, 800]} />
            <Field label="Keep metadata" row hint="Preserve EXIF / color profiles when possible (PNG only for now).">
              <Toggle value={settings.image.keep_metadata} onChange={(keep_metadata) => setImage({ keep_metadata })} />
            </Field>
          </>
        )}

        {active === "gif" && (
          <>
            <Field label="Quality" hint="Controls palette size and dithering.">
              <QualityPicker value={settings.gif.quality} onChange={(quality) => setGif({ quality })} />
            </Field>
            <Field label="Frame rate" row>
              <NumberInput value={settings.gif.fps} onChange={(fps) => setGif({ fps: fps ?? 15 })} min={1} max={60} suffix="fps" />
            </Field>
            <ResizeControl value={settings.gif.resize} onChange={(resize) => setGif({ resize })} presets={[1280, 960, 800, 640, 480, 320]} />
            <Field label="Loop forever" row>
              <Toggle value={settings.gif.loop_forever} onChange={(loop_forever) => setGif({ loop_forever })} />
            </Field>
          </>
        )}

        {active === "pdf" && (
          <>
            <Field label="Quality" hint="Highest keeps print quality (prepress). Acceptable targets screens (72 dpi).">
              <QualityPicker value={settings.pdf.quality} onChange={(quality) => setPdf({ quality })} />
            </Field>
            <ToolsHint tool="ghostscript" />
          </>
        )}

        {active === "output" && <OutputSection out={settings.output} setOut={setOut} />}
      </div>
    </aside>
  );
}

function ToolsHint({ tool }: { tool: "ffmpeg" | "ghostscript" }) {
  const tools = useStore((s) => s.tools);
  if (!tools) return null;
  if (tools[tool]) return null;
  return (
    <div className="notice" style={{ marginTop: 10 }}>
      {tool === "ghostscript" ? "Ghostscript is not installed. PDF compression needs it: brew install ghostscript" : "FFmpeg not found: brew install ffmpeg"}
    </div>
  );
}

export function OutputSection({ out, setOut }: { out: OutputSettings; setOut: (p: Partial<OutputSettings>) => void }) {
  return (
    <>
      <Field label="Save to">
        <Segmented value={out.location} options={[{ value: "samefolder", label: "Same folder" }, { value: "subfolder", label: "Subfolder" }, { value: "custom", label: "Custom" }]} onChange={(location) => setOut({ location })} />
        {out.location === "subfolder" && (
          <input className="input" value={out.subfolder_name} onChange={(e) => setOut({ subfolder_name: e.target.value })} placeholder="compressed" />
        )}
        {out.location === "custom" && (
          <div className="inline">
            <input className="input" value={out.custom_dir} onChange={(e) => setOut({ custom_dir: e.target.value })} placeholder="/path/to/folder" />
            <button
              className="btn sm"
              onClick={async () => {
                const d = await open({ directory: true, multiple: false });
                if (typeof d === "string") setOut({ custom_dir: d });
              }}
            >
              Browse
            </button>
          </div>
        )}
      </Field>
      <Field label="File name" hint="Variables: {name} {quality} {resolution} {codec} {date} {time}">
        <input className="input" value={out.name_template} disabled={out.overwrite_original} onChange={(e) => setOut({ name_template: e.target.value })} />
      </Field>
      <Field label="Replace original file" row hint="Overwrites the source in place. Irreversible.">
        <Toggle value={out.overwrite_original} onChange={(overwrite_original) => setOut({ overwrite_original, trash_original: overwrite_original ? false : out.trash_original })} />
      </Field>
      {!out.overwrite_original && (
        <Field label="Move original to Trash" row>
          <Toggle value={out.trash_original} onChange={(trash_original) => setOut({ trash_original })} />
        </Field>
      )}
      <Field label="Keep original dates" row hint="Copies modification date to the output.">
        <Toggle value={out.keep_dates} onChange={(keep_dates) => setOut({ keep_dates })} />
      </Field>
      <Field label="Never produce a larger file" row hint="If the result isn't smaller, keep the original bytes.">
        <Toggle value={out.skip_if_larger} onChange={(skip_if_larger) => setOut({ skip_if_larger })} />
      </Field>
    </>
  );
}
