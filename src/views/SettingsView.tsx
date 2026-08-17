import { useEffect, useState } from "react";
import { RiCheckboxCircleFill, RiCloseCircleFill, RiRefreshLine, RiSunLine, RiMoonLine, RiComputerLine } from "@remixicon/react";
import { useStore } from "../store";
import { Field, NumberInput, Toggle } from "../components/Controls";
import { OutputSection } from "../components/SettingsPanel";
import { applyTheme, getTheme, type Theme } from "../lib/theme";

export function SettingsView() {
  const { settings, updateSettings, tools, refreshTools } = useStore();
  const [theme, setTheme] = useState<Theme>(getTheme());
  useEffect(() => applyTheme(theme), [theme]);
  if (!settings) return null;
  const isMac = navigator.userAgent.includes("Mac");

  const ToolRow = ({ name, path, hint }: { name: string; path: string | null; hint: string }) => (
    <div className="tool-status">
      <div>
        <div className="n">{name}</div>
        <code>{path ?? hint}</code>
      </div>
      {path ? <span className="pill ok"><RiCheckboxCircleFill size={12} /> Installed</span> : <span className="pill err"><RiCloseCircleFill size={12} /> Missing</span>}
    </div>
  );

  return (
    <div className="page">
      <div className="page-inner">
        <h1>Settings</h1>
        <p className="sub">Feather runs entirely on your device. Nothing is uploaded.</p>

        <div className="section-title">Appearance</div>
        <div className="panel">
          <Field label="Theme">
            <div className="theme-picker">
              {([["light", "Light", RiSunLine], ["dark", "Dark", RiMoonLine], ["system", "System", RiComputerLine]] as const).map(([v, l, I]) => (
                <button key={v} className={`theme-opt${theme === v ? " active" : ""}`} onClick={() => setTheme(v)}>
                  <span className={`swatch ${v}`} /><span className="tl"><I size={14} /> {l}</span>
                </button>
              ))}
            </div>
          </Field>
        </div>

        <div className="section-title">Engine</div>
        <div className="panel">
          <ToolRow name="FFmpeg" path={tools?.ffmpeg ?? null} hint={isMac ? "brew install ffmpeg" : "Install FFmpeg and add it to PATH"} />
          <ToolRow name="ffprobe" path={tools?.ffprobe ?? null} hint="Ships with FFmpeg" />
          <ToolRow name="Ghostscript · PDF" path={tools?.ghostscript ?? null} hint={isMac ? "brew install ghostscript" : "Install Ghostscript"} />
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button className="btn sm" onClick={refreshTools}><RiRefreshLine size={13} /> Re-detect</button>
          </div>
          <Field label="Custom FFmpeg path" hint="Leave empty to auto-detect">
            <input className="input" value={settings.ffmpeg_path ?? ""} placeholder="/opt/homebrew/bin/ffmpeg" onChange={(e) => updateSettings((s) => ({ ...s, ffmpeg_path: e.target.value || null }))} />
          </Field>
          <Field label="Custom Ghostscript path" hint="Leave empty to auto-detect">
            <input className="input" value={settings.gs_path ?? ""} placeholder="/opt/homebrew/bin/gs" onChange={(e) => updateSettings((s) => ({ ...s, gs_path: e.target.value || null }))} />
          </Field>
        </div>

        <div className="section-title">Performance</div>
        <div className="panel">
          <Field label="Parallel jobs" row hint="Files compressed at the same time · 1–2 for video, more for images">
            <NumberInput value={settings.concurrency} min={1} max={16} onChange={(v) => updateSettings((s) => ({ ...s, concurrency: Math.max(1, Math.min(16, v ?? 2)) }))} />
          </Field>
          <Field label="Encoder threads" row hint="0 = automatic">
            <NumberInput value={settings.video.threads} min={0} max={64} onChange={(v) => updateSettings((s) => ({ ...s, video: { ...s.video, threads: v ?? 0 } }))} />
          </Field>
          <Field label="Notify when finished" row hint="Only when Feather is in the background">
            <Toggle value={settings.notify_on_finish} onChange={(v) => updateSettings((s) => ({ ...s, notify_on_finish: v }))} />
          </Field>
        </div>

        <div className="section-title">Output defaults</div>
        <div className="panel">
          <OutputSection out={settings.output} setOut={(p) => updateSettings((s) => ({ ...s, output: { ...s.output, ...p } }))} />
        </div>

        <div className="section-title">Shortcuts</div>
        <div className="panel shortcuts">
          <div><span className="kbd">⌘O</span> Add files</div>
          <div><span className="kbd">⌘↩</span> Compress</div>
          <div><span className="kbd">⌘Y</span> History</div>
          <div><span className="kbd">⌘,</span> Settings</div>
          <div><span className="kbd">Esc</span> Deselect</div>
        </div>
        <p className="foot">Feather 0.1.0 · Video via FFmpeg · PDF via Ghostscript · Images natively</p>
      </div>
    </div>
  );
}
