export type RiskSeverity = "critical" | "high" | "review";
export type RiskCategory =
  | "Access / title"
  | "Occupancy"
  | "Structural"
  | "Environmental"
  | "Utilities"
  | "Buildability"
  | "Demolition"
  | "Site cleanup";

export type RiskFlag = {
  category: RiskCategory;
  severity: RiskSeverity;
  label: string;
};

export type PublicLot = {
  id?: string;
  key: string;
  legacyKey?: string;
  propertyId?: string;
  county: string;
  lot: string;
  address: string;
  parcelId: string;
  minimumBid: number;
  currentTaxes: number;
  sev: number;
  category: string;
  localUnit: string;
  comment: string;
  score: number;
  latitude: number;
  longitude: number;
  catalogId?: string;
  catalogUrl: string;
  propertyUrl: string;
};

export type Strategy = {
  maxBid: number;
  minScore: number;
  minValueMultiple: number;
  maxDriveHours: number;
  counties: string[];
  categories: string[];
  riskTolerance: "Conservative" | "Balanced" | "Aggressive";
  waterfrontWeight: number;
  structureWeight: number;
  valueWeight: number;
  lowBidWeight: number;
  bidChangeThreshold: number;
};

export type EvaluatedLot = PublicLot & {
  identity: string;
  dynamicScore: number;
  valueMultiple: number;
  passes: boolean;
  risk: "High" | "Review" | "Lower";
  riskFlags: RiskFlag[];
  reasons: string[];
};

export type SourceSnapshot = Pick<
  PublicLot,
  | "county"
  | "lot"
  | "address"
  | "parcelId"
  | "minimumBid"
  | "currentTaxes"
  | "sev"
  | "category"
  | "localUnit"
  | "comment"
  | "catalogUrl"
  | "propertyUrl"
>;

export type LotDifference = {
  field: keyof SourceSnapshot | "availability";
  label: string;
  from: string | number;
  to: string | number;
  severity: "material" | "informational";
};

export const DEFAULT_STRATEGY: Strategy = {
  maxBid: 25_000,
  minScore: 60,
  minValueMultiple: 2,
  maxDriveHours: 4,
  counties: [],
  categories: [],
  riskTolerance: "Balanced",
  waterfrontWeight: 15,
  structureWeight: 18,
  valueWeight: 20,
  lowBidWeight: 12,
  bidChangeThreshold: 100,
};

export const COUNTY_DRIVE_HOURS: Record<string, number> = {
  Ottawa: 2.8,
  Muskegon: 3.1,
  Oceana: 3.5,
  Mason: 3.8,
  Manistee: 4.2,
};

const structurePattern = /\b(?:house|home|cottage|garage|building|ranch|residence|duplex|triplex|cabin|dwelling|barn)\b/i;
const waterPattern = /\b(?:waterfront|lakefront|riverfront|lake frontage)\b|\bnear\s+(?:the\s+)?[a-z ]*lake\b/i;

