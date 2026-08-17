import { useMemo } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { Plus, FolderPlus, Trash2, Zap, Ban, Feather } from "lucide-react";
import { useStore } from "../store";
import { FileCard } from "../components/FileCard";
import { SettingsPanel } from "../components/SettingsPanel";
import { fmtBytes } from "../lib/format";
import type { MediaKind } from "../lib/types";

const FILTERS = [
  { name: "Media", extensions: ["mp4", "mov", "m4v", "mkv", "webm", "avi", "flv", "ts", "mts", "wmv", "mpg", "mpeg", "jpg", "jpeg", "png", "webp", "avif", "heic", "heif", "tif", "tiff", "bmp", "gif", "pdf"] },
];

export async function pickFiles(addPaths: (p: string[]) => Promise<void>) {
  const res = await open({ multiple: true, filters: FILTERS });
  if (Array.isArray(res)) await addPaths(res);
  else if (typeof res === "string") await addPaths([res]);
}
export async function pickFolder(addPaths: (p: string[]) => Promise<void>) {
  const res = await open({ directory: true, multiple: true });
  if (Array.isArray(res)) await addPaths(res);
  else if (typeof res === "string") await addPaths([res]);
}

export function CompressView() {
  const { files, settings, updateSettings, selected, overrides, setOverride, addPaths, clearFiles, compress, cancelAll, jobs, jobByPath, dragging, adding } = useStore();

  const kinds = useMemo(() => Array.from(new Set(files.map((f) => f.kind))) as MediaKind[], [files]);
  const selFile = files.find((f) => f.path === selected) ?? null;

  const stats = useMemo(() => {
    let inTotal = 0, outTotal = 0, done = 0, running = 0, queued = 0, failed = 0, pending = 0;
    for (const f of files) {
      inTotal += f.size;
      const j = jobByPath[f.path] ? jobs[jobByPath[f.path]] : undefined;
      if (!j) { pending++; continue; }
      if (j.status === "done") { done++; outTotal += j.output_size ?? 0; }
      else if (j.status === "running") running++;
      else if (j.status === "queued") queued++;
      else if (j.status === "failed") failed++;
      else pending++;
    }
    const doneIn = files.reduce((acc, f) => { const j = jobByPath[f.path] ? jobs[jobByPath[f.path]] : undefined; return j?.status === "done" ? acc + f.size : acc; }, 0);
    const avgProgress = files.length ? files.reduce((acc, f) => { const j = jobByPath[f.path] ? jobs[jobByPath[f.path]] : undefined; return acc + (j ? (j.status === "done" ? 100 : j.status === "running" ? j.progress : 0) : 0); }, 0) / files.length : 0;
    return { inTotal, outTotal, doneIn, done, running, queued, failed, pending, avgProgress };
  }, [files, jobs, jobByPath]);

  if (!settings) return null;

  const active = stats.running + stats.queued > 0;
  const canCompress = stats.pending > 0 && !active;

  return (
    <div className="main">
      <div className="content">
        {files.length === 0 ? (
          <div className="empty">
            <div className={`dropzone${dragging ? " active" : ""}`}>
              <div className="icon"><Feather size={30} /></div>
              <h2>Drop files to make them lighter</h2>
              <p>Videos, images, GIFs and PDFs. Everything stays on your device.</p>
              <div className="actions">
                <button className="btn primary lg" onClick={() => pickFiles(addPaths)} disabled={adding}><Plus size={16} /> Add files</button>
                <button className="btn lg" onClick={() => pickFolder(addPaths)} disabled={adding}><FolderPlus size={16} /> Add folder</button>
              </div>
              <div className="formats">
                {["MP4", "MOV", "MKV", "WebM", "AVI", "JPG", "PNG", "WebP", "AVIF", "HEIC", "TIFF", "GIF", "PDF"].map((f) => <span className="chip" key={f}>{f}</span>)}
              </div>
            </div>
          </div>
        ) : (
          <div className="filelist" onClick={(e) => { if (e.target === e.currentTarget) useStore.getState().select(null); }}>
            <div className="file-grid">
              {files.map((f) => <FileCard key={f.path} file={f} />)}
            </div>
          </div>
        )}

        <div className="actionbar">
          <button className="btn" onClick={() => pickFiles(addPaths)} disabled={adding}><Plus size={14} /> Add</button>
          <button className="btn ghost" onClick={() => pickFolder(addPaths)} disabled={adding}><FolderPlus size={14} /> Folder</button>
          {files.length > 0 && <button className="btn ghost" onClick={clearFiles} disabled={active}><Trash2 size={14} /> Clear</button>}
          <div className="spacer" />
          {files.length > 0 && (
            <div className="stats">
              <span><b>{files.length}</b> file{files.length === 1 ? "" : "s"}</span>
              <span><b>{fmtBytes(stats.inTotal)}</b></span>
              {stats.done > 0 && (
                <span>saved <b style={{ color: "var(--ok)" }}>{fmtBytes(Math.max(0, stats.doneIn - stats.outTotal))}</b>{stats.doneIn > 0 && ` (${Math.round(((stats.doneIn - stats.outTotal) / stats.doneIn) * 100)}%)`}</span>
              )}
              {stats.failed > 0 && <span style={{ color: "var(--err)" }}>{stats.failed} failed</span>}
            </div>
          )}
          {active && (
            <div className="summary-progress progress"><i style={{ width: `${stats.avgProgress}%` }} /></div>
          )}
          {active ? (
            <button className="btn lg danger" onClick={cancelAll}><Ban size={16} /> Cancel all</button>
          ) : (
            <button className="btn primary lg" disabled={!canCompress} onClick={() => compress()}>
              <Zap size={16} /> Compress{stats.pending > 0 && files.length !== stats.pending ? ` ${stats.pending}` : ""}
            </button>
          )}
        </div>
      </div>

      {selFile ? (
        <SettingsPanel
          key={selFile.path}
          settings={overrides[selFile.path] ?? settings}
          onChange={(fn) => setOverride(selFile.path, fn(overrides[selFile.path] ?? settings))}
          kinds={[selFile.kind]}
          title={selFile.name}
          subtitle={overrides[selFile.path] ? "Custom settings for this file" : "Editing creates per-file settings"}
          onReset={overrides[selFile.path] ? () => setOverride(selFile.path, null) : undefined}
        />
      ) : (
        <SettingsPanel
          settings={settings}
          onChange={updateSettings}
          kinds={kinds.length ? kinds : ["video", "image", "gif", "pdf"]}
          title="Settings"
          subtitle={files.length ? "Applies to all files without custom settings" : "Defaults for new files"}
        />
      )}
    </div>
  );
}
