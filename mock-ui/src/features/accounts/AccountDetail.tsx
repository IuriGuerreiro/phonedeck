// One account: health, groups, charts and notes.
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Check, Flame, Settings2, Smartphone, Users } from "lucide-react";
import { toast } from "sonner";

import { BarChart, LineChart } from "@/components/shared/charts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { timeAgo } from "@/lib/mock";
import { cn } from "@/lib/utils";
import { deviceLabel, devicesApi, type Device } from "@/mocks/devices";
import { useGroups } from "@/mocks/groups";
import { useSettings } from "@/settings/SettingsContext";
import { accountHealth } from "./health";
import { HealthBadge } from "./HealthBadge";
import { accountsApi, type Account, type DayStat } from "./mock";

const dayLabel = (iso: string) => new Date(iso).toLocaleDateString([], { day: "numeric", month: "short" });

export function AccountDetail({ id }: { id: number }) {
  const [account, setAccount] = useState<Account | null | undefined>(undefined);
  const [device, setDevice] = useState<Device | null>(null);
  const [history, setHistory] = useState<DayStat[]>([]);
  const [notes, setNotes] = useState("");
  const groups = useGroups();
  const { openSettings } = useSettings();

  const load = useCallback(async () => {
    const a = await accountsApi.get(id);
    setAccount(a);
    if (!a) return;
    setNotes(a.notes);
    const [devices, h] = await Promise.all([devicesApi.list(), accountsApi.history(id)]);
    setDevice(devices.find((d) => d.serial === a.serial) ?? null);
    setHistory(h);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const back = (
    <Button variant="ghost" size="sm" className="self-start" render={<a href="#accounts" />}>
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
  const last14 = history.slice(-14);
  const totalMinutes = last14.reduce((s, d) => s + d.warmupMinutes, 0);
  const daysWarmed = last14.filter((d) => d.warmupMinutes > 0).length;
  const gained = history.length ? history[history.length - 1].followers - history[0].followers : 0;

  async function toggleGroup(gid: string) {
    const next = account!.groups.includes(gid) ? account!.groups.filter((g) => g !== gid) : [...account!.groups, gid];
    await accountsApi.update(account!.id, { groups: next });
    load();
  }

  async function saveNotes() {
    if (notes === account!.notes) return;
    await accountsApi.update(account!.id, { notes });
    toast.success("Notes saved");
    load();
  }

  return (
    <div className="flex flex-col gap-4">
      {back}

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex size-12 items-center justify-center rounded-full bg-muted text-lg font-semibold">
          {account.username[0].toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-semibold">@{account.username}</h1>
          <p className="flex items-center gap-1 text-sm text-muted-foreground">
            <Smartphone className="size-3.5" />
            {device ? (
              <a href={`#devices/${device.serial}`} className="underline-offset-4 hover:underline">
                {deviceLabel(device)}
              </a>
            ) : (
              account.serial
            )}
            · TikTok · {account.followers.toLocaleString()} followers
          </p>
        </div>
        <HealthBadge health={health} className="text-base" />
      </div>

      <div className="grid gap-4 md:grid-cols-3">
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

        <Card className="md:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2">
              <Users className="size-4" /> Groups
            </CardTitle>
            <Button variant="ghost" size="sm" onClick={() => openSettings("groups")}>
              <Settings2 /> Manage
            </Button>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-1.5">
              {groups.map((g) => {
                const on = account.groups.includes(g.id);
                return (
                  <Button key={g.id} size="sm" variant={on ? "secondary" : "outline"} onClick={() => toggleGroup(g.id)}>
                    {on && <Check />} {g.name}
                  </Button>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">
              Keywords:{" "}
              {(() => {
                const kws = [...new Set(groups.filter((g) => account.groups.includes(g.id)).flatMap((g) => g.keywords))];
                return kws.length ? kws.join(", ") : "Global default";
              })()}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Flame className="size-4" /> Warm-up
            </CardTitle>
            <CardDescription>
              Last 14d · {totalMinutes}m total · {daysWarmed}/14 days
              {account.lastWarmupAt && ` · Last ${timeAgo(account.lastWarmupAt)}`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {last14.length ? (
              <BarChart unit="min" data={last14.map((d) => ({ label: dayLabel(d.date), value: d.warmupMinutes }))} />
            ) : (
              <p className="text-sm text-muted-foreground">Loading…</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Followers</CardTitle>
            <CardDescription>
              Last 30d ·{" "}
              <span className={cn(gained > 0 && "text-foreground")}>
                {gained >= 0 ? "+" : ""}
                {gained.toLocaleString()}
              </span>
            </CardDescription>
          </CardHeader>
          <CardContent>
            {history.length ? (
              <LineChart unit="followers" data={history.map((d) => ({ label: dayLabel(d.date), value: d.followers }))} />
            ) : (
              <p className="text-sm text-muted-foreground">Loading…</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Notes</CardTitle>
        </CardHeader>
        <CardContent>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={saveNotes}
            rows={4}
            placeholder="Add a note…"
            className="w-full resize-y rounded-lg border bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
        </CardContent>
      </Card>
    </div>
  );
}
