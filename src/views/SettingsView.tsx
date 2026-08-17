import { useEffect, useState } from "react";
import { RiCheckboxCircleFill, RiCloseCircleFill, RiRefreshLine, RiSunLine, RiMoonLine, RiComputerLine, RiFolderAddLine, RiCloseLine, RiDownloadLine } from "@remixicon/react";
import { open } from "@tauri-apps/plugin-dialog";
import { api } from "../lib/api";
import { isTauri } from "../lib/tauri";
import { useStore } from "../store";
import { Field, NumberInput, Toggle } from "../components/Controls";
import { OutputSection } from "../components/SettingsPanel";
import { applyTheme, getTheme, type Theme } from "../lib/theme";

export function SettingsView() {
  const { settings, updateSettings, tools, refreshTools, installs, installTool } = useStore();
  const [theme, setThemeState] = useState<Theme>(getTheme());
  const [qa, setQa] = useState<string>("");
  const [cli, setCli] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => { void api.cliPath().then(setCli); }, []);
  const mcpConfig = cli ? JSON.stringify({ mcpServers: { feather: { command: cli, args: ["mcp"] } } }, null, 2) : "";
  const copy = async (t: string) => { try { await navigator.clipboard.writeText(t); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* ignore */ } };
  const setTheme = (t: Theme) => { applyTheme(t); setThemeState(t); };
  if (!settings) return null;
  const isMac = navigator.userAgent.includes("Mac");
  const setWatch = (p: Partial<typeof settings.watch>) => updateSettings((s) => ({ ...s, watch: { ...s.watch, ...p } }));
  const addFolders = (fs: string[]) => setWatch({ folders: Array.from(new Set([...settings.watch.folders, ...fs])) });
  const addFolder = async () => {
    if (!isTauri) return addFolders(["/Users/demo/Desktop"]);
    const d = await open({ directory: true, multiple: true });
    if (Array.isArray(d)) addFolders(d); else if (typeof d === "string") addFolders([d]);
  };
  const addDownloads = async () => {
    const dirs = await api.appDirs();
    if (dirs.downloads) addFolders([dirs.downloads]); else if (!isTauri) addFolders(["/Users/demo/Downloads"]);
  };

  const ToolRow = ({ name, path, hint, tool }: { name: string; path: string | null; hint: string; tool?: "ffmpeg" | "ghostscript" }) => {
    const inst = tool ? installs[tool] : undefined;
    return (
      <div className="tool-status">
        <div style={{ minWidth: 0 }}>
          <div className="n">{name}</div>
          <code>{path ?? (inst ? inst.message : hint)}</code>
        </div>
        {path ? <span className="pill ok"><RiCheckboxCircleFill size={12} /> Installed</span>
          : inst && inst.phase !== "error" ? <span className="pill accent">{inst.percent != null ? `${Math.round(inst.percent)}%` : "Installing…"}</span>
          : tool ? <button className="btn sm primary" onClick={() => installTool(tool)}>{tool === "ffmpeg" ? "Download" : "Install"}</button>
          : <span className="pill err"><RiCloseCircleFill size={12} /> Missing</span>}
      </div>
    );
  };

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

        <div className="section-title">Auto-compress</div>
        <div className="panel">
          <Field label="Watch folders" row hint="New videos & images dropped in these folders are compressed automatically">
            <Toggle value={settings.watch.enabled} onChange={(enabled) => setWatch({ enabled })} label="Auto-compress" />
          </Field>
          {settings.watch.enabled && (
            <>
              <div className="folder-list">
                {settings.watch.folders.length === 0 && <div className="hint">No folders yet — add your Downloads folder to start.</div>}
                {settings.watch.folders.map((f) => (
                  <div className="folder-row" key={f}>
                    <span className="path" title={f}>{shortPath(f)}</span>
                    <button className="icon-btn sm" aria-label="Remove folder" onClick={() => setWatch({ folders: settings.watch.folders.filter((x) => x !== f) })}><RiCloseLine size={14} /></button>
                  </div>
                ))}
                <div className="inline">
                  <button className="btn sm" onClick={addDownloads}><RiDownloadLine size={13} /> Add Downloads</button>
                  <button className="btn sm ghost" onClick={addFolder}><RiFolderAddLine size={13} /> Choose folder…</button>
                </div>
              </div>
              <Field label="File types">
                <div className="chips">
                  {([["videos", "Videos"], ["images", "Images"], ["gifs", "GIFs"], ["pdfs", "PDFs"]] as const).map(([k, l]) => (
                    <button key={k} className={`chip-toggle${settings.watch[k] ? " on" : ""}`} aria-pressed={settings.watch[k]} onClick={() => setWatch({ [k]: !settings.watch[k] })}>{l}</button>
                  ))}
                </div>
              </Field>
              <Field label="Replace the original file" row hint="Compressed version takes the place of the download (same name)">
                <Toggle value={settings.output.overwrite_original} onChange={(overwrite_original) => updateSettings((s) => ({ ...s, output: { ...s.output, overwrite_original, trash_original: overwrite_original ? false : s.output.trash_original } }))} label="Replace the original file" />
              </Field>
              <Field label="Wait before compressing" row hint="Lets downloads finish writing">
                <NumberInput value={settings.watch.settle_secs} min={1} max={120} onChange={(v) => setWatch({ settle_secs: Math.max(1, v ?? 5) })} suffix="s" />
              </Field>
            </>
          )}
        </div>

        {isMac && (
          <>
            <div className="section-title">Finder</div>
            <div className="panel">
              <Field label="Right-click → Compress with Feather" row hint="Adds a Quick Action to Finder's context menu">
                <button className="btn sm" onClick={async () => { try { await api.installQuickAction(); setQa("installed"); } catch (e) { setQa(String(e)); } }}>
                  {qa === "installed" ? "Installed ✓" : "Install"}
                </button>
              </Field>
              {qa && qa !== "installed" && <div className="notice err">{qa}</div>}
              <div className="hint">You can also right-click any file → Open With → Feather.</div>
            </div>
          </>
        )}

        <div className="section-title">AI agents · MCP</div>
        <div className="panel">
          <div className="hint" style={{ marginBottom: -4 }}>Feather ships an MCP server so Claude, Cursor or any MCP client can compress files for you (tools: compress, probe, estimate, history).</div>
          {cli ? (
            <>
              <Field label="Claude Code" hint="Run once in a terminal">
                <div className="code-row"><code>claude mcp add feather -- "{cli}" mcp</code><button className="btn sm" onClick={() => copy(`claude mcp add feather -- "${cli}" mcp`)}>{copied ? "Copied" : "Copy"}</button></div>
              </Field>
              <Field label="Claude Desktop / Cursor / others" hint="Add to the client's MCP config (claude_desktop_config.json, .cursor/mcp.json…)">
                <div className="code-row"><pre>{mcpConfig}</pre><button className="btn sm" onClick={() => copy(mcpConfig)}>{copied ? "Copied" : "Copy"}</button></div>
              </Field>
              <Field label="Terminal" hint="The same binary is a CLI">
                <div className="code-row"><code>"{cli}" compress ~/Movies/*.mp4 --quality good --max 1920</code></div>
              </Field>
            </>
          ) : (
            <div className="notice">The CLI/MCP binary ships inside the built app (Feather.app). Build with <code>pnpm tauri build</code> or run <code>sh scripts/build-cli.sh</code>.</div>
          )}
        </div>

        <div className="section-title">Engine</div>
        <div className="panel">
          <ToolRow name="FFmpeg" path={tools?.ffmpeg ?? null} hint="Not installed — Feather can download it" tool="ffmpeg" />
          <ToolRow name="ffprobe" path={tools?.ffprobe ?? null} hint="Comes with the FFmpeg download" />
          <ToolRow name="Ghostscript · PDF" path={tools?.ghostscript ?? null} hint={isMac ? "Not installed — Feather can install it via Homebrew" : "Not installed"} tool="ghostscript" />
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

function shortPath(p: string) {
  return p.replace(/^\/Users\/[^/]+/, "~").replace(/^C:\\Users\\[^\\]+/, "~");
}
