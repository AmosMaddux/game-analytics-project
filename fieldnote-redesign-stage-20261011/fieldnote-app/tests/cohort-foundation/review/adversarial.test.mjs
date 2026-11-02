import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveReleaseWindow,
  resolveReviewWindows,
  filterReleaseCohort,
  analyzeGenres,
  summarizeValues,
  toInclusiveEpochSeconds,
} from '../../../backend/cohort-foundation/index.mjs';

// Independent review fixtures: expected dates and statistics are deliberately
// specified rather than calculated with the implementation's helpers.
test('review: calendar-month subtraction clamps Gregorian month ends', () => {
  const fixtures = [
    ['2024-03-31T00:00:00.000Z', '1m', '2024-02-29T00:00:00.000Z'],
    ['2025-03-31T00:00:00.000Z', '1m', '2025-02-28T00:00:00.000Z'],
    ['2025-01-31T00:00:00.000Z', '2m', '2024-11-30T00:00:00.000Z'],
    ['2025-05-31T00:00:00.000Z', '3m', '2025-02-28T00:00:00.000Z'],
    ['2100-03-31T00:00:00.000Z', '1m', '2100-02-28T00:00:00.000Z'],
    ['2000-03-31T00:00:00.000Z', '1m', '2000-02-29T00:00:00.000Z'],
  ];
  for (const [asOf, preset, startInclusive] of fixtures) {
    const result = resolveReleaseWindow({ preset, asOf });
    assert.equal(result.startInclusive, startInclusive, `${asOf} minus ${preset}`);
    assert.equal(result.endExclusive, asOf);
    assert.equal(result.timeZone, 'UTC');
  }
});

test('review: calendar year and fixed review days remain different concepts', () => {
  const asOf = '2024-02-29T00:00:00.000Z';
  assert.equal(resolveReleaseWindow({ preset: '1y', asOf }).startInclusive,
    '2023-02-28T00:00:00.000Z');
  const monthAsOf = '2024-03-31T00:00:00.000Z';
  assert.equal(resolveReleaseWindow({ preset: '1m', asOf: monthAsOf }).startInclusive,
    '2024-02-29T00:00:00.000Z');
  const windows = resolveReviewWindows({ asOf: monthAsOf });
  assert.equal(windows.reviews30d.startInclusive, '2024-03-01T00:00:00.000Z');
  assert.equal(windows.reviews7d.startInclusive, '2024-03-24T00:00:00.000Z');
  assert.equal(windows.reviews30d.endExclusive, monthAsOf);
});

test('review: week presets mean exactly 7, 14, and 21 UTC days across a DST date', () => {
  const asOf = '2024-03-17T00:00:00.000Z';
  for (const [preset, expected] of [
    ['7d', '2024-03-10T00:00:00.000Z'],
    ['14d', '2024-03-03T00:00:00.000Z'],
    ['21d', '2024-02-25T00:00:00.000Z'],
  ]) {
    assert.equal(resolveReleaseWindow({ preset, asOf }).startInclusive, expected);
  }
});

test('review: custom inclusive end days convert to the following UTC midnight', () => {
  const asOf = '2026-10-11T00:00:00.000Z';
  for (const [startDate, endDate, expectedEnd] of [
    ['2024-02-29', '2024-02-29', '2024-03-01T00:00:00.000Z'],
    ['2024-12-31', '2025-01-01', '2025-01-02T00:00:00.000Z'],
    ['2025-04-30', '2025-04-30', '2025-05-01T00:00:00.000Z'],
  ]) {
    const result = resolveReleaseWindow({ preset: 'custom', asOf, startDate, endDate });
    assert.equal(result.startInclusive, `${startDate}T00:00:00.000Z`);
    assert.equal(result.endExclusive, expectedEnd);
  }
});

