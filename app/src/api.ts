// Typed wrappers around the Tauri (Rust) commands in src-tauri/src/lib.rs.
import { invoke, listen } from "@/lib/bridge";

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

/** Platforms with account automation. Only TikTok for now. */
export type PlatformId = "tiktok";

export type AccountSnapshot = { accountId: number; capturedAt: string; followers: number; following: number; likes: number };

export type Job =
  | { action: "open_app"; package: string }
  | { action: "swipe_up" }
  | { action: "account_analytics"; platform: PlatformId; username: string }
  | { action: "list_accounts"; platform: PlatformId }
  | { action: "switch_account"; platform: PlatformId; username: string }
  | {
      action: "warmup";
      platform: PlatformId;
      /** Switch to this account first; omit to warm up whichever account is active. */
      username?: string;
      minutes: number;
      /** Seconds on each video: random in [watchMinSec, watchMaxSec]. */
      watchMinSec: number;
      watchMaxSec: number;
      /** 0..1 */
      likeChance: number;
      /** 0..1 */
      followChance: number;
      /** Niche keywords to search; empty = the For You feed. */
      keywords: string[];
    };

export type Account = {
  id: number;
  serial: string;
  platform: PlatformId;
  username: string;
  status: "ok" | "needs_attention";
  note: string | null;
  lastWarmupAt: string | null;
};

export type JobProgress = { serial: string; message: string };

/** Live numbers read from the phone over adb. Fields are null when the phone didn't report them. */
export type DeviceStats = {
  battery: number | null;
  charging: boolean;
  /** °C */
  batteryTemp: number | null;
  storageUsedBytes: number | null;
  storageTotalBytes: number | null;
  ramTotalBytes: number | null;
  /** e.g. "1080x2400" */
  screen: string | null;
};

/** The job a phone is running right now. */
export type LiveJob = {
  serial: string;
  runId: number;
  action: string;
  username: string | null;
  /** ms since epoch */
  startedAt: number;
  progress: string | null;
};

/** Browser access to this app (see src-tauri/src/web.rs). */
export type WebInfo = {
  enabled: boolean;
  port: number;
  token: string;
  urls: string[];
  error: string | null;
};

export const api = {
  accountSnapshots: () => invoke<AccountSnapshot[]>("account_snapshots"),
  listDevices: () => invoke<Device[]>("list_devices"),
  renameDevice: (serial: string, name: string) => invoke<void>("rename_device", { serial, name }),
  workerStatus: () => invoke<WorkerStatus>("worker_status"),
  restartWorker: () => invoke<void>("restart_worker"),
  runJob: (serial: string, job: Job) => invoke<unknown>("run_job", { serial, job }),
  stopJob: (serial: string) => invoke<void>("stop_job", { serial }),
  /** Opens a live, view-only window of the phone's screen (scrcpy). */
  viewPhone: (serial: string, title: string) => invoke<void>("view_phone", { serial, title }),
  /** Accounts on one phone, or on every phone when `serial` is omitted. */
  listAccounts: (serial?: string) => invoke<Account[]>("list_accounts", { serial: serial ?? null }),
  deleteAccount: (id: number) => invoke<void>("delete_account", { id }),
  deviceStats: (serial: string) => invoke<DeviceStats>("device_stats", { serial }),
  /** PNG bytes of the phone's screen. Empty when the screen is off. */
  screenshot: (serial: string) => invoke<ArrayBuffer>("screenshot", { serial }),
  wakeScreen: (serial: string) => invoke<void>("wake_screen", { serial }),
  webInfo: () => invoke<WebInfo>("web_info"),
  liveJobs: () => invoke<LiveJob[]>("live_jobs"),
  recentRuns: (limit = 50) => invoke<JobRun[]>("recent_runs", { limit }),
  onJobProgress: (cb: (p: JobProgress) => void) =>
    listen<JobProgress>("job-progress", (e) => cb(e.payload)),
  onWorkerStatus: (cb: (s: WorkerStatus) => void) =>
    listen<WorkerStatus>("worker-status", (e) => cb(e.payload)),
};
