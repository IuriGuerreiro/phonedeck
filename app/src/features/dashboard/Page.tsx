// Home page: the state of everything at a glance.
import { useEffect, useState } from "react";
import { Bell, CalendarClock, CheckCheck, Flame, Moon, ShieldCheck, Smartphone } from "lucide-react";

import { BarChart } from "@/components/shared/charts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { parseTime, timeAgo } from "@/lib/time";
import { cn } from "@/lib/utils";
import { useAlerts } from "@/data/alerts";
import { api } from "@/api";
import { accountsApi, type Account } from "@/data/accounts";
import { devicesApi, isReady, type Device } from "@/data/devices";
import { useSettings } from "@/settings/SettingsContext";
import { inQuietHours, useSafety } from "@/settings/safety/store";
import { ALERT_KIND, alertTitle } from "../alerts/kinds";
import { accountHealth } from "../accounts/health";
import { HealthBadge } from "../accounts/HealthBadge";
import { untilText, type PlannedRun } from "./runs";

const isToday = (time: string) => parseTime(time).toDateString() === new Date().toDateString();

/** Not wired yet: needs warm-up minutes per day from the backend. */
const SAMPLE_WEEK = [32, 41, 0, 28, 45, 37, 22].map((value, i) => ({
  label: new Date(Date.now() - (6 - i) * 86_400_000).toLocaleDateString([], { weekday: "short" }),
  value,
}));

