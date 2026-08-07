import { useEffect, useMemo, useRef, useState } from "react";
import catalogJson from "../data/lots.json";
import refreshJson from "../data/refresh-report.json";
import {
  COUNTY_DRIVE_HOURS,
  DEFAULT_STRATEGY,
  changeSignature,
  diffSource,
  evaluateLot,
  formatChicagoTimestamp,
  lotIdentity,
  money,
  recommendLot,
  refreshHealth,
  sourceSnapshot,
  type EvaluatedLot,
  type PublicLot,
  type RecommendedLot,
  type Strategy,
} from "./domain";
import {
  createBackup,
  emptyChecklist,
  loadStrategy,
  migrateResearch,
  parseBackup,
  saveWorkspace,
  type DiligenceKey,
  type ResearchRecord,
  type ResearchStage,
} from "./storage";

type View = "recommended" | "matches" | "changes" | "research" | "ready" | "all";
type SortKey = "status" | "score" | "property" | "county" | "category" | "risk" | "minimumBid" | "valueMultiple";
type RefreshReport = {
  refreshedAt: string;
  added?: Array<string | { id?: string; key?: string; county?: string; lot?: string; address?: string }>;
  removed?: Array<string | { id?: string; key?: string; county?: string; lot?: string; address?: string }>;
  bidChanges?: Array<{ id?: string; key?: string; from: number; to: number }>;
  fieldChanges?: Array<{ id?: string; key?: string; county?: string; lot?: string; address?: string; changes: Array<{ field: string; from: unknown; to: unknown }> }>;
  failures?: unknown[];
};

const catalogData = catalogJson as unknown as {
  refreshedAt: string;
  sourceCount: number;
  lotCount: number;
  checksum: string;
  lots: PublicLot[];
};
const refreshReport = refreshJson as unknown as RefreshReport;
const lots = catalogData.lots;

const checklistLabels: Record<DiligenceKey, string> = {
  title: "Title reviewed",
  access: "Legal and physical access",
  zoning: "Zoning and buildability",
  utilities: "Utilities and assessments",
  condition: "Condition / drive-by",
  possession: "Occupancy and possession",
};

const changeCount =
  (refreshReport.added?.length ?? 0) +
  (refreshReport.removed?.length ?? 0) +
  (refreshReport.fieldChanges?.length ?? refreshReport.bidChanges?.length ?? 0);

