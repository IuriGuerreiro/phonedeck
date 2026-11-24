import assert from "node:assert/strict";
import { test } from "node:test";
import { parseProfileCount } from "../src/platforms/tiktok.ts";
test("reads localized profile counts without inventing missing metrics", () => {
  for (const [label, expected] of [["0", 0], ["1,234", 1234], ["1.234", 1234], ["1,2 mil", 1200], ["2.5K", 2500], ["3M", 3000000]] satisfies [string, number][]) {
    assert.equal(parseProfileCount(label), expected);
  }
  assert.throws(() => parseProfileCount("—"));
  assert.throws(() => parseProfileCount(""));
});
