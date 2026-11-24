// Safety limits, saved by the app (SQLite) and enforced on every warm-up.
// This store mirrors them for the UI: edits show at once and are saved shortly after.
import { useSyncExternalStore } from "react";
import { toast } from "sonner";

import { api, type SafetyLimits } from "@/api";

export type { SafetyLimits };

export const SAFETY_DEFAULTS: SafetyLimits = {
  maxLikesPerDay: 60,
  maxFollowsPerDay: 10,
  maxMinutesPerDay: 45,
  quietHoursOn: true,
  quietStart: "23:00",
  quietEnd: "07:30",
  breaksOn: true,
  breakEveryMin: 8,
  breakEveryMax: 15,
  breakLengthMin: 2,
  breakLengthMax: 6,
};

const listeners = new Set<() => void>();
let limits: SafetyLimits = SAFETY_DEFAULTS;
let saveTimer: ReturnType<typeof setTimeout> | undefined;

const emit = () => listeners.forEach((l) => l());

function load() {
  api.getSafety().then(
    (s) => {
      limits = s;
      emit();
    },
    () => {},
  );
}
load();

export function setSafety(next: SafetyLimits) {
  limits = next;
  emit();
  // Typing in a number field fires per key; save once it settles.
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    api.setSafety(limits).then(
      (saved) => {
        limits = saved;
        emit();
      },
      (e) => toast.error(`Couldn't save safety limits: ${e}`),
    );
  }, 400);
}

export function useSafety() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      // Pick up changes made elsewhere (another browser, the desktop window).
      if (listeners.size === 1) load();
      return () => listeners.delete(l);
    },
    () => limits,
  );
}

/** True if `now` falls inside quiet hours (handles ranges past midnight). */
export function inQuietHours(l: SafetyLimits, now = new Date()) {
  if (!l.quietHoursOn) return false;
  const mins = (t: string) => {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + m;
  };
  const n = now.getHours() * 60 + now.getMinutes();
  const s = mins(l.quietStart);
  const e = mins(l.quietEnd);
  return s <= e ? n >= s && n < e : n >= s || n < e;
}
