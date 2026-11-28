// Light / dark / system theme. Adds or removes the "dark" class on <html>,
// which switches the color tokens in index.css. index.html applies the saved
// choice before React loads so the page doesn't flash the wrong theme.
import { useSyncExternalStore } from "react";
import { getMovedItem } from "./storage";

export type ThemeChoice = "system" | "light" | "dark";

const KEY = "tapfleet.theme";
const OLD_KEY = "phonedeck.theme";
const media = window.matchMedia("(prefers-color-scheme: dark)");
const listeners = new Set<() => void>();

let choice: ThemeChoice = (() => {
  try {
    const v = getMovedItem(KEY, OLD_KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
})();

const resolve = (): "light" | "dark" => (choice === "system" ? (media.matches ? "dark" : "light") : choice);

function apply() {
  const dark = resolve() === "dark";
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
  listeners.forEach((l) => l());
}

media.addEventListener("change", () => choice === "system" && apply());
apply();

export function setTheme(next: ThemeChoice) {
  choice = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    // Not saved; still applies for this session.
  }
  apply();
}

const subscribe = (l: () => void) => (listeners.add(l), () => listeners.delete(l));

/** The user's choice: system, light or dark. */
export const useThemeChoice = () => useSyncExternalStore(subscribe, () => choice);
/** What is actually showing: light or dark. */
export const useResolvedTheme = () => useSyncExternalStore(subscribe, resolve);
