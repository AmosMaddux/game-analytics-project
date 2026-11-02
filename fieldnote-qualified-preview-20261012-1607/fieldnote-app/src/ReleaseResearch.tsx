import { useEffect, useRef, useState } from 'react';
import type { GameFilters } from './types';
import type { ObservationSet, ReleaseResearchReport, ResearchAuditRow, ResearchGenre, ResearchSelection, ResearchWindow } from './research-types';
import { ExternalLink, PageTitle, Pill, formatNumber, readable, stamp } from './ui';

export const researchPopulations = [['panel', 'Saved research panel'], ['broad', 'Broad saved inventory'], ['tracked', 'All tracked games'], ['legacy36', 'Original 36-game sample'], ['discovery', 'Saved discovery additions']] as const;
export const researchPresets = [['all', 'All release dates'], ['7d', 'Last 7 days'], ['14d', 'Last 14 days'], ['21d', 'Last 21 days'], ['1m', 'Past 1 month (rolling)'], ['2m', 'Past 2 months (rolling)'], ['3m', 'Past 3 months (rolling)'], ['1y', 'Past 1 year (rolling)'], ['custom', 'Custom dates']] as const;
export const researchMetrics = [['players', 'Saved concurrent players'], ['reviews', 'Saved cumulative reviews'], ['reviews7d', 'Reviews in last 7 days'], ['reviews30d', 'Reviews in last 30 days'], ['reviewsCustom', 'Reviews in custom interval']] as const;
export const researchTaxonomies = [['igdb_genre', 'IGDB genres'], ['igdb_theme', 'IGDB themes'], ['steam_tag', 'Saved Steam tags'], ['editorial', 'Legacy editorial genres']] as const;
const taxonomyLabel = (source: string) => researchTaxonomies.find(([id]) => id === source)?.[1] || source;
const metricLabel = (metric: string) => researchMetrics.find(([id]) => id === metric)?.[1] || metric;
const invalidReport = () => new Error('The saved release-research report has an unsupported or inconsistent format.');
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const string = (value: unknown): value is string => typeof value === 'string';
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(string);
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const numberOrNull = (value: unknown) => value === null || typeof value === 'number' && Number.isFinite(value);
const stringOrNull = (value: unknown) => value === null || string(value);
const countMap = (value: unknown) => object(value) && Object.values(value).every(count);
const member = (value: unknown, values: readonly (readonly [string, string])[]) => values.some(([id]) => id === value);

export function isUtcDay(value: unknown): value is string {
  return string(value) && /^\d{4}-\d{2}-\d{2}$/.test(value) && !value.startsWith('0000') && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}
