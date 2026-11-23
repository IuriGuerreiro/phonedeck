// Real devices: adb + the devices table, through the Rust commands in api.ts.
import { api, type Device } from "@/api";

export type { Device };

/** Friendly text for each adb state, plus what to do about it. */
export const DEVICE_STATE: Record<string, { label: string; hint?: string }> = {
  device: { label: "Ready" },
  unauthorized: { label: "Not allowed", hint: "Unlock the phone and accept the USB debugging prompt." },
  offline: { label: "Offline", hint: "Reconnect the USB cable." },
  disconnected: { label: "Unplugged", hint: "Plug the phone in with USB debugging on." },
  "no permissions": { label: "No permission", hint: "Install the USB rule from Setup, then replug the phone." },
};

export const deviceState = (d: Device) => DEVICE_STATE[d.state] ?? { label: d.state };
export const deviceLabel = (d: Device) => d.name ?? d.model ?? d.serial;
export const isReady = (d: Device | undefined) => d?.state === "device";

export const devicesApi = {
  list: api.listDevices,
  rename: api.renameDevice,
};
