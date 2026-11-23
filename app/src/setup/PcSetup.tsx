import { useEffect, useState } from "react";
import { CheckCircle2, CircleDashed, Copy, Download, Loader2, RefreshCw, ShieldCheck, XCircle } from "lucide-react";
import { toast } from "sonner";

import { api } from "@/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { setupApi, type Progress, type SetupStatus, type ToolId, type ToolStatus } from "./api";

type Props = { status: SetupStatus | null; refresh: () => Promise<void> };

export function PcSetup({ status, refresh }: Props) {
  const [installing, setInstalling] = useState<ToolId | null>(null);
  const [progress, setProgress] = useState<Record<string, Progress>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    const unlisten = setupApi.onProgress((p) => setProgress((cur) => ({ ...cur, [p.tool]: p })));
    return () => void unlisten.then((f) => f());
  }, []);

  // Optional tools get their own Install button, not "Install missing".
  const missing = status?.tools.filter((t) => !t.ok && t.canInstall && !t.optional) ?? [];

  async function install(ids: ToolId[]) {
    let changed = false;
    for (const id of ids) {
      setInstalling(id);
      setErrors(({ [id]: _, ...rest }) => rest);
      try {
        await setupApi.install(id);
        changed = true;
      } catch (e) {
        setErrors((cur) => ({ ...cur, [id]: String(e) }));
        break;
      }
    }
    setInstalling(null);
    await refresh();
    // The engine reads tool paths at start, so restart it to pick up new tools.
    if (changed) api.restartWorker().catch((e) => toast.error(String(e)));
  }

  if (!status) return <Loader2 className="m-6 animate-spin text-muted-foreground" />;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle>Tools on this PC</CardTitle>
            <CardDescription className="mt-1">
              Missing tools install into <code className="text-xs">{status.toolsDir}</code>. No sudo needed.
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" size="icon-sm" onClick={refresh} title="Check again" disabled={!!installing}>
              <RefreshCw />
            </Button>
            {missing.length > 0 && (
              <Button onClick={() => install(missing.map((t) => t.id))} disabled={!!installing}>
                <Download /> Install missing ({missing.length})
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="flex flex-col divide-y">
          {status.tools.map((t) => (
            <ToolRow
              key={t.id}
              tool={t}
              busy={installing === t.id}
              disabled={!!installing}
              progress={installing === t.id ? progress[t.id] : undefined}
              error={errors[t.id]}
              onInstall={() => install([t.id])}
            />
          ))}
        </CardContent>
      </Card>

      {status.udev.applies && <UdevCard udev={status.udev} refresh={refresh} />}
    </div>
  );
}

function ToolRow(props: {
  tool: ToolStatus;
  busy: boolean;
  disabled: boolean;
  progress?: Progress;
  error?: string;
  onInstall: () => void;
}) {
  const { tool: t, busy, progress: p, error } = props;
  const pct = p?.total ? Math.round((p.done / p.total) * 100) : null;
  return (
    <div className="flex flex-col gap-2 py-3">
      <div className="flex items-center gap-3">
        {t.ok ? (
          <CheckCircle2 className="size-5 shrink-0 text-green-600" />
        ) : t.optional ? (
          <CircleDashed className="size-5 shrink-0 text-muted-foreground" />
        ) : (
          <XCircle className="size-5 shrink-0 text-red-500" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-sm font-medium">
            {t.name}
            {t.managed && <Badge variant="secondary">installed by PhoneDeck</Badge>}
            {t.optional && !t.ok && <Badge variant="outline">optional</Badge>}
          </div>
          <div className="truncate text-xs text-muted-foreground" title={t.path ?? ""}>
            {t.ok ? [t.version, t.path].filter(Boolean).join(" · ") : t.problem}
          </div>
        </div>
        {!t.ok && t.canInstall && (
          <Button size="sm" variant="outline" onClick={props.onInstall} disabled={props.disabled}>
            {busy ? <Loader2 className="animate-spin" /> : <Download />} {busy ? "Installing…" : "Install"}
          </Button>
        )}
        {!t.ok && t.id === "node" && (
          <span className="text-xs text-muted-foreground">Install from nodejs.org, then check again</span>
        )}
      </div>
      {busy && p && (
        <div className="ml-8 flex flex-col gap-1">
          {pct !== null && (
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
            </div>
          )}
          <div className="truncate text-xs text-muted-foreground">
            {p.step}
            {p.total ? ` ${mb(p.done)} / ${mb(p.total)} MB` : ""}
          </div>
        </div>
      )}
      {error && (
        <pre className="ml-8 max-h-40 overflow-auto rounded-md bg-destructive/10 p-2 text-xs whitespace-pre-wrap text-destructive">
          {error}
        </pre>
      )}
    </div>
  );
}

function UdevCard({ udev, refresh }: { udev: SetupStatus["udev"]; refresh: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  async function installRule() {
    setBusy(true);
    try {
      await setupApi.installUdevRule();
      toast.success("USB access rule installed. Unplug and replug the phone.");
      await refresh();
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          USB access (Linux)
          {udev.installed ? <Badge>Rule found</Badge> : <Badge variant="outline">No rule found</Badge>}
        </CardTitle>
        <CardDescription className="mt-1">
          Without an Android udev rule, adb shows phones as “no permissions”.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <InstallUdevButton busy={busy} onClick={installRule} again={udev.installed} />
        <div className="text-xs text-muted-foreground">Or run this in a terminal:</div>
        <CopyCommand text={udev.manualCommand} />
      </CardContent>
    </Card>
  );
}

export function InstallUdevButton(p: { busy: boolean; onClick: () => void; again?: boolean }) {
  return (
    <Button variant={p.again ? "outline" : "default"} onClick={p.onClick} disabled={p.busy} className="self-start">
      {p.busy ? <Loader2 className="animate-spin" /> : <ShieldCheck />}
      {p.again ? "Install the rule again" : "Allow USB access (asks for your password)"}
    </Button>
  );
}

export function CopyCommand({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2">
      <pre className="flex-1 overflow-x-auto rounded-md bg-muted p-2 text-xs whitespace-pre-wrap break-all">{text}</pre>
      <Button
        variant="ghost"
        size="icon-sm"
        title="Copy"
        onClick={() => navigator.clipboard.writeText(text).then(() => toast.success("Copied"))}
      >
        <Copy />
      </Button>
    </div>
  );
}

const mb = (b: number) => (b / 1024 / 1024).toFixed(0);
