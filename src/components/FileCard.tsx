import { Film, FileText, Image as ImageIcon, X, FolderOpen, RotateCcw, Ban, SlidersHorizontal, Play } from "lucide-react";
import { revealItemInDir, openPath } from "@tauri-apps/plugin-opener";
import type { MediaInfo } from "../lib/types";
import { fmtBytes, fmtDuration, extOf, savings, fmtElapsed } from "../lib/format";
import { useJobFor, useStore } from "../store";

export function FileCard({ file }: { file: MediaInfo }) {
  const job = useJobFor(file.path);
  const thumb = useStore((s) => s.thumbs[file.path]);
  const selected = useStore((s) => s.selected === file.path);
  const hasOverride = useStore((s) => !!s.overrides[file.path]);
  const { select, removeFile, cancelJob, compress } = useStore();

  const Icon = file.kind === "video" ? Film : file.kind === "pdf" ? FileText : ImageIcon;
  const dims = file.width && file.height ? `${file.width}×${file.height}` : null;
  const status = job?.status;
  const running = status === "running" || status === "queued";
  const sav = job?.status === "done" ? savings(file.size, job.output_size) : null;

  return (
    <div className={`card${selected ? " selected" : ""}`} onClick={() => select(selected ? null : file.path)}>
      <div className="thumb">
        {thumb ? <img src={thumb} alt="" draggable={false} /> : <Icon size={28} strokeWidth={1.5} />}
        <span className="badge">{extOf(file.path)}</span>
        {file.duration != null && file.kind === "video" && <span className="dur">{fmtDuration(file.duration)}</span>}
        {!running && (
          <button className="remove" title="Remove" onClick={(e) => { e.stopPropagation(); removeFile(file.path); }}>
            <X size={14} />
          </button>
        )}
        {hasOverride && (
          <span className="override pill accent" title="This file has custom settings"><SlidersHorizontal size={10} style={{ verticalAlign: -1 }} /> custom</span>
        )}
      </div>
      <div className="body">
        <div className="name" title={file.path}>{file.name}</div>
        <div className="meta">
          <span>{fmtBytes(file.size)}</span>
          {dims && <span className="dot">{dims}</span>}
          {file.video_codec && <span className="dot">{file.video_codec.toUpperCase()}</span>}
          {file.fps && file.kind === "video" && <span className="dot">{Math.round(file.fps)} fps</span>}
        </div>

        {running && (
          <>
            <div className={`progress${status === "queued" ? " indeterminate" : ""}`}><i style={{ width: `${status === "queued" ? 30 : job!.progress}%` }} /></div>
            <div className="result">
              <span className="sizes">{status === "queued" ? "Waiting…" : `${job!.progress.toFixed(0)}%`}</span>
              <button className="btn sm ghost danger" onClick={(e) => { e.stopPropagation(); cancelJob(job!.id); }}><Ban size={12} /> Cancel</button>
            </div>
          </>
        )}

        {status === "done" && job && (
          <>
            <div className="result">
              <span className="sizes"><s>{fmtBytes(file.size)}</s> → <b>{fmtBytes(job.output_size)}</b></span>
              {sav != null && (
                <span className={`pill ${sav > 0 ? "ok" : "warn"}`}>{sav > 0 ? `−${sav}%` : sav === 0 ? "same size" : `+${Math.abs(sav)}%`}</span>
              )}
            </div>
            <div className="result">
              <span className="meta">
                {job.output_width && job.output_height && <span>{job.output_width}×{job.output_height}</span>}
                <span className="dot">{fmtElapsed(job.elapsed_ms)}</span>
              </span>
              <span className="row-actions">
                {job.output_path && (
                  <>
                    <button className="icon-btn" title="Open" onClick={(e) => { e.stopPropagation(); void openPath(job.output_path!); }}><Play size={14} /></button>
                    <button className="icon-btn" title="Show in folder" onClick={(e) => { e.stopPropagation(); void revealItemInDir(job.output_path!); }}><FolderOpen size={14} /></button>
                  </>
                )}
                <button className="icon-btn" title="Compress again" onClick={(e) => { e.stopPropagation(); void compress([file.path]); }}><RotateCcw size={14} /></button>
              </span>
            </div>
          </>
        )}

        {status === "failed" && job && (
          <>
            <div className="result">
              <span className="pill err">Failed</span>
              <button className="btn sm ghost" onClick={(e) => { e.stopPropagation(); void compress([file.path]); }}><RotateCcw size={12} /> Retry</button>
            </div>
            {job.error && <div className="error-text" title={job.error}>{job.error}</div>}
          </>
        )}

        {status === "cancelled" && (
          <div className="result">
            <span className="pill muted">Cancelled</span>
            <button className="btn sm ghost" onClick={(e) => { e.stopPropagation(); void compress([file.path]); }}><RotateCcw size={12} /> Retry</button>
          </div>
        )}
      </div>
    </div>
  );
}
