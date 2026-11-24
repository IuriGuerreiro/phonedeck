// One account: health, status and actions.

import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, ArrowLeftRight, Flame, Smartphone, Square } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { accountsApi, type Account } from "@/data/accounts";
import { deviceLabel, devicesApi, isReady, type Device } from "@/data/devices";
import { api, type Usage } from "@/api";
import { useSafety } from "@/settings/safety/store";
import { useGroups } from "@/data/groups";
import { useSettings } from "@/settings/SettingsContext";
import { timeAgo } from "@/lib/time";
import { toOptions, useWarmupSettings } from "@/settings/warmup/store";
import { accountHealth } from "./health";
import { HealthBadge } from "./HealthBadge";
import { useJobRunner } from "./useJobRunner";

export function AccountDetail({ id }: { id: number }) {
  const [account, setAccount] = useState<Account | null | undefined>(undefined);
  const [device, setDevice] = useState<Device | null>(null);
  const { groups, error: groupsError, reload: reloadGroups } = useGroups();
  const { openSettings } = useSettings();
  const [savingGroup, setSavingGroup] = useState(false);
  const warmup = toOptions(useWarmupSettings());

  const load = useCallback(async () => {
    try {
      const [accounts, devices] = await Promise.all([accountsApi.list(), devicesApi.list()]);
      const a = accounts.find((x) => x.id === id) ?? null;
      setAccount(a);
      setDevice(a ? (devices.find((d) => d.serial === a.serial) ?? null) : null);
    } catch (e) {
      toast.error(String(e));
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const job = useJobRunner(load);

  const back = (
    <Button variant="ghost" size="sm" className="self-start" nativeButton={false} render={<a href="#accounts" />}>
      <ArrowLeft /> Accounts
    </Button>
  );

  if (account === undefined) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (account === null)
    return (
      <div className="flex flex-col gap-3">
        {back}
        <p className="text-sm text-muted-foreground">Account not found.</p>
      </div>
    );

  const health = accountHealth(account);
  const canAct = !job.running && isReady(device ?? undefined);

  return (
    <div className="flex flex-col gap-4">
      {back}

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex size-12 items-center justify-center rounded-full bg-muted text-lg font-semibold">
          {account.username[0]?.toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-semibold">@{account.username}</h1>
          <p className="flex items-center gap-1 text-sm text-muted-foreground">
            <Smartphone className="size-3.5" />
            {device ? (
              <a href={`#devices/${encodeURIComponent(device.serial)}`} className="underline-offset-4 hover:underline">
                {deviceLabel(device)}
              </a>
            ) : (
              account.serial
            )}
            · TikTok
          </p>
        </div>
        <HealthBadge health={health} className="text-base" />
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between"><CardTitle>Groups</CardTitle><Button size="sm" variant="ghost" onClick={() => openSettings("groups")}>Manage groups</Button></CardHeader>
        <CardContent className="flex flex-col gap-3">
          {groupsError && <p role="alert" className="text-sm text-destructive">{groupsError}</p>}
          {!groups.length && <p className="text-sm text-muted-foreground">Create a group in Settings to organize this account.</p>}
          <div className="flex flex-wrap gap-3">{groups.map((g) => <label key={g.id} className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={g.accountIds.includes(account.id)} disabled={savingGroup || !!job.running} onChange={async (e) => {
              const member = e.target.checked;
              setSavingGroup(true);
              try { await api.setGroupMember(g.id, account.id, member); await reloadGroups(); }
              catch (e) { toast.error(String(e)); }
              finally { setSavingGroup(false); }
            }} />{g.name}
          </label>)}</div>
          <p className="text-xs text-muted-foreground">Warm-up keywords: {groups.filter((g) => g.accountIds.includes(account.id)).flatMap((g) => g.keywords).join(", ") || warmup.keywords.join(", ") || "For You"}</p>
        </CardContent>
      </Card>
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Health</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex items-baseline gap-2">
              <span className="text-4xl font-semibold tabular-nums">{health.score}</span>
              <span className="text-sm text-muted-foreground">/ 100</span>
            </div>
            {health.reasons.length === 0 ? (
              <p className="text-sm text-muted-foreground">No issues</p>
            ) : (
              <ul className="flex flex-col gap-1 text-sm">
                {health.reasons.map((r) => (
                  <li key={r.text} className="flex justify-between gap-2">
                    <span>{r.text}</span>
                    <span className="text-muted-foreground tabular-nums">{r.points}</span>
                  </li>
                ))}
              </ul>
            )}
            {account.status === "needs_attention" && account.note && (
              <p className="rounded-md border bg-muted/50 p-2 text-xs">{account.note}</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Flame className="size-4" /> Warm-up
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">
              Last warm-up: {account.lastWarmupAt ? timeAgo(account.lastWarmupAt) : "never"}
            </p>
            <TodayUsage serial={account.serial} username={account.username} refresh={job.running?.label ?? ""} />
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={!canAct || savingGroup}
                onClick={() => job.run(`Warm-up: @${account.username}`, account.serial, () => accountsApi.warmUp(account, warmup))}
              >
                <Flame /> Warm up now
              </Button>
              <Button
                variant="outline"
                disabled={!canAct || savingGroup}
                onClick={() => job.run(`Switching to @${account.username}`, account.serial, () => accountsApi.switchTo(account))}
              >
                <ArrowLeftRight /> Switch to
              </Button>
            </div>
            {!isReady(device ?? undefined) && (
              <p className="text-xs text-muted-foreground">The phone is not connected.</p>
            )}
            {job.running && (
              <div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/50 px-3 py-2 text-sm">
                <div className="min-w-0">
                  <div className="font-medium">{job.running.label}</div>
                  <div className="truncate text-xs text-muted-foreground">{job.progress ?? "Starting…"}</div>
                </div>
                <Button variant="outline" size="sm" onClick={job.stop}>
                  <Square /> Stop
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/** "Today: 12/45 min · 8/60 likes · 1/10 follows", against Settings → Safety. */
function TodayUsage({ serial, username, refresh }: { serial: string; username: string; refresh: string }) {
  const limits = useSafety();
  const { openSettings } = useSettings();
  const [used, setUsed] = useState<Usage | null>(null);

  useEffect(() => {
    api.usageToday(serial, username).then(setUsed, () => setUsed(null));
  }, [serial, username, refresh]);

  if (!used) return null;
  const part = (n: number, max: number, unit: string) => (
    <span className={n >= max ? "font-medium text-destructive" : undefined}>
      {n}/{max} {unit}
    </span>
  );
  return (
    <p className="text-sm text-muted-foreground">
      Today: {part(used.minutes, limits.maxMinutesPerDay, "min")} · {part(used.likes, limits.maxLikesPerDay, "likes")} ·{" "}
      {part(used.follows, limits.maxFollowsPerDay, "follows")}{" "}
      <button className="underline underline-offset-4" onClick={() => openSettings("safety")}>
        limits
      </button>
    </p>
  );
}
