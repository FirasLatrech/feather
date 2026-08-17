export function fmtBytes(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 ? v.toFixed(2) : v < 100 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

export function fmtDuration(s: number | null | undefined): string {
  if (s == null || !isFinite(s)) return "";
  const t = Math.round(s);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sec = t % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
}

export function fmtElapsed(ms: number | null | undefined): string {
  if (ms == null) return "";
  if (ms < 1000) return `${ms} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)} s`;
  return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
}

export function savings(inSize: number, outSize: number | null | undefined): number | null {
  if (outSize == null || inSize === 0) return null;
  return Math.round(((inSize - outSize) / inSize) * 1000) / 10;
}

export function extOf(path: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(path);
  return m ? m[1].toUpperCase() : "";
}

export function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

export function fmtEta(secs: number | null | undefined): string {
  if (secs == null || !isFinite(secs)) return "";
  if (secs < 5) return "a few seconds";
  if (secs < 60) return `${Math.round(secs)} s left`;
  if (secs < 3600) return `${Math.ceil(secs / 60)} min left`;
  const h = Math.floor(secs / 3600), m = Math.round((secs % 3600) / 60);
  return `${h} h ${m} min left`;
}
