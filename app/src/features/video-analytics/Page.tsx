import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { api, type Account, type VideoReading } from "@/api";
import { LineChart } from "@/components/shared/charts";
import { StatTile } from "@/components/shared/StatTile";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { engagement, latestVideos, videoKey } from "@/data/video-analytics";

const selectedKey = () => window.location.hash.split("/")[1] ?? null;
const count = (n: number | null) => n === null ? "—" : n.toLocaleString();
const pct = (n: number | null) => n === null ? "—" : `${(n * 100).toFixed(1)}%`;
type Sort = "views" | "likes" | "capturedAt";

export default function VideoAnalyticsPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [readings, setReadings] = useState<VideoReading[]>([]);
  const [accountId, setAccountId] = useState<number | null>(null);
  const [detailKey, setDetailKey] = useState(selectedKey);
  const [sort, setSort] = useState<Sort>("views");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function load() {
    const [list, saved] = await Promise.all([api.listAccounts(), api.videoReadings()]);
    setAccounts(list); setReadings(saved);
    setAccountId((id) => list.some((a) => a.id === id) ? id : list[0]?.id ?? null);
  }
  useEffect(() => {
    load().catch((e: unknown) => setError(String(e))).finally(() => setLoading(false));
    const onHash = () => setDetailKey(selectedKey());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const account = accounts.find((a) => a.id === accountId);
  const videos = latestVideos(readings);
  const rows = videos.filter((v) => v.accountId === accountId).sort((a, b) => sort === "capturedAt" ? Date.parse(b.capturedAt) - Date.parse(a.capturedAt) : (b[sort] ?? -1) - (a[sort] ?? -1));
  const detail = videos.find((v) => v.key === detailKey);
  const accountReadings = readings.filter((r) => r.accountId === accountId);
  const lastRead = accountReadings[accountReadings.length - 1];
  async function refresh() {
    if (!account) return;
    setBusy(true); setError(null);
    try {
      await api.runJob(account.serial, { action: "video_analytics", platform: account.platform, username: account.username });
      await load();
    } catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  }
  const back = <Button variant="ghost" size="sm" className="self-start" nativeButton={false} render={<a href="#video-analytics" />}><ArrowLeft /> Videos</Button>;
  if (detailKey) {
    if (loading) return <p>Loading video…</p>;
    if (!detail) return <div className="flex flex-col gap-3">{back}<p>{error ?? "No saved measurements for this video."}</p></div>;
    const history = readings.flatMap((r) => r.accountId === detail.accountId ? r.videos.filter((v) => videoKey(r.accountId, v.platformVideoId) === detail.key).map((v) => ({ ...v, capturedAt: r.capturedAt })) : []);
    const owner = accounts.find((a) => a.id === detail.accountId);
    return <div className="flex flex-col gap-4">
      {back}
      <h1 className="text-lg font-semibold">{detail.caption || `Video ${detail.platformVideoId}`}</h1>
      <p className="text-sm text-muted-foreground">@{owner?.username} · Last read {new Date(detail.capturedAt).toLocaleString()}</p>
      <a className="text-sm underline" href={detail.url} target="_blank" rel="noreferrer">Open on TikTok</a>
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatTile label="Views" value={count(detail.views)} />
        <StatTile label="Likes" value={count(detail.likes)} />
        <StatTile label="Comments" value={count(detail.comments)} />
        <StatTile label="Shares" value={count(detail.shares)} />
        <StatTile label="Saves" value={count(detail.saves)} />
        <StatTile label="Engagement" value={pct(engagement(detail))} sub="Likes + comments + shares / views" />
      </div>
      <Card><CardHeader><CardTitle>Views over time</CardTitle></CardHeader><CardContent>
        {history.length > 1 ? <LineChart unit="views" data={history.map((v) => ({ label: new Date(v.capturedAt).toLocaleString(), value: v.views }))} /> : <p className="text-sm text-muted-foreground">Refresh this account again later to build a history of total views.</p>}
      </CardContent></Card>
      <p className="text-sm text-muted-foreground">Counts may be rounded by TikTok. Watch time, retention, traffic sources, and followers gained are not collected.</p>
    </div>;
  }
  return <div className="flex flex-col gap-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><h1 className="text-lg font-semibold">Video analytics</h1><Button disabled={!account || loading || busy} onClick={refresh}>{busy ? "Reading phone…" : "Refresh from phone"}</Button></div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {loading && <p>Loading videos…</p>}
    {!loading && !accounts.length && <p className="text-sm text-muted-foreground">Sync accounts from the Accounts page to get started.</p>}
    <div className="flex flex-wrap gap-1">{accounts.map((a) => <Button key={a.id} size="sm" disabled={busy} variant={a.id === accountId ? "secondary" : "ghost"} onClick={() => setAccountId(a.id)}>@{a.username} · {a.serial}</Button>)}</div>
    {account && <>
      <p className="text-sm text-muted-foreground">Reads up to 12 videos from this account's profile per refresh. {lastRead ? `Last checked ${new Date(lastRead.capturedAt).toLocaleString()}.` : "Refresh to collect the first measurements."} Missing metrics appear as —.</p>
      {lastRead?.videos.length === 0 && <p className="text-sm text-muted-foreground">No posted videos were found in the latest refresh.</p>}
      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile label="Tracked videos" value={String(rows.length)} />
        <StatTile label="Total views" value={rows.length ? count(rows.reduce((n, v) => n + v.views, 0)) : "—"} sub="Latest saved count for each tracked video" />
        <StatTile label="Total likes" value={rows.length && rows.every((v) => v.likes !== null) ? count(rows.reduce((n, v) => n + (v.likes ?? 0), 0)) : "—"} />
      </div>
      <div className="flex gap-1">{(["views", "likes", "capturedAt"] satisfies Sort[]).map((key) => <Button key={key} size="sm" variant={sort === key ? "secondary" : "ghost"} onClick={() => setSort(key)}>{key === "capturedAt" ? "Last read" : key === "views" ? "Most views" : "Most likes"}</Button>)}</div>
      <Card><CardContent><Table><TableHeader><TableRow><TableHead>Video</TableHead><TableHead className="text-right">Views</TableHead><TableHead className="text-right">Likes</TableHead><TableHead className="text-right">Comments</TableHead><TableHead className="text-right">Shares</TableHead><TableHead className="text-right">Engagement</TableHead><TableHead>Last read</TableHead></TableRow></TableHeader><TableBody>
        {rows.map((v) => <TableRow key={v.key}><TableCell><a className="block max-w-72 truncate font-medium underline-offset-4 hover:underline" href={`#video-analytics/${v.key}`}>{v.caption || `Video ${v.platformVideoId}`}</a></TableCell><TableCell className="text-right tabular-nums">{count(v.views)}</TableCell><TableCell className="text-right tabular-nums">{count(v.likes)}</TableCell><TableCell className="text-right tabular-nums">{count(v.comments)}</TableCell><TableCell className="text-right tabular-nums">{count(v.shares)}</TableCell><TableCell className="text-right tabular-nums">{pct(engagement(v))}</TableCell><TableCell>{new Date(v.capturedAt).toLocaleString()}</TableCell></TableRow>)}
      </TableBody></Table>{!rows.length && <p className="py-6 text-center text-sm text-muted-foreground">No saved video measurements yet.</p>}</CardContent></Card>
    </>}
  </div>;
}
