// Control room: a small live screen for every phone, side by side.
import { useEffect, useState } from "react";
import { ChevronRight, Pause, Play } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DEVICE_STATE, deviceLabel, devicesApi, getLiveTask, type Device, type LiveTask } from "@/mocks/devices";
import { LiveScreen, type ScreenSize } from "../devices/ScreenMirror";

const TASK_TEXT = (t: LiveTask) =>
  t.kind === "warmup" ? `Warming up @${t.account}` : t.kind === "idle" ? "Idle" : "Unavailable";

export default function ControlRoomPage() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [paused, setPaused] = useState(false);
  const [size, setSize] = useState<ScreenSize>("sm");

  useEffect(() => {
    devicesApi.list().then(setDevices);
  }, []);

  const busy = devices.filter((d) => getLiveTask(d.serial).kind === "warmup").length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold">Control room</h1>
          <p className="text-sm text-muted-foreground">
            {devices.length} devices · {busy} active
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Button size="sm" variant={size === "sm" ? "secondary" : "ghost"} onClick={() => setSize("sm")}>
            Small
          </Button>
          <Button size="sm" variant={size === "md" ? "secondary" : "ghost"} onClick={() => setSize("md")}>
            Large
          </Button>
          <Button size="sm" variant="outline" onClick={() => setPaused(!paused)}>
            {paused ? <Play /> : <Pause />} {paused ? "Resume all" : "Pause all"}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-4">
        {devices.map((d) => {
          const task = getLiveTask(d.serial);
          const ready = d.state === "device";
          return (
            <Card key={d.serial} className="w-fit">
              <CardContent className="flex flex-col items-center gap-2">
                <div className="flex w-full items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium">{deviceLabel(d)}</span>
                  <Badge variant={ready ? "secondary" : "destructive"}>{DEVICE_STATE[d.state].label}</Badge>
                </div>
                <LiveScreen serial={d.serial} task={task} paused={paused} size={size} />
                <div className="flex w-full items-center justify-between gap-2 text-xs">
                  <span className="flex items-center gap-1.5 truncate text-muted-foreground">
                    {task.kind === "warmup" && !paused && <span className="size-1.5 animate-pulse rounded-full bg-red-500" />}
                    {TASK_TEXT(task)}
                  </span>
                  <Button size="icon-xs" variant="ghost" title="Device details" render={<a href={`#devices/${d.serial}`} />}>
                    <ChevronRight />
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
