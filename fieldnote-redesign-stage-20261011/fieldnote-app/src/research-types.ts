/** Read-only release research contract; separate from legacy snapshot/scoring. */
export type ReleasePreset = '7d' | '14d' | '21d' | '1m' | '2m' | '3m' | '1y' | 'custom';
export type ReleaseBasis = 'first_playable' | 'full_release';
export type ResearchPopulation = 'tracked' | 'legacy36' | 'discovery';
export type ResearchMetric = 'players' | 'reviews' | 'reviews7d' | 'reviews30d';
export interface ResearchSelection {
  population: ResearchPopulation; preset: ReleasePreset; basis: ReleaseBasis; metric: ResearchMetric;
  asOf: string; startDate?: string; endDate?: string; snapshot?: string;
}
export interface ResearchWindow {
  version: string; kind: string; timeZone: string; asOf: string;
  startInclusive: string; endExclusive: string; definition: { preset: string; [key: string]: unknown };
}
export interface ObservationSet {
  id: string; metric: string; runId: string; methodVersion: string; scope: string;
  collectedStart: string; collectedEnd: string; rowCount: number;
}
export interface ResearchGenre {
  genre: string; eligibleCount: number; observedCount: number; missingCount: number;
  coveragePercent: number | null; mean: number | null; median: number | null;
  q1: number | null; q3: number | null; iqr: number | null; iqrStatus: string;
  trimmedMean10: number | null; trimmedCountPerTail: number | null; trimmedN: number | null;
  sampleStatus: string; rankable: boolean; largestGameShare: number | null; largestGameShareStatus: string;
  values: { appId: string; value: number }[]; missing: { appId: string; reason: string }[];
  missingReasonCounts: Record<string, number>;
}
export interface ResearchAuditRow {
  appid: number; name: string; genre: string; savedCohort: string;
  appType: string; eligible: boolean; reasons: string[]; releaseDate: string | null;
  legacyDisplayDate: string | null; igdbFirstReleaseDate: string | null;
  evidence: { basis: string; date: string | null; precision: string; verified: boolean; status: string; phase: string | null; source: string; retrievedAt: string; note: string }[];
  observation: { value: number | null; missingReason: string | null; collectedAt: string | null; measuredAt: string | null; sourceUrl: string | null };
}
export interface ReleaseResearchReport {
  version: 'release-research-v1'; mode: 'read_only_saved_evidence'; selection: ResearchSelection;
  releaseWindow: ResearchWindow; reviewWindows: { reviews7d: ResearchWindow; reviews30d: ResearchWindow };
  population: { id: ResearchPopulation; label: string; inventoryCount: number; selectedCount: number; typeEligibleCount: number; typeExcludedCount: number; unresolvedGenreCount: number; missingReleaseEvidenceCount: number; taxonomyVersions: string[]; note: string };
  observations: { selected: ObservationSet | null; available: ObservationSet[]; status: string; note: string };
  cohort: { eligibleCount: number; excludedCount: number; exclusionCounts: Record<string, number>; unclassifiedAppIds: string[] };
  statisticVersion: string; releasePolicyVersion: string; genres: ResearchGenre[]; audit: ResearchAuditRow[];
  notes: string[];
}