test('review: invalid literal dates must not be normalized into valid cohorts', () => {
  const asOf = '2026-10-11T00:00:00.000Z';
  for (const badDate of ['2025-02-29', '2100-02-29', '2024-02-30', '2025-04-31', '2025-13-01']) {
    assert.throws(() => resolveReleaseWindow({
      preset: 'custom', asOf, startDate: badDate, endDate: '2026-10-11',
    }), badDate);
    assert.throws(() => resolveReleaseWindow({
      preset: 'custom', asOf, startDate: '2024-01-01', endDate: badDate,
    }), badDate);
  }
  assert.throws(() => resolveReleaseWindow({
    preset: 'custom', asOf, startDate: '2025-06-02', endDate: '2025-06-01',
  }));
});

test('review: exact UTC timestamp is frozen without accepting ambiguous local timestamps', () => {
  const asOf = '2024-03-31T12:34:56.789Z';
  const result = resolveReleaseWindow({ preset: '1m', asOf });
  assert.equal(result.startInclusive, '2024-02-29T12:34:56.789Z');
  assert.equal(result.endExclusive, asOf);
  assert.equal(result.asOf, asOf);
  const input = new Date(asOf);
  const copied = resolveReleaseWindow({ preset: '1m', asOf: input });
  input.setUTCFullYear(2020);
  assert.deepEqual(copied, result);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.definition), true);
  for (const badAsOf of ['2024-03-31T12:34:56', '2024-03-31T12:34:56+01:00',
    '2024-03-31T24:00:00Z', '2024-02-30T00:00:00Z']) {
    assert.throws(() => resolveReleaseWindow({ preset: '1m', asOf: badAsOf }));
  }
});

test('review: inclusive-second adapter loses no second and rejects fractional boundaries', () => {
  const window = resolveReleaseWindow({ preset: 'custom',
    asOf: '2026-10-11T00:00:00.000Z', startDate: '2024-02-29', endDate: '2024-02-29' });
  const seconds = toInclusiveEpochSeconds(window);
  assert.equal(seconds.end - seconds.start + 1, 86400);
  assert.equal(new Date(seconds.start * 1000).toISOString(), '2024-02-29T00:00:00.000Z');
  assert.equal(new Date(seconds.end * 1000).toISOString(), '2024-02-29T23:59:59.000Z');
  const fractional = resolveReleaseWindow({ preset: '7d', asOf: '2024-03-31T00:00:00.001Z' });
  assert.throws(() => toInclusiveEpochSeconds(fractional));
});

const release = (date, extra = {}) => ({ date, precision: 'day', verified: true,
  status: 'released', phase: 'full_release', source: 'review-fixture',
  retrievedAt: '2026-10-11T00:00:00.000Z', confidence: 'high', ...extra });
const january = resolveReleaseWindow({ preset: 'custom', asOf: '2026-02-01T00:00:00Z',
  startDate: '2026-01-01', endDate: '2026-01-31' });
const game = (appId, date = '2026-01-15', value = 1, extra = {}) => ({
  appId, genres: ['RPG'], releases: { firstPlayableSteam: release(date) },
  metrics: { reviews7d: value }, ...extra,
});

test('review: releases are filtered before genre counts and outlier statistics', () => {
  const result = analyzeGenres([
    game(1, '2025-12-31', 1e308), game(2, '2026-01-01', 0),
    game(3, '2026-01-31', 2), game(4, '2026-02-01', 1e308),
  ], { window: january, metric: 'reviews7d' });
  assert.equal(result.cohort.eligibleCount, 2);
  assert.deepEqual(result.cohort.eligibleGames.map(item => item.appId), ['2', '3']);
  const [rpg] = result.genres;
  assert.equal(rpg.eligibleCount, 2);
  assert.equal(rpg.n, 2);
  assert.equal(rpg.mean, 1);
  assert.equal(rpg.median, 1);
  assert.equal(rpg.coveragePercent, 100);
  assert.equal(rpg.rankable, false);
});

