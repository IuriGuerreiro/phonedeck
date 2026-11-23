import { useEffect, useMemo, useState } from "react";
import { RotateCcw, Search, X } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { settingsSections, type SettingsSectionDef } from "./sections";

type Props = {
  section: string;
  onSection: (id: string) => void;
  onClose: () => void;
};

/** Full settings dialog: section nav on the left, the open section on the right. */
export function SettingsModal({ section, onSection, onClose }: Props) {
  const [query, setQuery] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const active = settingsSections.find((s) => s.id === section) ?? settingsSections[0];
  const Section = active.component;

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const map = new Map<string, SettingsSectionDef[]>();
    for (const s of settingsSections) {
      if (q && !s.label.toLowerCase().includes(q)) continue;
      const g = s.group ?? "";
      map.set(g, [...(map.get(g) ?? []), s]);
    }
    return [...map];
  }, [query]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        className="flex h-[min(85vh,800px)] w-full max-w-5xl overflow-hidden rounded-xl border bg-background shadow-2xl"
      >
        <aside className="hidden w-56 shrink-0 flex-col gap-3 border-r bg-sidebar p-2 sm:flex">
          <label className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground">
            <Search className="size-4" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search"
              className="min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-muted-foreground"
            />
          </label>
          {groups.map(([group, items]) => (
            <nav key={group} className="flex flex-col gap-0.5">
              {group && <div className="px-2 pb-1 text-xs font-medium text-muted-foreground">{group}</div>}
              {items.map((s) => (
                <button
                  key={s.id}
                  onClick={() => onSection(s.id)}
                  className={cn(
                    "flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-sidebar-accent",
                    s.id === active.id && "bg-sidebar-accent font-medium",
                  )}
                >
                  <s.icon className="size-4" />
                  <span className="flex-1">{s.label}</span>
                  {s.preview && <Badge variant="outline">Preview</Badge>}
                </button>
              ))}
            </nav>
          ))}
          {groups.length === 0 && <p className="px-2 text-xs text-muted-foreground">No results</p>}
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-center gap-2 border-b px-5 py-3">
            <div className="flex-1 text-sm">
              <span className="text-muted-foreground">Settings</span>
              <span className="mx-2 text-muted-foreground">/</span>
              <span className="font-medium">{active.label}</span>
              {active.preview && (
                <span className="ml-2 text-xs text-muted-foreground">Preview: not used by jobs yet</span>
              )}
            </div>
            {active.restoreDefaults && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  active.restoreDefaults!();
                  toast.success(`${active.label} reset to defaults`);
                }}
              >
                <RotateCcw /> Reset defaults
              </Button>
            )}
            <Button variant="ghost" size="icon-sm" onClick={onClose} title="Close">
              <X />
            </Button>
          </header>
          <div className="flex-1 overflow-y-auto">
            <div className="mx-auto max-w-3xl px-5 py-6">
              <Section />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
