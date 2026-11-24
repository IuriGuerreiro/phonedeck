// Opt-in real-phone integration check. --public-profile checks collection without saving it as account data.
import assert from "node:assert/strict";
import { startAppium } from "../src/appium.ts";
import { closeAll, setAppiumPort, withDevice } from "../src/devices.ts";
import { runJob } from "../src/actions.ts";
import { readProfileVideos } from "../src/platforms/tiktok.ts";
import { sleep } from "../src/ui.ts";
const [serial, username, mode] = process.argv.slice(2);
if (!serial || !username) throw new Error("Usage: node test/video-analytics-live.ts SERIAL USERNAME [--public-profile]");
const server = await startAppium(4731, "/tmp/sma-video-analytics-test");
setAppiumPort(server.port);
try {
  const result = mode === "--public-profile" ? await withDevice(serial, async (s) => {
    await s.execute("mobile: deepLink", { url: `https://www.tiktok.com/@${username}`, package: "com.zhiliaoapp.musically" });
    await sleep(4000);
    return { videos: await readProfileVideos(s, username, 3) };
  }) : await runJob({ action: "video_analytics", serial, platform: "tiktok", username });
  assert.ok(typeof result === "object" && result !== null && "videos" in result && Array.isArray(result.videos));
  for (const video of result.videos) {
    assert.match(video.platformVideoId, /^\d+$/);
    assert.ok(Number.isSafeInteger(video.views) && video.views >= 0);
  }
  if (mode === "--public-profile") assert.equal(result.videos.length, 3);
  process.stdout.write(`${JSON.stringify(result)}\n`);
} finally {
  await closeAll(); server.stop();
}
