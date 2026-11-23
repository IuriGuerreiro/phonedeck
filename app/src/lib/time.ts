// Time helpers that accept both ISO strings and SQLite's UTC "YYYY-MM-DD HH:MM:SS".

/** Parse a timestamp. SQLite's datetime('now') has no zone marker but is UTC. */
export function parseTime(s: string): Date {
  return new Date(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(s) ? s.replace(" ", "T") + "Z" : s);
}

/** "3m ago", "5h ago", "2d ago". */
export function timeAgo(s: string) {
  const mins = Math.round((Date.now() - parseTime(s).getTime()) / 60_000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/** Local time of day, e.g. "14:05:12". */
export const localTime = (s: string) => parseTime(s).toLocaleTimeString();
