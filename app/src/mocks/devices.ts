// Shared fake devices backend. Lives here (not in a feature) because
// several features use it: devices, accounts and onboarding.
import { delay } from "@/lib/mock";

export type DeviceState = "device" | "unauthorized" | "offline";

export type Device = {
  serial: string;
  name: string | null;
  model: string;
  androidVersion: string;
  /** adb state: "device" = ready. */
  state: DeviceState;
  battery: number;
};

export const DEVICE_STATE: Record<DeviceState, { label: string; hint?: string }> = {
  device: { label: "Ready" },
  unauthorized: { label: "Unauthorized", hint: "Accept the USB debugging prompt on the device." },
  offline: { label: "Offline", hint: "Reconnect USB cable." },
};

const seed = (): Device[] => [
  { serial: "R58N12ABCDE", name: "Phone A", model: "Galaxy A54", androidVersion: "14", state: "device", battery: 82 },
  { serial: "1A2B3C4D5E", name: null, model: "Redmi Note 13", androidVersion: "13", state: "device", battery: 47 },
  { serial: "ZY22H7KLMN", name: "Old Pixel", model: "Pixel 6a", androidVersion: "15", state: "unauthorized", battery: 15 },
];

let devices = seed();

export const deviceLabel = (d: Device) => d.name ?? d.model;

export const devicesApi = {
  async list(): Promise<Device[]> {
    await delay(250);
    return devices.map((d) => ({ ...d }));
  },

  async rename(serial: string, name: string): Promise<void> {
    await delay(200);
    devices = devices.map((d) => (d.serial === serial ? { ...d, name: name.trim() || null } : d));
  },

  /** Pretend the user accepted the USB debugging prompt. */
  async authorize(serial: string): Promise<void> {
    await delay(800);
    devices = devices.map((d) => (d.serial === serial ? { ...d, state: "device" } : d));
  },

  reset() {
    devices = seed();
  },
};

/** Extra info shown on a device's detail view. */
export type DeviceDetails = {
  manufacturer: string;
  connection: "USB" | "Wi-Fi";
  ipAddress: string | null;
  screen: string;
  storageUsedGb: number;
  storageTotalGb: number;
  ramGb: number;
  charging: boolean;
  helpersInstalled: boolean;
  tiktokVersion: string | null;
  connectedSince: string;
  activity: { at: string; action: string; result: "ok" | "error"; note?: string }[];
};

const minsAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

const DETAILS: Record<string, DeviceDetails> = {
  R58N12ABCDE: {
    manufacturer: "Samsung",
    connection: "USB",
    ipAddress: "192.168.1.42",
    screen: "1080 × 2340",
    storageUsedGb: 74,
    storageTotalGb: 128,
    ramGb: 8,
    charging: true,
    helpersInstalled: true,
    tiktokVersion: "37.4.3",
    connectedSince: minsAgo(260),
    activity: [
      { at: minsAgo(12), action: "Warm-up @fit.with.ana", result: "ok" },
      { at: minsAgo(25), action: "Switched to @fit.with.ana", result: "ok" },
      { at: minsAgo(40), action: "Warm-up @daily.stretch", result: "error", note: "Captcha" },
      { at: minsAgo(180), action: "Synced accounts", result: "ok" },
    ],
  },
  "1A2B3C4D5E": {
    manufacturer: "Xiaomi",
    connection: "USB",
    ipAddress: "192.168.1.57",
    screen: "1080 × 2400",
    storageUsedGb: 101,
    storageTotalGb: 128,
    ramGb: 6,
    charging: false,
    helpersInstalled: true,
    tiktokVersion: "37.2.0",
    connectedSince: minsAgo(1500),
    activity: [
      { at: minsAgo(300), action: "Warm-up @home.cooking.hq", result: "ok" },
      { at: minsAgo(420), action: "Opened TikTok", result: "ok" },
    ],
  },
  ZY22H7KLMN: {
    manufacturer: "Google",
    connection: "USB",
    ipAddress: null,
    screen: "1080 × 2400",
    storageUsedGb: 39,
    storageTotalGb: 128,
    ramGb: 6,
    charging: false,
    helpersInstalled: false,
    tiktokVersion: null,
    connectedSince: minsAgo(3),
    activity: [],
  },
};

export async function getDeviceDetails(serial: string): Promise<DeviceDetails | null> {
  await delay(300);
  return DETAILS[serial] ?? null;
}

/** What the phone is doing right now, for the fake screen mirror. */
export type LiveTask =
  | { kind: "warmup"; account: string; keywords: string[] }
  | { kind: "idle" }
  | { kind: "no_screen"; reason: string };

const LIVE: Record<string, LiveTask> = {
  R58N12ABCDE: { kind: "warmup", account: "fit.with.ana", keywords: ["gym workout", "meal prep"] },
  "1A2B3C4D5E": { kind: "idle" },
  ZY22H7KLMN: { kind: "no_screen", reason: "Accept USB debugging on device" },
};

export const getLiveTask = (serial: string): LiveTask =>
  LIVE[serial] ?? { kind: "no_screen", reason: "Device offline" };