test('review: EA and 1.0 bases never substitute for each other', () => {
  const games = [
    game(1, '2021-01-01', 1, { releases: {
      firstPlayableSteam: release('2021-01-01', { phase: 'early_access' }),
      fullReleaseSteam: release('2026-01-15'),
    } }),
    game(2, '2026-01-15', 1, { releases: { fullReleaseSteam: release('2026-01-15') } }),
    game(3, '2026-01-15'),
  ];
  const first = filterReleaseCohort(games, { window: january });
  assert.deepEqual(first.eligibleGames.map(item => item.appId), ['3']);
  const full = filterReleaseCohort(games, { window: january, releaseBasis: 'full_release' });
  assert.deepEqual(full.eligibleGames.map(item => item.appId), ['1', '2']);
  assert.equal(full.excludedGames.find(item => item.appId === '3').reason, 'missing_release_date');
});

test('review: unknown, coarse, unverified and coming-soon dates remain excluded', () => {
  const games = [
    game(1, null),
    game(2, '2026-01-15', 1, { releases: { firstPlayableSteam: release('2026-01', { precision: 'month' }) } }),
    game(3, '2026-01-15', 1, { releases: { firstPlayableSteam: release('2026-01-15', { verified: false }) } }),
    game(4, '2026-01-15', 1, { releases: { firstPlayableSteam: release('2026-01-15', { status: 'coming_soon' }) } }),
    game(5, '2026-02-30'),
  ];
  const result = filterReleaseCohort(games, { window: january });
  assert.equal(result.eligibleCount, 0);
  assert.equal(result.excludedCount, 5);
  assert.deepEqual(result.excludedGames.map(item => item.reason), [
    'missing_release_date', 'imprecise_release_date', 'unverified_release_date',
    'not_released', 'invalid_release_date',
  ]);
});

test('review: future releases are excluded even when a custom window extends beyond asOf', () => {
  const window = resolveReleaseWindow({ preset: 'custom', asOf: '2026-10-11T00:00:00Z',
    startDate: '2026-10-01', endDate: '2026-12-31' });
  const result = filterReleaseCohort([game(1, '2026-10-12')], { window });
  assert.equal(result.eligibleCount, 0);
  assert.equal(result.excludedGames[0].reason, 'future_release_date');
});

test('review: canonical duplicate IDs merge once per genre, retain zero and preserve provenance', () => {
  const games = [
    game(1, '2026-01-15', 0, { genres: ['RPG', 'RPG', ' Action ', '__proto__'] }),
    game('001', '2026-01-15', null, { genres: ['RPG', 'Strategy'] }),
    game('1', '2026-01-15', 0, { genres: ['Action'] }),
  ];
  const before = structuredClone(games);
  const result = analyzeGenres(games, { window: january, metric: 'reviews7d' });
  assert.deepEqual(games, before);
  assert.equal(result.cohort.inputRowCount, 3);
  assert.equal(result.cohort.uniqueGameCount, 1);
  assert.equal(result.cohort.duplicateRowCount, 2);
  for (const item of result.genres) {
    assert.equal(item.eligibleCount, 1, item.genre);
    assert.equal(item.observedCount, 1, item.genre);
    assert.equal(item.mean, 0, item.genre);
    assert.equal(item.missingCount, 0, item.genre);
  }
  assert.deepEqual(result.cohort.eligibleGames[0].evidence[0], before[0].releases.firstPlayableSteam);
});

test('review: sparse missing input rows are never reported as duplicate games', () => {
  let result;
  try {
    result = filterReleaseCohort(new Array(1), { window: january });
  } catch (error) {
    assert.ok(error instanceof TypeError || error instanceof RangeError);
    return;
  }
  assert.equal(result.inputRowCount, 1);
  assert.equal(result.uniqueGameCount, 0);
  assert.equal(result.duplicateRowCount, 0);
  assert.equal(result.invalidRows.length, 1);
});

