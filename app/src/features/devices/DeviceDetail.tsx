// Detail view for one phone: what it is, setup state, quick actions, accounts and recent runs.
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, ArrowUp, CheckCircle2, Play, Smartphone, Square, XCircle } from "lucide-react";
import { toast } from "sonner";

import { api, type JobRun } from "@/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { accountsApi, type Account } from "@/data/accounts";
import { deviceLabel, devicesApi, deviceState, isReady, type Device } from "@/data/devices";
import { timeAgo } from "@/lib/time";
import { setupApi, type PhoneInfo } from "@/setup/api";
import { BatteryLevel } from "@/components/shared/BatteryLevel";
import { fmtBytes, liveJobText, useDeviceStats, useLiveJobs } from "@/data/live";
import { RunsTable } from "../activity/Page";
import { LiveScreen } from "./LiveScreen";
import { ViewScreenButton } from "./ViewScreenButton";

const APPS = [
  { id: "tiktok", label: "TikTok", package: "com.zhiliaoapp.musically" },
  { id: "instagram", label: "Instagram", package: "com.instagram.android" },
  { id: "facebook", label: "Facebook", package: "com.facebook.katana" },
] as const;

export function DeviceDetail({ serial }: { serial: string }) {
  const [device, setDevice] = useState<Device | null | undefined>(undefined);
  const [info, setInfo] = useState<PhoneInfo | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [runs, setRuns] = useState<JobRun[]>([]);
  const jobs = useLiveJobs();
  const stats = useDeviceStats(serial, isReady(device ?? undefined), 15_000);

  const load = useCallback(async () => {
    try {
      const [list, accs, recent] = await Promise.all([devicesApi.list(), accountsApi.list(), api.recentRuns(200)]);
      const d = list.find((x) => x.serial === serial) ?? null;
      setDevice(d);
      setAccounts(accs.filter((a) => a.serial === serial));
      setRuns(recent.filter((r) => r.serial === serial).slice(0, 15));
      if (isReady(d ?? undefined)) setupApi.phoneInfo(serial).then(setInfo).catch(() => setInfo(null));
    } catch (e) {
      toast.error(String(e));
    }
  }, [serial]);

  useEffect(() => {
    load();
  }, [load]);

  // Refresh runs and accounts when this phone's job ends.
  const runningId = jobs[serial]?.runId;
  useEffect(() => {
    if (runningId === undefined) load();
  }, [runningId, load]);

  const back = (
    <Button variant="ghost" size="sm" className="self-start" nativeButton={false} render={<a href="#devices" />}>
      <ArrowLeft /> Devices
    </Button>
  );

  if (device === undefined) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (device === null)
    return (
      <div className="flex flex-col gap-3">
        {back}
        <p className="text-sm text-muted-foreground">Device {serial} not found.</p>
      </div>
    );

  const ready = isReady(device);
  const state = deviceState(device);
  const job = jobs[serial];
  const storagePct =
    stats?.storageUsedBytes != null && stats.storageTotalBytes
      ? Math.round((stats.storageUsedBytes / stats.storageTotalBytes) * 100)
      : null;

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_auto]">
    <div className="flex min-w-0 flex-col gap-4">
      {back}

      <div className="flex flex-wrap items-center gap-3">
        <div className="rounded-xl bg-muted p-3">
          <Smartphone className="size-6" />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-semibold">{deviceLabel(device)}</h1>
          <p className="text-sm text-muted-foreground">
            {info ? `${info.manufacturer} ${info.model} · Android ${info.androidVersion}` : (device.model ?? "")}
          </p>
        </div>
        <ViewScreenButton device={device} />
        <Badge variant={ready ? "secondary" : "destructive"}>{state.label}</Badge>
      </div>
      {!ready && state.hint && <p className="text-sm text-muted-foreground">{state.hint}</p>}

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Phone</CardTitle>
          </CardHeader>
          <CardContent>
            <Facts
              rows={[
                ["Serial", <span className="font-mono">{device.serial}</span>],
                ["Maker", info?.manufacturer ?? "—"],
                ["Model", info?.model ?? device.model ?? "—"],
                ["Android", info?.androidVersion ?? "—"],
                ["Screen", stats?.screen?.replace("x", " × ") ?? "—"],
                ["RAM", stats?.ramTotalBytes != null ? fmtBytes(stats.ramTotalBytes) : "—"],
                [
                  "Storage",
                  storagePct != null ? (
                    <div className="flex flex-col gap-1">
                      <span>
                        {fmtBytes(stats!.storageUsedBytes!)} / {fmtBytes(stats!.storageTotalBytes!)} ({storagePct}%)
                      </span>
                      <div className="h-1.5 w-full rounded-full bg-muted">
                        <div
                          className={storagePct >= 90 ? "h-full rounded-full bg-destructive" : "h-full rounded-full bg-primary"}
                          style={{ width: `${storagePct}%` }}
                        />
                      </div>
                    </div>
                  ) : (
                    "—"
                  ),
                ],
                [
                  "Battery",
                  stats?.battery != null ? (
                    <span className="flex items-center gap-2">
                      <BatteryLevel level={stats.battery} charging={stats.charging} />
                      {stats.batteryTemp != null && (
                        <span className="whitespace-nowrap text-muted-foreground">{stats.batteryTemp.toFixed(1)} °C</span>
                      )}
                    </span>
                  ) : (
                    "—"
                  ),
                ],
                [
                  "Helpers",
                  info ? (
                    <YesNo ok={info.helpersInstalled} yes="Installed" no="Missing · see Setup → Phones" />
                  ) : (
                    "—"
                  ),
                ],
              ]}
            />
          </CardContent>
        </Card>

        <QuickActions device={device} onDone={load} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Accounts ({accounts.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {accounts.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No accounts yet. Sync them from the{" "}
              <a href="#accounts" className="underline underline-offset-4">
                Accounts
              </a>{" "}
              page.
            </p>
          ) : (
            <ul className="flex flex-col divide-y">
              {accounts.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <a href={`#accounts/${a.id}`} className="font-medium underline-offset-4 hover:underline">
                    @{a.username}
                  </a>
                  <span className="flex items-center gap-3 text-xs text-muted-foreground">
                    {a.lastWarmupAt ? `Warmed ${timeAgo(a.lastWarmupAt)}` : "Never warmed"}
                    <Badge variant={a.status === "ok" ? "secondary" : "destructive"}>
                      {a.status === "ok" ? "OK" : "Attention"}
                    </Badge>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent runs</CardTitle>
        </CardHeader>
        <CardContent>
          {runs.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing has run on this phone yet.</p>
          ) : (
            <RunsTable runs={runs} />
          )}
        </CardContent>
      </Card>
    </div>

    <Card className="lg:sticky lg:top-6">
      <CardHeader>
        <CardTitle>Live screen</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col items-center gap-3">
        <LiveScreen serial={serial} ready={ready} size="lg" everyMs={2000} unavailableText={state.label} />
        <div className="flex w-full items-start justify-between gap-2 text-sm">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 font-medium">
              {job && <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-red-500" />}
              {liveJobText(job)}
            </div>
            {job?.progress && <div className="line-clamp-2 text-xs text-muted-foreground">{job.progress}</div>}
          </div>
          {job && (
            <Button size="sm" variant="outline" onClick={() => api.stopJob(serial).catch((e) => toast.error(String(e)))}>
              <Square /> Stop
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
    </div>
  );
}

/** Open an app or swipe, to check the phone responds. */
function QuickActions({ device, onDone }: { device: Device; onDone: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [custom, setCustom] = useState("");
  const canRun = isReady(device) && !busy;

  async function run(label: string, job: Parameters<typeof api.runJob>[1]) {
    setBusy(label);
    try {
      await api.runJob(device.serial, job);
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(null);
      onDone();
    }
  }

  const open = (pkg: string) => run(`Opening ${pkg}`, { action: "open_app", package: pkg });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Quick actions</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-2">
          {APPS.map((a) => (
            <Button key={a.id} size="sm" variant="outline" disabled={!canRun} onClick={() => open(a.package)}>
              <Play /> {a.label}
            </Button>
          ))}
          <Button size="sm" variant="outline" disabled={!canRun} onClick={() => run("Swiping", { action: "swipe_up" })}>
            <ArrowUp /> Swipe up
          </Button>
        </div>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (custom.trim()) open(custom.trim());
          }}
        >
          <Input
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            placeholder="Other app package, e.g. com.twitter.android"
            className="font-mono"
          />
          <Button type="submit" size="sm" disabled={!canRun || !custom.trim()}>
            Open
          </Button>
        </form>
        {busy && <p className="text-xs text-muted-foreground">{busy}…</p>}
      </CardContent>
    </Card>
  );
}

function Facts({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-2 text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="min-w-0">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function YesNo({ ok, yes, no }: { ok: boolean; yes: string; no: string }) {
  return (
    <span className="flex items-center gap-1">
      {ok ? <CheckCircle2 className="size-4 text-primary" /> : <XCircle className="size-4 text-destructive" />}
      {ok ? yes : no}
    </span>
  );
}
