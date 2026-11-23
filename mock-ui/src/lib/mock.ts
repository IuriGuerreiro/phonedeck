/** Wait `ms` milliseconds. Use it to fake a slow backend call. */
export const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Random whole number in [min, max]. */
export const randInt = (min: number, max: number) =>
  Math.floor(min + Math.random() * (max - min + 1));

/** "3 min ago", "5 h ago", "2 days ago" for an ISO timestamp. */
export function timeAgo(iso: string) {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}
