// Typed wrappers around the Tauri (Rust) commands in src-tauri/src/lib.rs.
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export type Device = {
  serial: string;
  name: string | null;
  model: string | null;
  /** adb state: "device" = ready, "unauthorized", "offline", or "disconnected". */
  state: string;
};

export type WorkerStatus =
  | { state: "starting" }
  | { state: "ready"; appiumPort: number }
  | { state: "failed"; error: string };

export type JobRun = {
  id: number;
  serial: string;
  action: string;
  status: "running" | "ok" | "error";
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
};

export type Job = { action: "open_app"; package: string } | { action: "swipe_up" };

export const api = {
  listDevices: () => invoke<Device[]>("list_devices"),
  renameDevice: (serial: string, name: string) => invoke<void>("rename_device", { serial, name }),
  workerStatus: () => invoke<WorkerStatus>("worker_status"),
  restartWorker: () => invoke<void>("restart_worker"),
  runJob: (serial: string, job: Job) => invoke<unknown>("run_job", { serial, job }),
  recentRuns: (limit = 50) => invoke<JobRun[]>("recent_runs", { limit }),
  onWorkerStatus: (cb: (s: WorkerStatus) => void) =>
    listen<WorkerStatus>("worker-status", (e) => cb(e.payload)),
};
