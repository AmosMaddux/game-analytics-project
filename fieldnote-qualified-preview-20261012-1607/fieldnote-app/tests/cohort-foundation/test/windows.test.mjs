import test from 'node:test';
import assert from 'node:assert/strict';
import { parseUtcDay, parseUtcInstant, resolveReleaseWindow, resolveReviewWindows, toInclusiveEpochSeconds, validateReleaseWindow } from '../../../backend/cohort-foundation/windows.mjs';

const asOf = '2024-03-31T12:34:56.789Z';
test('all preset windows are deterministic, clamped, half-open UTC intervals', () => {
  const starts = { '7d':'2024-03-24', '14d':'2024-03-17', '21d':'2024-03-10', '1m':'2024-02-29', '2m':'2024-01-31', '3m':'2023-12-31', '1y':'2023-03-31' };
  for (const [preset, day] of Object.entries(starts)) {
    const window = resolveReleaseWindow({ preset, asOf });
    assert.equal(window.startInclusive, `${day}T12:34:56.789Z`);
    assert.equal(window.endExclusive, asOf);
    assert.equal(window.timeZone, 'UTC');
    assert.ok(Object.isFrozen(window));
    assert.deepEqual(window, resolveReleaseWindow({ preset, asOf: new Date(asOf) }));
  }
});
test('year subtraction clamps leap day while months use one direct subtraction', () => {
  assert.equal(resolveReleaseWindow({ preset:'1y', asOf:'2024-02-29T00:00:00Z' }).startInclusive, '2023-02-28T00:00:00.000Z');
  assert.equal(resolveReleaseWindow({ preset:'2m', asOf:'2024-03-31T00:00:00Z' }).startInclusive, '2024-01-31T00:00:00.000Z');
  assert.equal(resolveReleaseWindow({ preset:'1m', asOf:'2023-03-31T00:00:00Z' }).startInclusive, '2023-02-28T00:00:00.000Z');
});
test('custom dates include end day and do not silently clip requested window', () => {
  const window = resolveReleaseWindow({ preset:'custom', asOf, startDate:'2024-02-29', endDate:'2024-03-31' });
  assert.equal(window.startInclusive, '2024-02-29T00:00:00.000Z');
  assert.equal(window.endExclusive, '2024-04-01T00:00:00.000Z');
  assert.equal(window.asOf, asOf);
  assert.throws(() => resolveReleaseWindow({ preset:'custom', asOf, startDate:'2024-04-01', endDate:'2024-03-31' }), /startDate/);
});
test('review lookbacks are 7 and 30 elapsed UTC days, separate from release cohorts', () => {
  const reviews = resolveReviewWindows({ asOf });
  assert.equal(reviews.reviews7d.startInclusive, '2024-03-24T12:34:56.789Z');
  assert.equal(reviews.reviews30d.startInclusive, '2024-03-01T12:34:56.789Z');
  assert.equal(reviews.reviews30d.kind, 'review_activity');
  assert.throws(() => validateReleaseWindow(reviews.reviews30d), /release_cohort/);
});
test('strict date validation rejects normalized invalid dates and ambiguous instants', () => {
  for (const value of ['2023-02-29','2024-02-30','2024-13-01','2024-00-01','2024-01-00','0000-01-01','24-01-01']) assert.throws(() => parseUtcDay(value));
  assert.equal(new Date(parseUtcDay('0001-01-01')).toISOString(), '0001-01-01T00:00:00.000Z');
  for (const value of [undefined,'2024-03-31','2024-03-31T12:00:00','2024-03-31T24:00:00Z','2024-03-31T00:60:00Z','2024-03-31T00:00:60Z','2024-03-31T00:00:00+00:00','2024-02-30T00:00:00Z']) assert.throws(() => parseUtcInstant(value));
  assert.throws(() => resolveReleaseWindow({ preset:'30d',asOf }), /Unsupported/);
  assert.throws(() => resolveReleaseWindow({ preset:'7d',asOf,startDate:'2024-01-01' }), /Custom dates/);
});
test('inclusive-second conversion subtracts one second and rejects precision loss', () => {
  const window = resolveReleaseWindow({ preset:'custom', asOf, startDate:'2024-03-01', endDate:'2024-03-01' });
  const seconds = toInclusiveEpochSeconds(window);
  assert.equal(seconds.end - seconds.start + 1, 86400);
  assert.equal(new Date(seconds.end * 1000).toISOString(), '2024-03-01T23:59:59.000Z');
  assert.throws(() => toInclusiveEpochSeconds(resolveReleaseWindow({ preset:'7d',asOf })), /second-aligned/);
});
