// Typed wrappers for the setup commands in src-tauri/src/setup/.
import { invoke, listen } from "@/lib/bridge";

export type ToolId = "node" | "java" | "adb" | "appium" | "scrcpy";

export type ToolStatus = {
  id: ToolId;
  name: string;
  ok: boolean;
  version: string | null;
  path: string | null;
  /** Installed by Tapfleet into its data dir. */
  managed: boolean;
  problem: string | null;
  canInstall: boolean;
  /** Nice to have; automation works without it. */
  optional: boolean;
};

export type SetupStatus = {
  tools: ToolStatus[];
  toolsDir: string;
  udev: { applies: boolean; installed: boolean; manualCommand: string };
};

export type Progress = { tool: string; step: string; done: number; total: number | null };

export type PhoneInfo = {
  manufacturer: string;
  model: string;
  androidVersion: string;
  helpersInstalled: boolean;
};

export type ApkResult = { file: string; ok: boolean; output: string; userRestricted: boolean };

export const setupApi = {
  status: () => invoke<SetupStatus>("setup_status"),
  install: (tool: ToolId) => invoke<void>("setup_install", { tool }),
  installUdevRule: () => invoke<void>("install_udev_rule"),
  phoneInfo: (serial: string) => invoke<PhoneInfo>("phone_info", { serial }),
  installHelperApks: (serial: string) => invoke<ApkResult[]>("install_helper_apks", { serial }),
  onProgress: (cb: (p: Progress) => void) =>
    listen<Progress>("setup-progress", (e) => cb(e.payload)),
};