function downloadJson(filename: string, value: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function displayChangeItem(item: string | { id?: string; key?: string; county?: string; lot?: string; address?: string }) {
  if (typeof item === "string") return item;
  return item.address || [item.county, item.lot && `Lot ${item.lot}`].filter(Boolean).join(" · ") || item.id || item.key || "Unknown lot";
}

export default function App() {
  const [activeView, setActiveView] = useState<View>("recommended");
  const [catalogQuery, setCatalogQuery] = useState("");
  const [catalogCounty, setCatalogCounty] = useState("All");
  const [catalogCategory, setCatalogCategory] = useState("All");
  const [strategy, setStrategy] = useState<Strategy>(DEFAULT_STRATEGY);
  const [research, setResearch] = useState<ResearchRecord[]>([]);
  const [workspaceLoaded, setWorkspaceLoaded] = useState(false);
  const [strategyOpen, setStrategyOpen] = useState(true);
  const [backupMessage, setBackupMessage] = useState("");
  const [now, setNow] = useState(() => new Date());
  const importRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setStrategy(loadStrategy());
    setResearch(migrateResearch(lots));
    setWorkspaceLoaded(true);
  }, []);

  useEffect(() => {
    if (!workspaceLoaded) return;
    try { saveWorkspace(strategy, research); } catch { /* Browser storage can be unavailable in hardened modes. */ }
  }, [strategy, research, workspaceLoaded]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const countyOptions = useMemo(() => Array.from(new Set(lots.map((lot) => lot.county))).sort(), []);
  const categoryOptions = useMemo(() => Array.from(new Set(lots.map((lot) => lot.category))).sort(), []);
  const counties = ["All", ...countyOptions];
  const evaluatedLots = useMemo(
    () => lots.map((lot) => evaluateLot(lot, strategy)).sort((a, b) => Number(b.passes) - Number(a.passes) || b.dynamicScore - a.dynamicScore || a.minimumBid - b.minimumBid),
    [strategy],
  );
  const candidates = evaluatedLots.filter((lot) => lot.passes);
  const recommendations = useMemo(
    () => evaluatedLots
      .filter((lot) => lot.passes && !lot.riskFlags.some((flag) => flag.severity === "critical"))
      .map(recommendLot)
      .filter((lot) => lot.recommendationScore >= Math.max(60, strategy.minScore))
      .sort((a, b) => b.recommendationScore - a.recommendationScore || b.dynamicScore - a.dynamicScore || a.minimumBid - b.minimumBid)
      .slice(0, 10),
    [evaluatedLots, strategy.minScore],
  );
  const visibleLots = useMemo(
    () => evaluatedLots.filter((lot) =>
      (catalogCounty === "All" || lot.county === catalogCounty) &&
      (catalogCategory === "All" || lot.category === catalogCategory) &&
      `${lot.county} ${lot.address} ${lot.lot} ${lot.parcelId}`.toLowerCase().includes(catalogQuery.toLowerCase()),
    ),
    [evaluatedLots, catalogCounty, catalogCategory, catalogQuery],
  );
  const liveById = useMemo(() => new Map(lots.map((lot) => [lotIdentity(lot), lot])), []);
  const researchKeys = new Set(research.map((record) => record.id));
  const readyCount = research.filter((record) => record.stage === "Bid Ready").length;
  const unacknowledged = research.filter((record) => {
    const differences = diffSource(record.sourceSnapshot, liveById.get(record.id), strategy.bidChangeThreshold);
    return differences.length && changeSignature(differences) !== record.acknowledgedSignature;
  }).length;
  const health = refreshHealth(catalogData.refreshedAt, refreshReport.failures, now);

  const setNumber = (key: keyof Strategy, value: string) => setStrategy((current) => ({ ...current, [key]: Number(value) }));
  const toggleList = (key: "counties" | "categories", value: string) => setStrategy((current) => ({
    ...current,
    [key]: current[key].includes(value) ? current[key].filter((item) => item !== value) : [...current[key], value],
  }));
  const addToResearch = (lot: EvaluatedLot) => setResearch((current) => current.some((item) => item.id === lot.identity) ? current : [...current, {
    id: lot.identity,
    stage: "Research",
    notes: "",
    bidCap: 0,
    addedAt: new Date().toISOString(),
    sourceSnapshot: sourceSnapshot(lot),
    checklist: emptyChecklist(),
  }]);
  const updateResearch = (id: string, patch: Partial<ResearchRecord>) => setResearch((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));
  const removeResearch = (id: string) => setResearch((current) => current.filter((item) => item.id !== id));

  const exportWorkspace = () => {
    downloadJson(`auction-watch-backup-${new Date().toISOString().slice(0, 10)}.json`, createBackup(strategy, research));
    setBackupMessage("Backup downloaded. Keep it private—it contains your notes and bid caps.");
  };
  const importWorkspace = async (file: File) => {
    try {
      const backup = parseBackup(JSON.parse(await file.text()));
      setStrategy(backup.strategy);
      setResearch(backup.research);
      setBackupMessage(`Imported ${backup.research.length} research records.`);
    } catch (error) {
      setBackupMessage(error instanceof Error ? error.message : "Could not import this backup.");
    }
  };

  const viewCopy: Record<View, [string, string]> = {
    recommended: ["Start here", "Review the strongest current options, why they rank well, and what research is still missing."],
    matches: ["Start here", "Adjust criteria and promote promising matches into Research."],
    changes: ["Review changes", "Acknowledge source changes before relying on prior research."],
    research: ["Diligence workspace", "Complete each check and set a cap before Bid Ready becomes available."],
    ready: ["Approved queue", "Only properties with a cap and all diligence checks completed appear here."],
    all: ["Source catalog", "Browse every current lot, including properties outside your strategy."],
  };

  return <main>
    <header className="topbar">
      <div className="brand"><span className="mark">LM</span><div><b>Lake Michigan Auction Watch</b><small>Public catalog data · Private work stays in this browser</small></div></div>
      <div className="topActions"><button onClick={exportWorkspace}>Export backup</button><button onClick={() => importRef.current?.click()}>Import backup</button><input ref={importRef} hidden type="file" accept="application/json" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importWorkspace(file); event.target.value = ""; }} /><a className="source" href="https://www.tax-sale.info/catalog/csvList" target="_blank" rel="noreferrer">Source index ↗</a></div>
    </header>
    {backupMessage && <div className="backupMessage" role="status">{backupMessage}<button onClick={() => setBackupMessage("")} aria-label="Dismiss">×</button></div>}
    <section className="hero">
      <div><span className="eyebrow">Michigan tax-auction decision workspace</span><h1>Screen broadly.<br/><i>Bid deliberately.</i></h1><p>Set your strategy, investigate matching lots, and require completed diligence before anything becomes Bid Ready.</p></div>
      <div className={`freshnessCard ${health.className}`}><span>Catalog health</span><strong>{health.label}</strong><small>Updated {formatChicagoTimestamp(catalogData.refreshedAt)}</small><em>{Math.round(health.ageHours)} hours old · {catalogData.sourceCount} catalogs validated</em></div>
    </section>
    <section className="metrics">
      <div><span>Live lots</span><b>{catalogData.lotCount}</b><small>{catalogData.sourceCount} active catalogs</small></div>
      <div><span>Recommended</span><b>{recommendations.length}</b><small>Top researched-screen leads</small></div>
      <div><span>In research</span><b>{research.length - readyCount}</b><small>{unacknowledged} need source review</small></div>
      <div><span>Bid ready</span><b>{readyCount}</b><small>Passed manual gates</small></div>
    </section>
    <section className={`refreshStatus ${health.className}`}><div><span className="statusDot"/><b>Data {health.label.toLowerCase()}</b><small>Checksum {catalogData.checksum.slice(0, 8)} · failed refreshes never replace the last good snapshot</small></div><div><b>{refreshReport.added?.length ?? 0}</b><small>new</small><b>{refreshReport.removed?.length ?? 0}</b><small>removed</small><b>{refreshReport.fieldChanges?.length ?? refreshReport.bidChanges?.length ?? 0}</b><small>changed</small></div></section>

    <nav className="viewNav" aria-label="Auction workflow views">
      <NavButton active={activeView === "recommended"} number="1" label="Recommended" detail={`${recommendations.length} strongest current options`} onClick={() => setActiveView("recommended")}/>
      <NavButton active={activeView === "matches"} number="2" label="Strategy Matches" detail={`${candidates.length} lots pass your criteria`} onClick={() => setActiveView("matches")}/>
      <NavButton active={activeView === "research"} number="3" label="Research" detail={`${research.length - readyCount} properties under review`} onClick={() => setActiveView("research")}/>
      <NavButton active={activeView === "ready"} number="4" label="Bid Ready" detail={`${readyCount} passed the gate`} onClick={() => setActiveView("ready")}/>
      <NavButton active={activeView === "changes"} number="5" label="Change Inbox" detail={`${changeCount + unacknowledged} source items`} onClick={() => setActiveView("changes")}/>
      <NavButton active={activeView === "all"} number="6" label="All Live Lots" detail={`${catalogData.lotCount} source records`} onClick={() => setActiveView("all")}/>
    </nav>
    <div className="workflowNote"><b>{viewCopy[activeView][0]}</b><span>{viewCopy[activeView][1]}</span></div>

    {(activeView === "recommended" || activeView === "matches") && <>
      <StrategyPanel strategy={strategy} setStrategy={setStrategy} setNumber={setNumber} toggleList={toggleList} countyOptions={countyOptions} categoryOptions={categoryOptions} open={strategyOpen} setOpen={setStrategyOpen} matchCount={candidates.length}/>
      {activeView === "recommended" && <RecommendationSection rows={recommendations} researchKeys={researchKeys} onAdd={addToResearch}/>} 
    </>}
    {activeView === "matches" && <>
      <CatalogSection eyebrow="Generated from your strategy" title="Strategy matches" description="Only lots that pass every active criterion appear here. These are research leads, not bid recommendations." rows={visibleLots.filter((lot) => lot.passes)} total={candidates.length} query={catalogQuery} setQuery={setCatalogQuery} county={catalogCounty} setCounty={setCatalogCounty} category={catalogCategory} setCategory={setCatalogCategory} counties={counties} categories={categoryOptions} researchKeys={researchKeys} onAdd={addToResearch} minScore={strategy.minScore}/>
    </>}
    {activeView === "changes" && <ChangeInbox report={refreshReport} records={research} liveById={liveById} threshold={strategy.bidChangeThreshold} update={updateResearch}/>} 
    {(activeView === "research" || activeView === "ready") && <ResearchQueue records={research.filter((record) => activeView === "ready" ? record.stage === "Bid Ready" : record.stage === "Research")} mode={activeView} liveById={liveById} threshold={strategy.bidChangeThreshold} update={updateResearch} remove={removeResearch}/>} 
    {activeView === "all" && <CatalogSection eyebrow="Refreshable public data" title="All live lots" description="Every current lot, ranked using your strategy. Missing SEV remains unknown—it is never treated as proof of value." rows={visibleLots} total={catalogData.lotCount} query={catalogQuery} setQuery={setCatalogQuery} county={catalogCounty} setCounty={setCatalogCounty} category={catalogCategory} setCategory={setCatalogCategory} counties={counties} categories={categoryOptions} researchKeys={researchKeys} onAdd={addToResearch} minScore={strategy.minScore}/>} 
    <footer><p><b>Decision support only.</b> Tax-sale property is sold as-is. Confirm title, access, zoning, utilities, taxes, assessments, condition and possession independently before bidding.</p><span>Public data: Tax-Sale.info · Notes and bid caps stay on this device unless you export them.</span></footer>
  </main>;
}

