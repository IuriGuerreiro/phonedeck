// Worker entry. Talks JSON lines over stdin/stdout with the Tauri app.
//   in:  {"id": 1, "job": {"action": "swipe_up", "serial": "abc"}}
//   out: {"id": 1, "ok": true, "result": {...}}  or  {"id": 1, "ok": false, "error": "..."}
//   out: {"event": "ready", "appiumPort": 4723}  once Appium is up
// stdout is reserved for protocol messages; diagnostics go to stderr.
import { createInterface } from "node:readline";
import os from "node:os";
import path from "node:path";
import { startAppium } from "./appium.ts";
import { closeAll, setAppiumPort } from "./devices.ts";
import { runJob, type Job } from "./actions.ts";

const send = (msg: object) => process.stdout.write(JSON.stringify(msg) + "\n");

const port = Number(process.env.SMA_APPIUM_PORT ?? 4723);
const logDir = process.env.SMA_LOG_DIR ?? path.join(os.tmpdir(), "sma-logs");

let appium: Awaited<ReturnType<typeof startAppium>>;
try {
  appium = await startAppium(port, logDir);
} catch (err) {
  send({ event: "fatal", error: String(err instanceof Error ? err.message : err) });
  process.exit(1);
}
setAppiumPort(appium.port);
send({ event: "ready", appiumPort: appium.port });

const rl = createInterface({ input: process.stdin });
rl.on("line", async (line) => {
  if (!line.trim()) return;
  let id: unknown = null;
  try {
    const msg = JSON.parse(line) as { id: unknown; job: Job };
    id = msg.id;
    const result = await runJob(msg.job);
    send({ id, ok: true, result });
  } catch (err) {
    send({ id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  await closeAll();
  appium.stop();
  process.exit(0);
}
// The app closing our stdin means it exited; clean up the phone sessions and Appium.
rl.on("close", shutdown);
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
