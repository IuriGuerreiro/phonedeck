// Things that need a human: captchas, offline phones, logged-out accounts.
import { useState } from "react";
import { Ban, CheckCheck, CircleAlert, RotateCcw, ShieldAlert, Smartphone, UserX } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { timeAgo } from "@/lib/mock";
import { cn } from "@/lib/utils";
import { alertsApi, useAlerts, type Alert, type AlertKind } from "@/mocks/alerts";
import { useSettings } from "@/settings/SettingsContext";

export const ALERT_KIND: Record<AlertKind, { label: string; icon: typeof CircleAlert; color: string }> = {
  captcha: { label: "Captcha", icon: ShieldAlert, color: "text-[#d9900a]" },
  offline: { label: "Offline", icon: Smartphone, color: "text-[#d03b3b]" },
  logged_out: { label: "Logged out", icon: UserX, color: "text-[#d03b3b]" },
  job_failed: { label: "Job failed", icon: CircleAlert, color: "text-[#d03b3b]" },
  limit_reached: { label: "Limit reached", icon: Ban, color: "text-[#d9900a]" },
};

type Tab = "open" | "solved";

export default function AlertsPage() {
  const alerts = useAlerts();
  const [tab, setTab] = useState<Tab>("open");
  const [kind, setKind] = useState<AlertKind | null>(null);
  const { openSettings } = useSettings();

  const open = alerts.filter((a) => !a.solvedAt);
  const solved = alerts.filter((a) => a.solvedAt);
  const list = (tab === "open" ? open : solved)
    .filter((a) => !kind || a.kind === kind)
    .sort((a, b) => b.at.localeCompare(a.at));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">Alerts</h1>
        {tab === "open" && open.length > 0 && (
          <Button variant="outline" size="sm" onClick={alertsApi.solveAll}>
            <CheckCheck /> Resolve all
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1">
        <Button size="sm" variant={tab === "open" ? "secondary" : "ghost"} onClick={() => setTab("open")}>
          Open ({open.length})
        </Button>
        <Button size="sm" variant={tab === "solved" ? "secondary" : "ghost"} onClick={() => setTab("solved")}>
          Resolved ({solved.length})
        </Button>
        <span className="mx-2 h-4 w-px bg-border" />
        <Button size="sm" variant={kind === null ? "secondary" : "ghost"} onClick={() => setKind(null)}>
          All
        </Button>
        {(Object.keys(ALERT_KIND) as AlertKind[]).map((k) => (
          <Button key={k} size="sm" variant={kind === k ? "secondary" : "ghost"} onClick={() => setKind(k)}>
            {ALERT_KIND[k].label}
          </Button>
        ))}
      </div>

      {list.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center text-sm text-muted-foreground">
            <CheckCheck className="size-8 text-[#0ca30c]" />
            {tab === "open" ? "No open alerts" : "No resolved alerts"}
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-2">
          {list.map((a) => (
            <AlertRow key={a.id} alert={a} onSettings={() => openSettings("safety")} />
          ))}
        </div>
      )}
    </div>
  );
}

function AlertRow({ alert: a, onSettings }: { alert: Alert; onSettings: () => void }) {
  const k = ALERT_KIND[a.kind];
  return (
    <Card className={cn(a.solvedAt && "opacity-70")}>
      <CardContent className="flex items-start gap-3">
        <k.icon className={cn("mt-0.5 size-5 shrink-0", k.color)} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{a.title}</span>
            <Badge variant="outline">{k.label}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">{a.detail}</p>
          <div className="mt-1 flex flex-wrap gap-3 text-xs text-muted-foreground">
            <span>{timeAgo(a.at)}</span>
            {a.solvedAt && <span>Resolved {timeAgo(a.solvedAt)}</span>}
            {a.serial && (
              <a href={`#devices/${a.serial}`} className="underline-offset-4 hover:underline">
                Device
              </a>
            )}
            {a.accountId && (
              <a href={`#accounts/${a.accountId}`} className="underline-offset-4 hover:underline">
                Account
              </a>
            )}
            {a.kind === "limit_reached" && (
              <button className="underline-offset-4 hover:underline" onClick={onSettings}>
                Safety limits
              </button>
            )}
          </div>
        </div>
        {a.solvedAt ? (
          <Button size="sm" variant="ghost" onClick={() => alertsApi.reopen(a.id)}>
            <RotateCcw /> Reopen
          </Button>
        ) : (
          <Button size="sm" variant="outline" onClick={() => alertsApi.solve(a.id)}>
            <CheckCheck /> Resolve
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
