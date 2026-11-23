// How each posted video is doing.
import { useEffect, useState } from "react";
import { ArrowDown, ArrowLeft } from "lucide-react";

import { BarChart, LineChart } from "@/components/shared/charts";
import { StatTile } from "@/components/shared/StatTile";
import { VideoThumb } from "@/components/shared/VideoThumb";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { engagement, fmtNum, usePosts, videoStats, type Post, type VideoStats } from "@/mocks/posts";
import { accountsApi, type Account } from "../accounts/mock";

const idFromHash = () => Number(window.location.hash.split("/")[1]) || null;
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

export default function VideoAnalyticsPage() {
  const [id, setId] = useState(idFromHash);
  const [accounts, setAccounts] = useState<Account[]>([]);

  useEffect(() => {
    accountsApi.list().then(setAccounts);
    const onHash = () => setId(idFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const username = (aid: number) => accounts.find((a) => a.id === aid)?.username ?? `#${aid}`;
  return id ? <VideoDetail id={id} username={username} /> : <VideoList username={username} />;
}

type SortKey = "at" | "views" | "engagement" | "completion" | "followers";

function VideoList({ username }: { username: (id: number) => string }) {
  const posts = usePosts();
  const [sort, setSort] = useState<SortKey>("at");
  const [account, setAccount] = useState<number | null>(null);

  const rows = posts
    .filter((p) => p.status === "posted" && (account === null || p.accountId === account))
    .map((p) => ({ p, s: videoStats(p)! }));

  const value = ({ p, s }: { p: Post; s: VideoStats }) =>
    ({ at: new Date(p.at).getTime(), views: s.views, engagement: engagement(s), completion: s.completionRate, followers: s.newFollowers })[sort];
  rows.sort((a, b) => value(b) - value(a));

  const totals = rows.reduce(
    (t, { s }) => ({ views: t.views + s.views, likes: t.likes + s.likes, followers: t.followers + s.newFollowers }),
    { views: 0, likes: 0, followers: 0 },
  );
  const accountIds = [...new Set(posts.filter((p) => p.status === "posted").map((p) => p.accountId))];

  const Th = ({ k, children, className }: { k: SortKey; children: React.ReactNode; className?: string }) => (
    <TableHead className={className}>
      <button className={cn("inline-flex items-center gap-1", sort === k && "text-foreground")} onClick={() => setSort(k)}>
        {children}
        {sort === k && <ArrowDown className="size-3" />}
      </button>
    </TableHead>
  );

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold">Video analytics</h1>
        <p className="text-sm text-muted-foreground">Every posted video. Click one for details.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <StatTile label="Videos" value={String(rows.length)} />
        <StatTile label="Total views" value={fmtNum(totals.views)} />
        <StatTile label="Total likes" value={fmtNum(totals.likes)} />
        <StatTile label="Followers gained" value={fmtNum(totals.followers)} />
      </div>

      <div className="flex flex-wrap gap-1">
        <Button size="sm" variant={account === null ? "secondary" : "ghost"} onClick={() => setAccount(null)}>
          All accounts
        </Button>
        {accountIds.map((aid) => (
          <Button key={aid} size="sm" variant={account === aid ? "secondary" : "ghost"} onClick={() => setAccount(aid)}>
            @{username(aid)}
          </Button>
        ))}
      </div>

      <Card>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <Th k="at">Video</Th>
                <Th k="views" className="text-right">Views</Th>
                <Th k="engagement" className="text-right">Engagement</Th>
                <Th k="completion" className="text-right">Watched to end</Th>
                <Th k="followers" className="text-right">New followers</Th>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ p, s }) => (
                <TableRow key={p.id} className="cursor-pointer" onClick={() => (window.location.hash = `video-analytics/${p.id}`)}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <VideoThumb cover={p.cover} durationSec={p.durationSec} className="w-8" />
                      <div className="min-w-0">
                        <div className="max-w-72 truncate font-medium">{p.caption}</div>
                        <div className="text-xs text-muted-foreground">
                          @{username(p.accountId)} · {new Date(p.at).toLocaleDateString([], { day: "numeric", month: "short" })}
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{fmtNum(s.views)}</TableCell>
                  <TableCell className="text-right tabular-nums">{pct(engagement(s))}</TableCell>
                  <TableCell className="text-right tabular-nums">{pct(s.completionRate)}</TableCell>
                  <TableCell className="text-right tabular-nums">+{fmtNum(s.newFollowers)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {rows.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">No posted videos yet.</p>}
        </CardContent>
      </Card>
    </div>
  );
}

function VideoDetail({ id, username }: { id: number; username: (id: number) => string }) {
  const post = usePosts().find((p) => p.id === id);
  const back = (
    <Button variant="ghost" size="sm" className="self-start" render={<a href="#video-analytics" />}>
      <ArrowLeft /> All videos
    </Button>
  );
  const s = post && videoStats(post);
  if (!post || !s)
    return (
      <div className="flex flex-col gap-3">
        {back}
        <p className="text-sm text-muted-foreground">No stats for this video yet.</p>
      </div>
    );

  return (
    <div className="flex flex-col gap-4">
      {back}
      <div className="flex items-start gap-4">
        <VideoThumb cover={post.cover} durationSec={post.durationSec} className="w-20" />
        <div className="min-w-0">
          <h1 className="text-lg font-semibold">{post.caption}</h1>
          <p className="text-sm text-muted-foreground">{post.hashtags.map((h) => `#${h}`).join(" ")}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            <a href={`#accounts/${post.accountId}`} className="text-foreground underline-offset-4 hover:underline">
              @{username(post.accountId)}
            </a>{" "}
            · posted {new Date(post.at).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" })} · {post.durationSec}s
          </p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatTile label="Views" value={fmtNum(s.views)} />
        <StatTile label="Likes" value={fmtNum(s.likes)} />
        <StatTile label="Comments" value={fmtNum(s.comments)} />
        <StatTile label="Shares" value={fmtNum(s.shares)} />
        <StatTile label="Saves" value={fmtNum(s.saves)} />
        <StatTile label="New followers" value={`+${fmtNum(s.newFollowers)}`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Views per day</CardTitle>
            <CardDescription>Since it was posted.</CardDescription>
          </CardHeader>
          <CardContent>
            <BarChart
              unit="views"
              data={s.daily.map((d) => ({ label: new Date(d.date).toLocaleDateString([], { day: "numeric", month: "short" }), value: d.views }))}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Viewers still watching</CardTitle>
            <CardDescription>
              Average watch time {s.avgWatchSec}s of {post.durationSec}s · {pct(s.completionRate)} watched to the end
            </CardDescription>
          </CardHeader>
          <CardContent>
            <LineChart unit="% still watching" data={s.retention.map((v, i) => ({ label: `${i * 10}% in`, value: v }))} />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Where views came from</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2.5">
            {s.sources.map((src) => (
              <div key={src.label} className="flex items-center gap-3 text-sm">
                <span className="w-20 shrink-0 text-muted-foreground">{src.label}</span>
                <div className="h-2 flex-1 rounded-full bg-muted">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${src.pct}%` }} />
                </div>
                <span className="w-10 text-right tabular-nums">{src.pct}%</span>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Rates</CardTitle>
            <CardDescription>Out of all views.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-1.5 text-sm">
            <Rate k="Engagement (likes + comments + shares)" v={pct(engagement(s))} />
            <Rate k="Like rate" v={pct(s.likes / s.views)} />
            <Rate k="Share rate" v={pct(s.shares / s.views)} />
            <Rate k="Follow rate" v={pct(s.newFollowers / s.views)} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Rate({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-muted-foreground">{k}</span>
      <span className="tabular-nums">{v}</span>
    </div>
  );
}
