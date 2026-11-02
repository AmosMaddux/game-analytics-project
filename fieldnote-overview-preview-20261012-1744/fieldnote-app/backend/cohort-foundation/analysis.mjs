import { filterReleaseCohort } from './releases.mjs';
import { STATISTIC_VERSION, summarizeValues } from './statistics.mjs';

function numericMetric(value) {
  if (!Number.isFinite(value)) return { value: null, reason: 'nonfinite_metric' };
  if (value < 0) return { value: null, reason: 'negative_metric' };
  return { value };
}

function metricCandidate(raw) {
  if (raw === undefined || raw === null) return { value: null, reason: 'missing_metric' };
  if (typeof raw === 'number') return numericMetric(raw);
  if (typeof raw !== 'object' || Array.isArray(raw)) return { value: null, reason: 'invalid_metric' };
  if (raw.value === undefined || raw.value === null) return { value: null, reason: typeof raw.missingReason === 'string' && raw.missingReason.trim() ? raw.missingReason.trim() : 'missing_metric' };
  if (typeof raw.value !== 'number') return { value: null, reason: 'invalid_metric' };
  return numericMetric(raw.value);
}

function resolveMetric(game, metric) {
  const candidates = game.metricRows.map(row => metricCandidate(Object.hasOwn(row, metric) ? row[metric] : undefined));
  const values = [...new Set(candidates.filter(item => item.value !== null).map(item => item.value))];
  const missingReasons = [...new Set(candidates.filter(item => item.value === null).map(item => item.reason))].sort();
  if (values.length > 1) return { appId: game.appId, value: null, reason: 'conflicting_duplicate_values', conflictingValues: values.sort((a, b) => a - b), candidateMissingReasons: missingReasons };
  if (values.length === 1) return { appId: game.appId, value: values[0], candidateMissingReasons: missingReasons };
  return { appId: game.appId, value: null, reason: missingReasons.length === 1 ? missingReasons[0] : 'multiple_missing_reasons', candidateMissingReasons: missingReasons };
}

/** Each unique eligible app has equal weight once in each of its genre labels. */
export function analyzeGenres(games, { window, releaseBasis = 'first_playable', metric, genreUniverse = [] } = {}) {
  if (typeof metric !== 'string' || !metric.trim()) throw new TypeError('A nonempty metric name is required');
  if (!Array.isArray(genreUniverse) || genreUniverse.some(genre => typeof genre !== 'string' || !genre.trim())) throw new TypeError('genreUniverse must contain nonempty genre names');
  const cohort = filterReleaseCohort(games, { window, releaseBasis });
  const genreGames = new Map([...new Set(genreUniverse.map(genre => genre.trim()))].map(genre => [genre, []]));
  const unclassifiedAppIds = [];
  for (const game of cohort.eligibleGames) {
    const observation = resolveMetric(game, metric);
    if (game.genres.length === 0) unclassifiedAppIds.push(game.appId);
    for (const genre of game.genres) {
      if (!genreGames.has(genre)) genreGames.set(genre, []);
      genreGames.get(genre).push(observation);
    }
  }
  const genres = [...genreGames.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([genre, observations]) => {
    const observed = observations.filter(item => item.value !== null);
    const missing = observations.filter(item => item.value === null);
    const counts = new Map();
    for (const item of missing) counts.set(item.reason, (counts.get(item.reason) ?? 0) + 1);
    const missingReasonCounts = Object.fromEntries(counts);
    return { genre, eligibleCount: observations.length, observedCount: observed.length, missingCount: missing.length, coveragePercent: observations.length ? observed.length / observations.length * 100 : null, ...summarizeValues(observed.map(item => item.value)), values: observed, missing, missingReasonCounts };
  });
  return { statisticVersion: STATISTIC_VERSION, metric, weighting: 'one-equal-weight-per-unique-app-per-genre', multilabel: true, unclassifiedAppIds, cohort, genres };
}
