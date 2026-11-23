// Home page: the state of everything at a glance.
import { useEffect, useState } from "react";
import { Bell, CalendarClock, CheckCheck, Flame, Moon, ShieldCheck, Smartphone } from "lucide-react";

import { BarChart } from "@/components/shared/charts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { timeAgo } from "@/lib/mock";
import { cn } from "@/lib/utils";
import { useAlerts } from "@/mocks/alerts";
import { devicesApi, type Device } from "@/mocks/devices";
import { useSettings } from "@/settings/SettingsContext";
import { inQuietHours, useSafety } from "@/settings/safety/store";
import { ALERT_KIND } from "../alerts/Page";
import { accountHealth } from "../accounts/health";
import { HealthBadge } from "../accounts/HealthBadge";
import { accountsApi, type Account, type DayStat } from "@/mocks/accounts";
import { untilText, upcomingRuns } from "./mock";

const isToday = (iso: string) => new Date(iso).toDateString() === new Date().toDateString();

export default function DashboardPage() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [week, setWeek] = useState<{ label: string; value: number }[]>([]);
  const [now, setNow] = useState(() => new Date());
  const alerts = useAlerts();
  const safety = useSafety();
  const { openSettings } = useSettings();

  useEffect(() => {
    devicesApi.list().then(setDevices);
    accountsApi.list().then(async (list) => {
      setAccounts(list);
      // Total warm-up minutes per day over the last 7 days, all accounts.
      const all: DayStat[][] = await Promise.all(list.map((a) => accountsApi.history(a.id, 7)));
      setWeek(
        (all[0] ?? []).map((d, i) => ({
          label: new Date(d.date).toLocaleDateString([], { weekday: "short" }),
          value: all.reduce((s, h) => s + (h[i]?.warmupMinutes ?? 0), 0),
        })),
      );
    });
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  const online = devices.filter((d) => d.state === "device").length;
  const warmedToday = accounts.filter((a) => a.lastWarmupAt && isToday(a.lastWarmupAt)).length;
  const openAlerts = alerts.filter((a) => !a.solvedAt);
  const errorsToday = alerts.filter((a) => isToday(a.at) && a.kind !== "limit_reached").length;
  const runs = upcomingRuns(3, now);
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

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile icon={Smartphone} label="Devices online" value={`${online} / ${devices.length}`} href="#control-room" />
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
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Warm-up activity</CardTitle>
            <CardDescription>Last 7 days</CardDescription>
          </CardHeader>
          <CardContent>
            {week.length ? <BarChart unit="min" data={week} /> : <p className="text-sm text-muted-foreground">Loading…</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Upcoming</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {runs.map((r) => (
              <div key={r.at.toISOString()} className="flex items-start justify-between gap-3 text-sm">
                <div>
                  <div className="font-medium">{r.label}</div>
                  <div className="text-xs text-muted-foreground">
                    {r.at.toLocaleDateString() === now.toLocaleDateString() ? "Today" : "Tomorrow"}{" "}
                    {r.at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · {r.accounts} accounts
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
                    <span className="flex-1">{a.title}</span>
                    <span className="text-xs whitespace-nowrap text-muted-foreground">{timeAgo(a.at)}</span>
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
