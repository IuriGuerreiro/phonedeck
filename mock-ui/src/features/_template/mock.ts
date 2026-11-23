// Fake backend for this feature. Keep all its data in memory here.
import { delay } from "@/lib/mock";

export type Item = { id: number; name: string };

const seed = (): Item[] => [
  { id: 1, name: "First item" },
  { id: 2, name: "Second item" },
];

let items = seed();

export async function getItems(): Promise<Item[]> {
  await delay(400);
  return items.map((i) => ({ ...i }));
}

/** Put the fake data back to its starting state. */
export function reset() {
  items = seed();
}
