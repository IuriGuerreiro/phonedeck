// Warm-up settings shared by the settings modal and the accounts page.
// Saved in localStorage so they survive a reload.
import { useSyncExternalStore } from "react";

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

const STORAGE_KEY = "phonedeck.warmup";
const listeners = new Set<() => void>();

let form: WarmupForm = load();

function load(): WarmupForm {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? { ...WARMUP_DEFAULTS, ...JSON.parse(saved) } : WARMUP_DEFAULTS;
  } catch {
    return WARMUP_DEFAULTS;
  }
}

export function setWarmup(next: WarmupForm) {
  form = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(form));
  } catch {
    // Not saved; still works for this session.
  }
  listeners.forEach((l) => l());
}

export function useWarmupSettings() {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
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