test('review: conflicting duplicate dates and statuses exclude rather than choose a row', () => {
  const dateConflict = filterReleaseCohort([
    game(1, '2026-01-10'), game('001', '2026-01-20'),
  ], { window: january });
  assert.equal(dateConflict.eligibleCount, 0);
  assert.equal(dateConflict.excludedGames[0].reason, 'conflicting_release_dates');
  assert.equal(dateConflict.excludedGames[0].evidence.length, 2);
  const statusConflict = filterReleaseCohort([
    game(1), game('001', '2026-01-15', 1, {
      releases: { firstPlayableSteam: release('2026-01-15', { status: 'planned' }) },
    }),
  ], { window: january });
  assert.equal(statusConflict.eligibleCount, 0);
  assert.equal(statusConflict.excludedGames[0].reason, 'conflicting_release_status');
});

test('review: contradictory cross-basis chronology cannot silently enter the first-playable cohort', () => {
  const games = [game(1, '2026-01-15', 1, { releases: {
    firstPlayableSteam: release('2026-01-15'),
    fullReleaseSteam: release('2025-12-01'),
  } })];
  const result = filterReleaseCohort(games, { window: january });
  assert.equal(result.eligibleCount, 0);
  assert.match(result.excludedGames[0].reason, /conflict|chronolog/);
});

test('review: missing, invalid and conflicting observations never become zeros', () => {
  const result = analyzeGenres([
    game(1, '2026-01-15', 0), game(2, '2026-01-15', null),
    game(3, '2026-01-15', { value: null, missingReason: 'provider_unavailable' }),
    game(4, '2026-01-15', '0'), game(5, '2026-01-15', NaN),
    game(6, '2026-01-15', 1), game('006', '2026-01-15', 2),
  ], { window: january, metric: 'reviews7d', genreUniverse: ['Empty'] });
  const rpg = result.genres.find(item => item.genre === 'RPG');
  assert.equal(rpg.eligibleCount, 6);
  assert.equal(rpg.observedCount, 1);
  assert.equal(rpg.missingCount, 5);
  assert.equal(rpg.n, 1);
  assert.equal(rpg.mean, 0);
  assert.ok(Math.abs(rpg.coveragePercent - 100 / 6) < 1e-12);
  assert.equal(rpg.missingReasonCounts.conflicting_duplicate_values, 1);
  const empty = result.genres.find(item => item.genre === 'Empty');
  assert.equal(empty.eligibleCount, 0);
  assert.equal(empty.mean, null);
  assert.equal(empty.coveragePercent, null);
  const absent = analyzeGenres([game(1, '2026-01-15', null)], {
    window: january, metric: 'reviews7d',
  }).genres[0];
  assert.equal(absent.mean, null);
  assert.equal(absent.coveragePercent, 0);
  assert.equal(absent.missingCount, 1);
});

test('review: user-supplied missing reason labels are own numeric counts', () => {
  const result = analyzeGenres([
    game(1, '2026-01-15', { value: null, missingReason: '__proto__' }),
    game(2, '2026-01-15', { value: null, missingReason: 'constructor' }),
    game(3, '2026-01-15', { value: null, missingReason: 'constructor' }),
  ], { window: january, metric: 'reviews7d' });
  const counts = result.genres[0].missingReasonCounts;
  assert.equal(Object.hasOwn(counts, '__proto__'), true);
  assert.equal(counts.__proto__, 1);
  assert.equal(Object.hasOwn(counts, 'constructor'), true);
  assert.equal(counts.constructor, 2);
});

test('review: negative counts are unavailable for numeric and object metric inputs', () => {
  const result = analyzeGenres([
    game(1, '2026-01-15', -1),
    game(2, '2026-01-15', { value: -2, missingReason: 'ignored_for_supplied_value' }),
    game(3, '2026-01-15', -Infinity),
    game(4, '2026-01-15', { value: -0 }),
    game(5, '2026-01-15', 0),
    game(6, '2026-01-15', 2),
  ], { window: january, metric: 'reviews7d' }).genres[0];
  assert.equal(result.eligibleCount, 6);
  assert.equal(result.observedCount, 3);
  assert.equal(result.missingCount, 3);
  assert.equal(result.missingReasonCounts.negative_metric, 2);
  assert.equal(result.missingReasonCounts.nonfinite_metric, 1);
  assert.equal(result.coveragePercent, 50);
  assert.equal(result.mean, 2 / 3);
  assert.equal(result.median, 0);
  assert.equal(result.largestGameShare, 1);
});

