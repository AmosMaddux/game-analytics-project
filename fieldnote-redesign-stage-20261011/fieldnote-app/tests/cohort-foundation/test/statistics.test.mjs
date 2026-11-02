import test from 'node:test';
import assert from 'node:assert/strict';
import { STATISTIC_VERSION, summarizeValues } from '../../../backend/cohort-foundation/statistics.mjs';

test('exports a statistic version and an explicit empty result', () => {
  assert.equal(STATISTIC_VERSION, 'r7-trim10-floor-v1');
  assert.deepEqual(summarizeValues([]), {
    n: 0, mean: null, median: null, q1: null, q3: null, iqr: null,
    iqrStatus: 'empty', trimmedMean10: null, trimmedCountPerTail: null,
    trimmedN: null, sampleStatus: 'insufficient_sample', rankable: false,
    largestGameShare: null, largestGameShareStatus: 'empty',
  });
});

test('one value and genuine zeros remain measured observations', () => {
  const singleton = summarizeValues([7]);
  assert.equal(singleton.n, 1);
  for (const key of ['mean', 'median', 'q1', 'q3']) assert.equal(singleton[key], 7);
  assert.equal(singleton.iqr, 0);
  assert.equal(singleton.iqrStatus, 'available');
  assert.equal(singleton.largestGameShare, 1);
  assert.equal(singleton.largestGameShareStatus, 'available');

  for (const values of [[0], [0, 0, 0, 0, 0], [-0, 0]]) {
    const summary = summarizeValues(values);
    assert.equal(summary.n, values.length);
    assert.equal(summary.mean, 0);
    assert.equal(summary.iqr, 0);
    assert.equal(summary.largestGameShare, null);
    assert.equal(summary.largestGameShareStatus, 'zero_total');
  }
});

test('rejects missing, nonnumeric, infinite, NaN, and sparse input', () => {
  for (const input of [undefined, null, 1, '1', {}, new Float64Array([1])]) {
    assert.throws(() => summarizeValues(input), TypeError);
  }
  for (const value of [undefined, null, '2', false, NaN, Infinity, -Infinity, 1n, {}]) {
    assert.throws(() => summarizeValues([1, value]), /values\[1\] must be a finite number/);
  }
  assert.throws(() => summarizeValues(new Array(3)), /values\[0\]/);
  assert.throws(() => summarizeValues([1, , 3]), /values\[1\]/);
});

test('R7 reference quartiles interpolate rather than use median-of-halves', () => {
  const cases = [
    { values: [1, 2], expected: [1.25, 1.5, 1.75, 0.5] },
    { values: [1, 2, 3, 4], expected: [1.75, 2.5, 3.25, 1.5] },
    { values: [0, 10, 20, 30, 40], expected: [10, 20, 30, 20] },
    { values: [0, 2, 5, 9, 15, 20], expected: [2.75, 7, 13.5, 10.75] },
  ];
  for (const { values, expected } of cases) {
    const result = summarizeValues(values);
    assert.deepEqual([result.q1, result.median, result.q3, result.iqr], expected);
  }
});

test('sample labels and ranking eligibility use explicit n boundaries', () => {
  for (const n of [0, 1, 4, 5, 9, 10, 19, 20]) {
    const result = summarizeValues(Array(n).fill(2));
    assert.equal(result.sampleStatus,
      n < 5 ? 'insufficient_sample' : n < 10 ? 'low_sample' : 'adequate_sample');
    assert.equal(result.rankable, n >= 5);
  }
});

test('10% per-tail trimming starts at 20 and uses floor for 29', () => {
  const nineteen = summarizeValues(Array.from({ length: 19 }, (_, i) => i + 1));
  assert.equal(nineteen.trimmedMean10, null);
  assert.equal(nineteen.trimmedCountPerTail, null);
  assert.equal(nineteen.trimmedN, null);

  const twenty = summarizeValues(Array.from({ length: 20 }, (_, i) => i + 1));
  assert.equal(twenty.trimmedCountPerTail, 2);
  assert.equal(twenty.trimmedN, 16);
  assert.equal(twenty.trimmedMean10, 10.5);

  // The high tail is asymmetric, so rounding trim=2.9 up to 3 changes the mean.
  const values = [...Array.from({ length: 26 }, (_, i) => i + 1), 100, 1000, 10000];
  const twentyNine = summarizeValues(values);
  assert.equal(twentyNine.trimmedCountPerTail, 2);
  assert.equal(twentyNine.trimmedN, 25);
  assert.equal(twentyNine.trimmedMean10, 448 / 25);
});

