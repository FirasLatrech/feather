import { open } from "@tauri-apps/plugin-dialog";
import { RiFilmLine, RiImageLine, RiFileGifLine, RiFilePdf2Line, RiFolderDownloadLine, RiCloseLine } from "@remixicon/react";
import type { GifSettings, ImageSettings, MediaKind, OutputSettings, PdfSettings, Settings, VideoSettings } from "../lib/types";
import { Advanced, Field, Group, NumberInput, QualityPicker, Segmented, Toggle } from "./Controls";
import { ResizeControl } from "./ResizeControl";
import { useStore } from "../store";

const qLabel: Record<string, string> = { highest: "Highest", high: "High", good: "Good", medium: "Medium", acceptable: "Acceptable" };

export function SettingsPanel({ settings, onChange, kinds, title, subtitle, onReset, onClose }: {
  settings: Settings;
  onChange: (fn: (s: Settings) => Settings) => void;
  kinds: MediaKind[];
  title: string;
  subtitle?: string;
  onReset?: () => void;
  onClose?: () => void;
}) {
  const setVideo = (p: Partial<VideoSettings>) => onChange((s) => ({ ...s, video: { ...s.video, ...p } }));
  const setImage = (p: Partial<ImageSettings>) => onChange((s) => ({ ...s, image: { ...s.image, ...p } }));
  const setGif = (p: Partial<GifSettings>) => onChange((s) => ({ ...s, gif: { ...s.gif, ...p } }));
  const setPdf = (p: Partial<PdfSettings>) => onChange((s) => ({ ...s, pdf: { ...s.pdf, ...p } }));
  const setOut = (p: Partial<OutputSettings>) => onChange((s) => ({ ...s, output: { ...s.output, ...p } }));
  const v = settings.video;
  const showVideo = kinds.includes("video");
  const showImage = kinds.includes("image");
  const showGif = kinds.includes("gif") || (showVideo && v.format === "gif");
  const showPdf = kinds.includes("pdf");
  const order: [boolean, string][] = [[showVideo, "video"], [showImage, "image"], [showGif, "gif"], [showPdf, "pdf"]];
  const first = order.find(([x]) => x)?.[1];

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3>{title}</h3>
          {subtitle && <div className="sub">{subtitle}</div>}
        </div>
        {onReset && <button className="btn sm ghost" onClick={onReset}>Reset</button>}
        {onClose && <button className="icon-btn sm" onClick={onClose} title="Back to defaults (Esc)" aria-label="Close per-file settings"><RiCloseLine size={16} /></button>}
      </div>
      <div className="sidebar-body">
        {showVideo && (
          <Group icon={<RiFilmLine size={14} />} title="Video" summary={`${qLabel[v.quality]}${v.format !== "same" ? " · " + v.format.toUpperCase() : ""}`} defaultOpen={first === "video"}>
            <Field label="Quality">
              <QualityPicker value={v.quality} onChange={(quality) => setVideo({ quality })} />
            </Field>
            <Field label="Format">
              <Segmented value={v.format} options={[{ value: "same", label: "Same" }, { value: "mp4", label: "MP4" }, { value: "mov", label: "MOV" }, { value: "webm", label: "WebM" }, { value: "gif", label: "GIF" }]} onChange={(format) => setVideo({ format })} />
            </Field>
            {v.format !== "gif" && (
              <>
                <ResizeControl value={v.resize} onChange={(resize) => setVideo({ resize })} />
                <Field label="Remove audio" row>
                  <Toggle value={v.remove_audio} onChange={(remove_audio) => setVideo({ remove_audio })} label="Remove audio" />
                </Field>
                <Advanced>
                  <Field label="Target size" row hint="Exact size · slower">
                    <NumberInput value={v.target_size_mb} onChange={(target_size_mb) => setVideo({ target_size_mb })} min={0.1} step={0.5} placeholder="off" suffix="MB" />
                  </Field>
                  <Field label="Codec" hint={v.codec === "auto" ? "Auto keeps the source codec" : undefined}>
                    <Segmented value={v.codec} options={[{ value: "auto", label: "Auto" }, { value: "h264", label: "H.264" }, { value: "h265", label: "H.265" }, { value: "vp9", label: "VP9" }, { value: "av1", label: "AV1" }]} onChange={(codec) => setVideo({ codec })} compact />
                  </Field>
                  <Field label="Frame rate" row>
                    <NumberInput value={v.fps} onChange={(fps) => setVideo({ fps })} min={1} max={240} placeholder="same" suffix="fps" />
                  </Field>
                  <Field label="Trim" hint="Seconds from start → end">
                    <div className="inline">
                      <NumberInput value={v.trim_start} onChange={(trim_start) => setVideo({ trim_start })} min={0} step={0.1} placeholder="start" suffix="s" />
                      <span style={{ color: "var(--fg-3)" }}>→</span>
                      <NumberInput value={v.trim_end} onChange={(trim_end) => setVideo({ trim_end })} min={0} step={0.1} placeholder="end" suffix="s" />
                    </div>
                  </Field>
                  <Field label="Extract audio only" row hint="Saves an MP3">
                    <Toggle value={v.format === "mp3"} onChange={(on) => setVideo({ format: on ? "mp3" : "same" })} label="Extract audio only" />
                  </Field>
                </Advanced>
              </>
            )}
          </Group>
        )}

        {showImage && (
          <Group icon={<RiImageLine size={14} />} title="Image" summary={`${qLabel[settings.image.quality]}${settings.image.format !== "same" ? " · " + settings.image.format.toUpperCase() : ""}`} defaultOpen={first === "image"}>
            <Field label="Quality">
              <QualityPicker value={settings.image.quality} onChange={(quality) => setImage({ quality })} />
            </Field>
            <Field label="Format" hint={settings.image.format === "webp" || settings.image.format === "avif" ? "Much smaller than JPG · supported by all modern apps" : undefined}>
              <Segmented value={settings.image.format} options={[{ value: "same", label: "Same" }, { value: "jpg", label: "JPG" }, { value: "png", label: "PNG" }, { value: "webp", label: "WebP" }, { value: "avif", label: "AVIF" }]} onChange={(format) => setImage({ format })} />
            </Field>
            <ResizeControl value={settings.image.resize} onChange={(resize) => setImage({ resize })} presets={[3840, 2560, 1920, 1280, 854, 640]} />
            <Advanced>
              <Field label="Keep metadata" row hint="EXIF, color profile">
                <Toggle value={settings.image.keep_metadata} onChange={(keep_metadata) => setImage({ keep_metadata })} label="Keep metadata" />
              </Field>
            </Advanced>
          </Group>
        )}

        {showGif && (
          <Group icon={<RiFileGifLine size={14} />} title="GIF" summary={qLabel[settings.gif.quality]} defaultOpen={first === "gif" || (showVideo && v.format === "gif")}>
            <Field label="Quality">
              <QualityPicker value={settings.gif.quality} onChange={(quality) => setGif({ quality })} />
            </Field>
            <ResizeControl value={settings.gif.resize} onChange={(resize) => setGif({ resize })} presets={[1280, 854, 640]} />
            <Advanced>
              <Field label="Frame rate" row>
                <NumberInput value={settings.gif.fps} onChange={(fps) => setGif({ fps: fps ?? 15 })} min={1} max={60} suffix="fps" />
              </Field>
              <Field label="Loop forever" row>
                <Toggle value={settings.gif.loop_forever} onChange={(loop_forever) => setGif({ loop_forever })} label="Loop forever" />
              </Field>
            </Advanced>
          </Group>
        )}

        {showPdf && (
          <Group icon={<RiFilePdf2Line size={14} />} title="PDF" summary={qLabel[settings.pdf.quality]} defaultOpen={first === "pdf"}>
            <Field label="Quality">
              <QualityPicker value={settings.pdf.quality} onChange={(quality) => setPdf({ quality })} />
            </Field>
            <ToolsHint tool="ghostscript" />
          </Group>
        )}

        <Group icon={<RiFolderDownloadLine size={14} />} title="Output" summary={outSummary(settings.output)} defaultOpen={!first}>
          <OutputSection out={settings.output} setOut={setOut} />
        </Group>
      </div>
    </aside>
  );
}

