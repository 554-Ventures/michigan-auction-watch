import assert from "node:assert/strict";
import test from "node:test";
import { baseScreenScore, classifyProperty, compareLots, discoverCatalogs, normalizeRows, parseCsv } from "../scripts/refresh-lib.mjs";

test("catalog discovery selects exact county labels and excludes DNR variants", () => {
  const html = `<a href="/catalog/getCsv/id/100">Branch</a><a href="/catalog/getCsv/id/101">Mason</a><a href="/catalog/getCsv/id/102">Mason DNR</a>`;
  assert.deepEqual(discoverCatalogs(html, ["Branch", "Mason"]), [{ county: "Branch", catalogId: "100" }, { county: "Mason", catalogId: "101" }]);
});

test("CSV normalization creates a stable property ID and direct URL", () => {
  const csv = `Lot Number,County,Address,Parcel Id,Minimum Bid,Current Taxes,SEV,Local Unit,Comment 2,Latitude,Longitude\n10,Mason,1 Lake St,P-1,"$1,000.00",50,20000,Township,Ranch home,N43.1,W86.2\n`;
  const rows = parseCsv(csv);
  const urls = new Map([["10", "https://www.tax-sale.info/lot/show/id/555"]]);
  const [normalized] = normalizeRows({ county: "Mason", catalogId: "999" }, rows, urls);
  assert.equal(normalized.id, "taxsale:555");
  assert.equal(normalized.legacyKey, "mason:10");
  assert.equal(normalized.category, "Structure");
});

test("branch text is neither a ranch nor a structure score", () => {
  assert.equal(classifyProperty("Branch County disclaimer"), "Vacant lot");
  assert.equal(baseScreenScore({ "Comment 2": "Branch County disclaimer", Address: "VACANT", "Minimum Bid": "10000" }), 50);
});

test("refresh comparison reports field-level material changes", () => {
  const prior = [{ id: "taxsale:1", county: "Mason", lot: "1", address: "A", minimumBid: 1000, sev: 10000, currentTaxes: 1, parcelId: "P", category: "Land", localUnit: "T", comment: "x", propertyUrl: "u", catalogId: "1" }];
  const cents = [{ ...prior[0], minimumBid: 1000.5 }];
  assert.equal(compareLots(prior, cents, 25).fieldChanges.length, 0);
  const changed = [{ ...prior[0], minimumBid: 1500, comment: "roof collapsing" }];
  const report = compareLots(prior, changed, 25);
  assert.equal(report.fieldChanges.length, 1);
  assert.deepEqual(report.fieldChanges[0].changes.map((change) => change.field), ["minimumBid", "comment"]);
});
