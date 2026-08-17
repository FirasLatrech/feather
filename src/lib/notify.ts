import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { Job } from "./types";
import { fmtBytes } from "./format";
import { useStore } from "../store";

let asked = false;

/** Fire one summary notification for a finished batch. Skips when the window is focused. */
export async function notify(jobs: Job[]) {
  const settings = useStore.getState().settings;
  if (!settings?.notify_on_finish) return;
  try {
    if (await getCurrentWindow().isFocused()) return;
  } catch { /* ignore */ }
  const done = jobs.filter((j) => j.status === "done");
  const failed = jobs.filter((j) => j.status === "failed");
  if (!done.length && !failed.length) return;
  let ok = await isPermissionGranted();
  if (!ok && !asked) {
    asked = true;
    ok = (await requestPermission()) === "granted";
  }
  if (!ok) return;
  const inS = done.reduce((a, j) => a + j.input.size, 0);
  const outS = done.reduce((a, j) => a + (j.output_size ?? 0), 0);
  const saved = Math.max(0, inS - outS);
  const pct = inS ? Math.round(((inS - outS) / inS) * 100) : 0;
  const title = failed.length ? `Finished · ${done.length} done, ${failed.length} failed` : done.length === 1 ? `${done[0].input.name} compressed` : `${done.length} files compressed`;
  const body = done.length ? `Saved ${fmtBytes(saved)} (${pct}%)` : failed.map((f) => f.input.name).join(", ");
  sendNotification({ title, body });
}