export function isUtcInstant(value: unknown): value is string {
  if (!string(value)) return false;
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?Z$/.exec(value);
  return !!match && isUtcDay(match[1]) && Number(match[2]) < 24 && Number(match[3]) < 60 && Number(match[4]) < 60 && Number.isFinite(Date.parse(value));
}
export function parseResearchCategories(value?: string): string[] {
  if (!value) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { throw new Error('Selected categories are invalid. Clear categories and choose again.'); }
  if (!strings(parsed) || parsed.some(label => !label.trim()) || new Set(parsed).size !== parsed.length) throw new Error('Selected categories must be a list of saved labels. Clear categories and choose again.');
  return [...parsed].sort();
}
export function clearResearchCategories(setFilter: (key: string, value: string) => void) { setFilter('categories', ''); }
export function releaseResearchSelection(params: GameFilters, frozenAsOf: string): ResearchSelection {
  const population = params.population || 'tracked';
  const preset = params.preset || '1m';
  const basis = params.basis || 'first_playable';
  const metric = params.metric || 'players';
  const asOf = params.asOf || frozenAsOf;
  if (!member(population, researchPopulations) || !member(preset, researchPresets) || !member(metric, researchMetrics) || !['first_playable', 'full_release', 'igdb_pc'].includes(basis)) throw new Error('Choose a supported population, release window, release basis and metric.');
  if (!isUtcInstant(asOf)) throw new Error('As-of must be a valid explicit UTC timestamp ending in Z.');
  const selection: ResearchSelection = { population: population as ResearchSelection['population'], preset: preset as ResearchSelection['preset'], basis: basis as ResearchSelection['basis'], metric: metric as ResearchSelection['metric'], asOf: new Date(asOf).toISOString() };
  if (preset === 'custom') {
    if (!isUtcDay(params.startDate) || !isUtcDay(params.endDate)) throw new Error('Choose a valid start date and end date for the custom release window.');
    if (params.startDate > params.endDate) throw new Error('The custom start date must be on or before the end date.');
    selection.startDate = params.startDate; selection.endDate = params.endDate;
  }
  if (params.snapshot) selection.snapshot = params.snapshot;
  if (params.taxonomy) {
    if (!member(params.taxonomy, researchTaxonomies)) throw new Error('Choose a supported category source.');
    selection.taxonomy = params.taxonomy as ResearchSelection['taxonomy'];
  }
  if (params.categoryMatch) {
    if (!['any', 'all'].includes(params.categoryMatch)) throw new Error('Category matching must use ANY or ALL.');
    selection.categoryMatch = params.categoryMatch as ResearchSelection['categoryMatch'];
  }
  if (params.categories) selection.categories = JSON.stringify(parseResearchCategories(params.categories));
  if (params.reviewAsOf) {
    if (!isUtcInstant(params.reviewAsOf)) throw new Error('Review as-of must be a valid explicit UTC timestamp ending in Z.');
    if (Date.parse(params.reviewAsOf) > Date.parse(asOf)) throw new Error('Review as-of cannot be later than the evidence as-of cutoff.');
    selection.reviewAsOf = new Date(params.reviewAsOf).toISOString();
  }
  if (metric === 'reviewsCustom') {
    if (!isUtcDay(params.reviewStartDate) || !isUtcDay(params.reviewEndDate)) throw new Error('Choose a valid start date and end date for the custom review interval.');
    if (params.reviewStartDate > params.reviewEndDate) throw new Error('The custom review start date must be on or before the end date.');
    if (Date.parse(`${params.reviewEndDate}T00:00:00Z`) + 86_400_000 > Date.parse(asOf)) throw new Error('The custom review interval must end no later than the evidence as-of cutoff. Choose a completed UTC day.');
    selection.reviewStartDate = params.reviewStartDate; selection.reviewEndDate = params.reviewEndDate;
  }
  return selection;
}
export function buildReleaseResearchQuery(params: GameFilters, frozenAsOf: string): string {
  return new URLSearchParams(Object.entries(releaseResearchSelection(params, frozenAsOf))).toString();
}
export function changeResearchFilter(setFilter: (key: string, value: string) => void, key: string, value: string) {
  if (['metric', 'asOf', 'reviewAsOf', 'reviewStartDate', 'reviewEndDate'].includes(key)) setFilter('snapshot', '');
  if (key === 'taxonomy') clearResearchCategories(setFilter);
  setFilter(key, value);
}
function validWindow(value: unknown, kind: string): value is ResearchWindow {
  return object(value) && string(value.version) && value.kind === kind && value.timeZone === 'UTC' && isUtcInstant(value.asOf) && isUtcInstant(value.startInclusive) && isUtcInstant(value.endExclusive) && Date.parse(value.startInclusive) < Date.parse(value.endExclusive) && object(value.definition);
}
function validObservationSet(value: unknown): value is ObservationSet {
  return object(value) && ['id', 'metric', 'runId', 'methodVersion', 'scope'].every(key => string(value[key])) && isUtcInstant(value.collectedStart) && isUtcInstant(value.collectedEnd) && Date.parse(value.collectedStart) <= Date.parse(value.collectedEnd) && count(value.rowCount) && (value.windowStart === undefined && value.windowEndExclusive === undefined || isUtcInstant(value.windowStart) && isUtcInstant(value.windowEndExclusive) && Date.parse(value.windowStart) < Date.parse(value.windowEndExclusive));
}
/** Reject malformed nested data before it can be rendered or mistaken for evidence. */
export function assertReleaseResearch(value: unknown): asserts value is ReleaseResearchReport {
  if (!object(value) || value.version !== 'release-research-v1' || value.mode !== 'read_only_saved_evidence' || !object(value.selection)) throw invalidReport();
  const selection = value.selection;
  if (['taxonomy', 'categories', 'categoryMatch', 'reviewAsOf', 'reviewStartDate', 'reviewEndDate'].some(key => selection[key] !== undefined && !string(selection[key]))) throw invalidReport();
  try { releaseResearchSelection(selection as GameFilters, ''); } catch { throw invalidReport(); }
  if (!member(selection.population, researchPopulations) || !member(selection.preset, researchPresets) || !member(selection.metric, researchMetrics) || !['first_playable', 'full_release', 'igdb_pc'].includes(String(selection.basis)) || !isUtcInstant(selection.asOf) || selection.snapshot !== undefined && !string(selection.snapshot)) throw invalidReport();
  if (!validWindow(value.releaseWindow, 'release_cohort') || !object(value.reviewWindows) || !validWindow(value.reviewWindows.reviews7d, 'review_activity') || !validWindow(value.reviewWindows.reviews30d, 'review_activity')) throw invalidReport();
  if (Date.parse(value.releaseWindow.asOf) !== Date.parse(selection.asOf as string) || [value.reviewWindows.reviews7d, value.reviewWindows.reviews30d].some(window => Date.parse(window.asOf) !== Date.parse((selection.reviewAsOf || selection.asOf) as string))) throw invalidReport();
  const reviewEnd = Date.parse((selection.reviewAsOf || selection.asOf) as string);
  for (const [key, days] of [['reviews7d', 7], ['reviews30d', 30]] as const) {
    const window = value.reviewWindows[key] as ResearchWindow;
    if (Date.parse(window.endExclusive) !== reviewEnd || Date.parse(window.startInclusive) !== reviewEnd - days * 86_400_000) throw invalidReport();
  }
  const population = value.population; const observations = value.observations; const cohort = value.cohort;
  if (!object(population) || population.id !== selection.population || !string(population.label) || !string(population.note) || !strings(population.taxonomyVersions) || !['inventoryCount', 'selectedCount', 'typeEligibleCount', 'typeExcludedCount', 'unresolvedGenreCount', 'missingReleaseEvidenceCount'].every(key => count(population[key]))) throw invalidReport();
  if (Number(population.typeEligibleCount) + Number(population.typeExcludedCount) !== population.selectedCount || Number(population.selectedCount) > Number(population.inventoryCount)) throw invalidReport();
  if (!object(observations) || !string(observations.status) || !string(observations.note) || !Array.isArray(observations.available) || !observations.available.every(validObservationSet) || observations.selected !== null && !validObservationSet(observations.selected)) throw invalidReport();
  if (new Set(observations.available.map(set => set.id)).size !== observations.available.length || observations.available.some(set => set.metric !== selection.metric)) throw invalidReport();
  const selectedObservation = observations.selected;
  if (observations.selected !== null && (!observations.available.some(set => set.id === selectedObservation?.id) || observations.selected.metric !== selection.metric || selection.snapshot !== undefined && observations.selected.id !== selection.snapshot) || observations.selected === null && selection.snapshot !== undefined) throw invalidReport();
  if (!object(cohort) || !count(cohort.eligibleCount) || !count(cohort.excludedCount) || !countMap(cohort.exclusionCounts) || !strings(cohort.unclassifiedAppIds) || cohort.eligibleCount + cohort.excludedCount !== population.selectedCount) throw invalidReport();
  if (!string(value.statisticVersion) || !string(value.releasePolicyVersion) || !strings(value.notes) || !Array.isArray(value.genres) || !Array.isArray(value.audit)) throw invalidReport();
  const genreNames = new Set<string>();
  for (const genre of value.genres) {
    if (!object(genre) || !string(genre.genre) || genreNames.has(genre.genre) || !['eligibleCount', 'observedCount', 'missingCount'].every(key => count(genre[key])) || Number(genre.observedCount) + Number(genre.missingCount) !== genre.eligibleCount || !['coveragePercent', 'mean', 'median', 'q1', 'q3', 'iqr', 'trimmedMean10', 'trimmedCountPerTail', 'trimmedN', 'largestGameShare'].every(key => numberOrNull(genre[key])) || !['iqrStatus', 'sampleStatus', 'largestGameShareStatus'].every(key => string(genre[key])) || typeof genre.rankable !== 'boolean' || !countMap(genre.missingReasonCounts) || !Array.isArray(genre.values) || !Array.isArray(genre.missing)) throw invalidReport();
    if (genre.values.some(row => !object(row) || !string(row.appId) || typeof row.value !== 'number' || !Number.isFinite(row.value)) || genre.missing.some(row => !object(row) || !string(row.appId) || !string(row.reason)) || genre.values.length !== genre.observedCount || genre.missing.length !== genre.missingCount) throw invalidReport();
    if (genre.coveragePercent !== null && (Number(genre.coveragePercent) < 0 || Number(genre.coveragePercent) > 100) || genre.largestGameShare !== null && (Number(genre.largestGameShare) < 0 || Number(genre.largestGameShare) > 1)) throw invalidReport();
    genreNames.add(genre.genre);
  }
  const ids = new Set<number>();
  for (const row of value.audit) {
    if (!object(row) || !count(row.appid) || row.appid === 0 || ids.has(row.appid) || !['name', 'genre', 'savedCohort', 'appType'].every(key => string(row[key])) || typeof row.eligible !== 'boolean' || !strings(row.reasons) || !['releaseDate', 'legacyDisplayDate', 'igdbFirstReleaseDate'].every(key => stringOrNull(row[key])) || !Array.isArray(row.evidence) || !object(row.observation)) throw invalidReport();
    for (const evidence of row.evidence) if (!object(evidence) || !['basis', 'precision', 'status', 'source', 'retrievedAt', 'note'].every(key => string(evidence[key])) || !stringOrNull(evidence.date) || !stringOrNull(evidence.phase) || typeof evidence.verified !== 'boolean') throw invalidReport();
    const observation = row.observation;
    if (!numberOrNull(observation.value) || !['missingReason', 'collectedAt', 'measuredAt', 'sourceUrl'].every(key => stringOrNull(observation[key]))) throw invalidReport();
    ids.add(row.appid);
  }
  if (value.audit.length !== population.selectedCount) throw invalidReport();
  assertExtendedResearch(value);
}
function assertExtendedResearch(report: Record<string, unknown>) {
  const selection = report.selection as Record<string, unknown>;
  const population = report.population as Record<string, unknown>;
  const taxonomy = report.taxonomy;
  if (taxonomy !== undefined) {
    if (!object(taxonomy) || !member(taxonomy.source, researchTaxonomies) || taxonomy.source !== (selection.taxonomy || 'editorial') || !['label', 'version', 'note'].every(key => string(taxonomy[key])) || !strings(taxonomy.selected) || new Set(taxonomy.selected).size !== taxonomy.selected.length || !['any', 'all'].includes(String(taxonomy.match)) || taxonomy.match !== (selection.categoryMatch || 'any') || !count(taxonomy.coveredCount) || !count(taxonomy.missingCount) || taxonomy.coveredCount + taxonomy.missingCount !== population.selectedCount || !Array.isArray(taxonomy.available)) throw invalidReport();
    const expected = parseResearchCategories(selection.categories as string | undefined);
    const selected = taxonomy.selected;
    if (expected.length !== selected.length || expected.some(label => !selected.includes(label))) throw invalidReport();
    const names = new Set<string>();
    for (const item of taxonomy.available) {
      if (!object(item) || !string(item.name) || !item.name.trim() || names.has(item.name) || !count(item.populationCount) || !count(item.cohortCount) || item.cohortCount > item.populationCount || item.populationCount > Number(population.selectedCount)) throw invalidReport();
      names.add(item.name);
    }
    if (taxonomy.selected.some(label => !names.has(label))) throw invalidReport();
  }
  for (const value of report.audit as Record<string, unknown>[]) {
    if (value.categories !== undefined && (!strings(value.categories) || value.categories.some(label => !label.trim()) || new Set(value.categories).size !== value.categories.length)) throw invalidReport();
    if (value.categoryEvidence !== undefined) {
      if (!Array.isArray(value.categoryEvidence)) throw invalidReport();
      for (const evidence of value.categoryEvidence) if (!object(evidence) || !string(evidence.name) || !string(evidence.method) || !(evidence.sourceId === null || count(evidence.sourceId)) || !stringOrNull(evidence.sourceUrl) || !(evidence.collectedAt === null || isUtcInstant(evidence.collectedAt))) throw invalidReport();
    }
    if (value.pcReleaseEvidence !== undefined) {
      if (!Array.isArray(value.pcReleaseEvidence)) throw invalidReport();
      for (const evidence of value.pcReleaseEvidence) {
        if (!object(evidence) || !count(evidence.sourceId) || !string(evidence.precision) || !['date', 'region', 'status', 'sourceUrl'].every(key => stringOrNull(evidence[key])) || !(evidence.collectedAt === null || isUtcInstant(evidence.collectedAt))) throw invalidReport();
        if (evidence.dateFormat !== undefined && evidence.dateFormat !== null && (!object(evidence.dateFormat) || !count(evidence.dateFormat.id) || evidence.dateFormat.format !== undefined && !stringOrNull(evidence.dateFormat.format))) throw invalidReport();
        if (evidence.year !== undefined && evidence.year !== null && (!count(evidence.year) || evidence.year < 1 || evidence.year > 9999) || evidence.month !== undefined && evidence.month !== null && (!count(evidence.month) || evidence.month < 1 || evidence.month > 12)) throw invalidReport();
      }
    }
  }
  const panel = report.panel;
  if (panel !== undefined) {
    if (!object(panel) || !['id', 'policyVersion'].every(key => stringOrNull(panel[key])) || !['label', 'note'].every(key => string(panel[key])) || !(panel.createdAt === null || isUtcInstant(panel.createdAt)) || panel.targetCount !== 300 || !count(panel.selectedCount) || !count(panel.shortfallCount) || panel.selectedCount + panel.shortfallCount !== panel.targetCount || !Array.isArray(panel.groups)) throw invalidReport();
    for (const key of ['cohortCutoff', 'evidenceAsOf'] as const) {
      const cutoff = panel[key];
      if (cutoff !== undefined && cutoff !== null && (!isUtcInstant(cutoff) || Date.parse(cutoff) > Date.parse(selection.asOf as string))) throw invalidReport();
    }
    if (string(panel.cohortCutoff) && string(panel.evidenceAsOf) && Date.parse(panel.cohortCutoff) > Date.parse(panel.evidenceAsOf)) throw invalidReport();
    if (panel.qualificationTemporalScope !== undefined && !stringOrNull(panel.qualificationTemporalScope)) throw invalidReport();
    for (const group of panel.groups) if (!object(group) || !string(group.id) || !['target', 'selected', 'shortfall'].every(key => count(group[key])) || Number(group.selected) + Number(group.shortfall) !== group.target) throw invalidReport();
  }
  const review = report.reviewActivity;
  if (review !== undefined) {
    if (!object(review) || !string(review.status) || !string(review.note) || !strings(review.savedAnchors) || !review.savedAnchors.every(anchor => isUtcInstant(anchor) && Date.parse(anchor) <= Date.parse(selection.asOf as string)) || new Set(review.savedAnchors).size !== review.savedAnchors.length || review.window !== null && !validWindow(review.window, 'review_activity')) throw invalidReport();
    if (review.window !== null && Date.parse((review.window as ResearchWindow).asOf) !== Date.parse((selection.metric === 'reviewsCustom' ? selection.asOf : selection.reviewAsOf || selection.asOf) as string)) throw invalidReport();
    if (review.window !== null) {
      const window = review.window as ResearchWindow;
      const expected = selection.metric === 'reviews7d' || selection.metric === 'reviews30d' ? (report.reviewWindows as Record<string, ResearchWindow>)[selection.metric] : null;
      if (expected && (window.startInclusive !== expected.startInclusive || window.endExclusive !== expected.endExclusive)) throw invalidReport();
      if (selection.metric === 'reviewsCustom' && (Date.parse(window.startInclusive) !== Date.parse(`${selection.reviewStartDate}T00:00:00Z`) || Date.parse(window.endExclusive) !== Date.parse(`${selection.reviewEndDate}T00:00:00Z`) + 86_400_000)) throw invalidReport();
      const selected = (report.observations as { selected: ObservationSet | null }).selected;
      if (selected && (selected.windowStart !== window.startInclusive || selected.windowEndExclusive !== window.endExclusive)) throw invalidReport();
    }
  }
}
export type ResearchSortDirection = 'asc' | 'desc';
export type CategorySort = 'genre' | 'eligibleCount' | 'observedCount' | 'coveragePercent' | 'median' | 'mean' | 'iqr' | 'trimmedMean10' | 'largestGameShare';
export type GameSort = 'name' | 'appid' | 'releaseDate' | 'value' | 'eligible';
function compareResearchValues(left: number | string | boolean | null, right: number | string | boolean | null, direction: ResearchSortDirection) {
  if (left === null || right === null) return left === right ? 0 : left === null ? 1 : -1;
  const result = typeof left === 'string' && typeof right === 'string' ? left.localeCompare(right, 'en', { numeric: true }) : Number(left) - Number(right);
  return direction === 'asc' ? result : -result;
}
export function sortResearchCategories(rows: ResearchGenre[], key: CategorySort, direction: ResearchSortDirection) {
  return [...rows].sort((a, b) => compareResearchValues(a[key], b[key], direction) || a.genre.localeCompare(b.genre));
}
export function sortResearchGames(rows: ResearchAuditRow[], key: GameSort, direction: ResearchSortDirection, includedOnly = false) {
  return rows.filter(row => !includedOnly || row.eligible).sort((a, b) => compareResearchValues(key === 'value' ? a.observation.value : a[key], key === 'value' ? b.observation.value : b[key], direction) || a.name.localeCompare(b.name) || a.appid - b.appid);
}
export function researchRowCategories(row: ResearchAuditRow, taxonomy: string) {
  if (row.categories !== undefined) return row.categories;
  return taxonomy === 'editorial' && row.genre && row.genre !== 'Unresolved / needs review' ? [row.genre] : [];
}
function RawCategoryEvidence({ row, taxonomy }: { row: ResearchAuditRow; taxonomy: string }) {
  const categories = researchRowCategories(row, taxonomy);
  return <div className="research-release-evidence"><h3>Raw category &amp; PC metadata</h3><dl className="identity-grid"><dt>Selected category source</dt><dd>{taxonomyLabel(taxonomy)}</dd><dt>Saved labels</dt><dd>{categories.length ? categories.join(' · ') : `No saved ${taxonomyLabel(taxonomy)} labels`}</dd><dt>Legacy editorial assignment</dt><dd>{row.genre || 'Unresolved editorial genre'} · separate editorial reference</dd></dl>
    {!row.categoryEvidence?.length ? <p>No saved source/category provenance for this taxonomy. Missing source labels are never replaced with editorial genres.</p> : <div className="research-source-list">{row.categoryEvidence.map((evidence, index) => <article key={`${evidence.name}:${index}`}><b>{evidence.name}</b><dl className="identity-grid"><dt>Source ID</dt><dd>{evidence.sourceId ?? 'Not captured'}</dd><dt>Collected / method</dt><dd>{stamp(evidence.collectedAt)} / {evidence.method || 'Not captured'}</dd><dt>Source</dt><dd><ExternalLink url={evidence.sourceUrl}>Category source</ExternalLink><span className="research-source-text">{evidence.sourceUrl || 'Source URL not captured'}</span></dd></dl></article>)}</div>}
    <h3>IGDB-reported PC release records</h3><p>Platform-specific source records. They do not verify a Steam launch or full release.</p>{!row.pcReleaseEvidence?.length ? <p>No saved IGDB PC release records.</p> : row.pcReleaseEvidence.map((evidence, index) => <article key={`${evidence.sourceId}:${index}`}><dl className="identity-grid"><dt>Source record ID</dt><dd>{evidence.sourceId}</dd><dt>Reported date / precision</dt><dd>{evidence.date || 'Not captured'} / {readable(evidence.precision)}</dd><dt>Source date format</dt><dd>{evidence.dateFormat ? `${evidence.dateFormat.id} · ${evidence.dateFormat.format || 'Format name not captured'}` : 'Not captured'}</dd><dt>Source year / month</dt><dd>{evidence.year ?? 'Not captured'} / {evidence.month ?? 'Not captured'}</dd><dt>Region / status</dt><dd>{evidence.region || 'Not captured'} / {evidence.status || 'Not captured'}</dd><dt>Collected</dt><dd>{stamp(evidence.collectedAt)}</dd><dt>Source</dt><dd><ExternalLink url={evidence.sourceUrl}>IGDB PC release source</ExternalLink><span className="research-source-text">{evidence.sourceUrl || 'Source URL not captured'}</span></dd></dl></article>)}
  </div>;
}

