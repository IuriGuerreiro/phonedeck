// Account groups (tags) with their own warm-up keywords. Shared by the
// accounts pages and the "Account groups" settings section.
import { useSyncExternalStore } from "react";

export type Group = {
  id: string;
  name: string;
  /** Warm-up keywords for accounts in this group. Empty = use the global ones. */
  keywords: string[];
};

const seed = (): Group[] => [
  { id: "gym", name: "Gym", keywords: ["gym workout", "home workout", "lifting"] },
  { id: "cooking", name: "Cooking", keywords: ["meal prep", "healthy recipes"] },
  { id: "wellness", name: "Wellness", keywords: ["stretching", "yoga", "mobility"] },
];

let groups = seed();
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function useGroups() {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => groups,
  );
}

export const groupsApi = {
  get: (id: string) => groups.find((g) => g.id === id),

  add(name: string): Group {
    const g = { id: `group-${nextId++}`, name: name.trim() || "New group", keywords: [] };
    groups = [...groups, g];
    emit();
    return g;
  },

  update(id: string, patch: Partial<Omit<Group, "id">>) {
    groups = groups.map((g) => (g.id === id ? { ...g, ...patch } : g));
    emit();
  },

  remove(id: string) {
    groups = groups.filter((g) => g.id !== id);
    emit();
  },

  reset() {
    groups = seed();
    emit();
  },
};
