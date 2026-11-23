// Every job run on every phone, newest first.
import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { api, type Device, type JobRun } from "@/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { deviceLabel } from "@/data/devices";
import { parseTime } from "@/lib/time";

export default function ActivityPage() {
  const [runs, setRuns] = useState<JobRun[] | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);

  const refresh = useCallback(() => {
    api.recentRuns(100).then(setRuns).catch((e) => toast.error(String(e)));
    api.listDevices().then(setDevices).catch(() => {});
  }, []);

  useEffect(refresh, [refresh]);

  const phone = (serial: string) => {
    const d = devices.find((x) => x.serial === serial);
    return d ? deviceLabel(d) : serial;
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Activity</h1>
        <Button variant="outline" size="sm" onClick={refresh}>
          <RefreshCw /> Refresh
        </Button>
      </div>
      <Card>
        <CardContent>
          {runs === null ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : runs.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing has run yet.</p>
          ) : (
            <RunsTable runs={runs} phone={phone} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export function RunsTable({ runs, phone }: { runs: JobRun[]; phone?: (serial: string) => string }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Time</TableHead>
          {phone && <TableHead>Device</TableHead>}
          <TableHead>Action</TableHead>
          <TableHead>Result</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {runs.map((r) => (
          <TableRow key={r.id}>
            <TableCell className="text-muted-foreground">{fmtTime(r.startedAt)}</TableCell>
            {phone && <TableCell>{phone(r.serial)}</TableCell>}
            <TableCell>{ACTION_LABEL[r.action] ?? r.action}</TableCell>
            <TableCell className="max-w-md">
              <RunStatus run={r} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

const ACTION_LABEL: Record<string, string> = {
  open_app: "Open app",
  swipe_up: "Swipe up",
  list_accounts: "Sync accounts",
  switch_account: "Switch account",
  warmup: "Warm-up",
};

function fmtTime(s: string) {
  const d = parseTime(s);
  const today = d.toDateString() === new Date().toDateString();
  return today ? d.toLocaleTimeString() : d.toLocaleString();
}

function RunStatus({ run }: { run: JobRun }) {
  if (run.status === "running") return <Badge variant="secondary">Running…</Badge>;
  if (run.status === "ok") return <Badge variant="secondary">Done</Badge>;
  return (
    <div className="flex items-start gap-2">
      <Badge variant="destructive">Failed</Badge>
      <span className="line-clamp-2 text-xs text-muted-foreground" title={run.error ?? ""}>
        {run.error}
      </span>
    </div>
  );
}
