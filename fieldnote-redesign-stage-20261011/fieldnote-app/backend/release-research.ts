import type { D1Database } from './db.ts';
import type { ObservationSet, ResearchAuditRow, ResearchSelection, ReleaseResearchReport } from '../src/research-types.ts';
import { analyzeGenres, parseUtcDay, resolveReleaseWindow, resolveReviewWindows, type FoundationInput } from './cohort-foundation/index.mjs';

export class ResearchInputError extends Error {}
const UNRESOLVED = 'Unresolved / needs review';
const populations = { tracked: 'Current tracked inventory', legacy36: 'Preserved 36-game pilot', discovery: 'M3 discovery admissions' };
interface GameRow { appid: number; name: string; genre: string; cohort_id: string; release_display: string | null; first_release_at: string | null; admitted_at: string | null; collected_at: string | null; taxonomy_version: string | null }
interface TypeRow { appid: number; app_type: string; verified: number; source_url: string; retrieved_at: string; verification_note: string }
interface ReleaseRow { appid: number; release_basis: string; release_date: string | null; date_precision: string; verified: number; release_status: string; phase: string | null; source_url: string; retrieved_at: string; verification_note: string }
interface MetricRow { appid: number; metric: string; value: number | null; evidence_status: string; run_id: string; method_version: string; source_scope: string; unit: string; collected_at: string; measured_at: string | null; source_url: string | null }

export function parseResearchSelection(params: URLSearchParams, now = new Date().toISOString()): ResearchSelection {
  const allowed = new Set(['population','preset','basis','metric','asOf','startDate','endDate','snapshot']);
  for (const key of params.keys()) if (!allowed.has(key) || params.getAll(key).length !== 1) throw new ResearchInputError('Unsupported or repeated research filter.');
  if ([...params.values()].some(value => value.length > 4096)) throw new ResearchInputError('Research filter is too long.');
  const selection = {
    population: params.get('population') || 'tracked', preset: params.get('preset') || '1m',
    basis: params.get('basis') || 'first_playable', metric: params.get('metric') || 'players',
    asOf: params.get('asOf') || now,
    ...(params.get('startDate') ? { startDate: params.get('startDate')! } : {}),
    ...(params.get('endDate') ? { endDate: params.get('endDate')! } : {}),
    ...(params.get('snapshot') ? { snapshot: params.get('snapshot')! } : {}),
  };
  if (!Object.hasOwn(populations, selection.population) || !['first_playable','full_release'].includes(selection.basis) || !['players','reviews','reviews7d','reviews30d'].includes(selection.metric)) throw new ResearchInputError('Unsupported population, release basis or metric.');
  try { const window = resolveReleaseWindow(selection); selection.asOf = window.asOf; }
  catch { throw new ResearchInputError('Use a supported release preset, strict UTC asOf, and valid inclusive custom dates.'); }
  return selection as ResearchSelection;
}
const atOrBefore = (date: string | null, asOf: number) => date !== null && Number.isFinite(Date.parse(date)) && Date.parse(date) <= asOf;
const setId = (row: MetricRow) => JSON.stringify([row.metric,row.run_id,row.method_version,row.source_scope,row.unit]);

