import type { ReactElement } from "react";
import { RiDownloadCloud2Line, RiErrorWarningLine, RiCheckboxCircleFill } from "@remixicon/react";
import { useStore } from "../store";

/** Shown in the compress view when FFmpeg is missing / being installed, or Ghostscript is needed for PDFs. */
export function ToolsBanner() {
  const tools = useStore((s) => s.tools);
  const installs = useStore((s) => s.installs);
  const files = useStore((s) => s.files);
  const installTool = useStore((s) => s.installTool);
  if (!tools) return null;
  const items: ReactElement[] = [];
  const ff = installs["ffmpeg"];
  const needFf = !tools.ffmpeg || !tools.ffprobe;
  if (ff && ff.phase !== "error") {
    items.push(<Row key="ff" icon={ff.phase === "done" ? <RiCheckboxCircleFill size={16} color="var(--ok)" /> : <RiDownloadCloud2Line size={16} />} title={ff.phase === "done" ? "FFmpeg ready" : "Setting up FFmpeg"} sub={ff.message} pct={ff.percent} />);
  } else if (needFf) {
    items.push(<Row key="ff" icon={<RiErrorWarningLine size={16} color="var(--warn)" />} title="FFmpeg is required for videos, GIFs and previews" sub={ff?.phase === "error" ? ff.message : "Feather can download it for you (~60 MB, one time)."} action={<button className="btn sm primary" onClick={() => installTool("ffmpeg")}>Download FFmpeg</button>} />);
  }
  const gs = installs["ghostscript"];
  const needGs = !tools.ghostscript && files.some((f) => f.kind === "pdf");
  if (gs && gs.phase !== "error") {
    items.push(<Row key="gs" icon={gs.phase === "done" ? <RiCheckboxCircleFill size={16} color="var(--ok)" /> : <RiDownloadCloud2Line size={16} />} title={gs.phase === "done" ? "Ghostscript ready" : "Installing Ghostscript"} sub={gs.message} pct={gs.percent} />);
  } else if (needGs) {
    items.push(<Row key="gs" icon={<RiErrorWarningLine size={16} color="var(--warn)" />} title="Ghostscript is required for PDFs" sub={gs?.phase === "error" ? gs.message : "Feather can install it for you via Homebrew."} action={<button className="btn sm primary" onClick={() => installTool("ghostscript")}>Install Ghostscript</button>} />);
  }
  if (!items.length) return null;
  return <div className="tools-banner">{items}</div>;
}

function Row({ icon, title, sub, pct, action }: { icon: ReactElement; title: string; sub?: string; pct?: number | null; action?: ReactElement }) {
  return (
    <div className="tools-row">
      <span className="ti">{icon}</span>
      <div className="tt">
        <div className="t">{title}</div>
        {sub && <div className="s" title={sub}>{sub}</div>}
        {pct != null && <div className="progress" style={{ marginTop: 6 }}><i style={{ width: `${pct}%` }} /></div>}
      </div>
      {action}
    </div>
  );
}
