// All accounts on all phones. Warm-up settings live in the settings modal.
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeftRight, Flame, Search, Settings2, Square, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { timeAgo } from "@/lib/mock";
import { deviceLabel, devicesApi, type Device } from "@/mocks/devices";
import { useSettings } from "@/settings/SettingsContext";
import { toOptions, useWarmupSettings } from "@/settings/warmup/store";
import { useGroups } from "@/mocks/groups";
import { AccountDetail } from "./AccountDetail";
import { accountHealth } from "./health";
import { HealthBadge } from "./HealthBadge";
import { accountsApi, type Account } from "./mock";

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
  /** null = all groups. */
  const [groupFilter, setGroupFilter] = useState<string | null>(null);
  const groups = useGroups();
  const [running, setRunning] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const warmup = toOptions(useWarmupSettings());
  const { openSettings } = useSettings();
  // Set by Stop so "Warm up all" doesn't start the next account.
  const stopAll = useRef(false);

  const refresh = useCallback(() => {
    accountsApi.list().then(setAccounts).catch((e) => toast.error(String(e)));
    devicesApi.list().then(setDevices);
  }, []);

  useEffect(refresh, [refresh]);

  const visible = accounts.filter(
    (a) => (deviceFilter === null || a.serial === deviceFilter) && (groupFilter === null || a.groups.includes(groupFilter)),
  );
  const activeGroup = groupFilter ? groups.find((g) => g.id === groupFilter) : undefined;
  const device = (serial: string) => devices.find((d) => d.serial === serial);
  const isReady = (a: Account) => device(a.serial)?.state === "device";

  /** Run one fake job; returns false if it failed. */
  async function run(label: string, job: () => Promise<unknown>): Promise<boolean> {
    setRunning(label);
    setProgress(null);
    try {
      await job();
      return true;
    } catch (e) {
      toast.error(String(e));
      return false;
    } finally {
      setRunning(null);
      setProgress(null);
      refresh();
    }
  }

  const warmUp = (a: Account) => () => accountsApi.warmUp(a.id, setProgress);

  async function warmUpAll() {
    stopAll.current = false;
    const targets = visible.filter((a) => a.status === "ok" && isReady(a));
    for (const [i, a] of targets.entries()) {
      if (stopAll.current) break;
      await run(`Warm-up ${i + 1}/${targets.length}: @${a.username}`, warmUp(a));
    }
  }

  async function stop() {
    stopAll.current = true;
    await accountsApi.stop();
  }

  async function findAccounts() {
    const serials = deviceFilter ? [deviceFilter] : devices.map((d) => d.serial);
    await run("Finding logged-in accounts", async () => {
      const n = await accountsApi.findLoggedIn(serials);
      toast.success(n ? `Scanned ${n} phone${n > 1 ? "s" : ""}` : "No ready phones to scan");
    });
  }

  const idle = !running;

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle>Accounts</CardTitle>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={!idle} onClick={findAccounts}>
            <Search /> Find logged-in accounts
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
              All phones ({accounts.length})
            </FilterChip>
            {devices.map((d) => (
              <FilterChip key={d.serial} active={deviceFilter === d.serial} onClick={() => setDeviceFilter(d.serial)}>
                {deviceLabel(d)} ({accounts.filter((a) => a.serial === d.serial).length})
              </FilterChip>
            ))}
          </div>
          <Button disabled={!idle || !visible.some((a) => a.status === "ok" && isReady(a))} onClick={warmUpAll}>
            <Flame /> Warm up {visible.length === accounts.length ? "all" : "shown"}
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <span className="mr-1 text-xs text-muted-foreground">Group</span>
          <FilterChip active={groupFilter === null} onClick={() => setGroupFilter(null)}>
            Any
          </FilterChip>
          {groups.map((g) => (
            <FilterChip key={g.id} active={groupFilter === g.id} onClick={() => setGroupFilter(g.id)}>
              {g.name} ({accounts.filter((a) => a.groups.includes(g.id)).length})
            </FilterChip>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          {activeGroup?.keywords.length ? `${activeGroup.name} keywords: ${activeGroup.keywords.join(", ")}. ` : ""}
          Warm-up: {warmup.minutes} min per account, {warmup.watchMinSec}–{warmup.watchMaxSec}s per video,{" "}
          {Math.round(warmup.likeChance * 100)}% likes, {Math.round(warmup.followChance * 100)}% follows,{" "}
          {warmup.keywords.length ? `keywords: ${warmup.keywords.join(", ")}` : "For You feed"}.
        </p>

        {running && (
          <div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/50 px-3 py-2 text-sm">
            <div className="min-w-0">
              <div className="font-medium">{running}</div>
              <div className="truncate text-xs text-muted-foreground">{progress ?? "Starting…"}</div>
            </div>
            <Button variant="outline" size="sm" onClick={stop}>
              <Square /> Stop
            </Button>
          </div>
        )}

        {visible.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No accounts yet. Log in on the phone, then use “Find logged-in accounts”.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Account</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Groups</TableHead>
                <TableHead>Health</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last warm-up</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((a) => {
                const d = device(a.serial);
                const canAct = idle && isReady(a);
                return (
                  <TableRow key={a.id}>
                    <TableCell className="font-medium">
                      <a href={`#accounts/${a.id}`} className="underline-offset-4 hover:underline">
                        @{a.username}
                      </a>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {d ? deviceLabel(d) : a.serial}
                      {d && d.state !== "device" && <span className="ml-1 text-xs">(not ready)</span>}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {a.groups.map((gid) => (
                          <Badge key={gid} variant="outline">
                            {groups.find((g) => g.id === gid)?.name ?? gid}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell>
                      <HealthBadge health={accountHealth(a)} />
                    </TableCell>
                    <TableCell className="max-w-56">
                      {a.status === "ok" ? (
                        <Badge variant="secondary">OK</Badge>
                      ) : (
                        <div className="flex flex-col gap-1">
                          <Badge variant="destructive">Needs attention</Badge>
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
                          onClick={() => run(`Switching to @${a.username}`, () => accountsApi.switchTo(a.username))}
                        >
                          <ArrowLeftRight /> Switch
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={!canAct}
                          onClick={() => run(`Warm-up: @${a.username}`, warmUp(a))}
                        >
                          <Flame /> Warm up
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          disabled={!!running}
                          title="Remove from list (does not log out)"
                          onClick={() => accountsApi.remove(a.id).then(refresh)}
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
