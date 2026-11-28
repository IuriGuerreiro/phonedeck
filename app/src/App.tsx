import { Suspense, useEffect, useState } from "react";
import { FlaskConical, Moon, RotateCcw, Settings, Smartphone, Sun } from "lucide-react";
import { toast } from "sonner";

import { api, type WorkerStatus } from "@/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import { features, type Feature } from "@/features";
import { setTheme, useResolvedTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { SettingsProvider, useSettings } from "@/settings/SettingsContext";
import { setupApi } from "@/setup/api";
import { WebAuthGate } from "@/components/WebAuthGate";

/** Opened when the hash names no page. A real page, not a preview. */
const HOME = "devices";

/** Feature id from the hash. "#devices/R58N" opens "devices"; the page reads the rest. */
const currentHash = () => window.location.hash.slice(1).split("/")[0];

/** Features grouped by `group`, keeping registry order. */
function groupFeatures(list: Feature[]) {
  const groups = new Map<string, Feature[]>();
  for (const f of list) groups.set(f.group, [...(groups.get(f.group) ?? []), f]);
  return [...groups];
}

export default function App() {
  return (
    <WebAuthGate>
      <SettingsProvider>
        <Shell />
      </SettingsProvider>
    </WebAuthGate>
  );
}

function Shell() {
  const { openSettings } = useSettings();
  const theme = useResolvedTheme();
  // The open page lives in the URL hash so a reload stays on it.
  const [id, setId] = useState(currentHash);
  // Bumped by Reset to remount the page with fresh state.
  const [resetCount, setResetCount] = useState(0);

  useEffect(() => {
    const onHash = () => setId(currentHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // First run: send the user to Setup while a required tool is missing.
  useEffect(() => {
    setupApi
      .status()
      .then((s) => {
        if (s.tools.some((t) => !t.ok && !t.optional)) window.location.hash = "setup";
      })
      .catch((e) => toast.error(String(e)));
  }, []);

  const active = features.find((f) => f.id === id) ?? features.find((f) => f.id === HOME)!;
  const Page = active.page;

  function reset() {
    active.reset?.();
    setResetCount((n) => n + 1);
    toast.success("Sample data reset");
  }

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <aside className="flex w-60 shrink-0 flex-col gap-4 border-r bg-sidebar p-3">
        <div className="flex items-center gap-2 px-2 pt-1">
          <Smartphone className="size-5" />
          <div className="text-sm font-semibold leading-tight">Tapfleet</div>
        </div>
        {groupFeatures(features).map(([group, items]) => (
          <nav key={group} className="flex flex-col gap-0.5">
            <div className="px-2 pb-1 text-xs font-medium text-muted-foreground">{group}</div>
            {items.map((f) => (
              <a
                key={f.id}
                href={`#${f.id}`}
                className={cn(
                  "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-sidebar-foreground hover:bg-sidebar-accent",
                  f.id === active.id && "bg-sidebar-accent font-medium text-sidebar-accent-foreground",
                )}
              >
                <f.icon className="size-4 shrink-0" />
                <span className="flex-1 truncate">{f.label}</span>
                {f.useCount && <CountBadge useCount={f.useCount} />}
                {f.preview && (
                  <Badge variant="outline" title="Sample data, not connected yet">
                    Preview
                  </Badge>
                )}
              </a>
            ))}
          </nav>
        ))}
        <EngineStatus />
        <div className="flex items-center gap-1">
          <button
            onClick={() => openSettings()}
            className="flex flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-sm text-sidebar-foreground hover:bg-sidebar-accent"
          >
            <Settings className="size-4" /> Settings
          </button>
          <Button
            variant="ghost"
            size="icon-sm"
            title={theme === "dark" ? "Light mode" : "Dark mode"}
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          >
            {theme === "dark" ? <Sun /> : <Moon />}
          </Button>
        </div>
      </aside>
      <main className="min-w-0 flex-1 p-6">
        <div className={cn("mx-auto flex flex-col gap-4", !active.wide && "max-w-5xl")}>
          {active.preview && (
            <div className="flex items-center gap-3 rounded-lg border border-dashed bg-muted/40 px-3 py-2 text-sm">
              <FlaskConical className="size-4 shrink-0 text-muted-foreground" />
              <span className="flex-1 text-muted-foreground">
                Preview: this page shows sample data. It is not connected to your phones yet.
              </span>
              {active.reset && (
                <Button variant="ghost" size="sm" onClick={reset} title="Reset sample data">
                  <RotateCcw /> Reset
                </Button>
              )}
            </div>
          )}
          <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
            <Page key={`${active.id}-${resetCount}`} />
          </Suspense>
        </div>
      </main>
      <Toaster theme={theme} />
    </div>
  );
}

/** Calls the feature's count hook in its own component so hooks stay in a stable order. */
function CountBadge({ useCount }: { useCount: () => number }) {
  const n = useCount();
  return n > 0 ? (
    <span className="rounded-full bg-[#d03b3b] px-1.5 text-[10px] font-semibold text-white tabular-nums">{n}</span>
  ) : null;
}

/** Appium engine state, with a restart button. Sits at the bottom of the sidebar. */
function EngineStatus() {
  const [status, setStatus] = useState<WorkerStatus>({ state: "starting" });

  useEffect(() => {
    api.workerStatus().then(setStatus);
    const unlisten = api.onWorkerStatus(setStatus);
    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  return (
    <div className="mt-auto flex items-center gap-2 rounded-md px-2 py-1 text-xs">
      <span
        className={cn(
          "size-2 shrink-0 rounded-full",
          status.state === "ready" && "bg-green-500",
          status.state === "starting" && "animate-pulse bg-amber-500",
          status.state === "failed" && "bg-red-500",
        )}
      />
      <span
        className="flex-1 truncate text-muted-foreground"
        title={status.state === "failed" ? status.error : undefined}
      >
        {status.state === "ready" && "Engine ready"}
        {status.state === "starting" && "Starting engine…"}
        {status.state === "failed" && "Engine failed"}
      </span>
      {status.state !== "starting" && (
        <Button variant="ghost" size="icon-xs" onClick={() => api.restartWorker()} title="Restart engine">
          <RotateCcw />
        </Button>
      )}
    </div>
  );
}
