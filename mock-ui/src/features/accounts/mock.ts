// Fake accounts backend: every account on every phone, kept in memory.
import { delay, randInt } from "@/lib/mock";
import { devicesApi } from "@/mocks/devices";

export type Platform = "tiktok";

export type Account = {
  id: number;
  /** Phone the account is logged in on. */
  serial: string;
  platform: Platform;
  username: string;
  status: "ok" | "needs_attention";
  note: string | null;
  /** ISO timestamp, or null if never warmed up. */
  lastWarmupAt: string | null;
};

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

const seed = (): Account[] => [
  { id: 1, serial: "R58N12ABCDE", platform: "tiktok", username: "fit.with.ana", status: "ok", note: null, lastWarmupAt: hoursAgo(3) },
  { id: 2, serial: "R58N12ABCDE", platform: "tiktok", username: "mealprep_mike", status: "ok", note: null, lastWarmupAt: hoursAgo(30) },
  {
    id: 3,
    serial: "R58N12ABCDE",
    platform: "tiktok",
    username: "daily.stretch",
    status: "needs_attention",
    note: "Captcha shown after switching accounts. Solve it on the phone.",
    lastWarmupAt: null,
  },
  { id: 4, serial: "1A2B3C4D5E", platform: "tiktok", username: "home.cooking.hq", status: "ok", note: null, lastWarmupAt: hoursAgo(72) },
  { id: 5, serial: "1A2B3C4D5E", platform: "tiktok", username: "lift.log", status: "ok", note: null, lastWarmupAt: null },
];

let accounts = seed();
let nextId = 6;
let stopRequested = false;

export const accountsApi = {
  async list(): Promise<Account[]> {
    await delay(300);
    return accounts.map((a) => ({ ...a }));
  },

  /** Pretend to scan the given phones and find one new account on each ready one. */
  async findLoggedIn(serials: string[]): Promise<number> {
    await delay(1500);
    const ready = (await devicesApi.list()).filter((d) => d.state === "device" && serials.includes(d.serial));
    for (const d of ready) {
      accounts.push({
        id: nextId,
        serial: d.serial,
        platform: "tiktok",
        username: `new.account${nextId++}`,
        status: "ok",
        note: null,
        lastWarmupAt: null,
      });
    }
    return ready.length;
  },

  async switchTo(username: string): Promise<void> {
    await delay(1200);
    if (Math.random() < 0.15) throw new Error(`Could not find @${username} in the account list`);
  },

  async remove(id: number): Promise<void> {
    await delay(200);
    accounts = accounts.filter((a) => a.id !== id);
  },

  /** Fake warm-up: reports progress a few times, then marks the account warmed. */
  async warmUp(id: number, onProgress: (msg: string) => void): Promise<void> {
    stopRequested = false;
    const steps = randInt(4, 7);
    for (let i = 1; i <= steps; i++) {
      if (stopRequested) throw new Error("Stopped");
      onProgress(`Video ${i}/${steps}: watching ${randInt(5, 20)}s`);
      await delay(700);
    }
    const target = accounts.find((a) => a.id === id);
    if (target) target.lastWarmupAt = new Date().toISOString();
  },

  async stop(): Promise<void> {
    stopRequested = true;
    await delay(100);
  },
};

/** Put the fake data back to its starting state. */
export function reset() {
  accounts = seed();
  nextId = 6;
  stopRequested = false;
  devicesApi.reset();
}