function NavButton({ active, number, label, detail, onClick }: { active: boolean; number: string; label: string; detail: string; onClick: () => void }) {
  return <button className={active ? "active" : ""} onClick={onClick}><span>{number}</span><b>{label}</b><small>{detail}</small></button>;
}

function StrategyPanel({ strategy, setStrategy, setNumber, toggleList, countyOptions, categoryOptions, open, setOpen, matchCount }: {
  strategy: Strategy;
  setStrategy: React.Dispatch<React.SetStateAction<Strategy>>;
  setNumber: (key: keyof Strategy, value: string) => void;
  toggleList: (key: "counties" | "categories", value: string) => void;
  countyOptions: string[];
  categoryOptions: string[];
  open: boolean;
  setOpen: React.Dispatch<React.SetStateAction<boolean>>;
  matchCount: number;
}) {
  return <section className="strategyPanel">
    <div className="strategyTitle"><div><span className="eyebrow">Dynamic screening</span><h2>Your auction strategy</h2><p>{matchCount} of {catalogData.lotCount} live lots match. Changes recalculate instantly and remain private on this device.</p></div><div className="strategyActions"><button onClick={() => setStrategy(DEFAULT_STRATEGY)}>Reset</button><button className="primary" onClick={() => setOpen((value) => !value)}>{open ? "Hide criteria" : "Edit criteria"}</button></div></div>
    {open && <div className="strategyBody">
      <Criterion label="Maximum opening bid" value={money(strategy.maxBid)}><input type="range" min="1000" max="100000" step="1000" value={strategy.maxBid} onChange={(event) => setNumber("maxBid", event.target.value)}/></Criterion>
      <Criterion label="Minimum match score" value={String(strategy.minScore)}><input type="range" min="20" max="90" step="5" value={strategy.minScore} onChange={(event) => setNumber("minScore", event.target.value)}/></Criterion>
      <Criterion label="Minimum value proxy" value={`${strategy.minValueMultiple.toFixed(1)}×`} note="Uses 2× SEV ÷ minimum bid only when SEV is available."><input type="range" min="0" max="10" step=".5" value={strategy.minValueMultiple} onChange={(event) => setNumber("minValueMultiple", event.target.value)}/></Criterion>
      <Criterion label="Maximum drive estimate" value={`${strategy.maxDriveHours.toFixed(1)} hr`} note="County-level estimate from Chicago; verify the exact route."><input type="range" min="2.5" max="5" step=".1" value={strategy.maxDriveHours} onChange={(event) => setNumber("maxDriveHours", event.target.value)}/></Criterion>
      <div className="criterion wide"><label>Risk tolerance</label><div className="segmented">{(["Conservative", "Balanced", "Aggressive"] as const).map((value) => <button key={value} className={strategy.riskTolerance === value ? "active" : ""} onClick={() => setStrategy((current) => ({ ...current, riskTolerance: value }))}>{value}</button>)}</div></div>
      <div className="criterion wide"><label>Counties <small>None selected means all</small></label><div className="chips">{countyOptions.map((value) => <button key={value} className={strategy.counties.includes(value) ? "active" : ""} onClick={() => toggleList("counties", value)}>{value}<small>{COUNTY_DRIVE_HOURS[value] ?? "?"}h</small></button>)}</div></div>
      <div className="criterion wide"><label>Property types <small>None selected means all</small></label><div className="chips">{categoryOptions.map((value) => <button key={value} className={strategy.categories.includes(value) ? "active" : ""} onClick={() => toggleList("categories", value)}>{value}</button>)}</div></div>
      <details className="weights"><summary>Scoring and change-alert settings</summary><div>{([
        ["waterfrontWeight", "Water / lake signal"], ["structureWeight", "Structure signal"], ["valueWeight", "Value proxy"], ["lowBidWeight", "Low opening bid"], ["bidChangeThreshold", "Bid-change threshold ($)"],
      ] as Array<[keyof Strategy, string]>).map(([key, label]) => <label key={key}>{label}<input type="number" min="0" max={key === "bidChangeThreshold" ? 10000 : 40} value={strategy[key] as number} onChange={(event) => setNumber(key, event.target.value)}/></label>)}</div></details>
    </div>}
  </section>;
}

