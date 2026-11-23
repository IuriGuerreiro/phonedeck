import { Suspense, useEffect, useState } from "react";
import { RotateCcw, Settings, Smartphone } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import { features, type Feature, type FeatureStatus } from "@/features";
import { cn } from "@/lib/utils";
import { SettingsProvider, useSettings } from "@/settings/SettingsContext";

const STATUS_BADGE: Record<FeatureStatus, "default" | "secondary" | "outline"> = {
  draft: "outline",
  ready: "default",
  shipped: "secondary",
};

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
    <SettingsProvider>
      <Shell />
    </SettingsProvider>
  );
}

function Shell() {
  const { openSettings } = useSettings();
  // The open page lives in the URL hash so a reload stays on it.
  const [id, setId] = useState(currentHash);
  // Bumped by Reset to remount the page with fresh state.
  const [resetCount, setResetCount] = useState(0);

  useEffect(() => {
    const onHash = () => setId(currentHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const active = features.find((f) => f.id === id) ?? features[0];
  const Page = active.page;

  function reset() {
    active.reset?.();
    setResetCount((n) => n + 1);
    toast.success("Mock data reset");
  }

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <aside className="flex w-60 shrink-0 flex-col gap-4 border-r bg-sidebar p-3">
        <div className="flex items-center gap-2 px-2 pt-1">
          <Smartphone className="size-5" />
          <div>
            <div className="text-sm font-semibold leading-tight">PhoneDeck</div>
            <div className="text-xs text-muted-foreground">Mock UI</div>
          </div>
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
                <Badge variant={STATUS_BADGE[f.status]}>{f.status}</Badge>
              </a>
            ))}
          </nav>
        ))}
        <button
          onClick={() => openSettings()}
          className="mt-auto flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-sidebar-foreground hover:bg-sidebar-accent"
        >
          <Settings className="size-4" /> Settings
        </button>
      </aside>
      <main className="min-w-0 flex-1 p-6">
        <div className={cn("mx-auto flex flex-col gap-4", !active.wide && "max-w-5xl")}>
          {active.reset && (
            <div className="flex justify-end">
              <Button variant="outline" size="sm" onClick={reset}>
                <RotateCcw /> Reset mock data
              </Button>
            </div>
          )}
          <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
            <Page key={`${active.id}-${resetCount}`} />
          </Suspense>
        </div>
      </main>
      <Toaster />
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
