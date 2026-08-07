import { DEFAULT_STRATEGY, lotIdentity, sourceSnapshot, type PublicLot, type SourceSnapshot, type Strategy } from "./domain";

export type ResearchStage = "Research" | "Bid Ready";
export type DiligenceKey = "title" | "access" | "zoning" | "utilities" | "condition" | "possession";
export type DiligenceChecklist = Record<DiligenceKey, boolean>;

export type ResearchRecord = {
  id: string;
  stage: ResearchStage;
  notes: string;
  bidCap: number;
  addedAt: string;
  sourceSnapshot: SourceSnapshot;
  checklist: DiligenceChecklist;
  acknowledgedSignature?: string;
};

export type WorkspaceBackup = {
  schemaVersion: 2;
  exportedAt: string;
  strategy: Strategy;
  research: ResearchRecord[];
};

export const STRATEGY_STORAGE_KEY = "auction-watch-strategy-v2";
export const RESEARCH_STORAGE_KEY = "auction-watch-research-v2";
const LEGACY_STRATEGY_KEY = "auction-watch-strategy-v1";
const LEGACY_RESEARCH_KEY = "auction-watch-research-v1";

export const emptyChecklist = (): DiligenceChecklist => ({
  title: false,
  access: false,
  zoning: false,
  utilities: false,
  condition: false,
  possession: false,
});

const asArray = <T,>(value: unknown): T[] => Array.isArray(value) ? value as T[] : [];

export function loadStrategy(): Strategy {
  for (const key of [STRATEGY_STORAGE_KEY, LEGACY_STRATEGY_KEY]) {
    try {
      const saved = localStorage.getItem(key);
      if (saved) return { ...DEFAULT_STRATEGY, ...JSON.parse(saved) };
    } catch {
      // Ignore malformed browser state and continue with safe defaults.
    }
  }
  return DEFAULT_STRATEGY;
}

export function migrateResearch(lots: PublicLot[]): ResearchRecord[] {
  try {
    const current = localStorage.getItem(RESEARCH_STORAGE_KEY);
    if (current) return asArray<ResearchRecord>(JSON.parse(current));
    const legacy = localStorage.getItem(LEGACY_RESEARCH_KEY);
    if (!legacy) return [];
    const byLegacyKey = new Map(lots.map((lot) => [lot.legacyKey ?? lot.key, lot]));
    const migrated = asArray<any>(JSON.parse(legacy)).flatMap((record) => {
      const live = byLegacyKey.get(record.key);
      const snapshot = live ? sourceSnapshot(live) : record.snapshot ? {
        county: record.snapshot.county ?? "",
        lot: record.snapshot.lot ?? "",
        address: record.snapshot.address ?? "Address not listed",
        parcelId: record.snapshot.parcelId ?? "",
        minimumBid: Number(record.sourceMinimumBid ?? 0),
        currentTaxes: 0,
        sev: 0,
        category: record.snapshot.category ?? "Unknown",
        localUnit: "",
        comment: record.snapshot.comment ?? "",
        catalogUrl: record.snapshot.catalogUrl ?? "",
        propertyUrl: record.snapshot.propertyUrl ?? record.snapshot.catalogUrl ?? "",
      } : null;
      if (!snapshot) return [];
      return [{
        id: live ? lotIdentity(live) : String(record.key),
        stage: record.stage === "Bid Ready" ? "Bid Ready" : "Research",
        notes: String(record.notes ?? ""),
        bidCap: Number(record.bidCap ?? 0),
        addedAt: String(record.addedAt ?? new Date().toISOString()),
        sourceSnapshot: snapshot,
        checklist: emptyChecklist(),
      } satisfies ResearchRecord];
    });
    localStorage.setItem(RESEARCH_STORAGE_KEY, JSON.stringify(migrated));
    return migrated;
  } catch {
    return [];
  }
}

export function saveWorkspace(strategy: Strategy, research: ResearchRecord[]) {
  localStorage.setItem(STRATEGY_STORAGE_KEY, JSON.stringify(strategy));
  localStorage.setItem(RESEARCH_STORAGE_KEY, JSON.stringify(research));
}

export function createBackup(strategy: Strategy, research: ResearchRecord[]): WorkspaceBackup {
  return { schemaVersion: 2, exportedAt: new Date().toISOString(), strategy, research };
}

export function parseBackup(value: unknown): WorkspaceBackup {
  if (!value || typeof value !== "object") throw new Error("Backup is not a JSON object.");
  const candidate = value as Partial<WorkspaceBackup>;
  if (candidate.schemaVersion !== 2) throw new Error("Unsupported backup version.");
  if (!candidate.strategy || !Array.isArray(candidate.research)) throw new Error("Backup is missing strategy or research data.");
  return {
    schemaVersion: 2,
    exportedAt: String(candidate.exportedAt ?? new Date().toISOString()),
    strategy: { ...DEFAULT_STRATEGY, ...candidate.strategy },
    research: candidate.research,
  };
}
