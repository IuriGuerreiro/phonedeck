// Every phone plugged into this PC.
import { useCallback, useEffect, useState } from "react";
import { BatteryMedium, Check, Pencil, RefreshCw, ShieldCheck, Smartphone, X } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { DEVICE_STATE, deviceLabel, devicesApi, type Device } from "@/mocks/devices";
import { accountsApi, type Account } from "../accounts/mock";

export default function DevicesPage() {
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);

  const refresh = useCallback(() => {
    devicesApi.list().then(setDevices);
    accountsApi.list().then(setAccounts);
  }, []);

  useEffect(refresh, [refresh]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Devices</h1>
          <p className="text-sm text-muted-foreground">Phones connected to this PC over USB.</p>
        </div>
        <Button variant="outline" size="sm" onClick={refresh}>
          <RefreshCw /> Refresh
        </Button>
      </div>

      {devices === null ? (
        <p className="text-sm text-muted-foreground">Looking for phones…</p>
      ) : devices.length === 0 ? (
        <p className="text-sm text-muted-foreground">No phones found. Plug one in with USB debugging on.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {devices.map((d) => (
            <DeviceCard
              key={d.serial}
              device={d}
              accountCount={accounts.filter((a) => a.serial === d.serial).length}
              onChange={refresh}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function DeviceCard({ device: d, accountCount, onChange }: { device: Device; accountCount: number; onChange: () => void }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(d.name ?? "");
  const [busy, setBusy] = useState(false);
  const state = DEVICE_STATE[d.state];
  const ready = d.state === "device";

  async function save() {
    await devicesApi.rename(d.serial, name);
    setEditing(false);
    onChange();
  }

  async function authorize() {
    setBusy(true);
    await devicesApi.authorize(d.serial);
    setBusy(false);
    toast.success(`${deviceLabel(d)} is ready`);
    onChange();
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
              <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={d.model} />
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
          <div className="truncate text-xs text-muted-foreground">
            {d.model} · Android {d.androidVersion}
          </div>
        </div>
        <Badge variant={ready ? "secondary" : "destructive"}>{state.label}</Badge>
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
          <dt className="text-muted-foreground">Battery</dt>
          <dd className="flex items-center gap-1">
            <BatteryMedium className="size-3.5" /> {d.battery}%
          </dd>
        </dl>
        {state.hint && (
          <div className="flex flex-col gap-2 rounded-lg border bg-muted/50 p-2 text-xs">
            {state.hint}
            {d.state === "unauthorized" && (
              <Button size="sm" variant="outline" disabled={busy} onClick={authorize} className="self-start">
                <ShieldCheck /> I accepted it (mock)
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
