/** A scheduled warm-up that has not started yet. */
export type PlannedRun = { key: string; at: Date; label: string; accounts: number };

/** "in 2h 15m" style countdown. */
export function untilText(at: Date, now = new Date()) {
  const mins = Math.max(0, Math.round((at.getTime() - now.getTime()) / 60_000));
  if (mins < 60) return `in ${mins}m`;
  const h = Math.floor(mins / 60);
  if (h >= 48) return `in ${Math.round(h / 24)}d`;
  return `in ${h}h${mins % 60 ? ` ${mins % 60}m` : ""}`;
}
