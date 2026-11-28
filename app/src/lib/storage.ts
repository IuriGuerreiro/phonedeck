// localStorage keys moved from "phonedeck.*" to "tapfleet.*" when the app was renamed.

/** Reads `key`. If it's missing, moves the value from `oldKey` (once) and returns it. Can throw like localStorage. */
export function getMovedItem(key: string, oldKey: string): string | null {
  const value = localStorage.getItem(key);
  if (value !== null) return value;
  const old = localStorage.getItem(oldKey);
  if (old !== null) {
    localStorage.setItem(key, old);
    localStorage.removeItem(oldKey);
  }
  return old;
}
