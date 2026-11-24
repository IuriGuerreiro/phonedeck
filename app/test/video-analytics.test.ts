import assert from "node:assert/strict";
import { test } from "node:test";
import { latestVideos, engagement } from "../src/data/video-analytics.ts";

test("refreshes merge by account and stable video id while keeping older tracked videos", () => {
  const video = { platformVideoId: "123", url: "https://www.tiktok.com/@one/video/123", caption: "Same caption", views: 10, likes: 2, comments: 1, shares: 0, saves: null };
  const result = latestVideos([
    { id: 1, accountId: 1, capturedAt: "2026-11-23T10:00:00Z", videos: [video, { ...video, platformVideoId: "456" }] },
    { id: 2, accountId: 2, capturedAt: "2026-11-23T10:00:00Z", videos: [video] },
    { id: 3, accountId: 1, capturedAt: "2026-11-24T10:00:00Z", videos: [{ ...video, views: 20 }] },
    { id: 4, accountId: 1, capturedAt: "2026-11-24T11:00:00Z", videos: [] },
  ]);
  assert.equal(result.length, 3);
  assert.equal(result.find((v) => v.key === "1:123")?.views, 20);
  assert.equal(result.find((v) => v.key === "2:123")?.views, 10);
  assert.equal(result.find((v) => v.key === "1:456")?.views, 10);
  assert.equal(engagement(video), 0.3);
  assert.equal(engagement({ ...video, views: 0 }), null);
  assert.equal(engagement({ ...video, comments: null }), null);
});
