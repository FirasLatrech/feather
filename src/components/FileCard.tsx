import { RiFilmLine, RiFilePdf2Line, RiImageLine, RiCloseLine, RiFolderOpenLine, RiRestartLine, RiForbidLine, RiEqualizerLine, RiPlayLine, RiFileGifLine } from "@remixicon/react";
import { revealItemInDir, openPath } from "@tauri-apps/plugin-opener";
import type { MediaInfo } from "../lib/types";
import { fmtBytes, fmtDuration, extOf, savings, fmtElapsed, fmtEta } from "../lib/format";
import { useJobFor, useStore } from "../store";

export function FileCard({ file }: { file: MediaInfo }) {
  const job = useJobFor(file.path);
  const thumb = useStore((s) => s.thumbs[file.path]);
  const selected = useStore((s) => s.selected === file.path);
  const hasOverride = useStore((s) => !!s.overrides[file.path]);
  const est = useStore((s) => s.estimates[file.path]);
  const { select, removeFile, cancelJob, compress } = useStore();

  const Icon = file.kind === "video" ? RiFilmLine : file.kind === "pdf" ? RiFilePdf2Line : file.kind === "gif" ? RiFileGifLine : RiImageLine;
  const dims = file.width && file.height ? `${file.width}×${file.height}` : null;
  const status = job?.status;
  const running = status === "running" || status === "queued";
  const sav = job?.status === "done" ? savings(file.size, job.output_size) : null;
  const stop = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <div className={`card${selected ? " selected" : ""}`} onClick={() => select(selected ? null : file.path)}>
      <div className="thumb">
        {thumb ? <img src={thumb} alt="" draggable={false} /> : <Icon size={30} />}
        <span className="badge">{extOf(file.path)}</span>
        {file.duration != null && file.kind === "video" && <span className="dur">{fmtDuration(file.duration)}</span>}
        {!running && (
          <button className="remove" title="Remove" aria-label="Remove file" onClick={(e) => { stop(e); removeFile(file.path); }}><RiCloseLine size={14} /></button>
        )}
        {hasOverride && <span className="custom pill glass" title="Custom settings"><RiEqualizerLine size={11} /> custom</span>}
      </div>
      <div className="body">
        <div className="name" title={file.path}>{file.name}</div>
        <div className="meta">
          <span>{fmtBytes(file.size)}</span>
          {dims && <span>{dims}</span>}
          {file.video_codec && file.kind === "video" && <span>{file.video_codec.toUpperCase()}</span>}
        </div>

        {!status && est?.size != null && (
          <div className="result est">
            <span className="sizes">≈ <b>{fmtBytes(est.size)}</b>{est.time != null && <span className="dim">· {est.time < 5 ? "instant" : `~${fmtEta(est.time).replace(" left", "")}`}</span>}</span>
            {est.already_small
              ? <span className="pill warn" title="This file is already efficiently compressed; expect little or no reduction">already small</span>
              : <span className="pill muted">−{savings(file.size, est.size)}%</span>}
          </div>
        )}

        {running && (
          <>
            <div className={`progress${status === "queued" ? " indeterminate" : ""}`}><i style={{ width: `${status === "queued" ? 30 : job!.progress}%` }} /></div>
            <div className="result">
              <span className="sizes">
                {status === "queued" ? "Waiting…" : `${job!.progress.toFixed(0)}%`}
                {status === "running" && job!.speed != null && <span className="dim">· {job!.speed.toFixed(1)}×</span>}
                {status === "running" && job!.eta_secs != null && <span className="dim">· {fmtEta(job!.eta_secs)}</span>}
              </span>
              <button className="btn sm ghost danger" onClick={(e) => { stop(e); void cancelJob(job!.id); }}><RiForbidLine size={13} /> Cancel</button>
            </div>
          </>
        )}

        {status === "done" && job && (
          <>
            <div className="result">
              <span className="sizes"><s>{fmtBytes(file.size)}</s> → <b>{fmtBytes(job.output_size)}</b></span>
              {sav != null && <span className={`pill ${sav > 0 ? "ok" : "warn"}`}>{sav > 0 ? `−${sav}%` : sav === 0 ? "same" : `+${Math.abs(sav)}%`}</span>}
            </div>
            <div className="result">
              <span className="meta">
                {job.output_width && job.output_height && (job.output_width !== file.width || job.output_height !== file.height) && <span>{job.output_width}×{job.output_height}</span>}
                <span>{fmtElapsed(job.elapsed_ms)}</span>
                {job.output_path && <span title={job.output_path}>{job.output_path.split(/[\/]/).slice(-2, -1)[0]}/</span>}
              </span>
              <span className="row-actions">
                {job.output_path && (
                  <>
                    <button className="icon-btn sm" title="Open" aria-label="Open result" onClick={(e) => { stop(e); void openPath(job.output_path!); }}><RiPlayLine size={15} /></button>
                    <button className="icon-btn sm" title="Show in folder" aria-label="Show in folder" onClick={(e) => { stop(e); void revealItemInDir(job.output_path!); }}><RiFolderOpenLine size={15} /></button>
                  </>
                )}
                <button className="icon-btn sm" title="Compress again" aria-label="Compress again" onClick={(e) => { stop(e); void compress([file.path]); }}><RiRestartLine size={15} /></button>
              </span>
            </div>
          </>
        )}

        {status === "failed" && job && (
          <>
            <div className="result">
              <span className="pill err">Failed</span>
              <button className="btn sm ghost" onClick={(e) => { stop(e); void compress([file.path]); }}><RiRestartLine size={13} /> Retry</button>
            </div>
            {job.error && <div className="error-text" title={job.error}>{job.error}</div>}
          </>
        )}

        {status === "cancelled" && (
          <div className="result">
            <span className="pill muted">Cancelled</span>
            <button className="btn sm ghost" onClick={(e) => { stop(e); void compress([file.path]); }}><RiRestartLine size={13} /> Retry</button>
          </div>
        )}
      </div>
    </div>
  );
}
