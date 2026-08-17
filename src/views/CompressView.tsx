import { useMemo, useState } from "react";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { open } from "@tauri-apps/plugin-dialog";
import { RiAddLine, RiFolderAddLine, RiDeleteBinLine, RiFlashlightLine, RiForbidLine, RiArrowDownLine } from "@remixicon/react";
import { useStore } from "../store";
import { FileCard } from "../components/FileCard";
import { SettingsPanel } from "../components/SettingsPanel";
import { fmtBytes } from "../lib/format";
import type { MediaKind } from "../lib/types";
import { isTauri } from "../lib/tauri";

const FILTERS = [
  { name: "Media", extensions: ["mp4", "mov", "m4v", "mkv", "webm", "avi", "flv", "ts", "mts", "wmv", "mpg", "mpeg", "jpg", "jpeg", "png", "webp", "avif", "heic", "heif", "tif", "tiff", "bmp", "gif", "pdf"] },
];

export async function pickFiles(addPaths: (p: string[]) => Promise<void>) {
  if (!isTauri) return addPaths([]);
  const res = await open({ multiple: true, filters: FILTERS });
  if (Array.isArray(res)) await addPaths(res);
  else if (typeof res === "string") await addPaths([res]);
}
export async function pickFolder(addPaths: (p: string[]) => Promise<void>) {
  if (!isTauri) return addPaths([]);
  const res = await open({ directory: true, multiple: true });
  if (Array.isArray(res)) await addPaths(res);
  else if (typeof res === "string") await addPaths([res]);
}

