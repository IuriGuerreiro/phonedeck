import assert from "node:assert/strict";
import { test } from "node:test";
import { countFromLabel, videoIdentity } from "../src/platforms/video-metrics.ts";
import { parseProfileCount } from "../src/platforms/tiktok.ts";
test("reads visible localized video metrics and preserves unavailable values", () => {
  assert.equal(countFromLabel("Gostar do vídeo. 1,096 gostos", parseProfileCount), 1096);
  assert.equal(countFromLabel("Lê ou adiciona comentários. 0 comentários", parseProfileCount), 0);
  assert.equal(countFromLabel("Share video. 1.2K shares", parseProfileCount), 1200);
  assert.equal(countFromLabel("Add or remove from Favorites", parseProfileCount), null);
});
test("identifies videos by permanent id rather than caption or tracking link", () => {
  assert.deepEqual(videoIdentity("https://www.tiktok.com/@creator/video/123456?share_id=tracking"), { platformVideoId: "123456", url: "https://www.tiktok.com/@creator/video/123456" });
  assert.deepEqual(videoIdentity("https://www.tiktok.com/@creator/photo/123456"), { platformVideoId: "123456", url: "https://www.tiktok.com/@creator/photo/123456" });
  assert.throws(() => videoIdentity("https://www.tiktok.com.evil.test/@creator/video/123"));
  assert.throws(() => videoIdentity("https://vm.tiktok.com/short"));
  assert.throws(() => videoIdentity("https://www.tiktok.com/@creator"));
});
