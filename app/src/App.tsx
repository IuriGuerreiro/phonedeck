import { useCallback, useEffect, useState } from "react";
import { ArrowUp, Play, RefreshCw, RotateCcw, Smartphone } from "lucide-react";
import { toast } from "sonner";

import { api, type Device, type Job, type JobRun, type WorkerStatus } from "@/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Toaster } from "@/components/ui/sonner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

const APPS = [
  { id: "instagram", label: "Instagram", package: "com.instagram.android" },
  { id: "tiktok", label: "TikTok", package: "com.zhiliaoapp.musically" },
  { id: "facebook", label: "Facebook", package: "com.facebook.katana" },
] as const;
type AppChoice = (typeof APPS)[number]["id"] | "custom";

const DEVICE_STATE: Record<string, { label: string; hint?: string }> = {
  device: { label: "Ready" },
  unauthorized: { label: "Not allowed", hint: "Unlock the phone and accept the USB debugging prompt." },
  offline: { label: "Offline", hint: "Reconnect the USB cable." },
  disconnected: { label: "Unplugged" },
};

export default function App() {
  const [worker, setWorker] = useState<WorkerStatus>({ state: "starting" });
  const [devices, setDevices] = useState<Device[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [runs, setRuns] = useState<JobRun[]>([]);
  const [appChoice, setAppChoice] = useState<AppChoice>("instagram");
  const [customPkg, setCustomPkg] = useState("");
  const pkg =
    appChoice === "custom" ? customPkg : APPS.find((a) => a.id === appChoice)!.package;
  const [busy, setBusy] = useState<Job["action"] | null>(null);

  const refreshDevices = useCallback(async () => {
    try {
      const list = await api.listDevices();
      setDevices(list);
      setSelected((cur) =>
        cur && list.some((d) => d.serial === cur)
          ? cur
          : (list.find((d) => d.state === "device")?.serial ?? null),
      );
    } catch (e) {
      toast.error(String(e));
    }
  }, []);

  const refreshRuns = useCallback(() => {
    api.recentRuns(20).then(setRuns).catch((e) => toast.error(String(e)));
  }, []);

  useEffect(() => {
    api.workerStatus().then(setWorker);
    const unlisten = api.onWorkerStatus(setWorker);
    refreshDevices();
    refreshRuns();
    const timer = setInterval(refreshDevices, 3000);
    return () => {
      clearInterval(timer);
      unlisten.then((f) => f());
    };
  }, [refreshDevices, refreshRuns]);

  const device = devices.find((d) => d.serial === selected);
  const canRun = worker.state === "ready" && device?.state === "device" && !busy;

  async function run(job: Job) {
    if (!selected) return;
    setBusy(job.action);
    // The run shows up as "running" right away; refresh again when it ends.
    setTimeout(refreshRuns, 150);
    try {
      await api.runJob(selected, job);
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(null);
      refreshRuns();
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="flex items-center justify-between border-b px-6 py-3">
        <h1 className="text-base font-semibold">PhoneDeck</h1>
        <EngineStatus status={worker} onRestart={() => api.restartWorker()} />
      </header>

      <main className="grid gap-4 p-6 md:grid-cols-[320px_1fr]">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Phones</CardTitle>
            <Button variant="ghost" size="icon-sm" onClick={refreshDevices} title="Refresh">
              <RefreshCw />
            </Button>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {devices.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No phones found. Plug one in with USB debugging on.
              </p>
            )}
            {devices.map((d) => {
              const st = DEVICE_STATE[d.state] ?? { label: d.state };
              return (
                <button
                  key={d.serial}
                  onClick={() => setSelected(d.serial)}
                  className={cn(
                    "flex items-center gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-muted",
                    selected === d.serial && "border-primary bg-muted",
                  )}
                >
                  <Smartphone className="size-5 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{d.name ?? d.model ?? d.serial}</div>
                    <div className="truncate text-xs text-muted-foreground">{d.serial}</div>
                  </div>
                  <Badge variant={d.state === "device" ? "default" : "outline"}>{st.label}</Badge>
                </button>
              );
            })}
            {device && DEVICE_STATE[device.state]?.hint && (
              <p className="text-xs text-muted-foreground">{DEVICE_STATE[device.state].hint}</p>
            )}
          </CardContent>
        </Card>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Actions</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="flex flex-wrap gap-2">
                {APPS.map((a) => (
                  <Button
                    key={a.id}
                    variant={appChoice === a.id ? "default" : "outline"}
                    onClick={() => setAppChoice(a.id)}
                  >
                    {a.label}
                  </Button>
                ))}
                <Button
                  variant={appChoice === "custom" ? "default" : "outline"}
                  onClick={() => setAppChoice("custom")}
                >
                  Custom
                </Button>
              </div>
              <div className="flex gap-2">
                {appChoice === "custom" ? (
                  <Input
                    value={customPkg}
                    onChange={(e) => setCustomPkg(e.target.value)}
                    placeholder="App package, e.g. com.twitter.android"
                    className="font-mono"
                  />
                ) : (
                  <div className="flex h-8 flex-1 items-center rounded-lg border bg-muted/50 px-2.5 font-mono text-sm text-muted-foreground">
                    {pkg}
                  </div>
                )}
                <Button
                  disabled={!canRun || !pkg.trim()}
                  onClick={() => run({ action: "open_app", package: pkg.trim() })}
                >
                  <Play /> {busy === "open_app" ? "Opening…" : "Open app"}
                </Button>
              </div>
              <Button
                variant="outline"
                disabled={!canRun}
                onClick={() => run({ action: "swipe_up" })}
                className="self-start"
              >
                <ArrowUp /> {busy === "swipe_up" ? "Swiping…" : "Swipe up"}
              </Button>
              {worker.state === "ready" && !device && (
                <p className="text-xs text-muted-foreground">Pick a phone first.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Recent runs</CardTitle>
            </CardHeader>
            <CardContent>
              {runs.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing has run yet.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Time</TableHead>
                      <TableHead>Phone</TableHead>
                      <TableHead>Action</TableHead>
                      <TableHead>Result</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {runs.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="text-muted-foreground">{localTime(r.startedAt)}</TableCell>
                        <TableCell className="font-mono text-xs">{r.serial}</TableCell>
                        <TableCell>{r.action}</TableCell>
                        <TableCell className="max-w-md">
                          <RunStatus run={r} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      </main>
      <Toaster richColors position="bottom-right" />
    </div>
  );
}

function EngineStatus({ status, onRestart }: { status: WorkerStatus; onRestart: () => void }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span
        className={cn(
          "size-2 rounded-full",
          status.state === "ready" && "bg-green-500",
          status.state === "starting" && "animate-pulse bg-amber-500",
          status.state === "failed" && "bg-red-500",
        )}
      />
      <span className="text-muted-foreground" title={status.state === "failed" ? status.error : undefined}>
        {status.state === "ready" && `Appium ready on :${status.appiumPort}`}
        {status.state === "starting" && "Starting Appium…"}
        {status.state === "failed" && `Engine failed: ${status.error}`}
      </span>
      {status.state !== "starting" && (
        <Button variant="ghost" size="icon-sm" onClick={onRestart} title="Restart engine">
          <RotateCcw />
        </Button>
      )}
    </div>
  );
}

function RunStatus({ run }: { run: JobRun }) {
  if (run.status === "running") return <Badge variant="secondary">Running…</Badge>;
  if (run.status === "ok") return <Badge>Done</Badge>;
  return (
    <div className="flex items-start gap-2">
      <Badge variant="destructive">Failed</Badge>
      <span className="line-clamp-2 text-xs text-muted-foreground" title={run.error ?? ""}>
        {run.error}
      </span>
    </div>
  );
}

/** SQLite stores UTC as "YYYY-MM-DD HH:MM:SS". */
function localTime(utc: string) {
  return new Date(utc.replace(" ", "T") + "Z").toLocaleTimeString();
}