export function CompressView() {
  const { files, settings, updateSettings, selected, overrides, setOverride, select, addPaths, clearFiles, compress, cancelAll, jobs, jobByPath, dragging, adding } = useStore();

  const kinds = useMemo(() => Array.from(new Set(files.map((f) => f.kind))) as MediaKind[], [files]);
  const selFile = files.find((f) => f.path === selected) ?? null;

  const stats = useMemo(() => {
    let inTotal = 0, outTotal = 0, doneIn = 0, done = 0, running = 0, queued = 0, failed = 0, pending = 0, prog = 0;
    for (const f of files) {
      inTotal += f.size;
      const j = jobByPath[f.path] ? jobs[jobByPath[f.path]] : undefined;
      if (!j) { pending++; continue; }
      if (j.status === "done") { done++; outTotal += j.output_size ?? 0; doneIn += f.size; prog += 100; }
      else if (j.status === "running") { running++; prog += j.progress; }
      else if (j.status === "queued") queued++;
      else if (j.status === "failed") failed++;
      else pending++;
    }
    return { inTotal, outTotal, doneIn, done, running, queued, failed, pending, avgProgress: files.length ? prog / files.length : 0 };
  }, [files, jobs, jobByPath]);

  const [confirm, setConfirm] = useState(false);
  if (!settings) return null;
  const destructive = settings.output.overwrite_original || settings.output.trash_original || Object.values(overrides).some((o) => o.output.overwrite_original || o.output.trash_original);
  const startCompress = () => { if (destructive) setConfirm(true); else void compress(); };
  const active = stats.running + stats.queued > 0;
  const canCompress = stats.pending > 0 && !active;
  const savedBytes = Math.max(0, stats.doneIn - stats.outTotal);
  const savedPct = stats.doneIn > 0 ? Math.round(((stats.doneIn - stats.outTotal) / stats.doneIn) * 100) : 0;

  return (
    <div className="main">
      <div className="content">
        {files.length === 0 ? (
          <div className="empty">
            <div className={`dropzone${dragging ? " active" : ""}`}>
              <img className="icon" src="/feather-logo.png" alt="" width={72} height={72} draggable={false} />
              <h2>Drop files to make them lighter</h2>
              <p>Videos, images, GIFs and PDFs — compressed on your device, never uploaded.</p>
              <div className="actions">
                <button className="btn primary lg" onClick={() => pickFiles(addPaths)} disabled={adding}><RiAddLine size={18} /> Add files</button>
                <button className="btn lg" onClick={() => pickFolder(addPaths)} disabled={adding}><RiFolderAddLine size={18} /> Add folder</button>
              </div>
              <div className="formats">
                {["MP4", "MOV", "MKV", "WebM", "AVI", "JPG", "PNG", "WebP", "AVIF", "HEIC", "TIFF", "GIF", "PDF"].map((f) => <span className="chip" key={f}>{f}</span>)}
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="toolbar">
              <span className="title">{files.length} file{files.length === 1 ? "" : "s"}</span>
              <span className="sub">{fmtBytes(stats.inTotal)}</span>
              <div className="spacer" />
              <button className="btn sm ghost" onClick={() => pickFiles(addPaths)} disabled={adding}><RiAddLine size={15} /> Add</button>
              <button className="btn sm ghost" onClick={() => pickFolder(addPaths)} disabled={adding}><RiFolderAddLine size={15} /> Folder</button>
              <button className="btn sm ghost" onClick={clearFiles} disabled={active} aria-label="Clear file list"><RiDeleteBinLine size={15} /> Clear</button>
            </div>
            <div className="filelist" onClick={(e) => { if (e.target === e.currentTarget) select(null); }}>
              <div className="file-grid" onClick={(e) => { if (e.target === e.currentTarget) select(null); }}>
                {files.map((f) => <FileCard key={f.path} file={f} />)}
              </div>
            </div>
          </>
        )}

        {files.length > 0 && (
          <div className="actionbar">
            <div className="stats">
              {stats.done > 0 && (
                <span className="savings-tag"><RiArrowDownLine size={14} /> {fmtBytes(savedBytes)} saved{stats.doneIn > 0 && ` · ${savedPct}%`}</span>
              )}
              {stats.done > 0 && <span><b>{stats.done}</b>/{files.length} done</span>}
              {stats.failed > 0 && <span style={{ color: "var(--err)" }}>{stats.failed} failed</span>}
              {active && <span>{stats.running} running{stats.queued > 0 && `, ${stats.queued} queued`}</span>}
              {!active && stats.done === 0 && stats.failed === 0 && <span>Ready · {stats.pending} file{stats.pending === 1 ? "" : "s"} · {fmtBytes(stats.inTotal)}</span>}
            </div>
            <div className="spacer" />
            {active && <div className="summary-progress progress"><i style={{ width: `${stats.avgProgress}%` }} /></div>}
            {active ? (
              <button className="btn lg danger" onClick={cancelAll}><RiForbidLine size={16} /> Cancel all</button>
            ) : stats.pending === 0 ? (
              <button className="btn lg" onClick={() => pickFiles(addPaths)}><RiAddLine size={16} /> Add more</button>
            ) : (
              <button className="btn primary lg" disabled={!canCompress} onClick={startCompress} title="⌘↩">
                <RiFlashlightLine size={16} /> Compress{stats.pending > 0 && files.length !== stats.pending ? ` ${stats.pending}` : ""}
              </button>
            )}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirm}
        title={settings.output.overwrite_original ? "Replace original files?" : "Move originals to Trash?"}
        confirmLabel={settings.output.overwrite_original ? "Replace & compress" : "Trash & compress"}
        onCancel={() => setConfirm(false)}
        onConfirm={() => { setConfirm(false); void compress(); }}
      >
        {settings.output.overwrite_original
          ? "Your source files will be overwritten with the compressed versions. This can't be undone."
          : "After compressing, the original files will be moved to the Trash. You can restore them from there."}
      </ConfirmDialog>

      {files.length === 0 ? null : selFile ? (
        <SettingsPanel
          key={selFile.path}
          settings={overrides[selFile.path] ?? settings}
          onChange={(fn) => setOverride(selFile.path, fn(overrides[selFile.path] ?? settings))}
          kinds={[selFile.kind]}
          title={selFile.name}
          subtitle={overrides[selFile.path] ? "Custom settings for this file" : "Changes apply to this file only"}
          onReset={overrides[selFile.path] ? () => setOverride(selFile.path, null) : undefined}
          onClose={() => select(null)}
        />
      ) : (
        <SettingsPanel
          settings={settings}
          onChange={updateSettings}
          kinds={kinds.length ? kinds : ["video", "image", "gif", "pdf"]}
          title="Settings"
          subtitle="Applies to all files · click a file to customize it"
        />
      )}
    </div>
  );
}
