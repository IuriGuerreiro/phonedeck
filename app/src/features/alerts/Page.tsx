// Screens that stopped a job and need a person. The phone is on hold until resolved.
import { useEffect, useState } from "react";
import { CheckCheck, Smartphone } from "lucide-react";
import { toast } from "sonner";

import { api, type Alert, type AlertKind, type AlertLabel } from "@/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { reloadAlerts, useAlerts } from "@/data/alerts";
import { timeAgo } from "@/lib/time";
import { cn } from "@/lib/utils";
import { ALERT_KIND, alertTitle } from "./kinds";

const LABELS: [AlertLabel, string][] = [
  ...(Object.keys(ALERT_KIND) as AlertKind[]).filter((k) => k !== "unknown").map((k): [AlertLabel, string] => [k, ALERT_KIND[k].label]),
  ["unknown", "Something else"],
  ["false_alarm", "False alarm"],
];

export default function AlertsPage() {
  const { alerts, error, loading } = useAlerts();
  const [showResolved, setShowResolved] = useState(false);
  const open = alerts.filter((a) => !a.resolvedAt);
  const list = showResolved ? alerts.filter((a) => a.resolvedAt) : open;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold">Alerts</h1>
        <p className="text-sm text-muted-foreground">A phone with an open alert runs no jobs until you resolve it.</p>
      </div>
      <div className="flex gap-1">
        <Button size="sm" variant={showResolved ? "ghost" : "secondary"} onClick={() => setShowResolved(false)}>
          Open ({open.length})
        </Button>
        <Button size="sm" variant={showResolved ? "secondary" : "ghost"} onClick={() => setShowResolved(true)}>
          Resolved
        </Button>
      </div>
      {error && <p className="text-sm text-[#d03b3b]">Couldn't load alerts: {error}</p>}
      {list.map((a) => (
        <AlertCard key={a.id} alert={a} />
      ))}
      {list.length === 0 && !error && (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {loading ? "Loading…" : showResolved ? "No resolved alerts" : "No open alerts"}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function AlertCard({ alert: a }: { alert: Alert }) {
  const k = ALERT_KIND[a.kind];
  const [busy, setBusy] = useState(false);
  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
      await reloadAlerts();
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card className={cn(a.resolvedAt && "opacity-80")}>
      <CardContent className="flex flex-col gap-4 sm:flex-row">
        <Shot alert={a} />
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <k.icon className={cn("size-5 shrink-0", k.color)} />
            <span className="font-medium">{alertTitle(a)}</span>
            {!a.resolvedAt && <Badge variant="outline">Phone on hold</Badge>}
          </div>
          <p className="text-sm break-words text-muted-foreground">{a.message}</p>
          <p className="text-xs text-muted-foreground">
            {timeAgo(a.createdAt)} · {a.serial} · {a.action}
            {a.resolvedAt && ` · Resolved ${timeAgo(a.resolvedAt)}`}
          </p>
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">What was it?</span>
            <div className="flex flex-wrap gap-1">
              {LABELS.map(([id, text]) => (
                <Button key={id} size="sm" disabled={busy} aria-pressed={a.label === id} variant={a.label === id ? "secondary" : "ghost"} onClick={() => act(() => api.labelAlert(a.id, id))}>
                  {text}
                </Button>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" nativeButton={false} render={<a href={`#devices/${encodeURIComponent(a.serial)}`} />}>
              <Smartphone /> Open phone
            </Button>
            {!a.resolvedAt && (
              <Button size="sm" disabled={busy} onClick={() => act(() => api.resolveAlert(a.id))}>
                <CheckCheck /> Solved, continue
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function Shot({ alert: { id, hasScreenshot } }: { alert: Alert }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!hasScreenshot) return;
    let url: string | null = null;
    let alive = true;
    api.alertScreenshot(id).then(
      (bytes) => {
        if (!alive) return;
        url = URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
        setSrc(url);
      },
      () => {},
    );
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [id, hasScreenshot]);
  return src ? (
    <img src={src} alt="Phone screen when the job stopped" className="max-h-96 w-44 shrink-0 self-start rounded-md border object-contain" />
  ) : (
    <div className="flex h-32 w-44 shrink-0 items-center justify-center rounded-md border text-xs text-muted-foreground">
      {hasScreenshot ? "Loading…" : "No screenshot"}
    </div>
  );
}
