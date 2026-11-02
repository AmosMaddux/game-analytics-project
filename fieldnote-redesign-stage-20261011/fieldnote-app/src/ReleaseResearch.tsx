import { useEffect, useRef, useState } from 'react';
import type { GameFilters } from './types';
import type { ObservationSet, ReleaseResearchReport, ResearchSelection, ResearchWindow } from './research-types';
import { ExternalLink, PageTitle, Pill, formatNumber, readable, stamp } from './ui';

export const researchPopulations = [['tracked', 'All tracked games'], ['legacy36', 'Original 36-game sample'], ['discovery', 'Saved discovery additions']] as const;
export const researchPresets = [['7d', 'Last 7 days'], ['14d', 'Last 14 days'], ['21d', 'Last 21 days'], ['1m', 'Past 1 month (rolling)'], ['2m', 'Past 2 months (rolling)'], ['3m', 'Past 3 months (rolling)'], ['1y', 'Past 1 year (rolling)'], ['custom', 'Custom dates']] as const;
export const researchMetrics = [['players', 'Saved concurrent players'], ['reviews', 'Saved cumulative reviews'], ['reviews7d', 'Reviews in last 7 days'], ['reviews30d', 'Reviews in last 30 days']] as const;
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
export function releaseResearchSelection(params: GameFilters, frozenAsOf: string): ResearchSelection {
  const population = params.population || 'tracked';
  const preset = params.preset || '1m';
  const basis = params.basis || 'first_playable';
  const metric = params.metric || 'players';
  const asOf = params.asOf || frozenAsOf;
  if (!member(population, researchPopulations) || !member(preset, researchPresets) || !member(metric, researchMetrics) || !['first_playable', 'full_release'].includes(basis)) throw new Error('Choose a supported population, release window, release basis and metric.');
  if (!isUtcInstant(asOf)) throw new Error('As-of must be a valid explicit UTC timestamp ending in Z.');
  const selection: ResearchSelection = { population: population as ResearchSelection['population'], preset: preset as ResearchSelection['preset'], basis: basis as ResearchSelection['basis'], metric: metric as ResearchSelection['metric'], asOf: new Date(asOf).toISOString() };
  if (preset === 'custom') {
    if (!isUtcDay(params.startDate) || !isUtcDay(params.endDate)) throw new Error('Choose a valid start date and end date for the custom release window.');
    if (params.startDate > params.endDate) throw new Error('The custom start date must be on or before the end date.');
    selection.startDate = params.startDate; selection.endDate = params.endDate;
  }
  if (params.snapshot) selection.snapshot = params.snapshot;
  return selection;
}
export function buildReleaseResearchQuery(params: GameFilters, frozenAsOf: string): string {
  return new URLSearchParams(Object.entries(releaseResearchSelection(params, frozenAsOf))).toString();
}
export function changeResearchFilter(setFilter: (key: string, value: string) => void, key: string, value: string) {
  if (key === 'metric' || key === 'asOf') setFilter('snapshot', '');
  setFilter(key, value);
}
function validWindow(value: unknown, kind: string): value is ResearchWindow {
  return object(value) && string(value.version) && value.kind === kind && value.timeZone === 'UTC' && isUtcInstant(value.asOf) && isUtcInstant(value.startInclusive) && isUtcInstant(value.endExclusive) && Date.parse(value.startInclusive) < Date.parse(value.endExclusive) && object(value.definition);
}
function validObservationSet(value: unknown): value is ObservationSet {
  return object(value) && ['id', 'metric', 'runId', 'methodVersion', 'scope'].every(key => string(value[key])) && isUtcInstant(value.collectedStart) && isUtcInstant(value.collectedEnd) && Date.parse(value.collectedStart) <= Date.parse(value.collectedEnd) && count(value.rowCount);
}
/** Reject malformed nested data before it can be rendered or mistaken for evidence. */
export function assertReleaseResearch(value: unknown): asserts value is ReleaseResearchReport {
  if (!object(value) || value.version !== 'release-research-v1' || value.mode !== 'read_only_saved_evidence' || !object(value.selection)) throw invalidReport();
  const selection = value.selection;
  try { releaseResearchSelection(selection as GameFilters, ''); } catch { throw invalidReport(); }
  if (!member(selection.population, researchPopulations) || !member(selection.preset, researchPresets) || !member(selection.metric, researchMetrics) || !['first_playable', 'full_release'].includes(String(selection.basis)) || !isUtcInstant(selection.asOf) || selection.snapshot !== undefined && !string(selection.snapshot)) throw invalidReport();
  if (!validWindow(value.releaseWindow, 'release_cohort') || !object(value.reviewWindows) || !validWindow(value.reviewWindows.reviews7d, 'review_activity') || !validWindow(value.reviewWindows.reviews30d, 'review_activity')) throw invalidReport();
  if ([value.releaseWindow, value.reviewWindows.reviews7d, value.reviewWindows.reviews30d].some(window => Date.parse(window.asOf) !== Date.parse(selection.asOf as string))) throw invalidReport();
  const population = value.population; const observations = value.observations; const cohort = value.cohort;
  if (!object(population) || population.id !== selection.population || !string(population.label) || !string(population.note) || !strings(population.taxonomyVersions) || !['inventoryCount', 'selectedCount', 'typeEligibleCount', 'typeExcludedCount', 'unresolvedGenreCount', 'missingReleaseEvidenceCount'].every(key => count(population[key]))) throw invalidReport();
  if (Number(population.typeEligibleCount) + Number(population.typeExcludedCount) !== population.selectedCount || Number(population.selectedCount) > Number(population.inventoryCount)) throw invalidReport();
  if (!object(observations) || !string(observations.status) || !string(observations.note) || !Array.isArray(observations.available) || !observations.available.every(validObservationSet) || observations.selected !== null && !validObservationSet(observations.selected)) throw invalidReport();
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
}
export function assertResearchSelection(report: ReleaseResearchReport, query: string) {
  const requested = new URLSearchParams(query);
  for (const key of ['population', 'preset', 'basis', 'metric', 'asOf', 'startDate', 'endDate', 'snapshot'] as const) {
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
  const noVerifiedDates = population.selectedCount > 0 && population.missingReleaseEvidenceCount === population.selectedCount;
  return <div className="release-research-report">
    <div className="status-banner"><div><h2>Release cohorts from saved evidence</h2><p>Descriptive research within {population.label.toLowerCase()}. This is a selected catalog sample, not the whole Steam market. Opening this page never contacts a provider or starts collection.</p></div><Pill kind="outline">READ-ONLY</Pill></div>
    <section className="research-denominators" aria-label="Population and cohort denominators">
      <article className="panel"><span className="eyebrow">SELECTED POPULATION</span><strong>{formatNumber(population.selectedCount, 0)}</strong><p>{population.label}</p><small>of {formatNumber(population.inventoryCount, 0)} tracked applications</small></article>
      <article className="panel"><span className="eyebrow">VERIFIED GAME TYPE</span><strong>{formatNumber(population.typeEligibleCount, 0)}<small> / {formatNumber(population.selectedCount, 0)}</small></strong><p>Strict Steam game eligibility</p><small>{formatNumber(population.typeExcludedCount, 0)} unknown or excluded application types</small></article>
      <article className="panel"><span className="eyebrow">RELEASE COHORT</span><strong>{formatNumber(cohort.eligibleCount, 0)}<small> / {formatNumber(population.selectedCount, 0)}</small></strong><p>Eligible in the release window</p><small>{formatNumber(cohort.excludedCount, 0)} excluded from this cohort</small></article>
      <article className="panel"><span className="eyebrow">MISSING RELEASE EVIDENCE</span><strong>{formatNumber(population.missingReleaseEvidenceCount, 0)}</strong><p>For the selected release basis</p><small>{population.unresolvedGenreCount} unresolved genre mappings in population</small></article>
    </section>
    <p className="research-context">{population.note}</p>
    <section className="research-windows" aria-label="Release and review measurement windows">
      <article className="panel research-window"><span className="eyebrow">RELEASE COHORT WINDOW</span><h2>{selection.basis === 'full_release' ? 'Full release' : 'First playable release'}</h2><WindowBounds window={report.releaseWindow}/><p>{selection.basis === 'first_playable' ? 'Includes a verified Early Access launch when it is the first playable Steam release.' : 'Requires verified full-release evidence; an Early Access launch alone does not qualify.'}</p><p>Only verified, released, day-precision Steam dates qualify. A day is interpreted at 00:00:00 UTC. The start is inclusive and the end is exclusive. Rolling windows preserve the as-of time; a release dated on the start day is excluded when that start is later than midnight. Custom dates include both selected days.</p></article>
      <article className="panel research-window"><span className="eyebrow">REVIEW MEASUREMENT WINDOWS</span><h2>Separate from release dates</h2><h3>Last 7 days</h3><WindowBounds window={report.reviewWindows.reviews7d}/><h3>Last 30 days</h3><WindowBounds window={report.reviewWindows.reviews30d}/><p>These intervals measure review activity, not which games were released. Seven- and 30-day review activity is unavailable without full source validation and comparable saved observations; cumulative reviews are not a substitute.</p></article>
    </section>
    <section className="panel research-evidence" aria-labelledby="research-observations-title"><div className="section-heading"><h2 id="research-observations-title">{metricLabel(selection.metric)}</h2><Pill kind={observations.selected ? 'neutral' : 'amber'}>{readable(observations.status)}</Pill></div><p>{observations.note}</p>{observations.selected ? <dl className="identity-grid"><dt>Saved observation set</dt><dd>{observations.selected.id}</dd><dt>Collection span</dt><dd>{stamp(observations.selected.collectedStart)} to {stamp(observations.selected.collectedEnd)}</dd><dt>Comparable scope</dt><dd>{observations.selected.scope}</dd><dt>Run / method</dt><dd>{observations.selected.runId} / {observations.selected.methodVersion}</dd><dt>Saved rows in set</dt><dd>{observations.selected.rowCount} · before population and cohort exclusions</dd></dl> : <p className="notice-copy">No comparable saved observation set is available for this selection. Missing values remain missing.</p>}<p className="fineprint">As-of: <time dateTime={selection.asOf}>{stamp(selection.asOf)}</time>. This freezes the research cutoff; it is not a provider refresh or a simultaneous live measurement.</p></section>
    <section className="panel research-exclusions" aria-labelledby="research-exclusions-title"><h2 id="research-exclusions-title">Cohort exclusions</h2>{Object.keys(cohort.exclusionCounts).length ? <ul>{Object.entries(cohort.exclusionCounts).map(([reason, total]) => <li key={reason}><span>{readable(reason)}</span><strong>{total}</strong></li>)}</ul> : <p>No exclusions are recorded for this selection.</p>}<p className="fineprint">Each excluded application is omitted from cohort statistics. Per-app audit below preserves every recorded exclusion reason. Unknown application types, demos, DLC, soundtracks and tools do not qualify as verified games.</p></section>
    {!cohort.eligibleCount && <section className="panel research-empty" role="status"><span className="eyebrow">EVIDENCE GAP</span><h2>{!population.selectedCount ? 'No saved applications in this population' : noVerifiedDates ? 'No verified Steam release dates' : 'No eligible games in this release window'}</h2><p>{noVerifiedDates ? 'The selected population has no verified release-date evidence for this basis. Cohort aggregates are unavailable until both application type and release evidence qualify.' : 'There are no eligible games to summarize for the selected population, release basis and dates.'}</p><p>IGDB first-release dates and legacy store display dates are reference only. Neither is promoted to verified Steam release evidence.</p></section>}
    {cohort.eligibleCount > 0 && <section className="panel research-statistics" aria-labelledby="research-statistics-title"><div className="section-heading"><h2 id="research-statistics-title">Within-cohort genre statistics</h2><Pill kind="neutral">DESCRIPTIVE ONLY</Pill></div><p>Observed values only. Missing observations are excluded from calculations and shown in coverage. Genres are listed without a market ranking or a new popularity score.</p><div className="method-table" role="region" tabIndex={0} aria-label="Genre statistics, scroll horizontally"><table><thead><tr><th scope="col">Editorial genre</th><th scope="col">Observed / eligible</th><th scope="col">Median</th><th scope="col">Mean</th><th scope="col">Q1 / Q3</th><th scope="col">IQR</th><th scope="col">10% trimmed mean</th><th scope="col">Largest-game share</th><th scope="col">Sample</th></tr></thead><tbody>{report.genres.map(genre => <tr key={genre.genre}><th scope="row">{genre.genre}</th><td className="numeric">{genre.observedCount} / {genre.eligibleCount}<small>{percent(genre.coveragePercent)} coverage · {genre.missingCount} missing</small></td><td className="numeric">{valueText(genre.median)}</td><td className="numeric">{valueText(genre.mean)}</td><td className="numeric">{valueText(genre.q1)} / {valueText(genre.q3)}</td><td className="numeric">{valueText(genre.iqr)}{genre.iqr === null && <small>{readable(genre.iqrStatus)}</small>}</td><td className="numeric">{valueText(genre.trimmedMean10)}<small>{genre.observedCount < 20 ? 'Requires 20+ observed games' : `${genre.trimmedCountPerTail ?? 0} removed per tail · ${genre.trimmedN ?? 0} retained`}</small></td><td className="numeric">{genre.largestGameShare === null ? 'Unavailable' : percent(genre.largestGameShare * 100)}<small>{genre.largestGameShare === null ? readable(genre.largestGameShareStatus) : 'Outlier concentration'}</small></td><td><Pill kind={genre.observedCount < 10 ? 'amber' : 'neutral'}>{genre.observedCount < 5 ? 'Insufficient sample' : genre.observedCount < 10 ? 'Low sample' : '10+ observations'}</Pill><small>n = {genre.observedCount}</small></td></tr>)}</tbody></table></div>{!report.genres.length && <p className="notice-copy">Eligible games have no resolved editorial genre to summarize.</p>}<p className="fineprint">Quartiles use R7 interpolation; IQR = Q3 − Q1. At n ≥ 20, the trimmed mean removes floor(10% × n) from each tail. Largest-game share describes concentration of observed values, not market share. A zero total has no defined share. n &lt; 5 is insufficient; n = 5–9 is low sample. Larger counts do not establish representativeness.</p>{report.genres.some(genre => genre.missingCount > 0) && <details className="catalog-details"><summary>Missing observations by genre</summary>{report.genres.filter(genre => genre.missingCount > 0).map(genre => <p key={genre.genre}><b>{genre.genre}</b>: {Object.entries(genre.missingReasonCounts).map(([reason, total]) => `${readable(reason)}: ${total}`).join(' · ')}</p>)}</details>}</section>}
    <section className="panel research-audit" aria-labelledby="research-audit-title"><div className="section-heading"><h2 id="research-audit-title">Per-app evidence audit</h2><Pill kind="neutral">{report.audit.length} APPLICATIONS</Pill></div><p>Every application in the selected population, including exclusions. Open a row for release provenance. Raw saved metric values for excluded applications never enter cohort aggregates.</p>{!report.audit.length && <p className="notice-copy">There are no saved applications to audit in this population.</p>}{report.audit.map(row => <details className="research-audit-row" key={row.appid}><summary><span className="research-audit-name">{row.name}<small>Steam AppID {row.appid} · {row.genre || 'Unresolved genre'}</small></span><Pill kind={row.eligible ? 'green' : 'amber'}>{row.eligible ? 'Included' : 'Excluded'}</Pill><span className="research-audit-value">{row.observation.value === null ? 'Missing' : valueText(row.observation.value)}<small>{metricLabel(selection.metric)}</small></span></summary><div className="research-audit-body"><div><a className="text-link" href={`#/game/${row.appid}`}>Open game record →</a><dl className="identity-grid"><dt>Strict application type</dt><dd>{readable(row.appType)}</dd><dt>Saved population cohort</dt><dd>{readable(row.savedCohort)}</dd><dt>Eligibility reasons</dt><dd>{row.reasons.length ? row.reasons.map(readable).join(' · ') : row.eligible ? 'Meets selected cohort requirements' : 'No reason recorded'}</dd><dt>Verified date for selected basis</dt><dd>{row.releaseDate || 'No qualifying verified date'}</dd><dt>Legacy store display date</dt><dd>{row.legacyDisplayDate || 'Not captured'} · reference only, not verified Steam release evidence</dd><dt>IGDB first-release date</dt><dd>{row.igdbFirstReleaseDate || 'Not captured'} · reference only, not verified Steam release evidence</dd></dl></div><div className="research-raw-observation"><h3>Raw saved metric</h3><ResearchObservation observation={row.observation}/></div><div className="research-release-evidence"><h3>Release-date provenance</h3>{!row.evidence.length ? <p>No release evidence records are saved for this application.</p> : row.evidence.map((evidence, index) => <article key={index}><div className="research-evidence-heading"><b>{readable(evidence.basis)}</b><Pill kind={evidence.verified ? 'neutral' : 'amber'}>{evidence.verified ? 'Verified evidence record' : 'Unverified'}</Pill></div><dl className="identity-grid"><dt>Saved date / precision</dt><dd>{evidence.date || 'Not captured'} / {readable(evidence.precision)}</dd><dt>Release status / phase</dt><dd>{readable(evidence.status)} / {readable(evidence.phase)}</dd><dt>Retrieved</dt><dd>{stamp(evidence.retrievedAt)}</dd><dt>Verification note</dt><dd>{evidence.note || 'No note recorded'}</dd><dt>Source</dt><dd><ExternalLink url={evidence.source}>Release evidence source</ExternalLink><span className="research-source-text">{evidence.source || 'Not captured'}</span></dd></dl></article>)}</div></div></details>)}</section>
    <section className="panel research-methods" aria-labelledby="research-methods-title"><h2 id="research-methods-title">Reproducibility &amp; limits</h2><ul>{report.notes.map((note, index) => <li key={index}>{note}</li>)}</ul><dl className="identity-grid"><dt>Release policy</dt><dd>{report.releasePolicyVersion}</dd><dt>Statistic method</dt><dd>{report.statisticVersion}</dd><dt>Taxonomy versions</dt><dd>{population.taxonomyVersions.join(', ') || 'Not recorded'}</dd><dt>Window convention</dt><dd>{report.releaseWindow.version} · UTC · [start, end)</dd></dl></section>
  </div>;
}

interface ReportState { key: string; report: ReleaseResearchReport | null; loading: boolean; error: string | null }
/** A report belongs to one request key. New filters synchronously hide old results, before effects run. */
export function visibleResearchState(state: ReportState, key: string): ReportState {
  return state.key === key ? state : { key, report: null, loading: true, error: null };
}
export function ReleaseResearch({ params, setFilter, now }: { params: GameFilters; setFilter: (key: string, value: string) => void; now: number }) {
  const [frozenAsOf] = useState(() => new Date(now).toISOString());
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<ReportState>({ key: '', report: null, loading: true, error: null });
  const generation = useRef(0);
  let query = ''; let queryError: string | null = null;
  try { query = buildReleaseResearchQuery(params, frozenAsOf); } catch (reason) { queryError = reason instanceof Error ? reason.message : 'Check the research filters.'; }
  const requestKey = `${query}:${attempt}`;
  const visible = visibleResearchState(state, requestKey);
  const report = !queryError && !visible.loading && !visible.error ? visible.report : null;
  const asOf = params.asOf || frozenAsOf;
  useEffect(() => { if (!params.asOf) setFilter('asOf', frozenAsOf); }, [params.asOf, frozenAsOf, setFilter]);
  useEffect(() => {
    const controller = new AbortController(); const current = ++generation.current;
    setState({ key: requestKey, report: null, loading: !queryError, error: queryError });
    if (!queryError) fetchReleaseResearch(query, controller.signal).then(value => {
      if (!controller.signal.aborted && generation.current === current) setState({ key: requestKey, report: value, loading: false, error: null });
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted && generation.current === current) setState({ key: requestKey, report: null, loading: false, error: reason instanceof Error ? reason.message : 'Saved release research is unavailable.' });
    });
    return () => { controller.abort(); };
  }, [query, queryError, requestKey]);
  const change = (key: string, value: string) => changeResearchFilter(setFilter, key, value);
  const choosePreset = (value: string) => {
    if (value === 'custom') {
      const end = isUtcInstant(asOf) ? asOf.slice(0, 10) : frozenAsOf.slice(0, 10);
      if (!params.startDate) setFilter('startDate', report?.releaseWindow.startInclusive.slice(0, 10) || new Date(Date.parse(`${end}T00:00:00Z`) - 30 * 86_400_000).toISOString().slice(0, 10));
      if (!params.endDate) setFilter('endDate', end);
    }
    setFilter('preset', value);
  };
  return <><PageTitle eyebrow="RELEASE COHORTS / SAVED EVIDENCE" title="Release research" description="Choose a saved population and a release window, then inspect coverage, descriptive genre statistics and the evidence behind every inclusion." extra={<button className="button secondary" disabled={visible.loading && !queryError} onClick={() => setAttempt(value => value + 1)}>{visible.loading && !queryError ? 'Reading report…' : 'Reload saved report'}</button>}/>
    <section className="panel research-controls" aria-label="Release research filters"><div className="research-control-grid"><label>Population<select value={params.population || 'tracked'} onChange={event => change('population', event.target.value)}>{researchPopulations.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label><label>Release window<select value={params.preset || '1m'} onChange={event => choosePreset(event.target.value)}>{researchPresets.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label><label>Release basis<select value={params.basis || 'first_playable'} onChange={event => change('basis', event.target.value)}><option value="first_playable">First playable, including Early Access</option><option value="full_release">Full release only</option></select></label><label>Metric<select value={params.metric || 'players'} onChange={event => change('metric', event.target.value)}>{researchMetrics.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label><label>As-of cutoff (UTC)<input type="datetime-local" step="0.001" value={isUtcInstant(asOf) ? new Date(asOf).toISOString().slice(0, -1) : ''} onChange={event => { if (event.target.value) change('asOf', `${event.target.value.length === 16 ? `${event.target.value}:00` : event.target.value}Z`); }}/></label><label>Saved observation set<select value={params.snapshot || ''} onChange={event => change('snapshot', event.target.value)}><option value="">Latest eligible saved set</option>{params.snapshot && !report?.observations.available.some(set => set.id === params.snapshot) && <option value={params.snapshot}>Selected snapshot (awaiting validation)</option>}{report?.observations.available.map(set => <option key={set.id} value={set.id}>{stamp(set.collectedEnd)} · {set.scope} · {set.rowCount} rows · {set.runId}</option>)}</select></label>{params.preset === 'custom' && <><label>Release start date, included<input type="date" value={params.startDate || ''} onChange={event => change('startDate', event.target.value)}/></label><label>Release end date, included<input type="date" value={params.endDate || ''} onChange={event => change('endDate', event.target.value)}/></label></>}</div><p className="fineprint">Filters are stored in the page URL. The as-of cutoff stays frozen until you change it. Release windows select games; 7/30-day review windows measure activity independently. Only saved, comparable evidence is read. “Latest eligible saved set” is a selection policy and may change after an import; choose a specific set to keep it fixed.</p></section>
    {(queryError || visible.error) && <section className="panel unavailable-panel research-load-state" role="alert"><h2>Release research unavailable</h2><p>{queryError || visible.error}</p>{!queryError && <button className="button" onClick={() => setAttempt(value => value + 1)}>Try again</button>}</section>}
    {!queryError && visible.loading && <section className="panel unavailable-panel research-load-state" role="status"><span className="loading-mark" aria-hidden="true"/><h2>Reading the selected release cohort…</h2><p>Checking saved evidence for these filters. No source requests are made.</p></section>}
    {report && <ReleaseResearchView report={report}/>}</>;
}
