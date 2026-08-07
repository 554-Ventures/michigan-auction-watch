import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("published source has no hard-coded private research seeds", async () => {
  const source = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /curatedSeeds|zillow\.com|redfin\.com|realtor\.com/);
  assert.match(source, /Private work stays in this browser/);
  assert.match(source, /Export backup/);
});

test("Bid Ready requires a cap, complete checklist, current lot, and reviewed source changes", async () => {
  const source = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  assert.match(source, /record\.bidCap > 0/);
  assert.match(source, /completed === Object\.keys\(checklistLabels\)\.length/);
  assert.match(source, /!needsReview && !!current/);
  assert.match(source, /disabled=\{!gatePassed\}/);
});
