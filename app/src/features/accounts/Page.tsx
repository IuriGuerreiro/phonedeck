// All accounts on all phones. Warm-up settings live in the settings modal.
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeftRight, Flame, Search, Settings2, Square, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { accountsApi, type Account } from "@/data/accounts";
import { deviceLabel, devicesApi, isReady, type Device } from "@/data/devices";
import { timeAgo } from "@/lib/time";
import { useSettings } from "@/settings/SettingsContext";
import { toOptions, useWarmupSettings } from "@/settings/warmup/store";
import { AccountDetail } from "./AccountDetail";
import { accountHealth } from "./health";
import { HealthBadge } from "./HealthBadge";
import { useJobRunner } from "./useJobRunner";

/** "#accounts/<id>" opens that account's detail view. */
const idFromHash = () => Number(window.location.hash.split("/")[1]) || null;

export default function AccountsPage() {
  const [id, setId] = useState(idFromHash);

  useEffect(() => {
    const onHash = () => setId(idFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  return id ? <AccountDetail id={id} /> : <AccountList />;
}

function AccountList() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  /** null = all phones. */
  const [deviceFilter, setDeviceFilter] = useState<string | null>(null);
  const warmup = toOptions(useWarmupSettings());
  const { openSettings } = useSettings();
  // Set by Stop so "Warm up all" doesn't start the next account.
  const stopAll = useRef(false);

  const refresh = useCallback(() => {
    accountsApi.list().then(setAccounts).catch((e) => toast.error(String(e)));
    devicesApi.list().then(setDevices).catch((e) => toast.error(String(e)));
  }, []);

  useEffect(refresh, [refresh]);

  const job = useJobRunner(refresh);
  const visible = accounts.filter((a) => deviceFilter === null || a.serial === deviceFilter);
  const device = (serial: string) => devices.find((d) => d.serial === serial);
  const canWarm = (a: Account) => a.status === "ok" && isReady(device(a.serial));

  async function warmUpAll() {
    stopAll.current = false;
    const targets = visible.filter(canWarm);
    for (const [i, a] of targets.entries()) {
      if (stopAll.current) break;
      await job.run(`Warm-up ${i + 1}/${targets.length}: @${a.username}`, a.serial, () =>
        accountsApi.warmUp(a, warmup),
      );
    }
  }

  async function syncAccounts() {
    const targets = devices.filter((d) => isReady(d) && (deviceFilter === null || d.serial === deviceFilter));
    if (!targets.length) return toast.error("No ready phones. Plug one in first.");
    let found = 0;
    for (const d of targets) {
      await job.run(`Syncing ${deviceLabel(d)}`, d.serial, async () => {
        found += (await accountsApi.sync(d.serial)).length;
      });
    }
    toast.success(`Found ${found} account${found === 1 ? "" : "s"}`);
  }

  function stop() {
    stopAll.current = true;
    job.stop();
  }

  const idle = !job.running;

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle>Accounts</CardTitle>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={!idle} onClick={syncAccounts}>
            <Search /> Sync accounts
          </Button>
          <Button variant="ghost" size="sm" onClick={() => openSettings("warmup")}>
            <Settings2 /> Warm-up settings
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-1">
            <FilterChip active={deviceFilter === null} onClick={() => setDeviceFilter(null)}>
              All ({accounts.length})
            </FilterChip>
            {devices.map((d) => (
              <FilterChip key={d.serial} active={deviceFilter === d.serial} onClick={() => setDeviceFilter(d.serial)}>
                {deviceLabel(d)} ({accounts.filter((a) => a.serial === d.serial).length})
              </FilterChip>
            ))}
          </div>
          <Button disabled={!idle || !visible.some(canWarm)} onClick={warmUpAll}>
            <Flame /> Warm up {visible.length === accounts.length ? "all" : "shown"}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          {warmup.minutes}m / account · {warmup.watchMinSec}–{warmup.watchMaxSec}s watch ·{" "}
          {Math.round(warmup.likeChance * 100)}% like · {Math.round(warmup.followChance * 100)}% follow ·{" "}
          {warmup.keywords.length ? warmup.keywords.join(", ") : "For You"}
        </p>

        {job.running && (
          <div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/50 px-3 py-2 text-sm">
            <div className="min-w-0">
              <div className="font-medium">{job.running.label}</div>
              <div className="truncate text-xs text-muted-foreground">{job.progress ?? "Starting…"}</div>
            </div>
            <Button variant="outline" size="sm" onClick={stop}>
              <Square /> Stop
            </Button>
          </div>
        )}

        {visible.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No accounts yet. Log in to TikTok on a phone, then use “Sync accounts”.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Account</TableHead>
                <TableHead>Device</TableHead>
                <TableHead>Health</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last warm-up</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((a) => {
                const d = device(a.serial);
                const canAct = idle && isReady(d);
                return (
                  <TableRow key={a.id}>
                    <TableCell className="font-medium">
                      <a href={`#accounts/${a.id}`} className="underline-offset-4 hover:underline">
                        @{a.username}
                      </a>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {d ? deviceLabel(d) : a.serial}
                      {!isReady(d) && <span className="ml-1 text-xs">(offline)</span>}
                    </TableCell>
                    <TableCell>
                      <HealthBadge health={accountHealth(a)} />
                    </TableCell>
                    <TableCell className="max-w-56">
                      {a.status === "ok" ? (
                        <Badge variant="secondary">OK</Badge>
                      ) : (
                        <div className="flex flex-col gap-1">
                          <Badge variant="destructive">Attention</Badge>
                          <span className="line-clamp-2 text-xs text-muted-foreground" title={a.note ?? ""}>
                            {a.note}
                          </span>
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {a.lastWarmupAt ? timeAgo(a.lastWarmupAt) : "Never"}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={!canAct}
                          onClick={() => job.run(`Switching to @${a.username}`, a.serial, () => accountsApi.switchTo(a))}
                        >
                          <ArrowLeftRight /> Switch
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={!canAct}
                          onClick={() =>
                            job.run(`Warm-up: @${a.username}`, a.serial, () => accountsApi.warmUp(a, warmup))
                          }
                        >
                          <Flame /> Warm up
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          disabled={!idle}
                          title="Remove from list (does not log out)"
                          onClick={() => accountsApi.remove(a.id).then(refresh, (e) => toast.error(String(e)))}
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function FilterChip(props: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <Button size="sm" variant={props.active ? "secondary" : "ghost"} onClick={props.onClick}>
      {props.children}
    </Button>
  );
}
