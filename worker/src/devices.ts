// One Appium session per phone, reused across commands. Commands for the
// same phone run one at a time; different phones run in parallel.
import { remote } from "webdriverio";

type Browser = Awaited<ReturnType<typeof remote>>;

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