test('an extreme hit changes raw mean and share, not the primary median', () => {
  const result = summarizeValues([...Array(19).fill(1), 1_000_000]);
  assert.equal(result.mean, 1_000_019 / 20);
  assert.equal(result.median, 1);
  assert.equal(result.q1, 1);
  assert.equal(result.q3, 1);
  assert.equal(result.iqr, 0);
  assert.equal(result.trimmedMean10, 1);
  assert.equal(result.largestGameShare, 1_000_000 / 1_000_019);
});

test('input order and frozen arrays are preserved', () => {
  const input = Object.freeze([10, 1, 4, 2, 7]);
  const before = [...input];
  const result = summarizeValues(input);
  assert.deepEqual(input, before);
  assert.equal(result.median, 4);
  assert.equal(result.mean, 4.8);
});

test('MAX_VALUE repeated remains finite in mean, quartiles, trimming, and share', () => {
  for (const n of [1, 2, 3, 5, 20, 29, 1000]) {
    const result = summarizeValues(Array(n).fill(Number.MAX_VALUE));
    for (const key of ['mean', 'median', 'q1', 'q3']) {
      assert.equal(result[key], Number.MAX_VALUE, `${key} at n=${n}`);
    }
    assert.equal(result.iqr, 0);
    assert.equal(result.iqrStatus, 'available');
    assert.equal(result.largestGameShare, 1 / n);
    assert.equal(result.largestGameShareStatus, 'available');
    if (n >= 20) assert.equal(result.trimmedMean10, Number.MAX_VALUE);
  }
});

test('nonuniform huge nonnegative observations do not overflow intermediate sums', () => {
  const maximum = Number.MAX_VALUE;
  const result = summarizeValues([maximum / 2, maximum, maximum]);
  assert.ok(Number.isFinite(result.mean));
  assert.equal(result.median, maximum);
  assert.equal(result.q3, maximum);
  assert.equal(result.largestGameShare, 0.4);
  assert.equal(result.largestGameShareStatus, 'available');
  const pair = summarizeValues([0, maximum]);
  assert.equal(pair.mean, maximum / 2);
  assert.equal(pair.q1, maximum / 4);
  assert.equal(pair.median, maximum / 2);
  assert.equal(pair.q3, maximum * 0.75);
});

test('signed extremes cancel without losing a small residual', () => {
  const maximum = Number.MAX_VALUE;
  for (const values of [[maximum, 1, -maximum], [-maximum, maximum, 1], [1, -maximum, maximum]]) {
    const result = summarizeValues(values);
    assert.equal(result.mean, 1 / 3);
    assert.equal(result.median, 1);
    assert.equal(result.largestGameShare, null);
    assert.equal(result.largestGameShareStatus, 'contains_negative');
  }
  assert.equal(summarizeValues([maximum, maximum, -maximum, -maximum, 1]).mean, 0.2);
  assert.equal(summarizeValues([-maximum, maximum]).mean, 0);
  assert.equal(summarizeValues([-maximum, maximum]).median, 0);
  assert.equal(summarizeValues([-maximum, maximum]).iqr, maximum);
});

test('true IQR overflow is explicit while other signed statistics stay available', () => {
  const maximum = Number.MAX_VALUE;
  const result = summarizeValues([-maximum, -maximum, maximum, maximum]);
  assert.equal(result.mean, 0);
  assert.equal(result.median, 0);
  assert.equal(result.q1, -maximum);
  assert.equal(result.q3, maximum);
  assert.equal(result.iqr, null);
  assert.equal(result.iqrStatus, 'overflow');
  assert.equal(result.largestGameShareStatus, 'contains_negative');
});

test('negative-only values are valid observations, with no largest-game share', () => {
  const result = summarizeValues([-9, -7, -5, -3, -1]);
  assert.equal(result.mean, -5);
  assert.equal(result.q1, -7);
  assert.equal(result.q3, -3);
  assert.equal(result.iqr, 4);
  assert.equal(result.largestGameShare, null);
  assert.equal(result.largestGameShareStatus, 'contains_negative');
  assert.equal(summarizeValues([-1, 0, 1]).largestGameShareStatus, 'contains_negative');
});

test('subnormal observations and final ties round correctly without scaling loss', () => {
  const minimum = Number.MIN_VALUE;
  assert.equal(summarizeValues([minimum, minimum]).mean, minimum);
  assert.equal(summarizeValues([minimum, 2 * minimum]).mean, 2 * minimum);
  assert.equal(summarizeValues([minimum, 2 * minimum]).median, 2 * minimum);
  assert.equal(summarizeValues([0, minimum]).mean, 0);
  assert.equal(summarizeValues([Number.MAX_VALUE, minimum, -Number.MAX_VALUE]).mean, 0);
});
