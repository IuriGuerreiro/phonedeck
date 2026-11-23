// Fake accounts backend: every account on every phone, kept in memory.
import { delay, randInt } from "@/lib/mock";
import { devicesApi } from "@/mocks/devices";
import { groupsApi } from "@/mocks/groups";

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
  /** Group ids (see mocks/groups.ts). */
  groups: string[];
  notes: string;
  followers: number;
  /** Problems in the last 7 days. */
  captchas7d: number;
  errors7d: number;
};

/** One day of history for the charts. */
export type DayStat = { date: string; warmupMinutes: number; followers: number };

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

const seed = (): Account[] => [
  { id: 1, serial: "R58N12ABCDE", platform: "tiktok", username: "fit.with.ana", status: "ok", note: null, lastWarmupAt: hoursAgo(3), groups: ["gym"], notes: "Main gym account. Posts start next week.", followers: 1240, captchas7d: 0, errors7d: 0 },
  { id: 2, serial: "R58N12ABCDE", platform: "tiktok", username: "mealprep_mike", status: "ok", note: null, lastWarmupAt: hoursAgo(30), groups: ["cooking", "gym"], notes: "", followers: 312, captchas7d: 0, errors7d: 1 },
  {
    id: 3,
    serial: "R58N12ABCDE",
    platform: "tiktok",
    username: "daily.stretch",
    status: "needs_attention",
    note: "Captcha shown after switching accounts. Solve it on the phone.",
    lastWarmupAt: null,
    groups: ["wellness"],
    notes: "Got a captcha twice. Go slower.",
    followers: 58,
    captchas7d: 2,
    errors7d: 2,
  },
  { id: 4, serial: "1A2B3C4D5E", platform: "tiktok", username: "home.cooking.hq", status: "ok", note: null, lastWarmupAt: hoursAgo(72), groups: ["cooking"], notes: "", followers: 860, captchas7d: 0, errors7d: 0 },
  { id: 5, serial: "1A2B3C4D5E", platform: "tiktok", username: "lift.log", status: "ok", note: null, lastWarmupAt: null, groups: [], notes: "", followers: 12, captchas7d: 0, errors7d: 0 },
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
        groups: [],
        notes: "",
        followers: 0,
        captchas7d: 0,
        errors7d: 0,
      });
    }
    return ready.length;
  },

  async switchTo(username: string): Promise<void> {
    await delay(1200);
    if (Math.random() < 0.15) throw new Error(`Could not find @${username} in the account list`);
  },

  async get(id: number): Promise<Account | null> {
    await delay(200);
    const a = accounts.find((x) => x.id === id);
    return a ? { ...a } : null;
  },

  async update(id: number, patch: Partial<Pick<Account, "notes" | "groups">>): Promise<void> {
    await delay(150);
    accounts = accounts.map((a) => (a.id === id ? { ...a, ...patch } : a));
  },

  /** Last `days` days of warm-up minutes and follower counts. Same numbers every time per account. */
  async history(id: number, days = 30): Promise<DayStat[]> {
    await delay(300);
    const a = accounts.find((x) => x.id === id);
    if (!a) return [];
    const rand = seeded(id);
    const out: DayStat[] = [];
    let followers = Math.max(0, Math.round(a.followers * (0.55 + rand() * 0.2)));
    const growth = (a.followers - followers) / days;
    for (let i = days - 1; i >= 0; i--) {
      const date = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
      const skipped = a.lastWarmupAt === null || rand() < 0.2;
      followers = i === 0 ? a.followers : Math.max(0, Math.round(followers + growth * (0.4 + rand() * 1.2)));
      out.push({ date, warmupMinutes: skipped ? 0 : Math.round(5 + rand() * 20), followers });
    }
    return out;
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

/** Small repeatable random generator, so charts don't change on every reload. */
function seeded(seed: number) {
  let x = seed * 9301 + 49297;
  return () => ((x = (x * 9301 + 49297) % 233280) / 233280);
}

/** Put the fake data back to its starting state. */
export function reset() {
  accounts = seed();
  nextId = 6;
  stopRequested = false;
  devicesApi.reset();
  groupsApi.reset();
}
