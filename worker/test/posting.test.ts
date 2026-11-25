import assert from "node:assert/strict";
import { test } from "node:test";
import { isFresh, sameCaption } from "../src/platforms/tiktok-posting.ts";

test("only a just-posted video with the same caption counts as posted", () => {
  for (const t of ["· Há 2 m", "Há 5 s", "3m ago", "Just now"]) assert.ok(isFresh(t), t);
  for (const t of ["· Há 2 h", "Há 3 d", "11-20", "17 de set.", "", "1 mês"]) assert.ok(!isFresh(t), t);
  assert.ok(sameCaption("PhoneDeck test #a", "PhoneDeck  test #a"));
  assert.ok(sameCaption("A long caption that is cut sho… mais", "A long caption that is cut short here"));
  assert.ok(!sameCaption("PhoneDeck", "PhoneDeck test"));
  assert.ok(!sameCaption("", "x"));
});
