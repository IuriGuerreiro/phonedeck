import { useEffect, useState } from "react";
import { api, type Account, type AccountSnapshot } from "@/api";
import { LineChart } from "@/components/shared/charts";
import { StatTile } from "@/components/shared/StatTile";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function AccountAnalyticsPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [snapshots, setSnapshots] = useState<AccountSnapshot[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [range, setRange] = useState(30);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  async function load() {
    const [list, history] = await Promise.all([api.listAccounts(), api.accountSnapshots()]);
    setAccounts(list);
    setSnapshots(history);
    setSelected((id) => list.some((a) => a.id === id) ? id : list[0]?.id ?? null);
  }
  useEffect(() => { load().catch((e: unknown) => setError(String(e))).finally(() => setLoading(false)); }, []);
  const account = accounts.find((a) => a.id === selected);
  const all = snapshots.filter((s) => s.accountId === selected);
  const latest = all[all.length - 1];
  const history = all.filter((s) => Date.parse(s.capturedAt) >= Date.now() - range * 86400000);
  const first = history[0];
  const gained = first && history.length > 1 && latest ? latest.followers - first.followers : null;
  async function refresh() {
    if (!account) return;
    setBusy(true); setError(null);
    try {
      await api.runJob(account.serial, { action: "account_analytics", platform: account.platform, username: account.username });
      await load();
    } catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  }
  return <div className="flex flex-col gap-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h1 className="text-lg font-semibold">Account analytics</h1>
      <Button disabled={!account || busy || loading} onClick={refresh}>{busy ? "Reading phone…" : "Refresh from phone"}</Button>
    </div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {loading ? <p>Loading accounts…</p> : !accounts.length && <p className="text-sm text-muted-foreground">Sync accounts from the Accounts page to get started.</p>}
    <div className="flex flex-wrap gap-1">{accounts.map((a) => <Button key={a.id} disabled={busy} size="sm" variant={selected === a.id ? "secondary" : "ghost"} onClick={() => setSelected(a.id)}>@{a.username} · {a.serial}</Button>)}</div>
    {account && <>
      <p className="text-sm text-muted-foreground">{latest ? `Last read ${new Date(latest.capturedAt).toLocaleString()}. Counts may be rounded by TikTok.` : "No measurements yet. Refresh to read this account from its phone."}</p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Followers" value={latest?.followers.toLocaleString() ?? "—"} />
        <StatTile label="Following" value={latest?.following.toLocaleString() ?? "—"} />
        <StatTile label="Total likes" value={latest?.likes.toLocaleString() ?? "—"} />
        <StatTile label="Followers gained" value={gained === null ? "—" : `${gained >= 0 ? "+" : ""}${gained.toLocaleString()}`} sub={`Between saved readings in the last ${range} days`} />
      </div>
      <Card><CardHeader><CardTitle>Follower history</CardTitle></CardHeader><CardContent>
        <div className="mb-4 flex gap-1">{[7, 30].map((r) => <Button key={r} size="sm" variant={range === r ? "secondary" : "ghost"} onClick={() => setRange(r)}>{r}d</Button>)}</div>
        {history.length > 1 ? <LineChart unit="followers" data={history.map((s) => ({ label: new Date(s.capturedAt).toLocaleString(), value: s.followers }))} /> : <p className="text-sm text-muted-foreground">At least two readings are needed to show growth. Refresh again later to build history.</p>}
      </CardContent></Card>
    </>}
  </div>;
}
