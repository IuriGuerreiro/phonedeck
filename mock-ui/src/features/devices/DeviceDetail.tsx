// Detail view for one phone: hardware, setup state, accounts and recent activity.
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, BatteryCharging, BatteryMedium, CheckCircle2, Smartphone, XCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { timeAgo } from "@/lib/mock";
import { DEVICE_STATE, deviceLabel, devicesApi, getDeviceDetails, getLiveTask, type Device, type DeviceDetails } from "@/mocks/devices";
import { accountsApi, type Account } from "../accounts/mock";
import { ScreenMirror } from "./ScreenMirror";

export function DeviceDetail({ serial }: { serial: string }) {
  const [device, setDevice] = useState<Device | null | undefined>(undefined);
  const [details, setDetails] = useState<DeviceDetails | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);

  const load = useCallback(async () => {
    const [list, det, accs] = await Promise.all([devicesApi.list(), getDeviceDetails(serial), accountsApi.list()]);
    setDevice(list.find((d) => d.serial === serial) ?? null);
    setDetails(det);
    setAccounts(accs.filter((a) => a.serial === serial));
  }, [serial]);

  useEffect(() => {
    load();
  }, [load]);

  const back = (
    <Button variant="ghost" size="sm" className="self-start" render={<a href="#devices" />}>
      <ArrowLeft /> All devices
    </Button>
  );

  if (device === undefined) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (device === null)
    return (
      <div className="flex flex-col gap-3">
        {back}
        <p className="text-sm text-muted-foreground">No phone with serial {serial}.</p>
      </div>
    );

  const ready = device.state === "device";
  const storagePct = details ? Math.round((details.storageUsedGb / details.storageTotalGb) * 100) : 0;

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_auto]">
    <div className="flex min-w-0 flex-col gap-4">
      {back}

      <div className="flex items-center gap-3">
        <div className="rounded-xl bg-muted p-3">
          <Smartphone className="size-6" />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-semibold">{deviceLabel(device)}</h1>
          <p className="text-sm text-muted-foreground">
            {details?.manufacturer} {device.model} · Android {device.androidVersion}
          </p>
        </div>
        <Badge variant={ready ? "secondary" : "destructive"}>{DEVICE_STATE[device.state].label}</Badge>
      </div>

      {details && (
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Hardware</CardTitle>
            </CardHeader>
            <CardContent>
              <Facts
                rows={[
                  ["Serial", <span className="font-mono">{device.serial}</span>],
                  ["Screen", details.screen],
                  ["RAM", `${details.ramGb} GB`],
                  [
                    "Storage",
                    <div className="flex flex-col gap-1">
                      <span>
                        {details.storageUsedGb} / {details.storageTotalGb} GB ({storagePct}%)
                      </span>
                      <div className="h-1.5 w-full rounded-full bg-muted">
                        <div className="h-full rounded-full bg-primary" style={{ width: `${storagePct}%` }} />
                      </div>
                    </div>,
                  ],
                  [
                    "Battery",
                    <span className="flex items-center gap-1">
                      {details.charging ? <BatteryCharging className="size-4" /> : <BatteryMedium className="size-4" />}
                      {device.battery}%{details.charging && " (charging)"}
                    </span>,
                  ],
                ]}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Connection & setup</CardTitle>
            </CardHeader>
            <CardContent>
              <Facts
                rows={[
                  ["Connected by", details.connection],
                  ["IP address", details.ipAddress ?? "Unknown"],
                  ["Connected", timeAgo(details.connectedSince)],
                  ["Helper apps", <YesNo ok={details.helpersInstalled} yes="Installed" no="Not installed" />],
                  ["TikTok", <YesNo ok={!!details.tiktokVersion} yes={`v${details.tiktokVersion}`} no="Not installed" />],
                ]}
              />
            </CardContent>
          </Card>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Accounts on this phone ({accounts.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {accounts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No accounts found on this phone yet.</p>
          ) : (
            <ul className="flex flex-col divide-y">
              {accounts.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="font-medium">@{a.username}</span>
                  <span className="flex items-center gap-3 text-xs text-muted-foreground">
                    {a.lastWarmupAt ? `Warmed ${timeAgo(a.lastWarmupAt)}` : "Never warmed"}
                    <Badge variant={a.status === "ok" ? "secondary" : "destructive"}>
                      {a.status === "ok" ? "OK" : "Needs attention"}
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
          <CardTitle>Recent activity</CardTitle>
        </CardHeader>
        <CardContent>
          {!details?.activity.length ? (
            <p className="text-sm text-muted-foreground">Nothing has run on this phone yet.</p>
          ) : (
            <ul className="flex flex-col divide-y">
              {details.activity.map((r) => (
                <li key={r.at + r.action} className="flex items-center gap-3 py-2 text-sm">
                  {r.result === "ok" ? (
                    <CheckCircle2 className="size-4 shrink-0 text-primary" />
                  ) : (
                    <XCircle className="size-4 shrink-0 text-destructive" />
                  )}
                  <span className="flex-1">
                    {r.action}
                    {r.note && <span className="ml-2 text-xs text-muted-foreground">{r.note}</span>}
                  </span>
                  <span className="text-xs text-muted-foreground">{timeAgo(r.at)}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
    <ScreenMirror device={device} task={getLiveTask(device.serial)} />
    </div>
  );
}

function Facts({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-2 text-sm">
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
