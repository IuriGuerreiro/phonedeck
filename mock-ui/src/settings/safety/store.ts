// Safety limits shared by the settings modal and the dashboard. Saved in localStorage.
import { useSyncExternalStore } from "react";

export type SafetyLimits = {
  maxLikesPerDay: number;
  maxFollowsPerDay: number;
  maxMinutesPerDay: number;
  quietHoursOn: boolean;
  /** "HH:MM", local time. */
  quietStart: string;
  quietEnd: string;
  breaksOn: boolean;
  /** Take a break after a random time in this range (minutes of activity). */
  breakEveryMin: number;
  breakEveryMax: number;
  /** Break length range (minutes). */
  breakLengthMin: number;
  breakLengthMax: number;
};

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

const KEY = "mock-ui.safety";
const listeners = new Set<() => void>();
let limits: SafetyLimits = (() => {
  try {
    const s = localStorage.getItem(KEY);
    return s ? { ...SAFETY_DEFAULTS, ...JSON.parse(s) } : SAFETY_DEFAULTS;
  } catch {
    return SAFETY_DEFAULTS;
  }
})();

export function setSafety(next: SafetyLimits) {
  limits = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(limits));
  } catch {
    // Not saved; still works for this session.
  }
  listeners.forEach((l) => l());
}

export function useSafety() {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
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
