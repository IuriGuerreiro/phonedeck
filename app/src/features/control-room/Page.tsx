// Control room: every phone side by side, with its live screen and what it's doing.
import { useCallback, useEffect, useState } from "react";
import { ChevronRight, Pause, Play, Square } from "lucide-react";
import { toast } from "sonner";

import { api } from "@/api";
import { BatteryLevel } from "@/components/shared/BatteryLevel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { deviceLabel, devicesApi, deviceState, isReady, type Device } from "@/data/devices";
import { elapsed, liveJobText, useDeviceStats, useLiveJobs, type LiveJob } from "@/data/live";
import { LiveScreen, type ScreenSize } from "../devices/LiveScreen";

export default function ControlRoomPage() {
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [paused, setPaused] = useState(false);
  const [size, setSize] = useState<ScreenSize>("md");
  const jobs = useLiveJobs();

  const refresh = useCallback(() => {
    devicesApi.list().then(setDevices, (e) => toast.error(String(e)));
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 5000);
    return () => clearInterval(timer);
  }, [refresh]);

  // Unplugged phones seen before aren't interesting here.
  const shown = (devices ?? []).filter((d) => d.state !== "disconnected");
  const busy = shown.filter((d) => jobs[d.serial]).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold">Control room</h1>
          <p className="text-sm text-muted-foreground">
            {shown.length} connected · {busy} running a job
          </p>
        </div>
        <div className="flex items-center gap-1">
          {(["sm", "md", "lg"] as const).map((s) => (
            <Button key={s} size="sm" variant={size === s ? "secondary" : "ghost"} onClick={() => setSize(s)}>
              {{ sm: "Small", md: "Medium", lg: "Large" }[s]}
            </Button>
          ))}
          <Button size="sm" variant="outline" onClick={() => setPaused(!paused)} title="Stops screenshots, not jobs">
            {paused ? <Play /> : <Pause />} {paused ? "Resume screens" : "Pause screens"}
          </Button>
        </div>
      </div>

      {devices === null ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No phones connected. Plug one in with USB debugging on.
        </p>
      ) : (
        <div className="flex flex-wrap gap-4">
          {shown.map((d) => (
            <PhoneTile key={d.serial} device={d} job={jobs[d.serial]} paused={paused} size={size} />
          ))}
        </div>
      )}
    </div>
  );
}

function PhoneTile({ device: d, job, paused, size }: { device: Device; job?: LiveJob; paused: boolean; size: ScreenSize }) {
  const ready = isReady(d);
  const stats = useDeviceStats(d.serial, ready, 60_000);
  // Re-render every second so the elapsed time ticks.
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!job) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [job]);

  const stop = () => api.stopJob(d.serial).catch((e) => toast.error(String(e)));

  return (
    <Card className="w-fit">
      <CardContent className="flex flex-col items-center gap-2">
        <div className="flex w-full items-center justify-between gap-2">
          <span className="truncate text-sm font-medium">{deviceLabel(d)}</span>
          <Badge variant={ready ? "secondary" : "destructive"}>{deviceState(d).label}</Badge>
        </div>
        <LiveScreen serial={d.serial} ready={ready} paused={paused} size={size} />
        <div className="flex w-full flex-col gap-1 text-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-1.5 font-medium">
              {job && <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-red-500" />}
              <span className="truncate">{liveJobText(job)}</span>
            </span>
            {job && <span className="shrink-0 text-muted-foreground tabular-nums">{elapsed(job, now)}</span>}
          </div>
          {job?.progress && (
            <span className="line-clamp-2 text-muted-foreground" title={job.progress}>
              {job.progress}
            </span>
          )}
          <div className="flex items-center justify-between gap-2">
            {stats?.battery != null ? (
              <BatteryLevel level={stats.battery} charging={stats.charging} className="text-muted-foreground" />
            ) : (
              <span />
            )}
            <div className="flex gap-1">
              {job && (
                <Button size="icon-xs" variant="ghost" title="Stop this job" onClick={stop}>
                  <Square />
                </Button>
              )}
              <Button
                size="icon-xs"
                variant="ghost"
                title="Device details"
                nativeButton={false}
                render={<a href={`#devices/${encodeURIComponent(d.serial)}`} />}
              >
                <ChevronRight />
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
