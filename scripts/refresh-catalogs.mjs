import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { compareLots, discoverCatalogs, extractPropertyUrls, normalizeRows, parseCsv } from "./refresh-lib.mjs";

const root = process.cwd();
const dataDir = path.join(root, "data");
const configPath = path.join(dataDir, "catalogs.json");
const config = JSON.parse(await readFile(configPath, "utf8"));
const countyAllowlist = config.countyAllowlist ?? (Array.isArray(config) ? config.map((source) => source.county) : []);
const bidChangeMaterialityDollars = Number(config.bidChangeMaterialityDollars ?? 25);
const headers = { "user-agent": "LakeMichiganAuctionWatch/1.0 (+public GitHub Pages dashboard)" };

async function fetchText(url, label) {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`${label}: ${response.status} ${response.statusText}`);
  return response.text();
}

async function fetchCatalog(source) {
  const csvUrl = `https://www.tax-sale.info/catalog/getCsv/id/${source.catalogId}`;
  const catalogUrl = `https://www.tax-sale.info/listings/catalog/${source.catalogId}`;
  const [csv, html] = await Promise.all([fetchText(csvUrl, `${source.county} CSV`), fetchText(catalogUrl, `${source.county} catalog page`)]);
  const rows = parseCsv(csv);
  if (!rows.length || !("Lot Number" in rows[0]) || !("Minimum Bid" in rows[0])) throw new Error(`${source.county}: CSV schema or row validation failed`);
  const propertyUrls = extractPropertyUrls(html);
  const lots = normalizeRows(source, rows, propertyUrls);
  if (lots.length !== rows.length) throw new Error(`${source.county}: normalized ${lots.length} of ${rows.length} rows`);
  return { source, lots };
}

await mkdir(dataDir, { recursive: true });

let sources;
try {
  const indexHtml = await fetchText("https://www.tax-sale.info/catalog/csvList", "catalog index");
  sources = discoverCatalogs(indexHtml, countyAllowlist);
} catch (error) {
  console.error(JSON.stringify({ status: "failed-safe", failures: [{ stage: "catalog-discovery", error: error.message }] }, null, 2));
  process.exit(1);
}

const settled = await Promise.allSettled(sources.map(fetchCatalog));
const failures = settled.flatMap((result, index) => result.status === "rejected" ? [{ county: sources[index].county, error: result.reason.message }] : []);
if (failures.length) {
  console.error(JSON.stringify({ status: "failed-safe", failures }, null, 2));
  process.exit(1);
}

const seen = new Map();
const lots = settled.flatMap((result) => result.value.lots).filter((lot) => {
  if (seen.has(lot.id)) {
    const prior = seen.get(lot.id);
    if (prior.county === lot.county && prior.lot === lot.lot) return false;
    throw new Error(`Duplicate stable property identity ${lot.id}: ${prior.county} lot ${prior.lot} and ${lot.county} lot ${lot.lot}`);
  }
  seen.set(lot.id, lot);
  return true;
}).sort((left, right) => right.score - left.score || left.minimumBid - right.minimumBid);

const lotsPath = path.join(dataDir, "lots.json");
let previous = { lots: [], refreshedAt: null };
try { previous = JSON.parse(await readFile(lotsPath, "utf8")); } catch {}
const changes = compareLots(previous.lots, lots, bidChangeMaterialityDollars);
const refreshedAt = new Date().toISOString();
const payload = {
  schemaVersion: 2,
  refreshedAt,
  source: "Tax-Sale.info county catalog CSVs",
  sourceCount: sources.length,
  lotCount: lots.length,
  checksum: createHash("sha256").update(JSON.stringify(lots)).digest("hex"),
  lots,
};
const report = {
  schemaVersion: 2,
  refreshedAt,
  previousRefresh: previous.refreshedAt,
  total: lots.length,
  ...changes,
  bidChangeMaterialityDollars,
  counties: Object.fromEntries(sources.map((source) => [source.county, lots.filter((lot) => lot.county === source.county).length])),
  failures: [],
};
const historyPath = path.join(dataDir, "change-history.json");
let history = [];
try { history = JSON.parse(await readFile(historyPath, "utf8")); } catch {}
history = [{ refreshedAt, previousRefresh: previous.refreshedAt, total: lots.length, added: changes.added.length, removed: changes.removed.length, changed: changes.fieldChanges.length, checksum: payload.checksum }, ...history].slice(0, 30);
const sourceConfig = { schemaVersion: 2, countyAllowlist, bidChangeMaterialityDollars, activeCatalogs: sources, discoveredAt: refreshedAt };

const writes = [
  [lotsPath, payload],
  [path.join(dataDir, "refresh-report.json"), report],
  [historyPath, history],
  [configPath, sourceConfig],
];
for (const [target, value] of writes) await writeFile(`${target}.tmp`, `${JSON.stringify(value, null, 2)}\n`);
for (const [target] of writes) await rename(`${target}.tmp`, target);

console.log(JSON.stringify({ status: "updated", ...report }, null, 2));
