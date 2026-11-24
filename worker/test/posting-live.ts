// Prepares a real video for review and stops before Publish.
import assert from "node:assert/strict";
import { startAppium } from "../src/appium.ts";
import { closeAll, setAppiumPort } from "../src/devices.ts";
import { runJob } from "../src/actions.ts";
const [serial, username, filePath] = process.argv.slice(2);
if (!serial || !username || !filePath) throw new Error("Usage: node test/posting-live.ts SERIAL USERNAME MP4_PATH");
const server = await startAppium(4731, "/tmp/sma-posting-test");
setAppiumPort(server.port);
try {
  const result = await runJob({ action: "prepare_post", serial, platform: "tiktok", username, postId: Date.now(), filePath, caption: "PhoneDeck upload test", visibility: "private" });
  assert.deepEqual(result, { ready: true });
  process.stdout.write("Video prepared for review with Only you visibility. Publish was not pressed.\n");
} finally { await closeAll(); server.stop(); }
