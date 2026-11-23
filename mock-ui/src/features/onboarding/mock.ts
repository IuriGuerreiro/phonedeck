// Fake setup backend for the onboarding wizard. Mirrors app/src/setup/api.ts.
import { delay, randInt } from "@/lib/mock";

export type Tool = {
  id: string;
  name: string;
  why: string;
  ok: boolean;
  version: string | null;
  /** Nice to have; automation works without it. */
  optional: boolean;
};

const seed = (): Tool[] => [
  { id: "node", name: "Node.js", why: "Runs the automation engine.", ok: true, version: "22.11.0", optional: false },
  { id: "java", name: "Java", why: "Needed by Appium to talk to Android.", ok: false, version: null, optional: false },
  { id: "adb", name: "Android platform tools (adb)", why: "Connects to phones over USB.", ok: false, version: null, optional: false },
  { id: "appium", name: "Appium", why: "Taps and swipes on the phone.", ok: false, version: null, optional: false },
  { id: "scrcpy", name: "scrcpy", why: "Shows the phone screen on this PC.", ok: false, version: null, optional: true },
];

let tools = seed();
let phoneFound = false;
let helpersInstalled = false;

export const PHONE_STEPS = [
  {
    title: "Turn on Developer options",
    detail: "Settings → About phone → tap Build number 7 times. On Xiaomi tap MIUI / OS version instead.",
  },
  { title: "Turn on USB debugging", detail: "Settings → Developer options → USB debugging." },
  { title: "Plug the phone into this PC" },
  {
    title: "Allow this computer",
    detail: "Unlock the phone. On “Allow USB debugging?” tick “Always allow” and tap Allow.",
  },
];

export const onboardingApi = {
  async tools(): Promise<Tool[]> {
    await delay(300);
    return tools.map((t) => ({ ...t }));
  },

  /** Fake download + install with progress updates (0..100). */
  async install(id: string, onProgress: (pct: number) => void): Promise<void> {
    for (let pct = 0; pct <= 100; pct += randInt(15, 30)) {
      onProgress(pct);
      await delay(250);
    }
    onProgress(100);
    tools = tools.map((t) => (t.id === id ? { ...t, ok: true, version: `${randInt(1, 30)}.${randInt(0, 9)}.0` } : t));
  },

  /** First check finds nothing, the second one finds a phone, like plugging it in. */
  async findPhone(): Promise<{ model: string; android: string } | null> {
    await delay(1200);
    if (!phoneFound) {
      phoneFound = true;
      return null;
    }
    return { model: "Galaxy A54", android: "14" };
  },

  async installHelpers(): Promise<void> {
    await delay(2000);
    helpersInstalled = true;
  },

  get helpersInstalled() {
    return helpersInstalled;
  },
};

export function reset() {
  tools = seed();
  phoneFound = false;
  helpersInstalled = false;
}
