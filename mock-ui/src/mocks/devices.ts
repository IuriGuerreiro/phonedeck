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
  unauthorized: { label: "Not allowed", hint: "Unlock the phone and accept the USB debugging prompt." },
  offline: { label: "Offline", hint: "Reconnect the USB cable." },
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
