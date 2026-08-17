import { useEffect, useMemo, useState } from "react";
import { FolderOpen, Trash2 } from "lucide-react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { api } from "../lib/api";
import type { HistoryItem } from "../lib/types";
import { fmtBytes, fmtElapsed, savings } from "../lib/format";
import { useStore } from "../store";

export function HistoryView() {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const jobs = useStore((s) => s.jobs);
  useEffect(() => { void api.getHistory().then(setItems); }, [jobs]);

  const stats = useMemo(() => {
    const inS = items.reduce((a, i) => a + i.input_size, 0);
    const outS = items.reduce((a, i) => a + i.output_size, 0);
    return { count: items.length, inS, outS, saved: Math.max(0, inS - outS), pct: inS ? Math.round(((inS - outS) / inS) * 100) : 0 };
  }, [items]);

  return (
    <div className="page">
      <div style={{ display: "flex", alignItems: "flex-start" }}>
        <div style={{ flex: 1 }}>
          <h1>History</h1>
          <p className="sub">Everything you've compressed on this device.</p>
        </div>
        {items.length > 0 && <button className="btn ghost danger" onClick={async () => { await api.clearHistory(); setItems([]); }}><Trash2 size={14} /> Clear history</button>}
      </div>
      <div className="stat-row">
        <div className="stat"><div className="k">Files compressed</div><div className="v">{stats.count}</div></div>
        <div className="stat"><div className="k">Original size</div><div className="v">{fmtBytes(stats.inS)}</div></div>
        <div className="stat"><div className="k">Space saved</div><div className="v" style={{ color: "var(--ok)" }}>{fmtBytes(stats.saved)}</div></div>
        <div className="stat"><div className="k">Average reduction</div><div className="v">{stats.pct}%</div></div>
      </div>
      {items.length === 0 ? (
        <div className="panel" style={{ padding: 30, textAlign: "center", color: "var(--fg-3)" }}>Nothing yet. Compress something!</div>
      ) : (
        <div className="panel" style={{ padding: 0, overflow: "auto" }}>
          <table className="hist">
            <thead><tr><th>File</th><th>Type</th><th>Before</th><th>After</th><th>Saved</th><th>Time</th><th>When</th><th></th></tr></thead>
            <tbody>
              {[...items].reverse().map((i) => {
                const s = savings(i.input_size, i.output_size);
                return (
                  <tr key={i.id}>
                    <td className="name" title={i.output_path}>{i.input_name}</td>
                    <td><span className="pill muted">{i.kind.toUpperCase()}</span></td>
                    <td className="num">{fmtBytes(i.input_size)}</td>
                    <td className="num">{fmtBytes(i.output_size)}</td>
                    <td>{s != null && <span className={`pill ${s > 0 ? "ok" : "warn"}`}>{s > 0 ? `−${s}%` : `+${Math.abs(s)}%`}</span>}</td>
                    <td className="num">{fmtElapsed(i.elapsed_ms)}</td>
                    <td style={{ color: "var(--fg-3)" }}>{new Date(i.finished_at).toLocaleString()}</td>
                    <td><button className="icon-btn" title="Show in folder" onClick={() => void revealItemInDir(i.output_path)}><FolderOpen size={14} /></button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
