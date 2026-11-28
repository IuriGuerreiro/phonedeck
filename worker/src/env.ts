// Env vars are TAPFLEET_*; the old SMA_* names (from before the rename to Tapfleet) still work.
import os from "node:os";
import path from "node:path";

export const envVar = (name: string): string | undefined => process.env[`TAPFLEET_${name}`] ?? process.env[`SMA_${name}`];

/** Where logs go: set by the app, else a temp folder. */
export const logDir = (): string => envVar("LOG_DIR") ?? path.join(os.tmpdir(), "tapfleet-logs");
