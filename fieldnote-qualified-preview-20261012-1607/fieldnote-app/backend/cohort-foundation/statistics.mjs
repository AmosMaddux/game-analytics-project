/**
 * Descriptive component statistics. Sample labels are explicit display rules,
 * not guarantees of uncertainty, representativeness, or statistical confidence.
 * No popularity score is constructed here.
 */
export const STATISTIC_VERSION = 'r7-trim10-floor-v1';

const FLOAT_BITS = new DataView(new ArrayBuffer(8));
const FRACTION_MASK = (1n << 52n) - 1n;
const HIDDEN_BIT = 1n << 52n;

/** Every finite binary64 number is an integer multiple of 2^-1074. */
function toBinaryUnits(value) {
  FLOAT_BITS.setFloat64(0, value, false);
  const bits = FLOAT_BITS.getBigUint64(0, false);
  const exponent = Number((bits >> 52n) & 0x7ffn);
  const fraction = bits & FRACTION_MASK;
  const magnitude = exponent === 0
    ? fraction
    : (HIDDEN_BIT | fraction) << BigInt(exponent - 1);
  return value < 0 ? -magnitude : magnitude;
}

/**
 * Convert an exact rational times 2^binaryScale to binary64, rounding once to
 * nearest, ties to even. BigInt intermediates cannot overflow or lose a small
 * residual during cancellation. All callers return a convex average or share,
 * so their mathematical results fit in a finite number.
 */
function fromRatio(numerator, denominator, binaryScale = -1074) {
  if (numerator === 0n) return 0;
  const negative = numerator < 0n;
  if (negative) numerator = -numerator;

  let exponent = numerator.toString(2).length - denominator.toString(2).length;
  const belowPower = exponent >= 0
    ? numerator < (denominator << BigInt(exponent))
    : (numerator << BigInt(-exponent)) < denominator;
  if (belowPower) exponent -= 1;

  // Keep 53 significant bits, or use the subnormal quantum of 2^-1074.
  const shift = Math.max(exponent - 52, -1074 - binaryScale);
  const scaledNumerator = shift < 0 ? numerator << BigInt(-shift) : numerator;
  const scaledDenominator = shift > 0 ? denominator << BigInt(shift) : denominator;
  let significand = scaledNumerator / scaledDenominator;
  const twiceRemainder = (scaledNumerator % scaledDenominator) * 2n;
  if (twiceRemainder > scaledDenominator
      || (twiceRemainder === scaledDenominator && (significand & 1n) === 1n)) {
    significand += 1n;
  }

  const result = Number(significand) * (2 ** (binaryScale + shift));
  return negative ? -result : result;
}

/** R7: index = (n - 1) * p; linearly interpolate adjacent order statistics. */
function r7Quartile(sorted, quarter) {
  const positionInQuarters = (sorted.length - 1) * quarter;
  const lowerIndex = Math.floor(positionInQuarters / 4);
  const remainder = positionInQuarters % 4;
  const lower = sorted[lowerIndex];
  if (remainder === 0) return lower;
  const upper = sorted[lowerIndex + 1];
  if (lower === upper) return lower;
  return fromRatio(
    toBinaryUnits(lower) * BigInt(4 - remainder)
      + toBinaryUnits(upper) * BigInt(remainder),
    4n,
  );
}

/**
 * Summarize observed finite numeric values, without modifying the input.
 * Missing/unavailable values must be handled by the caller, never coerced to 0.
 * Quartiles use R7. At n >= 20, trim floor(n * 0.1) observations from each tail.
 * Largest-game share is meaningful only for a nonnegative, nonzero total.
 * Unavailable trimmed statistics, including their count metadata, are null.
 * IQR alone may overflow for signed extremes, in which case its value is null.
 *
 * @param {number[]} values
 * @returns {{n: number, mean: number|null, median: number|null,
 * q1: number|null, q3: number|null, iqr: number|null, iqrStatus: string,
 * trimmedMean10: number|null, trimmedCountPerTail: number|null,
 * trimmedN: number|null, sampleStatus: string, rankable: boolean,
 * largestGameShare: number|null, largestGameShareStatus: string}}
 */
export function summarizeValues(values) {
  if (!Array.isArray(values)) throw new TypeError('values must be an array of finite numbers');

  let total = 0n;
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!Number.isFinite(value)) {
      throw new TypeError(`values[${index}] must be a finite number; missing values are not zero`);
    }
    total += toBinaryUnits(value);
  }

  const n = values.length;
  const sampleStatus = n < 5 ? 'insufficient_sample' : n < 10 ? 'low_sample' : 'adequate_sample';
  const result = {
    n,
    mean: null,
    median: null,
    q1: null,
    q3: null,
    iqr: null,
    iqrStatus: 'empty',
    trimmedMean10: null,
    trimmedCountPerTail: null,
    trimmedN: null,
    sampleStatus,
    rankable: n >= 5,
    largestGameShare: null,
    largestGameShareStatus: 'empty',
  };
  if (n === 0) return result;

  const sorted = values.slice().sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  result.mean = fromRatio(total, BigInt(n));
  result.median = r7Quartile(sorted, 2);
  result.q1 = r7Quartile(sorted, 1);
  result.q3 = r7Quartile(sorted, 3);
  const iqr = result.q3 - result.q1;
  result.iqr = Number.isFinite(iqr) ? iqr : null;
  result.iqrStatus = Number.isFinite(iqr) ? 'available' : 'overflow';

  if (n >= 20) {
    const trim = Math.floor(n * 0.1);
    let trimmedTotal = 0n;
    for (let index = trim; index < n - trim; index += 1) {
      trimmedTotal += toBinaryUnits(sorted[index]);
    }
    result.trimmedCountPerTail = trim;
    result.trimmedN = n - 2 * trim;
    result.trimmedMean10 = fromRatio(trimmedTotal, BigInt(result.trimmedN));
  }

  if (sorted[0] < 0) {
    result.largestGameShareStatus = 'contains_negative';
  } else if (total === 0n) {
    result.largestGameShareStatus = 'zero_total';
  } else {
    result.largestGameShare = fromRatio(toBinaryUnits(sorted[n - 1]), total, 0);
    result.largestGameShareStatus = 'available';
  }
  return result;
}