export function assertResearchSelection(report: ReleaseResearchReport, query: string) {
  const requested = new URLSearchParams(query);
  for (const key of ['population', 'preset', 'basis', 'metric', 'asOf', 'startDate', 'endDate', 'snapshot', 'taxonomy', 'categories', 'categoryMatch', 'reviewAsOf', 'reviewStartDate', 'reviewEndDate'] as const) {
    const expected = requested.get(key);
    if (expected !== null && report.selection[key] !== expected) throw new Error('The saved report does not match the selected filters. Reload the report to try again.');
  }
}
export async function fetchReleaseResearch(query: string, signal: AbortSignal, request: typeof fetch = fetch): Promise<ReleaseResearchReport> {
  const response = await request(`/api/research/releases?${query}`, { signal, headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(response.status === 400 ? 'The selected filters or observation snapshot are unavailable. Adjust the selection and try again.' : 'The saved release-research report could not be read. Check the local server and database migrations.');
  const value: unknown = await response.json();
  assertReleaseResearch(value); assertResearchSelection(value, query);
  return value;
}
const valueText = (value: number | null) => value === null ? 'Unavailable' : formatNumber(value, 2);
const percent = (value: number | null) => value === null ? 'Unavailable' : `${formatNumber(value, 1)}%`;
function WindowBounds({ window }: { window: ResearchWindow }) {
  return <dl className="research-window-bounds"><dt>Start, included</dt><dd><time dateTime={window.startInclusive}>{stamp(window.startInclusive)}</time></dd><dt>End, excluded</dt><dd><time dateTime={window.endExclusive}>{stamp(window.endExclusive)}</time></dd></dl>;
}
function ResearchObservation({ observation }: { observation: ReleaseResearchReport['audit'][number]['observation'] }) {
  return <><strong className={observation.value === null ? 'research-missing' : 'research-observed'}>{observation.value === null ? 'Missing' : valueText(observation.value)}</strong><span>{observation.value === null ? readable(observation.missingReason || 'no_supported_observation') : 'Saved observation'}</span><small>Collected: {stamp(observation.collectedAt)}<br/>Measured: {stamp(observation.measuredAt)}</small><ExternalLink url={observation.sourceUrl}>Observation source</ExternalLink></>;
}
export function ReleaseResearchView({ report }: { report: ReleaseResearchReport }) {
  const { population, cohort, observations, selection } = report;
  const taxonomy = report.taxonomy?.source || selection.taxonomy || 'editorial';
  const [categorySort, setCategorySort] = useState<CategorySort>('genre');
  const [categoryDirection, setCategoryDirection] = useState<ResearchSortDirection>('asc');
  const [gameSort, setGameSort] = useState<GameSort>('name');
  const [gameDirection, setGameDirection] = useState<ResearchSortDirection>('asc');
  const [includedOnly, setIncludedOnly] = useState(false);
  const categoryRows = sortResearchCategories(report.genres, categorySort, categoryDirection);
  const auditRows = sortResearchGames(report.audit, gameSort, gameDirection, includedOnly);
  const pcBasis = selection.basis === 'igdb_pc';
  const noVerifiedDates = population.selectedCount > 0 && population.missingReleaseEvidenceCount === population.selectedCount;
  return <div className="release-research-report">
    <div className="status-banner"><div><h2>Release cohorts from saved evidence</h2><p>Descriptive research within {population.label.toLowerCase()}. This is a selected catalog sample, not the whole Steam market. Opening this page never contacts a provider or starts collection.</p></div><Pill kind="outline">READ-ONLY</Pill></div>
    <section className="research-denominators" aria-label="Population and cohort denominators">
      <article className="panel"><span className="eyebrow">SELECTED POPULATION</span><strong>{formatNumber(population.selectedCount, 0)}</strong><p>{population.label}</p><small>of {formatNumber(population.inventoryCount, 0)} tracked applications</small></article>
      <article className="panel"><span className="eyebrow">{pcBasis ? 'SOURCE-REPORTED GAME TYPE' : 'VERIFIED GAME TYPE'}</span><strong>{formatNumber(population.typeEligibleCount, 0)}<small> / {formatNumber(population.selectedCount, 0)}</small></strong><p>{pcBasis ? 'IGDB-reported PC game eligibility' : 'Strict Steam game eligibility'}</p><small>{formatNumber(population.typeExcludedCount, 0)} unknown or excluded application types</small></article>
      <article className="panel"><span className="eyebrow">RELEASE COHORT</span><strong>{formatNumber(cohort.eligibleCount, 0)}<small> / {formatNumber(population.selectedCount, 0)}</small></strong><p>Eligible in the release window</p><small>{formatNumber(cohort.excludedCount, 0)} excluded from this cohort</small></article>
      <article className="panel"><span className="eyebrow">MISSING RELEASE EVIDENCE</span><strong>{formatNumber(population.missingReleaseEvidenceCount, 0)}</strong><p>For the selected release basis</p><small>{report.taxonomy ? `${report.taxonomy.missingCount} applications without saved ${report.taxonomy.label}` : `${population.unresolvedGenreCount} unresolved genre mappings in population`}</small></article>
    </section>
    <p className="research-context">{population.note}</p>
    {report.panel && <section className="panel research-panel-summary" aria-label="Saved panel membership"><div className="section-heading"><h2>{report.panel.label}</h2><Pill kind={report.panel.shortfallCount ? 'amber' : 'neutral'}>{report.panel.selectedCount} / {report.panel.targetCount} SAVED</Pill></div><p>{report.panel.note}</p><p>{report.panel.shortfallCount} slots unfilled · Policy: {report.panel.policyVersion || 'Not recorded'} · Saved: {stamp(report.panel.createdAt)}</p>{(report.panel.cohortCutoff !== undefined || report.panel.evidenceAsOf !== undefined || report.panel.qualificationTemporalScope !== undefined) && <><dl className="identity-grid"><dt>Release / cohort cutoff</dt><dd>{report.panel.cohortCutoff ? <time dateTime={report.panel.cohortCutoff}>{report.panel.cohortCutoff}</time> : 'Not recorded'}</dd><dt>Evidence cutoff</dt><dd>{report.panel.evidenceAsOf ? <time dateTime={report.panel.evidenceAsOf}>{report.panel.evidenceAsOf}</time> : 'Not recorded'}</dd></dl><p>{report.panel.qualificationTemporalScope === 'multi_batch_observations_not_instantaneous_snapshot' ? 'Qualification observations span multiple collection batches; original times are retained.' : report.panel.qualificationTemporalScope ? `Qualification temporal scope: ${readable(report.panel.qualificationTemporalScope)}.` : 'Qualification temporal scope: Not recorded.'}</p></>}{report.panel.groups.length > 0 && <ul className="research-panel-groups">{report.panel.groups.map(group => <li key={group.id}><span>{readable(group.id)}</span><b>{group.selected} / {group.target}</b><small>{group.shortfall} unfilled</small></li>)}</ul>}</section>}
    {report.taxonomy && <p className="research-context">Category source: <b>{report.taxonomy.label}</b> · {report.taxonomy.coveredCount} with saved labels · {report.taxonomy.missingCount} missing. {report.taxonomy.note} Multi-label categories overlap; category counts must not be added together as unique games.</p>}
    <section className="research-windows" aria-label="Release and review measurement windows">
      <article className="panel research-window"><span className="eyebrow">RELEASE COHORT WINDOW</span><h2>{pcBasis ? 'IGDB-reported PC release' : selection.basis === 'full_release' ? 'Full release' : 'First playable release'}</h2><WindowBounds window={report.releaseWindow}/><p>{pcBasis ? 'Uses saved platform-specific IGDB PC release records. This does not establish first Steam playability or Steam 1.0.' : selection.basis === 'first_playable' ? 'Includes a verified Early Access launch when it is the first playable Steam release.' : 'Requires verified full-release evidence; an Early Access launch alone does not qualify.'}</p><p>{pcBasis ? 'Only qualifying saved IGDB PC date records enter this source-reported cohort.' : 'Only verified, released, day-precision Steam dates qualify.'} A day is interpreted at 00:00:00 UTC. The start is inclusive and the end is exclusive. Rolling windows preserve the as-of time; a release dated on the start day is excluded when that start is later than midnight. Custom dates include both selected days.</p></article>
      <article className="panel research-window"><span className="eyebrow">REVIEW MEASUREMENT WINDOWS</span><h2>Separate from release dates</h2><h3>Last 7 days</h3><WindowBounds window={report.reviewWindows.reviews7d}/><h3>Last 30 days</h3><WindowBounds window={report.reviewWindows.reviews30d}/><p>These intervals measure review activity, not which games were released. Seven-, 30-day and custom review activity is unavailable without full source validation and comparable saved observations; cumulative reviews are not a substitute.</p>{report.reviewActivity && <><h3>Selected review interval</h3>{report.reviewActivity.window ? <WindowBounds window={report.reviewActivity.window}/> : <p>No review-activity interval selected.</p>}<Pill kind={report.reviewActivity.status === 'available' ? 'neutral' : 'amber'}>{readable(report.reviewActivity.status)}</Pill><p>{report.reviewActivity.note}</p><p>Review as-of: {stamp(selection.reviewAsOf || selection.asOf)}. The release cutoff remains {stamp(selection.asOf)}.</p></>}</article>
    </section>
    <section className="panel research-evidence" aria-labelledby="research-observations-title"><div className="section-heading"><h2 id="research-observations-title">{metricLabel(selection.metric)}</h2><Pill kind={observations.selected ? 'neutral' : 'amber'}>{readable(observations.status)}</Pill></div><p>{observations.note}</p>{observations.selected ? <dl className="identity-grid"><dt>Saved observation set</dt><dd>{observations.selected.id}</dd><dt>Collection span</dt><dd>{stamp(observations.selected.collectedStart)} to {stamp(observations.selected.collectedEnd)}</dd><dt>Comparable scope</dt><dd>{observations.selected.scope}</dd><dt>Run / method</dt><dd>{observations.selected.runId} / {observations.selected.methodVersion}</dd>{observations.selected.windowStart && observations.selected.windowEndExclusive && <><dt>Saved interval, exact</dt><dd>{stamp(observations.selected.windowStart)} to {stamp(observations.selected.windowEndExclusive)} · [start, end)</dd></>}<dt>Saved rows in set</dt><dd>{observations.selected.rowCount} · before population and cohort exclusions</dd></dl> : <p className="notice-copy">No comparable saved observation set is available for this selection. Missing values remain missing.</p>}<p className="fineprint">As-of: <time dateTime={selection.asOf}>{stamp(selection.asOf)}</time>. This freezes the research cutoff; it is not a provider refresh or a simultaneous live measurement.</p></section>
    <section className="panel research-exclusions" aria-labelledby="research-exclusions-title"><h2 id="research-exclusions-title">Cohort exclusions</h2>{Object.keys(cohort.exclusionCounts).length ? <ul>{Object.entries(cohort.exclusionCounts).map(([reason, total]) => <li key={reason}><span>{readable(reason)}</span><strong>{total}</strong></li>)}</ul> : <p>No exclusions are recorded for this selection.</p>}<p className="fineprint">Each excluded application is omitted from cohort statistics. Per-app audit below preserves every recorded exclusion reason. Unknown application types, demos, DLC, soundtracks and tools do not qualify as verified games.</p></section>
    {!cohort.eligibleCount && <section className="panel research-empty" role="status"><span className="eyebrow">EVIDENCE GAP</span><h2>{!population.selectedCount ? 'No saved applications in this population' : noVerifiedDates ? pcBasis ? 'No qualifying saved IGDB PC release dates' : 'No verified Steam release dates' : 'No eligible games in this release window'}</h2><p>{noVerifiedDates ? pcBasis ? 'The selected population has no qualifying saved IGDB PC release-date evidence. Cohort aggregates are unavailable until source-specific eligibility requirements are met.' : 'The selected population has no verified release-date evidence for this basis. Cohort aggregates are unavailable until both application type and release evidence qualify.' : 'There are no eligible games to summarize for the selected population, release basis and dates.'}</p><p>General IGDB first-release dates and legacy store display dates are reference only. Neither is promoted to verified Steam release evidence. The IGDB PC basis uses separately saved platform-specific release records.</p></section>}
    {cohort.eligibleCount > 0 && <section className="panel research-statistics" aria-labelledby="research-statistics-title"><div className="section-heading"><h2 id="research-statistics-title">Within-cohort category statistics</h2><Pill kind="neutral">DESCRIPTIVE ONLY</Pill></div><p>Observed values only. Missing observations are excluded from calculations and shown in coverage. Categories use the selected source, without a market ranking or a new popularity score.</p><div className="research-list-controls"><label>Sort categories<select value={categorySort} onChange={event => setCategorySort(event.target.value as CategorySort)}><option value="genre">Category name</option><option value="eligibleCount">Eligible games</option><option value="observedCount">Observed games</option><option value="coveragePercent">Coverage</option><option value="median">Median</option><option value="mean">Mean</option><option value="iqr">IQR</option><option value="trimmedMean10">Trimmed mean</option><option value="largestGameShare">Largest-game share</option></select></label><button className="button secondary" onClick={() => setCategoryDirection(categoryDirection === 'asc' ? 'desc' : 'asc')}>Categories: {categoryDirection === 'asc' ? 'ascending ↑' : 'descending ↓'}</button></div><div className="method-table" role="region" tabIndex={0} aria-label="Category statistics, scroll horizontally"><table><thead><tr><th scope="col">{taxonomyLabel(taxonomy)}</th><th scope="col">Observed / eligible</th><th scope="col">Median</th><th scope="col">Mean</th><th scope="col">Q1 / Q3</th><th scope="col">IQR</th><th scope="col">10% trimmed mean</th><th scope="col">Largest-game share</th><th scope="col">Sample</th></tr></thead><tbody>{categoryRows.map(genre => <tr key={genre.genre}><th scope="row">{genre.genre}<details className="research-category-games"><summary>{genre.eligibleCount} included games</summary><ul>{sortResearchGames(report.audit.filter(row => row.eligible && researchRowCategories(row, taxonomy).includes(genre.genre)), gameSort, gameDirection).map(row => <li key={row.appid}><a href={`#/game/${row.appid}`}>{row.name}</a><span>{valueText(row.observation.value)}</span></li>)}</ul></details></th><td className="numeric">{genre.observedCount} / {genre.eligibleCount}<small>{percent(genre.coveragePercent)} coverage · {genre.missingCount} missing</small></td><td className="numeric">{valueText(genre.median)}</td><td className="numeric">{valueText(genre.mean)}</td><td className="numeric">{valueText(genre.q1)} / {valueText(genre.q3)}</td><td className="numeric">{valueText(genre.iqr)}{genre.iqr === null && <small>{readable(genre.iqrStatus)}</small>}</td><td className="numeric">{valueText(genre.trimmedMean10)}<small>{genre.observedCount < 20 ? 'Requires 20+ observed games' : `${genre.trimmedCountPerTail ?? 0} removed per tail · ${genre.trimmedN ?? 0} retained`}</small></td><td className="numeric">{genre.largestGameShare === null ? 'Unavailable' : percent(genre.largestGameShare * 100)}<small>{genre.largestGameShare === null ? readable(genre.largestGameShareStatus) : 'Outlier concentration'}</small></td><td><Pill kind={genre.observedCount < 10 ? 'amber' : 'neutral'}>{genre.observedCount < 5 ? 'Insufficient sample' : genre.observedCount < 10 ? 'Low sample' : '10+ observations'}</Pill><small>n = {genre.observedCount}</small></td></tr>)}</tbody></table></div>{!report.genres.length && <p className="notice-copy">Eligible games have no saved labels in the selected category source to summarize.</p>}<p className="fineprint">Quartiles use R7 interpolation; IQR = Q3 − Q1. At n ≥ 20, the trimmed mean removes floor(10% × n) from each tail. Largest-game share describes concentration of observed values, not market share. A zero total has no defined share. n &lt; 5 is insufficient; n = 5–9 is low sample. Larger counts do not establish representativeness.</p>{report.genres.some(genre => genre.missingCount > 0) && <details className="catalog-details"><summary>Missing observations by category</summary>{report.genres.filter(genre => genre.missingCount > 0).map(genre => <p key={genre.genre}><b>{genre.genre}</b>: {Object.entries(genre.missingReasonCounts).map(([reason, total]) => `${readable(reason)}: ${total}`).join(' · ')}</p>)}</details>}</section>}
    <section className="panel research-audit" aria-labelledby="research-audit-title"><div className="section-heading"><h2 id="research-audit-title">Per-app evidence audit</h2><Pill kind="neutral">{auditRows.length} / {report.audit.length} APPLICATIONS</Pill></div><p>Every application in the selected population, including exclusions. Open a row for release, category and PC provenance. Raw saved metric values for excluded applications never enter cohort aggregates.</p><div className="research-list-controls"><label>Sort games<select value={gameSort} onChange={event => setGameSort(event.target.value as GameSort)}><option value="name">Game name</option><option value="appid">Steam AppID</option><option value="releaseDate">Selected release date</option><option value="value">Saved metric value</option><option value="eligible">Inclusion</option></select></label><button className="button secondary" onClick={() => setGameDirection(gameDirection === 'asc' ? 'desc' : 'asc')}>Games: {gameDirection === 'asc' ? 'ascending ↑' : 'descending ↓'}</button><label className="research-check"><input type="checkbox" checked={includedOnly} onChange={event => setIncludedOnly(event.target.checked)}/>Included games only</label></div><p className="fineprint">Missing dates and metric values sort last in either direction. Game sorting also applies to each category’s included-game list.</p>{includedOnly && !auditRows.length && report.audit.length > 0 && <p className="notice-copy">No included games for this selection. Turn off “Included games only” to inspect exclusions.</p>}{!report.audit.length && <p className="notice-copy">There are no saved applications to audit in this population.</p>}{auditRows.map(row => <details className="research-audit-row" key={row.appid}><summary><span className="research-audit-name">{row.name}<small>Steam AppID {row.appid} · {researchRowCategories(row, taxonomy).join(' · ') || `No saved ${taxonomyLabel(taxonomy)} labels`}</small></span><Pill kind={row.eligible ? 'green' : 'amber'}>{row.eligible ? 'Included' : 'Excluded'}</Pill><span className="research-audit-value">{row.observation.value === null ? 'Missing' : valueText(row.observation.value)}<small>{metricLabel(selection.metric)}</small></span></summary><div className="research-audit-body"><div><a className="text-link" href={`#/game/${row.appid}`}>Open game record →</a><dl className="identity-grid"><dt>{pcBasis ? 'Source application type' : 'Strict application type'}</dt><dd>{readable(row.appType)}</dd><dt>Saved population cohort</dt><dd>{readable(row.savedCohort)}</dd><dt>Eligibility reasons</dt><dd>{row.reasons.length ? row.reasons.map(readable).join(' · ') : row.eligible ? 'Meets selected cohort requirements' : 'No reason recorded'}</dd><dt>{pcBasis ? 'Reported PC date for selected basis' : 'Verified date for selected basis'}</dt><dd>{row.releaseDate || (pcBasis ? 'No qualifying saved PC date' : 'No qualifying verified date')}</dd><dt>Legacy store display date</dt><dd>{row.legacyDisplayDate || 'Not captured'} · reference only, not verified Steam release evidence</dd><dt>IGDB first-release date</dt><dd>{row.igdbFirstReleaseDate || 'Not captured'} · reference only, not verified Steam release evidence</dd></dl></div><div className="research-raw-observation"><h3>Raw saved metric</h3><ResearchObservation observation={row.observation}/></div><RawCategoryEvidence row={row} taxonomy={taxonomy}/><div className="research-release-evidence"><h3>Release-date provenance</h3>{!row.evidence.length ? <p>No release evidence records are saved for this application.</p> : row.evidence.map((evidence, index) => <article key={index}><div className="research-evidence-heading"><b>{readable(evidence.basis)}</b><Pill kind={evidence.verified ? 'neutral' : 'amber'}>{evidence.verified ? 'Verified evidence record' : 'Unverified'}</Pill></div><dl className="identity-grid"><dt>Saved date / precision</dt><dd>{evidence.date || 'Not captured'} / {readable(evidence.precision)}</dd><dt>Release status / phase</dt><dd>{readable(evidence.status)} / {readable(evidence.phase)}</dd><dt>Retrieved</dt><dd>{stamp(evidence.retrievedAt)}</dd><dt>Verification note</dt><dd>{evidence.note || 'No note recorded'}</dd><dt>Source</dt><dd><ExternalLink url={evidence.source}>Release evidence source</ExternalLink><span className="research-source-text">{evidence.source || 'Not captured'}</span></dd></dl></article>)}</div></div></details>)}</section>
    <section className="panel research-methods" aria-labelledby="research-methods-title"><h2 id="research-methods-title">Reproducibility &amp; limits</h2><ul>{report.notes.map((note, index) => <li key={index}>{note}</li>)}</ul><dl className="identity-grid"><dt>Release policy</dt><dd>{report.releasePolicyVersion}</dd><dt>Statistic method</dt><dd>{report.statisticVersion}</dd><dt>Category source</dt><dd>{taxonomyLabel(taxonomy)} · {report.taxonomy?.version || 'Not recorded'}</dd><dt>Taxonomy versions</dt><dd>{population.taxonomyVersions.join(', ') || 'Not recorded'}</dd><dt>Window convention</dt><dd>{report.releaseWindow.version} · UTC · [start, end)</dd></dl></section>
  </div>;
}

interface ReportState { key: string; report: ReleaseResearchReport | null; loading: boolean; error: string | null }
/** A report belongs to one request key. New filters synchronously hide old results, before effects run. */
export function visibleResearchState(state: ReportState, key: string): ReportState {
  return state.key === key ? state : { key, report: null, loading: true, error: null };
}
export function ResearchCategoryPicker({ available, selected, onToggle }: { available: { name: string; populationCount: number | null }[]; selected: string[]; onToggle: (name: string) => void }) {
  return <div className="research-category-options" aria-label="Saved category labels">{available.map(option => <label className="research-category-option" key={option.name}><input type="checkbox" checked={selected.includes(option.name)} onChange={() => onToggle(option.name)}/><span>{option.name}</span><small>{option.populationCount === null ? 'Awaiting validation' : `${option.populationCount} saved`}</small></label>)}</div>;
}
export function ReleaseResearch({ params, setFilter, now }: { params: GameFilters; setFilter: (key: string, value: string) => void; now: number }) {
  const [frozenAsOf] = useState(() => new Date(now).toISOString());
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<ReportState>({ key: '', report: null, loading: true, error: null });
  const [categoryCache, setCategoryCache] = useState<{ key: string; available: NonNullable<ReleaseResearchReport['taxonomy']>['available'] }>({ key: '', available: [] });
  const [anchorCache, setAnchorCache] = useState<string[]>([]);
  const generation = useRef(0);
  const asOf = params.asOf || frozenAsOf;
  const reviewAsOf = params.reviewAsOf || asOf;
  const taxonomy = params.taxonomy || 'igdb_genre';
  const categoryKey = JSON.stringify([params.population || 'tracked', taxonomy, asOf]);
  let selectedCategories: string[] = [];
  try { selectedCategories = parseResearchCategories(params.categories); } catch { /* The clear control remains available for invalid URL selections. */ }
  let query = ''; let queryError: string | null = null;
  try { query = buildReleaseResearchQuery({ ...params, taxonomy, reviewAsOf }, frozenAsOf); } catch (reason) { queryError = reason instanceof Error ? reason.message : 'Check the research filters.'; }
  const requestKey = `${query}:${attempt}`;
  const visible = visibleResearchState(state, requestKey);
  const report = !queryError && !visible.loading && !visible.error ? visible.report : null;
  const availableCategories = report?.taxonomy?.available || (categoryCache.key === categoryKey ? categoryCache.available : []);
  const categoryOptions = [...availableCategories, ...selectedCategories.filter(name => !availableCategories.some(option => option.name === name)).map(name => ({ name, populationCount: null, cohortCount: null }))];
  const reviewMetric = ['reviews7d', 'reviews30d', 'reviewsCustom'].includes(params.metric || '') ? params.metric! : 'reviews7d';
  const reviewActive = ['reviews7d', 'reviews30d', 'reviewsCustom'].includes(params.metric || '');
  useEffect(() => { if (!params.asOf) setFilter('asOf', frozenAsOf); }, [params.asOf, frozenAsOf, setFilter]);
  useEffect(() => { if (!params.reviewAsOf) setFilter('reviewAsOf', asOf); }, [params.reviewAsOf, asOf, setFilter]);
  useEffect(() => {
    const controller = new AbortController(); const current = ++generation.current;
    setState({ key: requestKey, report: null, loading: !queryError, error: queryError });
    if (!queryError) fetchReleaseResearch(query, controller.signal).then(value => {
      if (!controller.signal.aborted && generation.current === current) {
        setState({ key: requestKey, report: value, loading: false, error: null });
        if (value.taxonomy) setCategoryCache({ key: categoryKey, available: value.taxonomy.available });
        if (value.reviewActivity) setAnchorCache(value.reviewActivity.savedAnchors);
      }
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted && generation.current === current) setState({ key: requestKey, report: null, loading: false, error: reason instanceof Error ? reason.message : 'Saved release research is unavailable.' });
    });
    return () => { controller.abort(); };
  }, [query, queryError, requestKey, categoryKey]);
  const change = (key: string, value: string) => changeResearchFilter(setFilter, key, value);
  const choosePreset = (value: string) => {
    if (value === 'custom') {
      const end = isUtcInstant(asOf) ? asOf.slice(0, 10) : frozenAsOf.slice(0, 10);
      if (!params.startDate) setFilter('startDate', (report?.selection.preset !== 'all' ? report?.releaseWindow.startInclusive.slice(0, 10) : null) || new Date(Date.parse(`${end}T00:00:00Z`) - 30 * 86_400_000).toISOString().slice(0, 10));
      if (!params.endDate) setFilter('endDate', end);
    }
    setFilter('preset', value);
  };
  const chooseReviewMetric = (value: string) => {
    if (value === 'reviewsCustom') {
      const cutoff = isUtcInstant(reviewAsOf) ? reviewAsOf : frozenAsOf;
      const end = new Date(Date.parse(`${cutoff.slice(0, 10)}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
      if (!params.reviewStartDate) setFilter('reviewStartDate', new Date(Date.parse(`${end}T00:00:00Z`) - 6 * 86_400_000).toISOString().slice(0, 10));
      if (!params.reviewEndDate) setFilter('reviewEndDate', end);
    }
    change('metric', value);
  };
  const toggleCategory = (name: string) => {
    const next = selectedCategories.includes(name) ? selectedCategories.filter(label => label !== name) : [...selectedCategories, name];
    setFilter('categories', next.length ? JSON.stringify(next.sort()) : '');
  };
  const utcInput = (value: string) => isUtcInstant(value) ? new Date(value).toISOString().slice(0, -1) : '';
  const changeUtc = (key: string, value: string) => { if (value) change(key, `${value.length === 16 ? `${value}:00` : value}Z`); };
  return <><PageTitle eyebrow="RELEASE COHORTS / SAVED EVIDENCE" title="Release research" description="Choose a saved population, release window and category source, then inspect coverage and the evidence behind every inclusion." extra={<button className="button secondary" disabled={visible.loading && !queryError} onClick={() => setAttempt(value => value + 1)}>{visible.loading && !queryError ? 'Reading report…' : 'Reload saved report'}</button>}/>
    <section className="panel research-controls" aria-label="Release research filters">
      <div className="research-control-grid">
        <label>Population<select value={params.population || 'tracked'} onChange={event => change('population', event.target.value)}>{researchPopulations.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
        <label>Release window<select value={params.preset || '1m'} onChange={event => choosePreset(event.target.value)}>{researchPresets.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
        <label>Release basis<select value={params.basis || 'first_playable'} onChange={event => change('basis', event.target.value)}><option value="first_playable">First playable, including Early Access</option><option value="full_release">Full release only</option><option value="igdb_pc">IGDB-reported PC release (separate source)</option></select></label>
        <label>Metric<select value={reviewActive ? 'review_activity' : params.metric || 'players'} onChange={event => event.target.value === 'review_activity' ? chooseReviewMetric(reviewMetric) : change('metric', event.target.value)}><option value="players">Saved concurrent players</option><option value="reviews">Saved cumulative reviews</option><option value="review_activity">Review activity in exact interval</option></select></label>
        <label>As-of cutoff (UTC)<input type="datetime-local" step="0.001" value={utcInput(asOf)} onChange={event => changeUtc('asOf', event.target.value)}/></label>
        <label>Saved observation set<select value={params.snapshot || ''} onChange={event => change('snapshot', event.target.value)}><option value="">Latest eligible saved set</option>{params.snapshot && !report?.observations.available.some(set => set.id === params.snapshot) && <option value={params.snapshot}>Selected snapshot (awaiting validation)</option>}{report?.observations.available.map(set => <option key={set.id} value={set.id}>{stamp(set.collectedEnd)} · {set.scope} · {set.rowCount} rows · {set.runId}</option>)}</select></label>
        {params.preset === 'custom' && <><label>Release start date, included<input type="date" value={params.startDate || ''} onChange={event => change('startDate', event.target.value)}/></label><label>Release end date, included<input type="date" value={params.endDate || ''} onChange={event => change('endDate', event.target.value)}/></label></>}
      </div>
      <p className="fineprint">Strict Steam bases require verified Steam evidence. IGDB-reported PC dates form a separate source-reported cohort and do not establish a Steam launch. “All release dates” removes the release recency restriction; evidence and source eligibility still apply.</p>
      <fieldset className="research-filter-section"><legend>Category source &amp; labels</legend><div className="research-control-grid"><label>Category taxonomy<select value={taxonomy} onChange={event => change('taxonomy', event.target.value)}>{researchTaxonomies.map(([id, label]) => <option value={id} key={id}>{label}</option>)}</select></label><label>Match selected labels<select value={params.categoryMatch || 'any'} onChange={event => change('categoryMatch', event.target.value)}><option value="any">ANY selected label</option><option value="all">ALL selected labels</option></select></label><div className="research-clear-categories"><button className="button secondary" type="button" onClick={() => clearResearchCategories(setFilter)}>Clear categories</button><small>{selectedCategories.length} selected · all saved labels available</small></div></div>
        <ResearchCategoryPicker available={categoryOptions} selected={selectedCategories} onToggle={toggleCategory}/>
        {!categoryOptions.length && <p className="fineprint">{visible.loading && !queryError ? 'Reading saved category labels…' : 'No saved labels available for this source and population. You can still clear the current category selection.'}</p>}
        <p className="fineprint">With no labels selected, all categories are included. ANY accepts at least one selected label; ALL requires every selected label. There is no 12-label display or selection cap. Missing source labels stay missing; legacy editorial assignments are a separate taxonomy.</p>
      </fieldset>
      <fieldset className="research-filter-section"><legend>Independent review activity</legend><div className="research-control-grid"><label>Review measurement window<select value={reviewMetric} onChange={event => chooseReviewMetric(event.target.value)}><option value="reviews7d">Exact 7 elapsed days</option><option value="reviews30d">Exact 30 elapsed days</option><option value="reviewsCustom">Custom review dates</option></select></label><label>Rolling review as-of (UTC)<input type="datetime-local" step="0.001" disabled={reviewMetric === 'reviewsCustom'} value={utcInput(reviewAsOf)} onChange={event => changeUtc('reviewAsOf', event.target.value)}/></label><label>Saved review anchor<select disabled={reviewMetric === 'reviewsCustom'} value={(report?.reviewActivity?.savedAnchors || anchorCache).includes(reviewAsOf) ? reviewAsOf : ''} onChange={event => { if (event.target.value) change('reviewAsOf', event.target.value); }}><option value="">Choose a saved interval endpoint</option>{(report?.reviewActivity?.savedAnchors || anchorCache).map(anchor => <option key={anchor} value={anchor}>{stamp(anchor)}</option>)}</select></label>{reviewMetric === 'reviewsCustom' && <><label>Review start date, included<input type="date" value={params.reviewStartDate || ''} onChange={event => change('reviewStartDate', event.target.value)}/></label><label>Review end date, included<input type="date" value={params.reviewEndDate || ''} onChange={event => change('reviewEndDate', event.target.value)}/></label></>}</div><p className="fineprint">Choosing a review window selects the review-activity metric and leaves the release filters unchanged. These intervals require an exact compatible saved source interval; unavailable intervals remain unavailable. Cumulative review totals are never substituted. Saved anchors set the endpoint for exact 7/30-day windows. Custom intervals use their own inclusive dates. All review intervals end no later than the evidence cutoff; saved anchors are not live refreshes.</p></fieldset>
      <p className="fineprint">Filters are stored in the page URL. The as-of cutoffs stay frozen until you change them. Release windows select games; review windows measure activity independently. Only saved, comparable evidence is read. “Latest eligible saved set” is a selection policy and may change after an import; choose a specific set to keep it fixed.</p>
    </section>
    {(queryError || visible.error) && <section className="panel unavailable-panel research-load-state" role="alert"><h2>Release research unavailable</h2><p>{queryError || visible.error}</p>{!queryError && <button className="button" onClick={() => setAttempt(value => value + 1)}>Try again</button>}</section>}
    {!queryError && visible.loading && <section className="panel unavailable-panel research-load-state" role="status"><span className="loading-mark" aria-hidden="true"/><h2>Reading the selected release cohort…</h2><p>Checking saved evidence for these filters. No source requests are made.</p></section>}
    {report && <ReleaseResearchView report={report}/>}</>;
}
