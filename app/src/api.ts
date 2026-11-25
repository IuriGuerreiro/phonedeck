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

export type Group = { id: number; name: string; keywords: string[]; accountIds: number[] };

export type PostVisibility = "private" | "public";
export type PostStatus = "uploading" | "draft" | "preparing" | "ready" | "publishing" | "submitted" | "failed" | "uncertain";
export type Post = { id: number; accountId: number; username: string; serial: string; name: string; caption: string; visibility: PostVisibility; bytes: number; status: PostStatus; error: string | null; createdAt: string };

export type VideoMeasurement = {
  platformVideoId: string;
  url: string;
  caption: string;
  views: number;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
};
export type VideoReading = { id: number; accountId: number; capturedAt: string; videos: VideoMeasurement[] };

export type AccountSnapshot = { accountId: number; capturedAt: string; followers: number; following: number; likes: number };

export type Job =
  | { action: "open_app"; package: string }
  | { action: "swipe_up" }
  | { action: "video_analytics"; platform: PlatformId; username: string }
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

/** Settings → Safety. Enforced by the app on every warm-up. */
export type SafetyLimits = {
  maxLikesPerDay: number;
  maxFollowsPerDay: number;
  maxMinutesPerDay: number;
  quietHoursOn: boolean;
  /** "HH:MM", local time of the PC running PhoneDeck. */
  quietStart: string;
  quietEnd: string;
  breaksOn: boolean;
  breakEveryMin: number;
  breakEveryMax: number;
  breakLengthMin: number;
  breakLengthMax: number;
};

export type AlertKind = "captcha" | "logged_out" | "account_warning" | "popup" | "unknown";
export type AlertLabel = AlertKind | "false_alarm";

/** A screen that stopped a job. While open, its phone runs nothing. */
export type Alert = {
  id: number;
  /** Best guess. */
  kind: AlertKind;
  /** What the user said it was. */
  label: AlertLabel | null;
  serial: string;
  username: string | null;
  accountId: number | null;
  action: string;
  message: string;
  hasScreenshot: boolean;
  createdAt: string;
  resolvedAt: string | null;
};

/** A timed warm-up for all accounts or one group. */
export type Schedule = {
  id: number | null;
  name: string;
  enabled: boolean;
  /** null = every account. */
  groupId: number | null;
  /** 0 = Sunday … 6 = Saturday. */
  days: number[];
  /** "HH:MM", local time of the PC running PhoneDeck. */
  times: string[];
  minutes: number;
  /** Starts up to this many minutes late, at random. */
  jitterMin: number;
};

export type UpcomingRun = { scheduleId: number; name: string; date: string; at: string };

export type ScheduleRunResult = {
  account: string;
  serial: string;
  result: "ok" | "skipped" | "error";
  note: string;
};

export type ScheduleRun = {
  id: number;
  scheduleId: number;
  name: string;
  slot: string;
  status: "running" | "done" | "skipped" | "stopped";
  startedAt: string;
  finishedAt: string | null;
  results: ScheduleRunResult[];
};

/** One account's warm-up use today. */
export type Usage = { likes: number; follows: number; minutes: number };

export const api = {
  listPosts: () => invoke<Post[]>("list_posts"),
  createPost: (draft: { accountId: number; name: string; caption: string; visibility: PostVisibility; bytes: number }) => invoke<number>("create_post", draft),
  uploadPostChunk: (id: number, offset: number, data: number[]) => invoke<void>("upload_post_chunk", { id, offset, data }),
  finishPostUpload: (id: number) => invoke<void>("finish_post_upload", { id }),
  deletePost: (id: number) => invoke<void>("delete_post", { id }),
  preparePost: (id: number) => invoke<void>("prepare_post", { id }),
  postNow: (id: number) => invoke<void>("post_now", { id }),
  publishPost: (id: number) => invoke<void>("publish_post", { id }),
  listGroups: () => invoke<Group[]>("list_groups"),
  saveGroup: (group: { id: number | null; name: string; keywords: string[] }) => invoke<void>("save_group", group),
  deleteGroup: (id: number) => invoke<void>("delete_group", { id }),
  setGroupMember: (groupId: number, accountId: number, member: boolean) => invoke<void>("set_group_member", { groupId, accountId, member }),
  videoReadings: () => invoke<VideoReading[]>("video_readings"),
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
  listAlerts: () => invoke<Alert[]>("list_alerts"),
  resolveAlert: (id: number) => invoke<void>("resolve_alert", { id }),
  labelAlert: (id: number, label: AlertLabel) => invoke<void>("label_alert", { id, label }),
  alertScreenshot: (id: number) => invoke<ArrayBuffer>("alert_screenshot", { id }),
  listSchedules: () => invoke<Schedule[]>("list_schedules"),
  saveSchedule: (schedule: Schedule) => invoke<Schedule>("save_schedule", { schedule }),
  deleteSchedule: (id: number) => invoke<void>("delete_schedule", { id }),
  upcomingRuns: (limit = 10) => invoke<UpcomingRun[]>("upcoming_runs", { limit }),
  scheduleRuns: (limit = 20) => invoke<ScheduleRun[]>("schedule_runs", { limit }),
  runScheduleNow: (id: number) => invoke<number>("run_schedule_now", { id }),
  stopScheduleRun: (id: number) => invoke<void>("stop_schedule_run", { id }),
  getWarmup: () => invoke<unknown>("get_warmup"),
  setWarmup: (value: unknown) => invoke<void>("set_warmup", { value }),
  getSafety: () => invoke<SafetyLimits>("get_safety"),
  setSafety: (safety: SafetyLimits) => invoke<SafetyLimits>("set_safety", { safety }),
  usageToday: (serial: string, username: string) => invoke<Usage>("usage_today", { serial, username }),
  webInfo: () => invoke<WebInfo>("web_info"),
  liveJobs: () => invoke<LiveJob[]>("live_jobs"),
  recentRuns: (limit = 50) => invoke<JobRun[]>("recent_runs", { limit }),
  onJobProgress: (cb: (p: JobProgress) => void) =>
    listen<JobProgress>("job-progress", (e) => cb(e.payload)),
  onWorkerStatus: (cb: (s: WorkerStatus) => void) =>
    listen<WorkerStatus>("worker-status", (e) => cb(e.payload)),
};