export default function DashboardPage() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [planned, setPlanned] = useState<PlannedRun[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());
  const { alerts } = useAlerts();
  const safety = useSafety();
  const { openSettings } = useSettings();

  useEffect(() => {
    let alive = true;
    const load = () => {
      Promise.all([devicesApi.list(), accountsApi.list(), api.listSchedules(), api.listGroups(), api.upcomingRuns(8)]).then(
        ([d, a, schedules, groups, runs]) => {
          if (!alive) return;
          const members = (groupId: number | null) =>
            groupId === null ? a.length : a.filter((x) => groups.find((g) => g.id === groupId)?.accountIds.includes(x.id)).length;
          setDevices(d);
          setAccounts(a);
          setPlanned(
            runs.map((r) => ({
              key: `${r.scheduleId}-${r.date}-${r.at}`,
              label: r.name,
              at: new Date(`${r.date}T${r.at}:00`),
              accounts: members(schedules.find((s) => s.id === r.scheduleId)?.groupId ?? null),
            })),
          );
          setNow(new Date());
          setError(null);
        },
        (e) => alive && setError(String(e)),
      );
    };
    load();
    const t = setInterval(load, 5000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const online = devices.filter(isReady).length;
  const warmedToday = accounts.filter((a) => a.lastWarmupAt && isToday(a.lastWarmupAt)).length;
  const openAlerts = alerts.filter((a) => !a.resolvedAt);
  const errorsToday = alerts.filter((a) => isToday(a.createdAt)).length;
  // The backend keeps a slot listed for a while after it started.
  const runs = planned.filter((r) => r.at > now).slice(0, 3);
  const next = runs[0];
  const quiet = inQuietHours(safety, now);
  const needCare = accounts
    .map((a) => ({ a, h: accountHealth(a) }))
    .filter((x) => x.h.level !== "good")
    .sort((x, y) => x.h.score - y.h.score);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          {now.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" })}
        </p>
      </div>

      {error && <p role="alert" className="text-sm text-destructive">Couldn't load: {error}</p>}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile icon={Smartphone} label="Devices online" value={`${online} / ${devices.length}`} href="#devices" />
        <Tile icon={Flame} label="Warmed today" value={`${warmedToday} / ${accounts.length}`} href="#accounts" />
        <Tile
          icon={Bell}
          label="Alerts"
          value={String(openAlerts.length)}
          sub={errorsToday ? `${errorsToday} today` : undefined}
          href="#alerts"
          warn={openAlerts.length > 0}
        />
        <Tile
          icon={CalendarClock}
          label="Next run"
          value={next ? next.at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"}
          sub={next ? untilText(next.at, now) : undefined}
          href="#schedule"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Warm-up activity <Badge variant="outline">Sample data</Badge>
            </CardTitle>
            <CardDescription>Last 7 days</CardDescription>
          </CardHeader>
          <CardContent>
            <BarChart unit="min" data={SAMPLE_WEEK} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Upcoming</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {runs.length === 0 && <p className="text-sm text-muted-foreground">Nothing planned this week.</p>}
            {runs.map((r) => (
              <div key={r.key} className="flex items-start justify-between gap-3 text-sm">
                <div>
                  <div className="font-medium">{r.label}</div>
                  <div className="text-xs text-muted-foreground">
                    {dayText(r.at, now)}{" "}
                    {r.at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · {r.accounts} account{r.accounts === 1 ? "" : "s"}
                  </div>
                </div>
                <span className="text-xs whitespace-nowrap text-muted-foreground">{untilText(r.at, now)}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Open alerts</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {openAlerts.length === 0 ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <CheckCheck className="size-4 text-[#0ca30c]" /> No open alerts
              </p>
            ) : (
              openAlerts.slice(0, 4).map((a) => {
                const k = ALERT_KIND[a.kind];
                return (
                  <a key={a.id} href="#alerts" className="flex items-start gap-2 rounded-md p-1 text-sm hover:bg-muted">
                    <k.icon className={cn("mt-0.5 size-4 shrink-0", k.color)} />
                    <span className="flex-1">{alertTitle(a)}</span>
                    <span className="text-xs whitespace-nowrap text-muted-foreground">{timeAgo(a.createdAt)}</span>
                  </a>
                );
              })
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Account health</CardTitle>
            <CardDescription>
              {accounts.length - needCare.length}/{accounts.length} healthy
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-1.5">
            {needCare.length === 0 ? (
              <p className="text-sm text-muted-foreground">All accounts healthy</p>
            ) : (
              needCare.map(({ a, h }) => (
                <a key={a.id} href={`#accounts/${a.id}`} className="flex items-center justify-between gap-2 rounded-md p-1 text-sm hover:bg-muted">
                  <span className="truncate">@{a.username}</span>
                  <HealthBadge health={h} />
                </a>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="size-4" /> Safety
            </CardTitle>
            <Button variant="ghost" size="sm" onClick={() => openSettings("safety")}>
              Edit
            </Button>
          </CardHeader>
          <CardContent className="flex flex-col gap-1.5 text-sm">
            {quiet && (
              <div className="mb-1 flex items-center gap-2 rounded-md border bg-muted/50 p-2 text-xs">
                <Moon className="size-4" /> Quiet hours active until {safety.quietEnd}
              </div>
            )}
            <Row k="Likes" v={`${safety.maxLikesPerDay}/day`} />
            <Row k="Follows" v={`${safety.maxFollowsPerDay}/day`} />
            <Row k="Warm-up" v={`${safety.maxMinutesPerDay}m/day`} />
            <Row k="Quiet hours" v={safety.quietHoursOn ? `${safety.quietStart}–${safety.quietEnd}` : "Off"} />
            <Row
              k="Breaks"
              v={safety.breaksOn ? `Every ${safety.breakEveryMin}–${safety.breakEveryMax}m` : "Off"}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function dayText(at: Date, now: Date) {
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  if (at.toDateString() === now.toDateString()) return "Today";
  if (at.toDateString() === tomorrow.toDateString()) return "Tomorrow";
  return at.toLocaleDateString([], { weekday: "short", day: "numeric" });
}

function Tile(props: {
  icon: typeof Bell;
  label: string;
  value: string;
  sub?: string;
  href?: string;
  warn?: boolean;
}) {
  const body = (
    <Card className={cn("h-full", props.href && "transition-colors hover:bg-muted/50")}>
      <CardContent className="flex flex-col gap-1">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <props.icon className={cn("size-4", props.warn && "text-[#d03b3b]")} />
          {props.label}
        </div>
        <div className="text-3xl font-semibold tabular-nums">{props.value}</div>
        {props.sub && <div className="text-xs text-muted-foreground">{props.sub}</div>}
      </CardContent>
    </Card>
  );
  return props.href ? <a href={props.href}>{body}</a> : body;
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-muted-foreground">{k}</span>
      <span className="tabular-nums">{v}</span>
    </div>
  );
}