const riskRules: Array<{ category: RiskCategory; severity: RiskSeverity; label: string; pattern: RegExp }> = [
  { category: "Access / title", severity: "critical", label: "No known legal or physical access", pattern: /\bno\s+(?:known\s+)?(?:legal\s+|physical\s+)?access\b|\blandlocked\b/i },
  { category: "Access / title", severity: "review", label: "Easement or title condition", pattern: /\beasement\b|\btitle\s+(?:issue|condition|exception)\b/i },
  { category: "Occupancy", severity: "high", label: "Occupied or possession risk", pattern: /\boccupied\b|\btenant\b|\bpossession\b|\bsquatter\b/i },
  { category: "Structural", severity: "critical", label: "Collapse, fire, or major structural failure", pattern: /\b(?:roof\s+)?collaps(?:e|ed|ing)\b|\bstructural\s+(?:problem|damage|failure)s?\b|\bfoundation\s+(?:failure|collapse|damage)\b|\bfire[- ]damaged?\b/i },
  { category: "Structural", severity: "high", label: "Major condition or water-intrusion concern", pattern: /\bmold\b|\bmajor\s+(?:roof\s+)?leak(?:age|ing|s)?\b|\bwater\s+damage\b|\bdilapidated\b|\bpoorly\s+maintained\b|\bconsiderable\s+work\b/i },
  { category: "Environmental", severity: "critical", label: "Potential contamination", pattern: /\bcontaminat(?:ed|ion)\b|\bbrownfield\b|\bhazardous\s+(?:material|waste)s?\b/i },
  { category: "Environmental", severity: "high", label: "Environmental inspection indicated", pattern: /\basbestos\b|\bunderground\s+(?:storage\s+)?tank\b/i },
  { category: "Utilities", severity: "review", label: "Private or uncertain utilities", pattern: /\bseptic\b|\bwell\b|\bno\s+utilities\b|\butilities\s+unknown\b/i },
  { category: "Buildability", severity: "critical", label: "Potentially unbuildable parcel", pattern: /\btoo\s+small\s+to\s+build\b|\bonly\s+(?:about\s+|~\s*)?\d+\s*(?:feet|ft\.?)\s+wide\b/i },
  { category: "Buildability", severity: "high", label: "Buildability or zoning constraint", pattern: /\bwetland\b|\bdeed\s+restriction\b|\bsetback\b|\bbuildability\b|\bzoning\s+(?:issue|restriction|approval)\b/i },
  { category: "Demolition", severity: "critical", label: "Condemnation or demolition risk", pattern: /\bcondemn(?:ed|ation)?\b|\bdemolition\b|\bunsafe\s+structure\b/i },
  { category: "Site cleanup", severity: "review", label: "Debris or personal property remains", pattern: /\bdebris\b|\bpersonal\s+property\b|\bclean[- ]?out\b/i },
];

export const money = (value: number, cents = false) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: cents ? 2 : 0,
    maximumFractionDigits: cents ? 2 : 0,
  }).format(value);

export function lotIdentity(lot: Pick<PublicLot, "id" | "propertyId" | "propertyUrl" | "key">): string {
  if (lot.id) return lot.id;
  if (lot.propertyId) return `taxsale:${lot.propertyId}`;
  const propertyId = lot.propertyUrl?.match(/\/id\/(\d+)/)?.[1];
  return propertyId ? `taxsale:${propertyId}` : lot.key;
}

export function hasStructureSignal(text: string): boolean {
  return structurePattern.test(text);
}

export function detectRiskFlags(text: string): RiskFlag[] {
  return riskRules
    .filter((rule) => rule.pattern.test(text))
    .map(({ category, severity, label }) => ({ category, severity, label }));
}

const clamp = (value: number) => Math.max(0, Math.min(100, Math.round(value)));

