import { CheckCircle2, XCircle, RefreshCw } from "lucide-react";
import { useStore } from "../store";
import { Field, NumberInput, Toggle } from "../components/Controls";
import { OutputSection } from "../components/SettingsPanel";

export function SettingsView() {
  const { settings, updateSettings, tools, refreshTools } = useStore();
  if (!settings) return null;
  const isMac = navigator.userAgent.includes("Mac");
  const row = (name: string, path: string | null, hint: string) => (
    <div className="tool-status">
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 500 }}>
          {path ? <CheckCircle2 size={15} color="var(--ok)" /> : <XCircle size={15} color="var(--err)" />} {name}
        </div>
        <code>{path ?? hint}</code>
      </div>
    </div>
  );
  return (
    <div className="page" style={{ maxWidth: 720 }}>
      <h1>Settings</h1>
      <p className="sub">Feather runs everything locally. Nothing is uploaded.</p>

      <div className="section-title">Engine</div>
      <div className="panel">
        <div style={{ display: "flex", justifyContent: "flex-end", paddingTop: 8 }}>
          <button className="btn sm ghost" onClick={refreshTools}><RefreshCw size={12} /> Re-detect</button>
        </div>
        {row("FFmpeg", tools?.ffmpeg ?? null, isMac ? "Not found — brew install ffmpeg" : "Not found — install FFmpeg and add it to PATH")}
        {row("ffprobe", tools?.ffprobe ?? null, "Not found — ships with FFmpeg")}
        {row("Ghostscript (PDF)", tools?.ghostscript ?? null, isMac ? "Not found — brew install ghostscript" : "Not found — install Ghostscript")}
        <Field label="Custom FFmpeg path" hint="Leave empty to auto-detect.">
          <input className="input" value={settings.ffmpeg_path ?? ""} placeholder="/opt/homebrew/bin/ffmpeg" onChange={(e) => updateSettings((s) => ({ ...s, ffmpeg_path: e.target.value || null }))} />
        </Field>
        <Field label="Custom Ghostscript path" hint="Leave empty to auto-detect.">
          <input className="input" value={settings.gs_path ?? ""} placeholder="/opt/homebrew/bin/gs" onChange={(e) => updateSettings((s) => ({ ...s, gs_path: e.target.value || null }))} />
        </Field>
      </div>

      <div className="section-title">Performance</div>
      <div className="panel">
        <Field label="Parallel jobs" row hint="How many files compress at the same time. Video encoding already uses all cores; 1–2 is usually fastest for video, more for images.">
          <NumberInput value={settings.concurrency} min={1} max={16} onChange={(v) => updateSettings((s) => ({ ...s, concurrency: Math.max(1, Math.min(16, v ?? 2)) }))} />
        </Field>
        <Field label="Video encoder threads" row hint="0 = automatic.">
          <NumberInput value={settings.video.threads} min={0} max={64} onChange={(v) => updateSettings((s) => ({ ...s, video: { ...s.video, threads: v ?? 0 } }))} />
        </Field>
        <Field label="Notify when finished" row>
          <Toggle value={settings.notify_on_finish} onChange={(v) => updateSettings((s) => ({ ...s, notify_on_finish: v }))} />
        </Field>
      </div>

      <div className="section-title">Output defaults</div>
      <div className="panel">
        <OutputSection out={settings.output} setOut={(p) => updateSettings((s) => ({ ...s, output: { ...s.output, ...p } }))} />
      </div>
    </div>
  );
}
