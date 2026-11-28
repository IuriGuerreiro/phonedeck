// Opt-in integration check. Requires a connected phone with this TikTok account.
import assert from "node:assert/strict";
import { startAppium } from "../src/appium.ts";
import { closeAll, setAppiumPort } from "../src/devices.ts";
import { runJob } from "../src/actions.ts";
const [serial, username] = process.argv.slice(2);
if (!serial || !username) throw new Error("Usage: node test/account-analytics-live.ts SERIAL USERNAME");
const server = await startAppium(4723, "/tmp/tapfleet-analytics-test");
setAppiumPort(server.port);
try {
  const result = await runJob({ action: "account_analytics", serial, platform: "tiktok", username });
  assert.ok(typeof result === "object" && result !== null);
  assert.ok("username" in result && result.username === username);
  for (const metric of ["followers", "following", "likes"]) {
    assert.ok(metric in result);
    const value = Reflect.get(result, metric);
    assert.ok(Number.isSafeInteger(value) && value >= 0);
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
} finally {
  await closeAll();
  server.stop();
}
