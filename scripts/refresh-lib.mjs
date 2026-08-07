const structurePattern = /\b(?:house|home|cottage|garage|building|ranch|residence|duplex|triplex|cabin|dwelling|barn)\b/i;
const waterPattern = /\b(?:waterfront|lakefront|riverfront|lake frontage)\b/i;

export function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { field += '"'; index++; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") { row.push(field); field = ""; }
    else if (char === "\n") { row.push(field.replace(/\r$/, "")); rows.push(row); row = []; field = ""; }
    else field += char;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const headers = (rows.shift() ?? []).map((header) => header.trim());
  return rows.filter((candidate) => candidate.some(Boolean)).map((candidate) => Object.fromEntries(headers.map((header, index) => [header, candidate[index] ?? ""])));
}

const decodeHtml = (value) => value
  .replace(/<[^>]+>/g, " ")
  .replace(/&amp;/gi, "&")
  .replace(/&#39;|&apos;/gi, "'")
  .replace(/&quot;/gi, '"')
  .replace(/\s+/g, " ")
  .trim();

export function discoverCatalogs(indexHtml, countyAllowlist) {
  const allowed = new Map(countyAllowlist.map((county) => [county.toLowerCase(), county]));
  const discovered = new Map();
  const anchorPattern = /<a\b[^>]*href=["'][^"']*\/catalog\/getCsv\/id\/(\d+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of indexHtml.matchAll(anchorPattern)) {
    const label = decodeHtml(match[2]);
    const county = allowed.get(label.toLowerCase());
    if (county) discovered.set(county, { county, catalogId: match[1] });
  }
  const missing = countyAllowlist.filter((county) => !discovered.has(county));
  if (missing.length) throw new Error(`Catalog discovery did not find: ${missing.join(", ")}`);
  return countyAllowlist.map((county) => discovered.get(county));
}

export function extractPropertyUrls(catalogHtml) {
  const propertyUrls = new Map();
  for (const match of catalogHtml.matchAll(/href=["']\/lot\/show(?:Preview)?\/id\/(\d+)["'][^>]*aria-label=["']Lot\s+([^\s"'<>]+)/gi)) {
    propertyUrls.set(match[2].trim(), `https://www.tax-sale.info/lot/show/id/${match[1]}`);
  }
  for (const match of catalogHtml.matchAll(/alt=["']Lot\s+([^\s"'<>]+)["']/gi)) {
    const preceding = catalogHtml.slice(Math.max(0, match.index - 2_000), match.index);
    const links = [...preceding.matchAll(/href=["']\/lot\/show(?:Preview)?\/id\/(\d+)["']/gi)];
    const propertyId = links.at(-1)?.[1];
    if (propertyId) propertyUrls.set(match[1].trim(), `https://www.tax-sale.info/lot/show/id/${propertyId}`);
  }
  return propertyUrls;
}

export const toNumber = (value) => Number(String(value ?? "").replace(/[$,]/g, "")) || 0;
const cleanCoord = (value) => toNumber(String(value ?? "").replace(/^[A-Za-z]/, ""));

export function classifyProperty(comment) {
  if (structurePattern.test(comment)) return "Structure";
  if (waterPattern.test(comment)) return "Waterfront";
  if (/\bacres?\b/i.test(comment)) return "Land";
  return "Vacant lot";
}

export function baseScreenScore(row) {
  const text = `${row["Comment 2"] ?? ""} ${row.Address ?? ""}`;
  let score = 50;
  if (structurePattern.test(text)) score += 22;
  if (waterPattern.test(text) || /\bnear\s+(?:the\s+)?[a-z ]*lake\b/i.test(text)) score += 15;
  if (/\bno\s+(?:known\s+)?(?:legal\s+|physical\s+)?access\b|\blandlocked\b|\bcontaminat(?:ed|ion)\b/i.test(text)) score -= 35;
  if (/\boccupied\b|\bdemolition\b|\bcondemn(?:ed|ation)?\b|\bcollaps(?:e|ed|ing)\b/i.test(text)) score -= 22;
  if (toNumber(row["Minimum Bid"]) <= 5_000) score += 8;
  return Math.max(0, Math.min(100, score));
}

export function normalizeRows(source, rows, propertyUrls) {
  return rows.map((row) => {
    const county = String(row.County || source.county).trim().replace(/\b\w/g, (letter) => letter.toUpperCase());
    const lot = String(row["Lot Number"]).trim();
    const propertyUrl = propertyUrls.get(lot);
    const propertyId = propertyUrl?.match(/\/id\/(\d+)/)?.[1];
    if (!propertyId) throw new Error(`Could not resolve property link for ${county} lot ${lot}`);
    const comment = String(row["Comment 2"] || "").trim();
    return {
      id: `taxsale:${propertyId}`,
      key: `taxsale:${propertyId}`,
      legacyKey: `${county.toLowerCase()}:${lot}`,
      propertyId,
      county,
      lot,
      address: String(row.Address || "Address not listed").trim().replace(/\s+/g, " "),
      parcelId: String(row["Parcel Id"] || "").trim(),
      minimumBid: toNumber(row["Minimum Bid"]),
      currentTaxes: toNumber(row["Current Taxes"]),
      sev: toNumber(row.SEV),
      category: classifyProperty(comment),
      localUnit: String(row["Local Unit"] || "").trim(),
      comment,
      score: baseScreenScore(row),
      latitude: cleanCoord(row.Latitude),
      longitude: -Math.abs(cleanCoord(row.Longitude)),
      catalogId: String(source.catalogId),
      catalogUrl: `https://www.tax-sale.info/listings/catalog/${source.catalogId}`,
      propertyUrl,
    };
  });
}

const identity = (lot) => lot.id || lot.propertyId && `taxsale:${lot.propertyId}` || lot.propertyUrl?.match(/\/id\/(\d+)/)?.[1] && `taxsale:${lot.propertyUrl.match(/\/id\/(\d+)/)[1]}` || lot.key;
const minimalLot = (lot) => ({ id: identity(lot), county: lot.county, lot: lot.lot, address: lot.address, propertyUrl: lot.propertyUrl });
const comparedFields = ["minimumBid", "sev", "currentTaxes", "address", "parcelId", "category", "localUnit", "comment", "propertyUrl", "catalogId"];

export function compareLots(previousLots, currentLots, bidThreshold = 25) {
  const previous = new Map(previousLots.map((lot) => [identity(lot), lot]));
  const current = new Map(currentLots.map((lot) => [identity(lot), lot]));
  const added = currentLots.filter((lot) => !previous.has(identity(lot))).map(minimalLot);
  const removed = previousLots.filter((lot) => !current.has(identity(lot))).map(minimalLot);
  const fieldChanges = currentLots.flatMap((lot) => {
    const prior = previous.get(identity(lot));
    if (!prior) return [];
    const changes = comparedFields.flatMap((field) => {
      if (prior[field] === lot[field]) return [];
      if (field === "minimumBid" && Math.abs(Number(lot[field]) - Number(prior[field])) < bidThreshold) return [];
      return [{ field, from: prior[field] ?? "", to: lot[field] ?? "" }];
    });
    return changes.length ? [{ ...minimalLot(lot), changes }] : [];
  });
  const bidChanges = fieldChanges.flatMap((lot) => lot.changes.filter((change) => change.field === "minimumBid").map((change) => ({ id: lot.id, key: lot.id, from: change.from, to: change.to })));
  return { added, removed, fieldChanges, bidChanges };
}
