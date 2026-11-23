// How each account is growing: followers, views and engagement, plus a comparison table.
import { useEffect, useState } from "react";

import { BarChart, LineChart } from "@/components/shared/charts";
import { StatTile } from "@/components/shared/StatTile";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { engagement, fmtNum, usePosts, videoStats } from "@/mocks/posts";
import { accountHealth } from "../accounts/health";
import { HealthBadge } from "../accounts/HealthBadge";
import { accountsApi, type Account, type DayStat } from "../accounts/mock";

const RANGES = [7, 30] as const;
const dayLabel = (iso: string) => new Date(iso).toLocaleDateString([], { day: "numeric", month: "short" });

export default function AccountAnalyticsPage() {
  const posts = usePosts();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [history, setHistory] = useState<Record<number, DayStat[]>>({});
  const [selected, setSelected] = useState<number | null>(null);
  const [range, setRange] = useState<(typeof RANGES)[number]>(30);

  useEffect(() => {
    accountsApi.list().then(async (list) => {
      setAccounts(list);
      setSelected((s) => s ?? list[0]?.id ?? null);
      const all = await Promise.all(list.map((a) => accountsApi.history(a.id, 30)));
      setHistory(Object.fromEntries(list.map((a, i) => [a.id, all[i]])));
    });
  }, []);

  const since = Date.now() - range * 86_400_000;

  /** Per-account numbers for the chosen range. */
  function summary(a: Account) {
    const h = (history[a.id] ?? []).slice(-range);
    const gained = h.length ? h[h.length - 1].followers - h[0].followers : 0;
    const mine = posts.filter((p) => p.accountId === a.id && p.status === "posted");
    const inRange = mine.filter((p) => new Date(p.at).getTime() >= since);
    const stats = inRange.map((p) => videoStats(p)!);
    const views = stats.reduce((s, x) => s + x.views, 0);
    const eng = stats.length ? stats.reduce((s, x) => s + engagement(x), 0) / stats.length : 0;
    // Views per day across all this account's videos.
    const viewsByDay = new Map<string, number>();
    for (const p of mine) for (const d of videoStats(p)!.daily) viewsByDay.set(d.date, (viewsByDay.get(d.date) ?? 0) + d.views);
    return { h, gained, posts: inRange.length, views, eng, viewsByDay };
  }

  const account = accounts.find((a) => a.id === selected);
  const sel = account ? summary(account) : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold">Account analytics</h1>
          <p className="text-sm text-muted-foreground">Growth and reach for each account.</p>
        </div>
        <div className="flex gap-1">
          {RANGES.map((r) => (
            <Button key={r} size="sm" variant={range === r ? "secondary" : "ghost"} onClick={() => setRange(r)}>
              Last {r} days
            </Button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-1">
        {accounts.map((a) => (
          <Button key={a.id} size="sm" variant={selected === a.id ? "secondary" : "ghost"} onClick={() => setSelected(a.id)}>
            @{a.username}
          </Button>
        ))}
      </div>

      {account && sel && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <StatTile label="Followers" value={fmtNum(account.followers)} />
            <StatTile label="Followers gained" value={`${sel.gained >= 0 ? "+" : ""}${fmtNum(sel.gained)}`} sub={`last ${range} days`} />
            <StatTile label="Videos posted" value={String(sel.posts)} sub={`last ${range} days`} />
            <StatTile label="Views" value={fmtNum(sel.views)} sub="from those videos" />
            <StatTile label="Avg engagement" value={`${(sel.eng * 100).toFixed(1)}%`} sub="likes + comments + shares" />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Followers</CardTitle>
                <CardDescription>@{account.username} · last {range} days</CardDescription>
              </CardHeader>
              <CardContent>
                {sel.h.length ? (
                  <LineChart unit="followers" data={sel.h.map((d) => ({ label: dayLabel(d.date), value: d.followers }))} />
                ) : (
                  <p className="text-sm text-muted-foreground">Loading…</p>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Views per day</CardTitle>
                <CardDescription>All videos from @{account.username}</CardDescription>
              </CardHeader>
              <CardContent>
                {sel.h.length ? (
                  <BarChart unit="views" data={sel.h.map((d) => ({ label: dayLabel(d.date), value: sel.viewsByDay.get(d.date) ?? 0 }))} />
                ) : (
                  <p className="text-sm text-muted-foreground">Loading…</p>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}

      <Card>
        <CardHeader>
          <CardTitle>All accounts</CardTitle>
          <CardDescription>Last {range} days. Click a row to see it above.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Account</TableHead>
                <TableHead className="text-right">Followers</TableHead>
                <TableHead className="text-right">Gained</TableHead>
                <TableHead className="text-right">Videos</TableHead>
                <TableHead className="text-right">Views</TableHead>
                <TableHead className="text-right">Views / video</TableHead>
                <TableHead className="text-right">Engagement</TableHead>
                <TableHead>Health</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {accounts.map((a) => {
                const s = summary(a);
                return (
                  <TableRow
                    key={a.id}
                    className={cn("cursor-pointer", a.id === selected && "bg-muted/50")}
                    onClick={() => setSelected(a.id)}
                  >
                    <TableCell className="font-medium">@{a.username}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtNum(a.followers)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {s.gained >= 0 ? "+" : ""}
                      {fmtNum(s.gained)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{s.posts}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtNum(s.views)}</TableCell>
                    <TableCell className="text-right tabular-nums">{s.posts ? fmtNum(Math.round(s.views / s.posts)) : "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{s.posts ? `${(s.eng * 100).toFixed(1)}%` : "—"}</TableCell>
                    <TableCell>
                      <HealthBadge health={accountHealth(a)} />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
