// Worker entry. Talks JSON lines over stdin/stdout with the Tauri app.
//   in:  {"id": 1, "job": {"action": "swipe_up", "serial": "abc"}}
//   out: {"id": 1, "ok": true, "result": {...}}  or  {"id": 1, "ok": false, "error": "..."}
//   out: {"event": "ready", "appiumPort": 4723}  once Appium is up
// stdout is reserved for protocol messages; diagnostics go to stderr.
import { createInterface } from "node:readline";
import { isUp, startAppium } from "./appium.ts";
import { closeAll, setAppiumPort, setAppiumReviver } from "./devices.ts";
import { runJob, type Job } from "./actions.ts";
import { send } from "./protocol.ts";
import { envVar, logDir as getLogDir } from "./env.ts";

const port = Number(envVar("APPIUM_PORT") ?? 4723);
const logDir = getLogDir();

let appium: Awaited<ReturnType<typeof startAppium>>;
try {
  appium = await startAppium(port, logDir);
} catch (err) {
  send({ event: "fatal", error: String(err instanceof Error ? err.message : err) });
  process.exit(1);
}
setAppiumPort(appium.port);
setAppiumReviver(async () => {
  if (await isUp(port)) return;
  console.error("[worker] Appium is down; starting it again");
  appium.stop();
  appium = await startAppium(port, logDir);
});
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
    const code = (err as { code?: unknown })?.code;
    send({
      id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      code: typeof code === "string" ? code : undefined,
    });
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
