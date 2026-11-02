export type EvidenceStatus = 'observed' | 'reported' | 'calculated' | 'estimated' | 'unknown' | 'unavailable';
export interface Evidence {
  status: EvidenceStatus;
  freshness?: string;
  measuredAt: string | null;
  collectedAt: string | null;
  unit: string;
  methodVersion?: string | null;
}
export interface Metric {
  value: number | null;
  status?: string;
  observedAt?: string | null;
  sourceTimestamp?: string | null;
  sourceUrl?: string | null;
  sourceLabel?: string;
  scope?: string;
  error?: string | null;
  freshness?: string;
  scoreEligible?: boolean;
  refresh?: { runId: string; attemptedAt: string; status: string; reason?: string | null };
  evidence?: Evidence;
}
export interface NamedValue { id: number; name: string; abbreviation?: string }
export interface ReleaseRecord {
  id: number;
  date: string | null;
  displayDate?: string;
  platform?: NamedValue | null;
  region?: { id: number; region: string } | null;
  dateFormat?: { id: number; format: string } | null;
  status?: NamedValue | null;
}
export interface CatalogProvenance {
  sourceProvider: string;
  sourceEntityId: number;
  fieldPath: string;
  sourceUrl: string;
  fetchedAt: string;
  sourceUpdatedAt?: string | null;
  eventOrObservationTime?: string | null;
  unit: string;
  status: string;
  retentionRule?: string;
}
export interface CatalogConflict {
  field: string;
  status: string;
  reason: string;
  comparisonScope?: string;
  chosenSource?: string;
  ruleVersion?: string;
  steam?: { value?: string; sourceUrl?: string; [key: string]: unknown };
  igdb?: { value?: string; sourceUrl?: string; [key: string]: unknown };
}
export interface Catalog {
  status: string;
  reason?: string;
  source?: string;
  sourceId?: number;
  sourceUrl?: string;
  fetchedAt?: string;
  sourceUpdatedAt?: string | null;
  name?: string;
  summary?: string;
  platforms?: NamedValue[];
  developers?: NamedValue[];
  publishers?: NamedValue[];
  companies?: { id: number; company: NamedValue; developer: boolean | null; publisher: boolean | null; supporting: boolean | null; porting: boolean | null; companySourceUrl?: string | null; officialWebsites?: {id:number;url:string;type?:{id:number;type:string}|null;trusted?:boolean|null}[] }[];
  genres?: NamedValue[];
  themes?: NamedValue[];
  keywords?: NamedValue[];
  releaseDates?: ReleaseRecord[];
  firstReleaseDate?: string | null;
  websites?: { id: number; url: string; type?: { id: number; type: string }; trusted?: boolean }[];
  officialWebsites?: { id: number; url: string; type?: { id: number; type: string }; trusted?: boolean }[];
  identity?: {
    status: string;
    ruleVersion: string;
    steamAppid: number;
    steamName: string;
    steamUrl: string;
    steamFetchedAt: string;
    crosswalk: { id: number; uid: string; gameId: number; sourceId: number; sourceName: string; urlValidation: string; url: string; sourceUpdatedAt?: string | null }[];
  };
  provenance?: Record<string, CatalogProvenance>;
  conflicts?: CatalogConflict[];
}
export interface MarketingEvent {
  type: string;
  date: string | null;
  dateKind: string;
  url: string;
  summary: string;
  observedAt: string | null;
  discoveredOn: string | null;
}
export interface Marketing {
  status: string;
  sourceUrl?: string | null;
  sourceLabel?: string;
  organization?: string | null;
  sourceRole?: string | null;
  summary?: string | null;
  observedAt?: string | null;
  events: MarketingEvent[];
  caveats: string[];
  deepProof: boolean;
  associationUrl?: string | null;
  exhaustive: boolean;
}
export interface Game {
  id: string;
  appid: number;
  name: string;
  steamName?: string;
  genre: string;
  cohort: string;
  tags: string[];
  releaseDate: string | null;
  storeUrl: string;
  observedAt: string;
  provenance: { sourceFile: string; sourceUrl: string; sourceType: string; identityVerified: boolean; tagNote: string; cohortNote: string };
  players: Metric;
  reviews: Metric;
  storeReviews: Metric;
  marketing: Marketing;
  unknowns: string[];
  catalog?: Catalog;
}
export interface TimeWindow { start?: string | null; end?: string | null }
export interface SnapshotMeta {
  schemaVersion: string;
  builtAt: string;
  mode: string;
  collectionWindow: TimeWindow;
  tagCollectionWindow?: TimeWindow;
  coverage: { games: number; originalGames: number; supplementGames: number; currentPlayers: number; reviewTotals: number; storeReviewSummaries: number; marketingProfiles: number; deepProofGames: number; eventRecords: number; marketingStatuses: Record<string, number> };
  cohorts: { id: string; label: string; count: number }[];
  sourceFiles: { path: string; sha256: string }[];
  limitations: string[];
  releaseRules: string[];
  metricDefinitions: { name: string; definition: string; exclusions?: string; quality_gate?: string; categories?: string[] }[];
  catalogIntegration?: { status: string; matched: number; unmatched: number; ambiguous: number; quarantined: number; unattempted: number; fieldCoverage: Record<string, number>; conflictCount: number; fetchWindow?: TimeWindow; runId?: string; runStatus?: string };
  steamMetricsIntegration?: {
    status: string; runId: string; runStatus: string; fetchWindow: TimeWindow; scoreWindow?: TimeWindow;
    accepted: { players: number; reviews: number };
    staleCache: { players: number; reviews: number };
    missing: { players: number; reviews: number };
    rejected: { players: number; reviews: number };
    dateProbe?: { accepted: number; rejected: number; note: string; failures?: { appid: number; purpose: string; httpStatus?: number; reason: string }[] };
  };
  steamDateValidation?: {
    status: string; runId: string; runStatus: string; fetchWindow: TimeWindow; targetCount: number; overallVerdict: string;
    completeEnumerations: number; consistentPartitions: number; checksPassed: number; emptyWindows: number; inconclusive: number; unattempted: number;
    acceptedAggregateRequests: number; rejectedAggregateRequests: number; note: string;
    probes: { appid: number; status: string; totalMatching: number | null; completeEnumeration: boolean; partitionMatches: boolean; boundaryExercised: boolean; period?: { start: string; endInclusive: string } }[];
  };
}
export interface FoundationMeta {
  [key: string]: unknown;
}
export interface Snapshot { meta: SnapshotMeta; games: Game[]; genres: string[]; foundation?: FoundationMeta }
export interface GameFilters { query?: string; genre?: string; cohort?: string; sort?: string; direction?: string; tag?: string; [key: string]: string | undefined }
export interface GenreRow {
  genre: string; average: number | null; median: number | null; total: number | null;
  observedCount: number; gameCount: number; observedStart: string | null; observedEnd: string | null;
}
export interface ScoredGenreRow extends GenreRow { signal: number | null; popularityScore: number | null }
export interface TagSummary {
  genre: string; gameCount: number; taggedGameCount: number; matchingGameCount: number;
  classifiedTagCount: number; recurringTagCount: number;
  tags: { tag: string; type: 'mechanic' | 'theme'; count: number; percentage: number }[];
}
export interface Settings {
  preferences: { monthlyBudgetUsd: number; compactTables: boolean; showEvidenceDetails: boolean; updatedAt: string | null };
  usage: { status: 'unknown'; billedUsd: null; measuredAt: null; note: string };
  providers: { id: string; label: string; status: 'unavailable'; connected: false; note: string }[];
  mode: string;
  persistence: string;
}

