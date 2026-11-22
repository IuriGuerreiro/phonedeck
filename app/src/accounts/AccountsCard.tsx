import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeftRight, Flame, Search, Square, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { api, type Account, type Job, type PlatformId } from "@/api";
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
import { toOptions, useWarmupSettings, WarmupSettings } from "./WarmupSettings";

type Props = {
  serial: string;
  /** Engine and phone are ready. */
  ready: boolean;
  /** Called after any job finishes so the runs table can refresh. */
  onJobDone: () => void;
};

// TikTok only for now; the worker has no other platforms yet.
const platform: PlatformId = "tiktok";

export function AccountsCard({ serial, ready, onJobDone }: Props) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [running, setRunning] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [settings, setSettings] = useWarmupSettings();
  // Set by Stop so "Warm up all" doesn't start the next account.
  const stopAll = useRef(false);

  const refresh = useCallback(() => {
    api.listAccounts(serial).then(setAccounts).catch((e) => toast.error(String(e)));
  }, [serial]);

  useEffect(refresh, [refresh]);

  useEffect(() => {
    const unlisten = api.onJobProgress((p) => {
      if (p.serial === serial) setProgress(p.message);
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, [serial]);

  const visible = accounts.filter((a) => a.platform === platform);
  const warmupOpts = () => toOptions(settings);

  /** Run one job; returns false if it failed. */
  async function run(label: string, job: Job): Promise<boolean> {
    setRunning(label);
    setProgress(null);
    try {
      await api.runJob(serial, job);
      return true;
    } catch (e) {
      toast.error(String(e));
      return false;
    } finally {
      setRunning(null);
      setProgress(null);
      refresh();
      onJobDone();
    }
  }

  async function warmUpAll() {
    stopAll.current = false;
    const targets = visible.filter((a) => a.status === "ok");
    for (const [i, a] of targets.entries()) {
      if (stopAll.current) break;
      await run(`Warm-up ${i + 1}/${targets.length}: @${a.username}`, {
        action: "warmup",
        platform,
        username: a.username,
        ...warmupOpts(),
      });
    }
  }

  async function stop() {
    stopAll.current = true;
    await api.stopJob(serial).catch((e) => toast.error(String(e)));
  }

  const idle = ready && !running;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>TikTok accounts</CardTitle>
        <Button
          variant="outline"
          size="sm"
          disabled={!idle}
          onClick={() => run("Finding accounts", { action: "list_accounts", platform })}
        >
          <Search /> Find logged-in accounts
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <WarmupSettings form={settings} onChange={setSettings} />
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled={!idle}
              onClick={() => run("Warm-up (current account)", { action: "warmup", platform, ...warmupOpts() })}
            >
              <Flame /> Warm up current
            </Button>
            <Button disabled={!idle || !visible.some((a) => a.status === "ok")} onClick={warmUpAll}>
              <Flame /> Warm up all
            </Button>
          </div>
        </div>

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
                <TableHead>Status</TableHead>
                <TableHead>Last warm-up</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="font-medium">@{a.username}</TableCell>
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
                        disabled={!idle}
                        onClick={() =>
                          run(`Switching to @${a.username}`, {
                            action: "switch_account",
                            platform,
                            username: a.username,
                          })
                        }
                      >
                        <ArrowLeftRight /> Switch
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={!idle}
                        onClick={() =>
                          run(`Warm-up: @${a.username}`, {
                            action: "warmup",
                            platform,
                            username: a.username,
                            ...warmupOpts(),
                          })
                        }
                      >
                        <Flame /> Warm up
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        disabled={!!running}
                        title="Remove from list (does not log out)"
                        onClick={() => api.deleteAccount(a.id).then(refresh)}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

/** SQLite stores UTC as "YYYY-MM-DD HH:MM:SS". */
function timeAgo(utc: string) {
  const mins = Math.round((Date.now() - new Date(utc.replace(" ", "T") + "Z").getTime()) / 60_000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}
