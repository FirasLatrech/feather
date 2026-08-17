import { create } from "zustand";
import { listen as tauriListen } from "@tauri-apps/api/event";
import { convertFileSrc as tauriConvert } from "@tauri-apps/api/core";
import { isTauri } from "./lib/tauri";
import { mockListen, mockConvertFileSrc } from "./lib/mock";
const listen: typeof tauriListen = isTauri ? tauriListen : (mockListen as unknown as typeof tauriListen);
const convertFileSrc = isTauri ? tauriConvert : mockConvertFileSrc;
import { api } from "./lib/api";
import { notify } from "./lib/notify";
import type { Estimate, Job, MediaInfo, Settings, Tools } from "./lib/types";

export type View = "compress" | "history" | "settings";

interface State {
  ready: boolean;
  view: View;
  files: MediaInfo[];
  overrides: Record<string, Settings>;
  selected: string | null;
  jobs: Record<string, Job>;
  jobByPath: Record<string, string>;
  settings: Settings | null;
  tools: Tools | null;
  thumbs: Record<string, string>;
  estimates: Record<string, Estimate>;
  refreshEstimates: () => Promise<void>;
  dragging: boolean;
  adding: boolean;
  init: () => Promise<void>;
  setView: (v: View) => void;
  addPaths: (paths: string[]) => Promise<void>;
  removeFile: (path: string) => void;
  clearFiles: () => void;
  select: (path: string | null) => void;
  setOverride: (path: string, s: Settings | null) => void;
  updateSettings: (fn: (s: Settings) => Settings) => void;
  compress: (paths?: string[]) => Promise<void>;
  cancelJob: (id: string) => Promise<void>;
  cancelAll: () => Promise<void>;
  loadThumb: (path: string) => Promise<void>;
  setDragging: (v: boolean) => void;
  refreshTools: () => Promise<void>;
}

let saveTimer: number | undefined;
let estTimer: number | undefined;

