import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_STRATEGY, detectRiskFlags, diffSource, evaluateLot, hasStructureSignal, lotIdentity, refreshHealth, sourceSnapshot, type PublicLot } from "../src/domain";

const lot: PublicLot = {
  key: "muskegon:1",
  county: "Muskegon",
  lot: "1",
  address: "100 TEST ST",
  parcelId: "A-1",
  minimumBid: 5_000,
  currentTaxes: 200,
  sev: 50_000,
  category: "Vacant lot",
  localUnit: "TEST TOWNSHIP",
  comment: "Vacant parcel",
  score: 50,
  latitude: 43,
  longitude: -86,
  catalogUrl: "https://www.tax-sale.info/listings/catalog/1",
  propertyUrl: "https://www.tax-sale.info/lot/show/id/123456",
};

test("stable identity is the Tax-Sale.info property ID", () => {
  assert.equal(lotIdentity(lot), "taxsale:123456");
});

test("structure rules do not match ranch inside branch", () => {
  assert.equal(hasStructureSignal("Branch County disclaimer"), false);
  assert.equal(hasStructureSignal("A small ranch home and garage"), true);
  assert.equal(evaluateLot({ ...lot, comment: "Branch office notice" }, DEFAULT_STRATEGY).reasons.includes("structure signal"), false);
});

test("serious catalog risks are categorized", () => {
  const flags = detectRiskFlags("Roof collapsing, major leakage, visible mold and an occupied unsafe structure slated for demolition.");
  assert.ok(flags.some((flag) => flag.category === "Structural" && flag.severity === "critical"));
  assert.ok(flags.some((flag) => flag.category === "Structural" && flag.severity === "high"));
  assert.ok(flags.some((flag) => flag.category === "Occupancy"));
  assert.ok(flags.some((flag) => flag.category === "Demolition"));
});

test("minor cents do not trigger a bid warning but material changes do", () => {
  const snapshot = sourceSnapshot(lot);
  assert.deepEqual(diffSource(snapshot, { ...lot, minimumBid: 5_000.49 }, 100), []);
  const changes = diffSource(snapshot, { ...lot, minimumBid: 5_250 }, 100);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].field, "minimumBid");
});

test("freshness becomes stale instead of staying permanently healthy", () => {
  const refreshed = "2026-08-01T12:00:00.000Z";
  assert.equal(refreshHealth(refreshed, [], new Date("2026-08-01T18:00:00.000Z")).label, "Fresh");
  assert.equal(refreshHealth(refreshed, [], new Date("2026-08-05T12:00:00.000Z")).label, "Stale");
  assert.equal(refreshHealth(refreshed, ["network"], new Date("2026-08-01T18:00:00.000Z")).label, "Failed");
});
