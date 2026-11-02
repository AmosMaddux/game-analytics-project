import { parseUtcDay, validateReleaseWindow } from './windows.mjs';

export const RELEASE_POLICY_VERSION = 'verified-day-release-v1';
const BASES = Object.freeze({ first_playable: 'firstPlayableSteam', full_release: 'fullReleaseSteam', igdb_pc: 'igdbPcRelease' });
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function canonicalAppId(value) {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value > 0 ? String(value) : null;
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? String(number) : null;
}

/** Duplicate rows are metadata fragments, never independent game observations. */
function normalizeGames(games) {
  if (!Array.isArray(games)) throw new TypeError('games must be an array');
  const byId = new Map();
  const invalidRows = [];
  const diagnostics = [];
  for (const [rowIndex, row] of games.entries()) {
    const appId = isRecord(row) ? canonicalAppId(row.appId) : null;
    if (appId === null) {
      invalidRows.push({ rowIndex, appId: row?.appId ?? null, reason: 'invalid_app_id' });
      continue;
    }
    if (!byId.has(appId)) byId.set(appId, { appId, genres: new Set(), releaseEvidence: { firstPlayableSteam: [], fullReleaseSteam: [], igdbPcRelease: [] }, metricRows: [], sourceRowCount: 0 });
    const game = byId.get(appId);
    game.sourceRowCount += 1;
    if (row.genres !== undefined && !Array.isArray(row.genres)) diagnostics.push({ appId, rowIndex, reason: 'invalid_genres' });
    if (Array.isArray(row.genres)) for (const genre of row.genres) {
      if (typeof genre === 'string' && genre.trim()) game.genres.add(genre.trim());
      else diagnostics.push({ appId, rowIndex, reason: 'invalid_genre' });
    }
    if (row.releases !== undefined && !isRecord(row.releases)) diagnostics.push({ appId, rowIndex, reason: 'invalid_releases' });
    for (const field of Object.values(BASES)) {
      const evidence = row.releases?.[field];
      if (evidence !== undefined && evidence !== null) game.releaseEvidence[field].push(isRecord(evidence) ? { ...evidence } : { invalid: true, suppliedValue: evidence });
    }
    if (row.metrics !== undefined && !isRecord(row.metrics)) diagnostics.push({ appId, rowIndex, reason: 'invalid_metrics' });
    game.metricRows.push(isRecord(row.metrics) ? { ...row.metrics } : {});
  }
  const uniqueGames = [...byId.values()].map(game => ({ ...game, genres: [...game.genres].sort() })).sort((a, b) => Number(a.appId) - Number(b.appId));
  return { uniqueGames, invalidRows, diagnostics, inputRowCount: games.length, uniqueGameCount: uniqueGames.length, duplicateRowCount: games.length - invalidRows.length - uniqueGames.length };
}

function evaluateEvidence(evidence, releaseBasis) {
  if (evidence.invalid) return { reason: 'invalid_release_evidence' };
  if (evidence.status !== 'released') return { reason: evidence.status === 'planned' || evidence.status === 'coming_soon' ? 'not_released' : 'unverified_playability' };
  if (evidence.verified !== true) return { reason: 'unverified_release_date' };
  if (releaseBasis === 'full_release' && evidence.phase !== undefined && evidence.phase !== 'full_release') return { reason: 'invalid_release_phase' };
  if (evidence.date === undefined || evidence.date === null || evidence.date === '') return { reason: 'missing_release_date' };
  if (evidence.precision !== 'day') return { reason: 'imprecise_release_date' };
  try { return { releaseMs: parseUtcDay(evidence.date) }; }
  catch { return { reason: 'invalid_release_date' }; }
}

function resolveEvidence(game, releaseBasis, boundaries) {
  const evidence = game.releaseEvidence[BASES[releaseBasis]];
  if (evidence.length === 0) return { reason: 'missing_release_date', evidence, evidenceIssues: [] };
  const evaluated = evidence.map(item => ({ evidence: item, ...evaluateEvidence(item, releaseBasis) }));
  const usable = evaluated.filter(item => item.releaseMs !== undefined);
  const evidenceIssues = evaluated.filter(item => item.reason !== undefined).map(({ evidence: item, reason }) => ({ reason, evidence: item }));
  const common = { evidence, evidenceIssues };
  const dates = [...new Set(usable.map(item => item.releaseMs))];
  if (dates.length > 1) return { ...common, reason: 'conflicting_release_dates' };
  // An explicit planned state alongside released evidence needs reconciliation.
  if (usable.length && evidenceIssues.some(item => item.reason === 'not_released')) return { ...common, reason: 'conflicting_release_status' };
  if (!dates.length) {
    const reasons = [...new Set(evidenceIssues.map(item => item.reason))].sort();
    return { ...common, reason: reasons.length === 1 ? reasons[0] : 'unresolved_release_evidence', unresolvedReasons: reasons };
  }
  const releaseMs = dates[0];
  const resolved = { ...common, releaseDate: new Date(releaseMs).toISOString().slice(0, 10) };
  if (releaseMs > boundaries.asOf) return { ...resolved, reason: 'future_release_date' };
  if (releaseMs < boundaries.start || releaseMs >= boundaries.end) return { ...resolved, reason: 'outside_release_window' };
  return resolved;
}

/** Dedupe, resolve chosen release evidence, then apply [start, end) and asOf. */
export function filterReleaseCohort(games, { window, releaseBasis = 'first_playable' } = {}) {
  if (!Object.hasOwn(BASES, releaseBasis)) throw new RangeError(`Unsupported release basis: ${String(releaseBasis)}`);
  const boundaries = validateReleaseWindow(window);
  const normalized = normalizeGames(games);
  const eligibleGames = [];
  const excludedGames = [];
  const exclusionCounts = {};
  for (const game of normalized.uniqueGames) {
    let resolution = resolveEvidence(game, releaseBasis, boundaries);
    // Full 1.0 necessarily proves playability by that date. Contradictory
    // verified chronology cannot be repaired by choosing whichever filter fits.
    const firstDates = game.releaseEvidence.firstPlayableSteam.map(item => evaluateEvidence(item, 'first_playable')).filter(item => item.releaseMs !== undefined).map(item => item.releaseMs);
    const fullDates = game.releaseEvidence.fullReleaseSteam.map(item => evaluateEvidence(item, 'full_release')).filter(item => item.releaseMs !== undefined).map(item => item.releaseMs);
    if (firstDates.some(first => fullDates.some(full => full < first))) resolution = { ...resolution, reason: 'conflicting_release_chronology' };
    if (resolution.reason) {
      excludedGames.push({ appId: game.appId, genres: game.genres, sourceRowCount: game.sourceRowCount, releaseEvidence: game.releaseEvidence, ...resolution });
      exclusionCounts[resolution.reason] = (exclusionCounts[resolution.reason] ?? 0) + 1;
    } else eligibleGames.push({ ...game, ...resolution });
  }
  const { uniqueGames, ...countsAndDiagnostics } = normalized;
  return { releasePolicyVersion: RELEASE_POLICY_VERSION, window, releaseBasis, ...countsAndDiagnostics, eligibleCount: eligibleGames.length, excludedCount: excludedGames.length, eligibleGames, excludedGames, exclusionCounts };
}
