// Warm-up settings shared by the settings modal, the accounts page and the scheduler.
// Saved by the app (SQLite) so scheduled warm-ups use them too.
import { useSyncExternalStore } from "react";
import { toast } from "sonner";

import { api } from "@/api";

/** Form values, kept as typed strings so fields can be cleared while editing. */
export type WarmupForm = {
  minutes: string;
  watchMinSec: string;
  watchMaxSec: string;
  likePct: string;
  followPct: string;
  /** Comma-separated niche keywords. */
  keywords: string;
};

/** What a warm-up job takes. */
export type WarmupOptions = {
  minutes: number;
  watchMinSec: number;
  watchMaxSec: number;
  likeChance: number;
  followChance: number;
  keywords: string[];
};

export const WARMUP_DEFAULTS: WarmupForm = {
  minutes: "10",
  watchMinSec: "5",
  watchMaxSec: "20",
  likePct: "10",
  followPct: "2",
  keywords: "",
};

/** Where settings lived before they moved to the app; copied over once. */
const OLD_STORAGE_KEY = "phonedeck.warmup";
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
let form: WarmupForm = WARMUP_DEFAULTS;
let saveTimer: ReturnType<typeof setTimeout> | undefined;

function load() {
  api.getWarmup().then(
    (saved) => {
      const f = (saved as { form?: Partial<WarmupForm> } | null)?.form;
      if (f) {
        form = { ...WARMUP_DEFAULTS, ...f };
        emit();
        return;
      }
      // Nothing saved yet: bring over this browser's old settings, if any.
      try {
        const old = localStorage.getItem(OLD_STORAGE_KEY);
        if (old) setWarmup({ ...WARMUP_DEFAULTS, ...JSON.parse(old) });
      } catch {
        // Ignore unreadable old settings.
      }
    },
    () => {},
  );
}
load();

export function setWarmup(next: WarmupForm) {
  form = next;
  emit();
  // Number fields fire per key; save once typing settles.
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    api.setWarmup({ form, options: toOptions(form) }).catch((e) => toast.error(`Couldn't save warm-up settings: ${e}`));
  }, 400);
}

export function useWarmupSettings() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      // Pick up edits made elsewhere (another browser, the desktop window).
      if (listeners.size === 1) load();
      return () => listeners.delete(l);
    },
    () => form,
  );
}

export function toOptions(f: WarmupForm): WarmupOptions {
  const watchMinSec = num(f.watchMinSec, 1, 600, 5);
  return {
    minutes: num(f.minutes, 1, 120, 10),
    watchMinSec,
    watchMaxSec: Math.max(watchMinSec, num(f.watchMaxSec, 1, 600, 20)),
    likeChance: num(f.likePct, 0, 100, 10) / 100,
    followChance: num(f.followPct, 0, 100, 2) / 100,
    keywords: f.keywords
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean),
  };
}

/** Parse a typed number, clamped to [min, max]; `fallback` when it isn't a number. */
function num(v: string, min: number, max: number, fallback: number) {
  const n = Number(v);
  return v.trim() !== "" && Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}