function outSummary(o: OutputSettings) {
  if (o.overwrite_original) return "Replace original";
  if (o.location === "subfolder") return `/${o.subfolder_name || "compressed"}`;
  if (o.location === "custom") return "Custom folder";
  return "Same folder";
}

function ToolsHint({ tool }: { tool: "ffmpeg" | "ghostscript" }) {
  const tools = useStore((s) => s.tools);
  if (!tools || tools[tool]) return null;
  return (
    <div className="notice">
      {tool === "ghostscript" ? <>Ghostscript is required for PDFs. Install: <code>brew install ghostscript</code></> : <>FFmpeg not found: <code>brew install ffmpeg</code></>}
    </div>
  );
}

export function OutputSection({ out, setOut }: { out: OutputSettings; setOut: (p: Partial<OutputSettings>) => void }) {
  return (
    <>
      <Field label="Save to">
        <Segmented value={out.location} options={[{ value: "samefolder", label: "Same folder" }, { value: "subfolder", label: "Subfolder" }, { value: "custom", label: "Choose…" }]} onChange={(location) => setOut({ location })} />
        {out.location === "subfolder" && (
          <input className="input" value={out.subfolder_name} onChange={(e) => setOut({ subfolder_name: e.target.value })} placeholder="compressed" />
        )}
        {out.location === "custom" && (
          <div className="inline">
            <input className="input" value={out.custom_dir} onChange={(e) => setOut({ custom_dir: e.target.value })} placeholder="/path/to/folder" />
            <button className="btn sm" onClick={async () => { const d = await open({ directory: true, multiple: false }); if (typeof d === "string") setOut({ custom_dir: d }); }}>Browse</button>
          </div>
        )}
      </Field>
      <Field label="Replace original" row hint="Overwrite the source file">
        <Toggle value={out.overwrite_original} onChange={(overwrite_original) => setOut({ overwrite_original, trash_original: overwrite_original ? false : out.trash_original })} label="Replace original" />
      </Field>
      <Advanced>
        <Field label="File name" hint="{name} {quality} {resolution} {date}">
          <input className="input" value={out.name_template} disabled={out.overwrite_original} onChange={(e) => setOut({ name_template: e.target.value })} />
        </Field>
        {!out.overwrite_original && (
          <Field label="Move original to Trash" row>
            <Toggle value={out.trash_original} onChange={(trash_original) => setOut({ trash_original })} label="Move original to Trash" />
          </Field>
        )}
        <Field label="Keep original dates" row>
          <Toggle value={out.keep_dates} onChange={(keep_dates) => setOut({ keep_dates })} label="Keep original dates" />
        </Field>
        <Field label="Never make it larger" row hint="Keep original if not smaller">
          <Toggle value={out.skip_if_larger} onChange={(skip_if_larger) => setOut({ skip_if_larger })} label="Never make it larger" />
        </Field>
      </Advanced>
    </>
  );
}
