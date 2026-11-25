// One Appium session per phone, reused across commands. Commands for the
// same phone run one at a time; different phones run in parallel.
import { remote } from "webdriverio";

export type Browser = Awaited<ReturnType<typeof remote>>;

type Device = {
  serial: string;
  systemPort: number;
  session?: Browser;
  queue: Promise<unknown>;
};

const devices = new Map<string, Device>();
let nextSystemPort = 8200;
let appiumPort = 4723;

export function setAppiumPort(port: number) {
  appiumPort = port;
}

/** Makes sure Appium is running; set by the worker entry. Unplugging a phone can crash Appium. */
let reviveAppium: (() => Promise<void>) | undefined;
let reviving: Promise<void> | undefined;
export function setAppiumReviver(fn: () => Promise<void>) {
  reviveAppium = fn;
}

/** Phones where the user asked the running job to stop. Long jobs check this. */
const stopRequested = new Set<string>();
export const requestStop = (serial: string) => stopRequested.add(serial);
export const shouldStop = (serial: string) => stopRequested.has(serial);

function device(serial: string): Device {
  let d = devices.get(serial);
  if (!d) {
    d = { serial, systemPort: nextSystemPort++, queue: Promise.resolve() };
    devices.set(serial, d);
  }
  return d;
}

/** Run `fn` with a live session for this phone, after earlier jobs for it finish. */
export function withDevice<T>(serial: string, fn: (s: Browser) => Promise<T>): Promise<T> {
  const d = device(serial);
  const run = d.queue.then(async () => {
    stopRequested.delete(serial);
    const session = await ensureSession(d);
    try {
      return await fn(session);
    } catch (err) {
      // A dead session fails every later command. Drop it so the next job starts fresh.
      if (!(await isAlive(session))) d.session = undefined;
      throw err;
    }
  });
  d.queue = run.catch(() => {});
  return run;
}

async function ensureSession(d: Device): Promise<Browser> {
  if (d.session && (await isAlive(d.session))) return d.session;
  // One check at a time, so two phones don't start two servers.
  reviving ??= reviveAppium?.().finally(() => (reviving = undefined));
  await reviving;
  d.session = await remote({
    hostname: "127.0.0.1",
    port: appiumPort,
    logLevel: "error",
    capabilities: {
      platformName: "Android",
      "appium:automationName": "UiAutomator2",
      "appium:udid": d.serial,
      "appium:systemPort": d.systemPort,
      "appium:noReset": true,
      "appium:newCommandTimeout": 600,
    },
  });
  // Video apps never go idle (something is always playing), and by default
  // UiAutomator waits up to 10s for idle before every lookup.
  await d.session.updateSettings({ waitForIdleTimeout: 0 });
  return d.session;
}

async function isAlive(s: Browser): Promise<boolean> {
  try {
    await s.getWindowSize();
    return true;
  } catch {
    return false;
  }
}

export async function closeAll() {
  await Promise.allSettled([...devices.values()].map((d) => d.session?.deleteSession()));
  devices.clear();
}
