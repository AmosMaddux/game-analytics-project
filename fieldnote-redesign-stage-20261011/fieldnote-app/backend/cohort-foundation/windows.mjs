/** Pure, UTC-only date contracts. No wall clock, environment, or I/O access. */
export const WINDOW_VERSION = 'utc-half-open-v1';
const DAY_MS = 86_400_000;
const PRESETS = Object.freeze({ '7d': ['days', 7], '14d': ['days', 14], '21d': ['days', 21], '1m': ['months', 1], '2m': ['months', 2], '3m': ['months', 3], '1y': ['months', 12] });

function utcDate(year, month, day, hour = 0, minute = 0, second = 0, ms = 0) {
  const result = new Date(0);
  result.setUTCFullYear(year, month - 1, day);
  result.setUTCHours(hour, minute, second, ms);
  return result;
}

/** Strict Gregorian day; unlike Date.parse, never normalizes February 30. */
export function parseUtcDay(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new TypeError('Expected a YYYY-MM-DD date');
  const [year, month, day] = value.split('-').map(Number);
  const date = utcDate(year, month, day);
  if (year < 1 || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) throw new RangeError(`Invalid UTC date: ${value}`);
  return date.getTime();
}

/** Require an explicit UTC instant, never parse a local/ambiguous timestamp. */
export function parseUtcInstant(value, name = 'asOf') {
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime()) || value.getUTCFullYear() < 1 || value.getUTCFullYear() > 9999) throw new RangeError(`Invalid ${name}`);
    return value.getTime();
  }
  const match = typeof value === 'string' && /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?Z$/.exec(value);
  if (!match) throw new TypeError(`${name} must be an explicit UTC ISO timestamp ending in Z`);
  const day = parseUtcDay(match[1]);
  const [hour, minute, second] = match.slice(2, 5).map(Number);
  if (hour > 23 || minute > 59 || second > 59) throw new RangeError(`Invalid ${name}`);
  return day + hour * 3_600_000 + minute * 60_000 + second * 1000 + Number((match[5] ?? '').padEnd(3, '0'));
}

function iso(ms) {
  const date = new Date(ms);
  if (!Number.isFinite(ms) || date.getUTCFullYear() < 1 || date.getUTCFullYear() > 9999) throw new RangeError('Resolved date is outside supported years 0001–9999');
  return date.toISOString();
}

function subtractClampedMonths(ms, count) {
  const end = new Date(ms);
  const totalMonths = end.getUTCFullYear() * 12 + end.getUTCMonth() - count;
  const year = Math.floor(totalMonths / 12);
  const monthIndex = ((totalMonths % 12) + 12) % 12;
  const lastDay = utcDate(year, monthIndex + 2, 0).getUTCDate();
  return utcDate(year, monthIndex + 1, Math.min(end.getUTCDate(), lastDay), end.getUTCHours(), end.getUTCMinutes(), end.getUTCSeconds(), end.getUTCMilliseconds()).getTime();
}

function makeWindow(kind, definition, start, end, asOf) {
  if (start >= end) throw new RangeError('Window start must be earlier than its end');
  return Object.freeze({ version: WINDOW_VERSION, kind, timeZone: 'UTC', definition: Object.freeze(definition), asOf: iso(asOf), startInclusive: iso(start), endExclusive: iso(end) });
}

/** Rolling presets preserve asOf's UTC time of day. Custom dates include both days. */
export function resolveReleaseWindow({ preset, asOf, startDate, endDate } = {}) {
  const end = parseUtcInstant(asOf);
  if (preset === 'custom') {
    const start = parseUtcDay(startDate);
    const requestedEnd = parseUtcDay(endDate);
    if (start > requestedEnd) throw new RangeError('Custom startDate must not follow endDate');
    return makeWindow('release_cohort', { preset, startDate, endDate }, start, requestedEnd + DAY_MS, end);
  }
  if (!Object.hasOwn(PRESETS, preset)) throw new RangeError(`Unsupported release preset: ${String(preset)}`);
  if (startDate !== undefined || endDate !== undefined) throw new TypeError('Custom dates require preset: custom');
  const [unit, count] = PRESETS[preset];
  const start = unit === 'days' ? end - count * DAY_MS : subtractClampedMonths(end, count);
  return makeWindow('release_cohort', { preset }, start, end, end);
}

/** Fixed-duration review measurement intervals; independent of release cohorts. */
export function resolveReviewWindows({ asOf } = {}) {
  const end = parseUtcInstant(asOf);
  return Object.freeze(Object.fromEntries([7, 30].map(days => [`reviews${days}d`, makeWindow('review_activity', { days }, end - days * DAY_MS, end, end)])));
}

/** Validates serialized windows and refuses a review interval as a release cohort. */
export function validateReleaseWindow(window) {
  if (!window || window.kind !== 'release_cohort' || window.timeZone !== 'UTC' || window.version !== WINDOW_VERSION) throw new TypeError('A versioned UTC release_cohort window is required');
  const start = parseUtcInstant(window.startInclusive, 'startInclusive');
  const end = parseUtcInstant(window.endExclusive, 'endExclusive');
  const asOf = parseUtcInstant(window.asOf);
  if (start >= end) throw new RangeError('Window start must be earlier than its end');
  return { start, end, asOf };
}

/** Optional endpoint adapter: only exact second boundaries can be represented. */
export function toInclusiveEpochSeconds(window) {
  const start = parseUtcInstant(window?.startInclusive, 'startInclusive');
  const end = parseUtcInstant(window?.endExclusive, 'endExclusive');
  if (start >= end || start % 1000 !== 0 || end % 1000 !== 0) throw new RangeError('Endpoint conversion requires an ordered, second-aligned window');
  return Object.freeze({ start: start / 1000, end: end / 1000 - 1 });
}