export const useStore = create<State>((set, get) => ({
  ready: false,
  view: "compress",
  files: [],
  overrides: {},
  selected: null,
  jobs: {},
  jobByPath: {},
  settings: null,
  tools: null,
  thumbs: {},
  estimates: {},
  dragging: false,
  adding: false,

  init: async () => {
    const [settings, tools, jobs] = await Promise.all([api.getSettings(), api.getTools(), api.listJobs()]);
    const jobMap: Record<string, Job> = {};
    const jobByPath: Record<string, string> = {};
    for (const j of jobs) {
      jobMap[j.id] = j;
      jobByPath[j.input.path] = j.id;
    }
    set({ settings, tools, jobs: jobMap, jobByPath, ready: true });
    if (!isTauri) {
      // Browser preview: ?demo=files | running | done | history | settings, &select=1
      const q = new URLSearchParams(location.search);
      const demo = q.get("demo");
      if (demo === "history") set({ view: "history" });
      if (demo === "settings") set({ view: "settings" });
      if (demo === "files" || demo === "running" || demo === "done") {
        await get().addPaths([]);
        if (q.get("select")) set({ selected: get().files[0]?.path ?? null });
        if (demo === "running" || demo === "done") await get().compress();
      }
    }
    await listen<Job>("job:update", (e) => {
      const j = e.payload;
      const prev = get().jobs[j.id];
      set((s) => {
        const known = s.files.some((f) => f.path === j.input.path);
        return {
          jobs: { ...s.jobs, [j.id]: j },
          jobByPath: { ...s.jobByPath, [j.input.path]: j.id },
          // Jobs started by the folder watcher: surface them in the list.
          files: known ? s.files : [...s.files, j.input],
        };
      });
      if (!get().thumbs[j.input.path]) void get().loadThumb(j.input.path);
      if (prev?.status !== j.status && (j.status === "done" || j.status === "failed")) {
        // Notify when the whole batch settles (not per file), if enabled and app is not focused.
        const all = Object.values(get().jobs);
        const stillActive = all.some((x) => x.status === "running" || x.status === "queued");
        if (!stillActive) void notify(all);
      }
    });
    await listen("jobs:changed", async () => {
      const list = await api.listJobs();
      const jobMap: Record<string, Job> = {};
      const byPath: Record<string, string> = {};
      for (const j of list) {
        jobMap[j.id] = j;
        byPath[j.input.path] = j.id;
      }
      set({ jobs: jobMap, jobByPath: byPath });
    });
  },

  setView: (view) => set({ view }),

  addPaths: async (paths) => {
    if (!paths.length && isTauri) return;
    set({ adding: true });
    try {
      const infos = await api.probePaths(paths);
      set((s) => {
        const existing = new Set(s.files.map((f) => f.path));
        const fresh = infos.filter((f) => !existing.has(f.path));
        // Re-adding a file that already has a finished job: reset the job link so it can run again.
        const jobByPath = { ...s.jobByPath };
        for (const f of infos) delete jobByPath[f.path];
        return { files: [...s.files, ...fresh], jobByPath, view: "compress" };
      });
      for (const f of infos) void get().loadThumb(f.path);
      void get().refreshEstimates();
    } finally {
      set({ adding: false });
    }
  },

  removeFile: (path) => {
    const jobId = get().jobByPath[path];
    if (jobId) void api.removeJob(jobId);
    set((s) => {
      const overrides = { ...s.overrides };
      delete overrides[path];
      return {
        files: s.files.filter((f) => f.path !== path),
        overrides,
        selected: s.selected === path ? null : s.selected,
      };
    });
  },

  clearFiles: () => {
    void api.cancelAll().then(() => api.clearFinished());
    set({ files: [], overrides: {}, selected: null, jobByPath: {} });
  },

  select: (selected) => set({ selected }),

  setOverride: (path, s) => {
    set((st) => {
      const overrides = { ...st.overrides };
      if (s) overrides[path] = s;
      else delete overrides[path];
      return { overrides };
    });
    window.clearTimeout(estTimer);
    estTimer = window.setTimeout(() => void get().refreshEstimates(), 250);
  },

  updateSettings: (fn) => {
    const cur = get().settings;
    if (!cur) return;
    const next = fn(cur);
    set({ settings: next });
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      void api.saveSettings(next).then(() => { void get().refreshTools(); void get().refreshEstimates(); });
    }, 300);
  },

  compress: async (paths) => {
    const { files, overrides, jobs, jobByPath } = get();
    const targets = files.filter((f) => {
      if (paths && !paths.includes(f.path)) return false;
      const j = jobByPath[f.path] ? jobs[jobByPath[f.path]] : undefined;
      // Skip files already queued/running or done (unless re-requested explicitly)
      if (!paths && j && (j.status === "queued" || j.status === "running" || j.status === "done")) return false;
      return true;
    });
    if (!targets.length) return;
    const ov: Record<string, Settings> = {};
    for (const f of targets) if (overrides[f.path]) ov[f.path] = overrides[f.path];
    const created = await api.startCompression(targets, ov);
    set((s) => {
      const jobMap = { ...s.jobs };
      const byPath = { ...s.jobByPath };
      for (const j of created) {
        jobMap[j.id] = j;
        byPath[j.input.path] = j.id;
      }
      return { jobs: jobMap, jobByPath: byPath };
    });
  },

  cancelJob: (id) => api.cancelJob(id),
  cancelAll: () => api.cancelAll(),

  loadThumb: async (path) => {
    if (get().thumbs[path]) return;
    try {
      const p = await api.thumbnail(path);
      if (p) set((s) => ({ thumbs: { ...s.thumbs, [path]: p.startsWith("data:") || !isTauri ? p : convertFileSrc(p) } }));
    } catch {
      /* ignore */
    }
  },

  refreshEstimates: async () => {
    const { files, overrides } = get();
    if (!files.length) { set({ estimates: {} }); return; }
    try {
      const list = await api.estimate(files, overrides);
      const estimates: Record<string, Estimate> = {};
      for (const e of list) estimates[e.path] = e;
      set({ estimates });
    } catch { /* ignore */ }
  },

  setDragging: (dragging) => set({ dragging }),

  refreshTools: async () => set({ tools: await api.getTools() }),
}));

export function useJobFor(path: string): Job | undefined {
  return useStore((s) => (s.jobByPath[path] ? s.jobs[s.jobByPath[path]] : undefined));
}
