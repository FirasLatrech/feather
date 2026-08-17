import { invoke } from "@tauri-apps/api/core";
import type { HistoryItem, Job, MediaInfo, Settings, Tools } from "./types";

export const api = {
  getTools: () => invoke<Tools>("get_tools"),
  probePaths: (paths: string[]) => invoke<MediaInfo[]>("probe_paths", { paths }),
  getSettings: () => invoke<Settings>("get_settings"),
  saveSettings: (settings: Settings) => invoke<void>("save_settings", { settings }),
  startCompression: (files: MediaInfo[], overrides: Record<string, Settings>) =>
    invoke<Job[]>("start_compression", { files, overrides }),
  listJobs: () => invoke<Job[]>("list_jobs"),
  cancelJob: (id: string) => invoke<void>("cancel_job", { id }),
  cancelAll: () => invoke<void>("cancel_all"),
  removeJob: (id: string) => invoke<void>("remove_job", { id }),
  clearFinished: () => invoke<void>("clear_finished"),
  getHistory: () => invoke<HistoryItem[]>("get_history"),
  clearHistory: () => invoke<void>("clear_history"),
  thumbnail: (path: string) => invoke<string | null>("thumbnail", { path }),
  appDirs: () => invoke<Record<string, string>>("app_dirs"),
};