/** Conservative explicit adapter: no provider I/O, inferred launch dates, mixed runs or metric backfill. */
export async function readReleaseResearch(db: D1Database, selection: ResearchSelection): Promise<ReleaseResearchReport> {
  const releaseWindow = resolveReleaseWindow(selection);
  const reviewWindows = resolveReviewWindows({ asOf: selection.asOf });
  const asOf = Date.parse(selection.asOf);
  const [gameResult, typeResult, releaseResult, metricResult] = await Promise.all([
    db.prepare(`SELECT g.appid,g.name,g.genre,g.cohort_id,g.release_display,g.collected_at,c.first_release_at,a.admitted_at,a.taxonomy_version FROM games g LEFT JOIN catalog_games c ON c.appid=g.appid LEFT JOIN catalog_admissions a ON a.appid=g.appid ORDER BY g.appid`).all<GameRow>(),
    db.prepare('SELECT * FROM research_application_evidence ORDER BY appid,evidence_id').all<TypeRow>(),
    db.prepare('SELECT * FROM research_release_evidence ORDER BY appid,evidence_id').all<ReleaseRow>(),
    db.prepare(`SELECT appid,metric,value,evidence_status,run_id,method_version,source_scope,unit,collected_at,measured_at,source_url FROM metric_observations WHERE metric=? AND run_id IS NOT NULL ORDER BY collected_at,observation_id`).bind(selection.metric).all<MetricRow>(),
  ]);
  const selectedGames = gameResult.results.filter(game => selection.population === 'tracked' || (selection.population === 'legacy36' ? ['original_30','recent_6'].includes(game.cohort_id) : game.cohort_id === 'm3_discovery'));
  // A saved observation set has one metric, run, method, scope and unit, even if some games are absent.
  const sets = new Map<string, { info: ObservationSet; rows: MetricRow[] }>();
  for (const row of metricResult.results) {
    if (!atOrBefore(row.collected_at, asOf)) continue;
    const id = setId(row);
    if (!sets.has(id)) sets.set(id, { info: { id, metric: row.metric, runId: row.run_id, methodVersion: row.method_version, scope: row.source_scope, collectedStart: row.collected_at, collectedEnd: row.collected_at, rowCount: 0 }, rows: [] });
    const set = sets.get(id)!; set.rows.push(row); set.info.rowCount++;
    if (Date.parse(row.collected_at) < Date.parse(set.info.collectedStart)) set.info.collectedStart = row.collected_at;
    if (Date.parse(row.collected_at) > Date.parse(set.info.collectedEnd)) set.info.collectedEnd = row.collected_at;
  }
  const available = [...sets.values()].map(set => set.info).sort((a,b) => Date.parse(b.collectedEnd)-Date.parse(a.collectedEnd) || a.id.localeCompare(b.id));
  if (selection.snapshot && !sets.has(selection.snapshot)) throw new ResearchInputError('The selected observation set is unavailable for this metric and asOf.');
  const selected = (selection.snapshot ? sets.get(selection.snapshot)?.info : available[0]) ?? null;
  const rows = selected ? sets.get(selected.id)!.rows : [];
  const inputs: FoundationInput[] = [];
  const audit: ResearchAuditRow[] = [];
  let typeEligibleCount = 0, typeExcludedCount = 0, missingReleaseEvidenceCount = 0;
  const preExclusions: Record<string, number> = {};
  const excludedBeforeCohort = (reason: string) => { preExclusions[reason] = (preExclusions[reason] ?? 0) + 1; };
  for (const game of selectedGames) {
    const types = typeResult.results.filter(row => row.appid === game.appid && row.verified === 1 && atOrBefore(row.retrieved_at, asOf) && safeEvidenceSource(row.source_url));
    const distinctTypes = [...new Set(types.map(row => row.app_type))];
    const appType = distinctTypes.length === 1 ? distinctTypes[0] : distinctTypes.length ? 'conflicting' : 'unknown';
    const releases = releaseResult.results.filter(row => row.appid === game.appid && atOrBefore(row.retrieved_at, asOf));
    const hasBasis = releases.some(row => row.release_basis === selection.basis && row.verified === 1 && row.date_precision === 'day' && row.release_status === 'released' && validReleaseDay(row.release_date) && safeEvidenceSource(row.source_url));
    if (!hasBasis) missingReleaseEvidenceCount++;
    const candidates = rows.filter(row => row.appid === game.appid);
    const metricValues = candidates.map(row => ({ value: ['observed','reported'].includes(row.evidence_status) && typeof row.value === 'number' && Number.isFinite(row.value) && row.value >= 0 ? row.value : null, missingReason: ['observed','reported'].includes(row.evidence_status) ? 'missing_metric' : 'unsupported_evidence_status' }));
    const values = [...new Set(metricValues.filter(item => item.value !== null).map(item => item.value))];
    const metricValue = values.length === 1 ? values[0]! : null;
    const missingReason = values.length > 1 ? 'conflicting_duplicate_values' : values.length ? null : (candidates.length ? metricValues[0].missingReason : selection.metric.startsWith('reviews') && selection.metric !== 'reviews' ? 'review_activity_source_gate_unvalidated' : 'missing_in_selected_observation_set');
    const representative = metricValue === null ? null : candidates.find(row => ['observed','reported'].includes(row.evidence_status) && row.value === metricValue) ?? null;
    const reasons: string[] = [];
    if (!atOrBefore(game.admitted_at ?? game.collected_at, asOf)) reasons.push('population_not_recorded_by_as_of');
    if (appType !== 'game') { reasons.push(appType === 'conflicting' ? 'conflicting_application_type' : appType === 'unknown' ? 'unverified_application_type' : 'excluded_application_type'); typeExcludedCount++; }
    else typeEligibleCount++;
    if (reasons.length) excludedBeforeCohort(reasons[0]);
    const record: ResearchAuditRow = {
      appid: game.appid, name: game.name, genre: game.genre, savedCohort: game.cohort_id, appType, eligible: false, reasons,
      releaseDate: null, legacyDisplayDate: game.release_display, igdbFirstReleaseDate: game.first_release_at,
      evidence: releases.map(row => ({ basis: row.release_basis, date: row.release_date, precision: row.date_precision, verified: row.verified === 1 && safeEvidenceSource(row.source_url), status: row.release_status, phase: row.phase, source: row.source_url, retrievedAt: row.retrieved_at, note: row.verification_note })),
      observation: { value: metricValue, missingReason, collectedAt: representative?.collected_at ?? null, measuredAt: representative?.measured_at ?? null, sourceUrl: representative?.source_url ?? null },
    };
    audit.push(record);
    if (reasons.length) continue;
    const genres = game.genre === UNRESOLVED ? [] : [game.genre];
    // Cartesian fragments preserve ALL release and metric candidates; the foundation deduplicates per app.
    const releaseFragments = releases.length ? releases : [null];
    const metrics = metricValues.length ? metricValues : [{ value: null, missingReason: missingReason! }];
    for (const release of releaseFragments) for (const metric of metrics) inputs.push({
      appId: game.appid, genres,
      releases: release ? { [release.release_basis === 'first_playable' ? 'firstPlayableSteam' : 'fullReleaseSteam']: {
        date: release.release_date, precision: release.date_precision, verified: release.verified === 1 && safeEvidenceSource(release.source_url), status: release.release_status,
        ...(release.phase ? { phase: release.phase } : {}), source: release.source_url, retrievedAt: release.retrieved_at, confidence: release.verified ? 'verified' : 'unverified', verificationNote: release.verification_note,
      } } : {},
      metrics: { [selection.metric]: metric },
    });
  }
  const analysis = analyzeGenres(inputs, { window: releaseWindow, releaseBasis: selection.basis, metric: selection.metric, genreUniverse: [...new Set(selectedGames.map(game => game.genre).filter(genre => genre !== UNRESOLVED))] });
  for (const record of audit) {
    const eligible = analysis.cohort.eligibleGames.find(game => Number(game.appId) === record.appid);
    const excluded = analysis.cohort.excludedGames.find(game => Number(game.appId) === record.appid);
    if (eligible) { record.eligible = true; record.releaseDate = eligible.releaseDate; }
    if (excluded) record.reasons.push(excluded.reason);
  }
  return {
    version: 'release-research-v1', mode: 'read_only_saved_evidence', selection: { ...selection, ...(selected ? { snapshot: selected.id } : {}) }, releaseWindow, reviewWindows,
    population: { id: selection.population, label: populations[selection.population], inventoryCount: gameResult.results.length, selectedCount: selectedGames.length, typeEligibleCount, typeExcludedCount, unresolvedGenreCount: selectedGames.filter(game => game.genre === UNRESOLVED).length, missingReleaseEvidenceCount, taxonomyVersions: [...new Set(selectedGames.map(game => game.taxonomy_version ?? 'editorial-cohort-1.0'))].sort(), note: 'Existing saved sample only. No 300-game panel or all-Steam release census has been allocated. Verified game-type evidence is required; demos, DLC, tools, soundtracks, unknown and conflicting types are excluded before cohort statistics.' },
    observations: { selected, available, status: selected ? 'saved_compatible_observation_set' : 'unavailable', note: selected ? 'One exact metric/run/method/scope/unit set. Missing games are not backfilled from older runs. Collection times span the saved run; these are not simultaneous or live readings. Source measurement timestamps may be unknown.' : 'No compatible saved observations. Seven- and 30-day review activity remain unavailable: six feasibility windows do not establish a production-wide validated source contract.' },
    cohort: { eligibleCount: analysis.cohort.eligibleCount, excludedCount: selectedGames.length-analysis.cohort.eligibleCount, exclusionCounts: { ...preExclusions, ...analysis.cohort.exclusionCounts }, unclassifiedAppIds: analysis.unclassifiedAppIds },
    statisticVersion: analysis.statisticVersion, releasePolicyVersion: analysis.cohort.releasePolicyVersion, genres: analysis.genres, audit,
    notes: [
      'Application-type verification can be a manually reviewed classification from an exact official Steam product page, with positive game identity, standalone offer and gameplay evidence. It is not necessarily a retained API app_type field. The five-game pilot uses this explicit manual method; 298 reconstructed catalog classifications are not promoted by it.',
      'First playable means the first public playable Steam release, including Early Access. Full release means separately verified Steam 1.0. Neither basis falls back to the other.',
      'Legacy store display dates and IGDB release/platform dates are reference evidence only. They never establish first Steam playability or Steam 1.0 in this view.',
      'Release membership uses [start inclusive, end exclusive) in UTC. A verified day is midnight UTC: a rolling cutoff later that day excludes that start-day release. The unknown launch hour is not inferred.',
      'Release-cohort windows and 7/30 elapsed-day review-activity windows are independent. One calendar month is not 30 days.',
      'AsOf is an explicit evaluation cutoff. Evidence/observations recorded after it are excluded. Current saved cohort/genre mappings are used; historical membership changes and historical taxonomy cannot be reconstructed here.',
      'One equal weight per eligible observed game per genre. Current adapter retains one saved editorial genre; unresolved mappings remain in the audit. New multi-label tag taxonomy is not inferred.',
      'Median is primary; arithmetic mean, R7 quartiles/IQR and largest-game share describe dispersion and concentration. Fewer than 5 observations is insufficient; 5–9 is low sample. Trimmed mean removes 10% per tail only at n ≥ 20.',
      'No new calibrated Popularity Score or ranking is created. Overview/Search retain their labeled legacy provisional scores.',
    ],
  };
}
function safeEvidenceSource(source: string): boolean {
  try { const url = new URL(source); return ['https:','http:'].includes(url.protocol); } catch { return false; }
}

function validReleaseDay(value: string | null): boolean {
  try { parseUtcDay(value); return true; } catch { return false; }
}
