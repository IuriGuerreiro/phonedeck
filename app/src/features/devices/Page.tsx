// Every phone plugged into this PC.
import { useCallback, useEffect, useState } from "react";
import { ChevronRight, Check, Pencil, RefreshCw, Smartphone, X } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { accountsApi, type Account } from "@/data/accounts";
import { deviceLabel, devicesApi, deviceState, isReady, type Device } from "@/data/devices";
import { DeviceDetail } from "./DeviceDetail";
import { ViewScreenButton } from "./ViewScreenButton";
import { BatteryLife } from "@/components/shared/BatteryLife";
import { BatteryLevel } from "@/components/shared/BatteryLevel";
import { liveJobText, useDeviceStats, useLiveJobs, type LiveJob } from "@/data/live";

/** "#devices/<serial>" opens that device's detail view. */
const serialFromHash = () => decodeURIComponent(window.location.hash.split("/")[1] ?? "") || null;

export default function DevicesPage() {
  const [serial, setSerial] = useState(serialFromHash);

  useEffect(() => {
    const onHash = () => setSerial(serialFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  return serial ? <DeviceDetail serial={serial} /> : <DeviceList />;
}

function DeviceList() {
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const jobs = useLiveJobs();

  const refresh = useCallback(() => {
    devicesApi.list().then(setDevices).catch((e) => toast.error(String(e)));
    accountsApi.list().then(setAccounts).catch((e) => toast.error(String(e)));
  }, []);

  // Poll so plugging a phone in shows up without a click.
  useEffect(() => {
    refresh();
    const timer = setInterval(() => devicesApi.list().then(setDevices).catch(() => {}), 3000);
    return () => clearInterval(timer);
  }, [refresh]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Devices</h1>
        <Button variant="outline" size="sm" onClick={refresh}>
          <RefreshCw /> Refresh
        </Button>
      </div>

      {devices === null ? (
        <p className="text-sm text-muted-foreground">Scanning…</p>
      ) : devices.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No phones found. Plug one in with USB debugging on, or open{" "}
          <a href="#setup" className="underline underline-offset-4">
            Setup
          </a>
          .
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {devices.map((d) => (
            <DeviceCard
              key={d.serial}
              device={d}
              accountCount={accounts.filter((a) => a.serial === d.serial).length}
              job={jobs[d.serial]}
              onChange={refresh}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function DeviceCard({
  device: d,
  accountCount,
  job,
  onChange,
}: {
  device: Device;
  accountCount: number;
  job?: LiveJob;
  onChange: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(d.name ?? "");
  const state = deviceState(d);
  const ready = isReady(d);
  const stats = useDeviceStats(d.serial, ready);

  async function save() {
    try {
      await devicesApi.rename(d.serial, name);
      setEditing(false);
      onChange();
    } catch (e) {
      toast.error(String(e));
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start gap-3">
        <div className="rounded-lg bg-muted p-2">
          <Smartphone className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          {editing ? (
            <form className="flex gap-1" onSubmit={(e) => (e.preventDefault(), save())}>
              <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={d.model ?? d.serial} />
              <Button type="submit" size="icon-sm" variant="ghost" title="Save">
                <Check />
              </Button>
              <Button type="button" size="icon-sm" variant="ghost" title="Cancel" onClick={() => setEditing(false)}>
                <X />
              </Button>
            </form>
          ) : (
            <CardTitle className="flex items-center gap-1 truncate">
              {deviceLabel(d)}
              <Button size="icon-xs" variant="ghost" title="Rename" onClick={() => setEditing(true)}>
                <Pencil />
              </Button>
            </CardTitle>
          )}
          <div className="truncate text-xs text-muted-foreground">{d.model ?? "Unknown model"}</div>
        </div>
        <Badge variant={ready ? "secondary" : d.state === "disconnected" ? "outline" : "destructive"}>{state.label}</Badge>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <dl className="grid grid-cols-2 gap-y-1 text-xs">
          <dt className="text-muted-foreground">Serial</dt>
          <dd className="truncate font-mono">{d.serial}</dd>
          <dt className="text-muted-foreground">Accounts</dt>
          <dd>
            <a href="#accounts" className="underline-offset-4 hover:underline">
              {accountCount}
            </a>
          </dd>
          {stats?.battery != null && (
            <>
              <dt className="text-muted-foreground">Battery</dt>
              <dd className="flex items-center gap-2">
                <BatteryLevel level={stats.battery} charging={stats.charging} />
                {stats.batteryTemp != null && <span className="text-muted-foreground">{stats.batteryTemp.toFixed(1)} °C</span>}
              </dd>
            </>
          )}
          {stats && (stats.batteryHealth || stats.batteryCapacityMah != null) && (
            <>
              <dt className="text-muted-foreground">Battery life</dt>
              <dd>
                <BatteryLife stats={stats} model={d.model} />
              </dd>
            </>
          )}
          {ready && (
            <>
              <dt className="text-muted-foreground">Now</dt>
              <dd className="flex min-w-0 items-center gap-1.5" title={job?.progress ?? undefined}>
                {job && <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-red-500" />}
                <span className="truncate">{liveJobText(job)}</span>
              </dd>
            </>
          )}
        </dl>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" nativeButton={false} render={<a href={`#devices/${encodeURIComponent(d.serial)}`} />}>
            Details <ChevronRight />
          </Button>
          <ViewScreenButton device={d} />
        </div>
        {!ready && state.hint && <div className="rounded-lg border bg-muted/50 p-2 text-xs">{state.hint}</div>}
      </CardContent>
    </Card>
  );
}

