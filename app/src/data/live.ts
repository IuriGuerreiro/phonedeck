// Live phone data: stats, screenshots and the job each phone is running.
import { useEffect, useState } from "react";

import { api, type DeviceStats, type LiveJob } from "@/api";

export type { DeviceStats, LiveJob };

/** Stats for a ready phone, refreshed every `everyMs`. null until loaded or when not ready. */
export function useDeviceStats(serial: string, ready: boolean, everyMs = 30_000) {
  const [stats, setStats] = useState<DeviceStats | null>(null);
  useEffect(() => {
    if (!ready) return setStats(null);
    let alive = true;
    const load = () => api.deviceStats(serial).then((s) => alive && setStats(s), () => {});
    load();
    const timer = setInterval(load, everyMs);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [serial, ready, everyMs]);
  return stats;
}

/** Running jobs by serial, polled every 2s. */
export function useLiveJobs() {
  const [jobs, setJobs] = useState<Record<string, LiveJob>>({});
  useEffect(() => {
    let alive = true;
    const load = () =>
      api.liveJobs().then((list) => alive && setJobs(Object.fromEntries(list.map((j) => [j.serial, j]))), () => {});
    load();
    const timer = setInterval(load, 2000);
    // Progress events land between polls; show them right away.
    const unlisten = api.onJobProgress((p) =>
      setJobs((cur) => (cur[p.serial] ? { ...cur, [p.serial]: { ...cur[p.serial], progress: p.message } } : cur)),
    );
    return () => {
      alive = false;
      clearInterval(timer);
      unlisten.then((f) => f());
    };
  }, []);
  return jobs;
}

const ACTION_TEXT: Record<string, string> = {
  open_app: "Opening app",
  swipe_up: "Swiping",
  list_accounts: "Syncing accounts",
  switch_account: "Switching account",
  warmup: "Warming up",
  prepare_post: "Preparing a post",
  publish_post: "Publishing",
  post_video: "Posting",
};

/** "Warming up @ana", "Syncing accounts", or "Idle". */
export function liveJobText(job: LiveJob | undefined) {
  if (!job) return "Idle";
  const what = ACTION_TEXT[job.action] ?? job.action;
  return job.username ? `${what} @${job.username}` : what;
}

/** "Running 3m 12s". */
export function elapsed(job: LiveJob, now = Date.now()) {
  const s = Math.max(0, Math.round((now - job.startedAt) / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

/** "12.3 GB" */
export function fmtBytes(n: number) {
  const gb = n / 1024 ** 3;
  return gb >= 10 ? `${Math.round(gb)} GB` : `${gb.toFixed(1)} GB`;
}