function Criterion({ label, value, note, children }: { label: string; value: string; note?: string; children: React.ReactNode }) {
  return <div className="criterion"><label>{label} <b>{value}</b></label>{children}{note && <small>{note}</small>}</div>;
}

function researchLinks(lot: RecommendedLot) {
  const location = lot.latitude && lot.longitude ? `${lot.latitude},${lot.longitude}` : `${lot.address}, ${lot.county} County, Michigan`;
  const search = (query: string) => `https://www.google.com/search?q=${encodeURIComponent(query)}`;
  return {
    map: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location)}`,
    address: search(`"${lot.address}" ${lot.county} Michigan property`),
    parcel: search(`${lot.county} County Michigan parcel "${lot.parcelId}"`),
    comps: search(`"${lot.address}" Michigan sold real estate comparable`),
  };
}

function RecommendationSection({ rows, researchKeys, onAdd }: { rows: RecommendedLot[]; researchKeys: Set<string>; onAdd: (lot: EvaluatedLot) => void }) {
  return <section className="recommendations"><div className="sectionHead"><div><span className="eyebrow">Ranked decision shortlist</span><h2>Recommended properties</h2><p>These are the strongest current leads after strategy fit, catalog evidence, data completeness, and risk language are combined. Open a research brief before promoting one.</p></div><div className="recommendationLegend"><span><i className="legendDot top"/>Top pick</span><span><i className="legendDot strong"/>Strong candidate</span><span><i className="legendDot next"/>Research next</span></div></div>
    <div className="recommendationNotice"><b>Preliminary, not bid-ready.</b><span>The app has screened the catalog and organized the known evidence. Title, condition, value, access, occupancy, and local obligations still require verification.</span></div>
    {rows.length ? <div className="recommendationGrid">{rows.map((lot, index) => <RecommendationCard key={lot.identity} lot={lot} rank={index + 1} inResearch={researchKeys.has(lot.identity)} onAdd={onAdd}/>)}</div> : <div className="emptyQueue"><b>No property currently clears the recommendation threshold.</b><p>Broaden the strategy to see more matches, but do not lower standards solely to fill the list.</p></div>}
  </section>;
}

function RecommendationCard({ lot, rank, inResearch, onAdd }: { lot: RecommendedLot; rank: number; inResearch: boolean; onAdd: (lot: EvaluatedLot) => void }) {
  const links = researchLinks(lot);
  return <article className="recommendationCard"><div className="recommendationCardHead"><span className="recommendationRank">#{rank}</span><div><span className={`recommendationTier ${lot.recommendationTier.toLowerCase().replace(/\s/g, "-")}`}>{lot.recommendationTier}</span><span className={`confidence ${lot.recommendationConfidence.toLowerCase()}`}>{lot.recommendationConfidence} evidence confidence</span></div><div className="recommendationScore"><b>{lot.recommendationScore}</b><small>recommendation</small></div></div>
    <h3><a href={lot.propertyUrl} target="_blank" rel="noreferrer">{lot.address || "Address not listed"} ↗</a></h3><p className="recommendationLocation">{lot.county} County · Lot {lot.lot} · {lot.category}</p>
    <div className="recommendationFacts"><div><span>Opening bid</span><b>{money(lot.minimumBid)}</b></div><div><span>Value proxy</span><b>{lot.valueMultiple ? `${lot.valueMultiple.toFixed(1)}×` : "Unknown"}</b></div><div><span>SEV</span><b>{lot.sev ? money(lot.sev) : "Unknown"}</b></div><div><span>Catalog risk</span><b>{lot.risk}</b></div></div>
    <div className="recommendationEvidence"><div><h4>Why it ranks</h4><ul>{lot.strengths.map((item) => <li key={item}>{item}</li>)}</ul></div><div className="cautions"><h4>What could change the decision</h4><ul>{lot.cautions.map((item) => <li key={item}>{item}</li>)}</ul></div></div>
    <details className="researchBrief"><summary>Open research brief</summary><div className="researchBriefBody"><div><h4>Source description</h4><p>{lot.comment || "No catalog description was provided."}</p></div><div><h4>Research still required</h4><ul>{lot.researchNeeded.map((item) => <li key={item}>{item}</li>)}</ul></div><div className="researchLinks"><a href={lot.propertyUrl} target="_blank" rel="noreferrer">Auction page ↗</a><a href={links.map} target="_blank" rel="noreferrer">Map / satellite ↗</a><a href={links.parcel} target="_blank" rel="noreferrer">Parcel records ↗</a><a href={links.comps} target="_blank" rel="noreferrer">Comparable sales ↗</a><a href={links.address} target="_blank" rel="noreferrer">Address research ↗</a></div></div></details>
    <div className="recommendationFooter"><span>Fit score {lot.dynamicScore} · Parcel {lot.parcelId || "not provided"}</span><button className="promoteButton" disabled={inResearch} onClick={() => onAdd(lot)}>{inResearch ? "In research" : "Add to Research"}</button></div>
  </article>;
}

function CatalogSection(props: {
  eyebrow: string; title: string; description: string; rows: EvaluatedLot[]; total: number;
  query: string; setQuery: (value: string) => void; county: string; setCounty: (value: string) => void;
  category: string; setCategory: (value: string) => void; counties: string[]; categories: string[];
  researchKeys: Set<string>; onAdd: (lot: EvaluatedLot) => void; minScore: number;
}) {
  return <section className="catalog matchesCatalog"><div className="sectionHead"><div><span className="eyebrow">{props.eyebrow}</span><h2>{props.title}</h2><p>{props.description}</p></div><div className="catalogFilters"><input aria-label="Search properties" placeholder="Search address, lot or parcel" value={props.query} onChange={(event) => props.setQuery(event.target.value)}/><select aria-label="Filter by county" value={props.county} onChange={(event) => props.setCounty(event.target.value)}>{props.counties.map((value) => <option key={value}>{value}</option>)}</select><select aria-label="Filter by category" value={props.category} onChange={(event) => props.setCategory(event.target.value)}>{["All", ...props.categories].map((value) => <option key={value}>{value}</option>)}</select></div></div><div className="catalogMeta"><span>Showing <b>{props.rows.length}</b> of {props.total}</span><span>Click an address to open the individual property page.</span></div><LotTable rows={props.rows} minScore={props.minScore} researchKeys={props.researchKeys} onAdd={props.onAdd}/></section>;
}

function LotTable({ rows, minScore, researchKeys, onAdd }: { rows: EvaluatedLot[]; minScore: number; researchKeys: Set<string>; onAdd: (lot: EvaluatedLot) => void }) {
  const [sort, setSort] = useState<{ key: SortKey; direction: "asc" | "desc" }>({ key: "score", direction: "desc" });
  const sortedRows = useMemo(() => [...rows].sort((a, b) => {
    const values: Record<SortKey, [string | number, string | number]> = { status: [Number(a.passes), Number(b.passes)], score: [a.dynamicScore, b.dynamicScore], property: [a.address, b.address], county: [a.county, b.county], category: [a.category, b.category], risk: [a.risk, b.risk], minimumBid: [a.minimumBid, b.minimumBid], valueMultiple: [a.valueMultiple, b.valueMultiple] };
    const [left, right] = values[sort.key];
    const result = typeof left === "number" && typeof right === "number" ? left - right : String(left).localeCompare(String(right), "en-US", { numeric: true, sensitivity: "base" });
    return (sort.direction === "asc" ? result : -result) || a.identity.localeCompare(b.identity);
  }), [rows, sort]);
  const changeSort = (key: SortKey) => setSort((current) => current.key === key ? { key, direction: current.direction === "asc" ? "desc" : "asc" } : { key, direction: ["property", "county", "category", "risk"].includes(key) ? "asc" : "desc" });
  const heading = (key: SortKey, label: string) => <button className="sortButton" onClick={() => changeSort(key)} aria-label={`Sort by ${label}, ${sort.key === key && sort.direction === "asc" ? "descending" : "ascending"}`}>{label}<span aria-hidden="true">{sort.key === key ? (sort.direction === "asc" ? "↑" : "↓") : "↕"}</span></button>;
  return <div className="tableWrap catalogTable"><table><thead><tr><th>{heading("status", "Status")}</th><th>{heading("score", "Score")}</th><th>{heading("property", "Property")}</th><th>{heading("county", "County")}</th><th>{heading("category", "Type")}</th><th>{heading("risk", "Risk")}</th><th>{heading("minimumBid", "Minimum bid")}</th><th>{heading("valueMultiple", "Value proxy")}</th><th>Next step</th></tr></thead><tbody>{sortedRows.length ? sortedRows.map((lot) => <tr key={lot.identity} className={lot.passes ? "matchRow" : ""}><td data-label="Status"><span className={`matchBadge ${lot.passes ? "yes" : "no"}`}>{lot.passes ? "Match" : "Outside"}</span></td><td data-label="Score"><span className={`score ${lot.dynamicScore >= minScore ? "high" : lot.dynamicScore < 40 ? "low" : ""}`}>{lot.dynamicScore}</span></td><td data-label="Property"><a className="propertyLink" href={lot.propertyUrl} target="_blank" rel="noreferrer">{lot.address || "Address not listed"} ↗</a><small>Lot {lot.lot} · {lot.parcelId}</small><small>{lot.reasons.length ? lot.reasons.join(" · ") : "No positive scoring signals"}</small></td><td data-label="County">{lot.county}</td><td data-label="Type">{lot.category}</td><td data-label="Risk"><RiskSummary lot={lot}/></td><td data-label="Minimum bid"><b>{money(lot.minimumBid)}</b></td><td data-label="Value proxy">{lot.valueMultiple ? `${lot.valueMultiple.toFixed(1)}×` : "Unknown"}<small>{lot.sev ? `${money(lot.sev)} SEV` : "SEV unavailable"}</small></td><td data-label="Next step"><button className="promoteButton" disabled={researchKeys.has(lot.identity)} onClick={() => onAdd(lot)}>{researchKeys.has(lot.identity) ? "In research" : "Add to Research"}</button><a className="catalogLink" href={lot.propertyUrl} target="_blank" rel="noreferrer">View property ↗</a></td></tr>) : <tr><td colSpan={9} className="emptyState"><b>No lots match these criteria.</b><small>Raise the maximum bid, lower the score threshold, or broaden counties and property types.</small></td></tr>}</tbody></table></div>;
}

function RiskSummary({ lot }: { lot: EvaluatedLot }) {
  return <>{lot.risk}<small>{lot.riskFlags.length ? lot.riskFlags.map((flag) => flag.category).filter((value, index, all) => all.indexOf(value) === index).join(" · ") : "No catalog-text flags"}</small></>;
}

function ChangeInbox({ report, records, liveById, threshold, update }: { report: RefreshReport; records: ResearchRecord[]; liveById: Map<string, PublicLot>; threshold: number; update: (id: string, patch: Partial<ResearchRecord>) => void }) {
  const reconciliations = records.flatMap((record) => {
    const differences = diffSource(record.sourceSnapshot, liveById.get(record.id), threshold);
    const signature = changeSignature(differences);
    return differences.length && signature !== record.acknowledgedSignature ? [{ record, differences, signature }] : [];
  });
  const publicFieldChanges: NonNullable<RefreshReport["fieldChanges"]> = report.fieldChanges ?? (report.bidChanges ?? []).map((change) => ({ id: change.id, key: change.key, changes: [{ field: "minimumBid", from: change.from, to: change.to }] }));
  const isEmpty = !reconciliations.length && !(report.added?.length) && !(report.removed?.length) && !publicFieldChanges.length;
  return <section className="changeInbox"><div className="sectionHead"><div><span className="eyebrow">Since the prior validated refresh</span><h2>Change inbox</h2><p>Review changes that could invalidate prior screening or diligence. Small bid changes below your {money(threshold)} threshold are suppressed.</p></div></div>{isEmpty && <div className="emptyQueue"><b>No unreviewed changes.</b><p>The current snapshot matches the prior validated refresh and your research records.</p></div>}
    {!!reconciliations.length && <div className="changeGroup"><h3>Your researched properties</h3>{reconciliations.map(({ record, differences, signature }) => <article className="changeItem" key={record.id}><div><b>{record.sourceSnapshot.address}</b><small>{record.sourceSnapshot.county} · Lot {record.sourceSnapshot.lot}</small></div><ul>{differences.map((difference) => <li key={difference.field}><b>{difference.label}</b><span>{String(difference.from)} → {String(difference.to)}</span></li>)}</ul><button onClick={() => update(record.id, { acknowledgedSignature: signature })}>Acknowledge</button></article>)}</div>}
    {!!report.added?.length && <PublicChangeGroup title="New lots" items={report.added}/>} 
    {!!report.removed?.length && <PublicChangeGroup title="Removed lots" items={report.removed}/>} 
    {!!publicFieldChanges.length && <div className="changeGroup"><h3>Changed source records</h3>{publicFieldChanges.map((item, index) => <article className="changeItem compact" key={item.id ?? item.key ?? index}><div><b>{item.address || [item.county, item.lot && `Lot ${item.lot}`].filter(Boolean).join(" · ") || item.id || item.key}</b></div><ul>{item.changes.map((change) => <li key={change.field}><b>{change.field}</b><span>{String(change.from)} → {String(change.to)}</span></li>)}</ul></article>)}</div>}
  </section>;
}

function PublicChangeGroup({ title, items }: { title: string; items: Array<string | { id?: string; key?: string; county?: string; lot?: string; address?: string }> }) {
  return <div className="changeGroup"><h3>{title}</h3><div className="publicChangeList">{items.map((item, index) => <span key={typeof item === "string" ? item : item.id ?? item.key ?? index}>{displayChangeItem(item)}</span>)}</div></div>;
}

function ResearchQueue({ records, mode, liveById, threshold, update, remove }: { records: ResearchRecord[]; mode: "research" | "ready"; liveById: Map<string, PublicLot>; threshold: number; update: (id: string, patch: Partial<ResearchRecord>) => void; remove: (id: string) => void }) {
  return <section className="researchQueue"><div className="sectionHead"><div><span className="eyebrow">Manual decision layer</span><h2>{mode === "ready" ? "Bid-ready properties" : "Research queue"}</h2><p>Catalog facts reconcile automatically. Your notes, checklist, cap, and workflow status remain under your control.</p></div></div>{records.length ? <div className="researchCards">{records.map((record) => <ResearchCard key={record.id} record={record} current={liveById.get(record.id)} threshold={threshold} update={update} remove={remove}/>)}</div> : <div className="emptyQueue"><b>Nothing here yet.</b><p>{mode === "research" ? "Promote a Strategy Match into Research." : "Complete diligence on a researched property to make it Bid Ready."}</p></div>}</section>;
}

function ResearchCard({ record, current, threshold, update, remove }: { record: ResearchRecord; current?: PublicLot; threshold: number; update: (id: string, patch: Partial<ResearchRecord>) => void; remove: (id: string) => void }) {
  const differences = diffSource(record.sourceSnapshot, current, threshold);
  const signature = changeSignature(differences);
  const needsReview = differences.length > 0 && signature !== record.acknowledgedSignature;
  const completed = Object.values(record.checklist).filter(Boolean).length;
  const gatePassed = record.bidCap > 0 && completed === Object.keys(checklistLabels).length && !needsReview && !!current;
  const updateStage = (stage: ResearchStage) => update(record.id, { stage });
  const propertyUrl = current?.propertyUrl || record.sourceSnapshot.propertyUrl || record.sourceSnapshot.catalogUrl;
  return <article className="researchCard"><div className="researchCardHead"><div><div className="recordFlags"><span className={`pill ${record.stage === "Bid Ready" ? "bid" : "conditional"}`}>{record.stage}</span>{!current && <span className="changeFlag removed">Removed from catalog</span>}{needsReview && <span className="changeFlag">Source changed · review inbox</span>}</div><h3><a href={propertyUrl} target="_blank" rel="noreferrer">{current?.address || record.sourceSnapshot.address} ↗</a></h3><small>{record.sourceSnapshot.county} · Lot {record.sourceSnapshot.lot} · {record.sourceSnapshot.parcelId}</small></div><a href={propertyUrl} target="_blank" rel="noreferrer">View property ↗</a></div>
    <div className="researchFields"><label>Maximum bid<input type="number" min="0" step="100" value={record.bidCap || ""} placeholder="Set cap" onChange={(event) => update(record.id, { bidCap: Number(event.target.value) })}/></label><label>Current minimum bid<input disabled value={current ? money(current.minimumBid, true) : "Unavailable"}/></label><label className="notesField">Diligence notes<textarea value={record.notes} placeholder="Record evidence, links, calls, assumptions, and open questions…" onChange={(event) => update(record.id, { notes: event.target.value })}/></label></div>
    <fieldset className="diligenceChecklist"><legend>Diligence gate <span>{completed}/{Object.keys(checklistLabels).length}</span></legend>{(Object.entries(checklistLabels) as Array<[DiligenceKey, string]>).map(([key, label]) => <label key={key}><input type="checkbox" checked={record.checklist[key]} onChange={(event) => update(record.id, { checklist: { ...record.checklist, [key]: event.target.checked } })}/><span>{label}</span></label>)}</fieldset>
    <div className="recordFooter"><span>{record.stage === "Research" ? gatePassed ? "All gates complete." : "Set a cap, complete all checks, and clear source changes." : "Bid Ready is a manual decision—recheck immediately before bidding."}</span><div>{record.stage === "Research" ? <button className="promoteButton" disabled={!gatePassed} onClick={() => updateStage("Bid Ready")}>Mark Bid Ready</button> : <button className="secondaryButton" onClick={() => updateStage("Research")}>Return to Research</button>}<button className="removeButton" onClick={() => remove(record.id)}>Remove</button></div></div>
  </article>;
}