/** Read-only operational evidence. A saved schedule is not proof of a running scheduler. */
export interface SourceMetricCoverage {
  metric: 'players' | 'reviews' | 'storeReviews' | 'tags';
  label: string;
  total: number;
  supported: number;
  missing: number;
  fresh: number;
  stale: number;
  freshnessUnknown: number;
  sourceMeasurementUnknown: number;
  evidenceStates: Record<EvidenceStatus, number>;
  collectionWindow: TimeWindow;
  sourceMeasurementWindow: TimeWindow;
}
export interface SourceGateDetails {
  label: string;
  allowedHosts: string[];
  officialLinks: { label: string; url: string }[];
  gate: { status: string; note: string };
  retentionNote: string | null;
  collectionNote: string | null;
}
export interface SourceHealthRecord {
  source: string;
  status: string;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastFailureCode: string | null;
  lastErrorCode: string | null;
  details: SourceGateDetails;
}
export interface CollectionJobHealth {
  jobId: string;
  source: string;
  kind: string;
  status: string;
  startedAt: string | null;
  finishedAt: string | null;
  errorCode: string | null;
  nextRunAt: string | null;
  limits: Record<string, number>;
  counters: Record<string, number>;
  checkpoint: Record<string, number | boolean>;
  hasSavedCursor: boolean;
}
export interface CollectionAttemptHealth {
  jobId: string;
  source: string;
  appid: number | null;
  metric: string | null;
  status: string;
  attemptedAt: string | null;
  errorCode: string | null;
}
export interface CollectionScheduleHealth {
  id: string;
  source: string;
  kind: string;
  enabled: boolean;
  intervalHours: number | null;
  watchlistCount: number;
  nextRunAt: string | null;
  expiresAt: string | null;
  expired: boolean;
  limits: Record<string, number>;
}
export interface SourceHealthData {
  schemaVersion: number | null;
  asOf: string;
  mode: 'read_only_saved_collection_state';
  collectionControlsAvailable: false;
  scheduler: { status: 'not_running_in_web_app'; enabledSchedules: number; note: string };
  freshness: { targetHours: number; note: string };
  catalog: {
    totalGames: number;
    unresolvedGames: number;
    taxonomyVersions: string[];
    classificationNote: string;
    igdbCatalogGames: number;
    verifiedCrosswalkGames: number;
    genresBelowMinimum: number;
    minimumPerGenre: number;
    genres: { genre: string; games: number; verifiedCrosswalkGames: number; belowMinimum: boolean }[];
    collectionWindow: TimeWindow;
  };
  coverage: SourceMetricCoverage[];
  sources: SourceHealthRecord[];
  jobs: { total: number; limit: number; items: CollectionJobHealth[] };
  attempts: { total: number; limit: number; items: CollectionAttemptHealth[] };
  schedules: { total: number; limit: number; items: CollectionScheduleHealth[] };
  preservedSnapshot: {
    builtAt: string | null;
    collectionWindow: TimeWindow;
    metricWindow: TimeWindow;
    tagWindow: TimeWindow;
    catalogWindow: TimeWindow;
  };
}
