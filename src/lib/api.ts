import { invoke } from "@tauri-apps/api/core";
import type { Estimate, HistoryItem, Job, MediaInfo, Settings, Tools } from "./types";

import { isTauri } from "./tauri";
import { mockApi } from "./mock";

const real = {
  getTools: () => invoke<Tools>("get_tools"),
  probePaths: (paths: string[]) => invoke<MediaInfo[]>("probe_paths", { paths }),
  getSettings: () => invoke<Settings>("get_settings"),
  saveSettings: (settings: Settings) => invoke<void>("save_settings", { settings }),
  startCompression: (files: MediaInfo[], overrides: Record<string, Settings>) =>
    invoke<Job[]>("start_compression", { files, overrides }),
  estimate: (files: MediaInfo[], overrides: Record<string, Settings>) => invoke<Estimate[]>("estimate", { files, overrides }),
  listJobs: () => invoke<Job[]>("list_jobs"),
  cancelJob: (id: string) => invoke<void>("cancel_job", { id }),
  cancelAll: () => invoke<void>("cancel_all"),
  removeJob: (id: string) => invoke<void>("remove_job", { id }),
  clearFinished: () => invoke<void>("clear_finished"),
  getHistory: () => invoke<HistoryItem[]>("get_history"),
  clearHistory: () => invoke<void>("clear_history"),
  thumbnail: (path: string) => invoke<string | null>("thumbnail", { path }),
  appDirs: () => invoke<Record<string, string>>("app_dirs"),
  takeOpenedFiles: () => invoke<string[]>("take_opened_files"),
  installQuickAction: () => invoke<string>("install_quick_action"),
  cliPath: () => invoke<string | null>("cli_path"),
};

export const api: typeof real = isTauri ? real : (mockApi as unknown as typeof real);