export function evaluateLot(lot: PublicLot, strategy: Strategy): EvaluatedLot {
  const text = `${lot.address} ${lot.comment}`;
  const valueMultiple = lot.minimumBid > 0 && lot.sev > 0 ? (lot.sev * 2) / lot.minimumBid : 0;
  const riskFlags = detectRiskFlags(text);
  const hasCritical = riskFlags.some((flag) => flag.severity === "critical");
  const hasHigh = riskFlags.some((flag) => flag.severity === "high");
  const hasReview = riskFlags.some((flag) => flag.severity === "review");
  let score = 35;
  const reasons: string[] = [];

  if (waterPattern.test(text)) {
    score += strategy.waterfrontWeight;
    reasons.push("water or lake signal");
  }
  if (hasStructureSignal(text)) {
    score += strategy.structureWeight;
    reasons.push("structure signal");
  }
  if (valueMultiple >= strategy.minValueMultiple) {
    score += strategy.valueWeight;
    reasons.push(`${valueMultiple.toFixed(1)}× bid-to-SEV proxy`);
  }
  if (lot.minimumBid <= Math.min(strategy.maxBid, 5_000)) {
    score += strategy.lowBidWeight;
    reasons.push("low entry bid");
  }

  if (hasCritical) score -= strategy.riskTolerance === "Aggressive" ? 18 : 40;
  if (hasHigh) score -= strategy.riskTolerance === "Conservative" ? 28 : strategy.riskTolerance === "Balanced" ? 18 : 8;
  if (hasReview) score -= strategy.riskTolerance === "Conservative" ? 14 : strategy.riskTolerance === "Balanced" ? 7 : 3;

  const dynamicScore = clamp(score);
  const driveHours = COUNTY_DRIVE_HOURS[lot.county] ?? Number.POSITIVE_INFINITY;
  const passes =
    lot.minimumBid <= strategy.maxBid &&
    dynamicScore >= strategy.minScore &&
    (valueMultiple === 0 || valueMultiple >= strategy.minValueMultiple) &&
    driveHours <= strategy.maxDriveHours &&
    (strategy.counties.length === 0 || strategy.counties.includes(lot.county)) &&
    (strategy.categories.length === 0 || strategy.categories.includes(lot.category)) &&
    !(hasCritical && strategy.riskTolerance === "Conservative");

  return {
    ...lot,
    identity: lotIdentity(lot),
    dynamicScore,
    valueMultiple,
    passes,
    risk: hasCritical || hasHigh ? "High" : hasReview ? "Review" : "Lower",
    riskFlags,
    reasons,
  };
}

export function sourceSnapshot(lot: PublicLot): SourceSnapshot {
  return {
    county: lot.county,
    lot: lot.lot,
    address: lot.address,
    parcelId: lot.parcelId,
    minimumBid: lot.minimumBid,
    currentTaxes: lot.currentTaxes,
    sev: lot.sev,
    category: lot.category,
    localUnit: lot.localUnit,
    comment: lot.comment,
    catalogUrl: lot.catalogUrl,
    propertyUrl: lot.propertyUrl,
  };
}

const fieldLabels: Record<keyof SourceSnapshot, string> = {
  county: "County",
  lot: "Lot number",
  address: "Address",
  parcelId: "Parcel ID",
  minimumBid: "Minimum bid",
  currentTaxes: "Current taxes",
  sev: "SEV",
  category: "Property type",
  localUnit: "Local unit",
  comment: "Catalog description",
  catalogUrl: "Catalog link",
  propertyUrl: "Property link",
};

export function diffSource(
  snapshot: SourceSnapshot,
  current: PublicLot | undefined,
  bidThreshold: number,
): LotDifference[] {
  if (!current) {
    return [{ field: "availability", label: "Catalog status", from: "Live", to: "Removed", severity: "material" }];
  }

  return (Object.keys(fieldLabels) as Array<keyof SourceSnapshot>).flatMap((field) => {
    const from = snapshot[field];
    const to = current[field];
    if (from === to) return [];
    if (field === "minimumBid" && Math.abs(Number(to) - Number(from)) < bidThreshold) return [];
    return [{
      field,
      label: fieldLabels[field],
      from,
      to,
      severity: ["minimumBid", "sev", "address", "parcelId", "comment", "propertyUrl"].includes(field)
        ? "material" as const
        : "informational" as const,
    }];
  });
}

export function changeSignature(differences: LotDifference[]): string {
  return differences.map((difference) => `${difference.field}:${difference.from}=>${difference.to}`).join("|");
}

export function refreshHealth(refreshedAt: string, failures: unknown[] = [], now = new Date()) {
  const ageHours = Math.max(0, (now.getTime() - new Date(refreshedAt).getTime()) / 3_600_000);
  if (failures.length) return { label: "Failed", className: "failed", ageHours };
  if (ageHours <= 36) return { label: "Fresh", className: "fresh", ageHours };
  if (ageHours <= 72) return { label: "Aging", className: "aging", ageHours };
  return { label: "Stale", className: "stale", ageHours };
}

export function formatChicagoTimestamp(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Chicago",
    timeZoneName: "short",
  }).format(new Date(value));
}