test('review: negative duplicate fragments retain missing reasons without poisoning valid counts', () => {
  const counts = analyzeGenres([
    game(1, '2026-01-15', -1), game('001', '2026-01-15', 0),
    game(2, '2026-01-15', { value: -2 }), game('002', '2026-01-15', { value: 2 }),
    game(3, '2026-01-15', -1), game('003', '2026-01-15', { value: -2 }),
  ], { window: january, metric: 'reviews7d' }).genres[0];
  assert.equal(counts.eligibleCount, 3);
  assert.equal(counts.observedCount, 2);
  assert.equal(counts.missingCount, 1);
  assert.equal(counts.mean, 1);
  assert.equal(counts.missingReasonCounts.negative_metric, 1);
  assert.equal(counts.missingReasonCounts.conflicting_duplicate_values, undefined);
  for (const observed of counts.values) {
    assert.deepEqual(observed.candidateMissingReasons, ['negative_metric']);
  }
});

test('review: review windows cannot be substituted for release cohorts', () => {
  const window = resolveReviewWindows({ asOf: '2026-02-01T00:00:00Z' }).reviews30d;
  assert.throws(() => filterReleaseCohort([game(1)], { window }));
});

test('review: R7 quartiles, trimming floor and sample thresholds have independent fixtures', () => {
  const small = summarizeValues([30, 0, 20, 10]);
  assert.deepEqual([small.q1, small.median, small.q3, small.iqr], [7.5, 15, 22.5, 15]);
  assert.equal(small.rankable, false);
  for (const [n, trim, remaining] of [[19, null, null], [20, 2, 16], [29, 2, 25], [30, 3, 24]]) {
    const result = summarizeValues(Array.from({ length: n }, (_, index) => index + 1));
    assert.equal(result.trimmedCountPerTail, trim, `n=${n}`);
    assert.equal(result.trimmedN, remaining, `n=${n}`);
    assert.equal(result.trimmedMean10, n < 20 ? null : (n + 1) / 2, `n=${n}`);
  }
  for (const [n, status] of [[4, 'insufficient_sample'], [5, 'low_sample'], [9, 'low_sample'], [10, 'adequate_sample']]) {
    assert.equal(summarizeValues(Array(n).fill(1)).sampleStatus, status);
  }
});

test('review: overflow, underflow and outliers do not corrupt representative statistics', () => {
  const maximum = Number.MAX_VALUE;
  const huge = summarizeValues([maximum, maximum]);
  assert.deepEqual([huge.mean, huge.median, huge.q1, huge.q3], Array(4).fill(maximum));
  assert.equal(huge.largestGameShare, 0.5);
  const tiny = summarizeValues([Number.MIN_VALUE, Number.MIN_VALUE]);
  assert.equal(tiny.mean, Number.MIN_VALUE);
  assert.equal(tiny.largestGameShare, 0.5);
  const outlier = summarizeValues([...Array(19).fill(1), maximum]);
  assert.equal(outlier.median, 1);
  assert.equal(outlier.trimmedMean10, 1);
  assert.ok(Number.isFinite(outlier.mean));
  assert.ok(outlier.mean > 1e306);
  assert.equal(outlier.iqr, 0);
  assert.equal(outlier.largestGameShare, 1);
  const cancellation = summarizeValues([maximum, 1, -maximum]);
  assert.equal(cancellation.mean, 1 / 3);
  assert.equal(cancellation.largestGameShare, null);
});

test('review: statistics never coerce missing, text or infinite inputs', () => {
  for (const value of [null, undefined, '0', false, NaN, Infinity, -Infinity]) {
    assert.throws(() => summarizeValues([0, value]));
  }
  assert.throws(() => summarizeValues(new Array(5)));
  const input = Object.freeze([4, 2, 1, 3]);
  summarizeValues(input);
  assert.deepEqual(input, [4, 2, 1, 3]);
});
