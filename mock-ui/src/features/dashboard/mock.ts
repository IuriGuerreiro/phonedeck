// Fake schedule for the dashboard's "next run". The real scheduler doesn't exist yet.
export type ScheduledRun = { at: Date; label: string; accounts: number };

const SLOTS = [
  { time: "09:00", label: "Morning · All accounts", accounts: 5 },
  { time: "14:30", label: "Afternoon · Gym", accounts: 2 },
  { time: "20:00", label: "Evening · All accounts", accounts: 5 },
];

/** The next `count` runs from now, across today and the following days. */
export function upcomingRuns(count = 3, now = new Date()): ScheduledRun[] {
  const runs: ScheduledRun[] = [];
  for (let day = 0; runs.length < count && day < 3; day++) {
    for (const s of SLOTS) {
      const [h, m] = s.time.split(":").map(Number);
      const at = new Date(now);
      at.setDate(at.getDate() + day);
      at.setHours(h, m, 0, 0);
      if (at > now) runs.push({ at, label: s.label, accounts: s.accounts });
      if (runs.length === count) break;
    }
  }
  return runs;
}

/** "in 2h 15m" style countdown. */
export function untilText(at: Date, now = new Date()) {
  const mins = Math.max(0, Math.round((at.getTime() - now.getTime()) / 60_000));
  if (mins < 60) return `in ${mins}m`;
  const h = Math.floor(mins / 60);
  return `in ${h}h${mins % 60 ? ` ${mins % 60}m` : ""}`;
}
