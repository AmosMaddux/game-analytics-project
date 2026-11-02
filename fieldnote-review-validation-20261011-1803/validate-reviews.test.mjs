import test from 'node:test';
import assert from 'node:assert/strict';
import { VERSION, ENDPOINTS, LIMITS, SENTINELS, windowDays, reviewInput, normalizeReviews, createTransport, enumerate, validateHighVolumePartition, plan, validate } from './validate-reviews.mjs';

const END = Date.parse('2026-10-11T00:00:00Z') / 1000;
const response = (rows, total = rows.length) => ({ total_matching: total, query_summary: { num_reviews: rows.length, total_reviews: total, total_positive: total, total_negative: 0 }, reviews: rows, cursor: 'next' });
const row = (id, created) => ({ recommendationid: String(id), timestamp_created: created, review: 'MUST NEVER PERSIST', author: { steamid: 'PRIVATE_AUTHOR' } });
const clock = () => { let time = 0; return { now: () => time, wait: async n => { time += n; }, advance: n => { time += n; } }; };

test('frozen 7/30 day half-open windows become inclusive API seconds', () => {
  assert.deepEqual(windowDays(END, 7), { start: END - 7 * 86400, endExclusive: END });
  const input = reviewInput(730, { window: windowDays(END, 30) });
  assert.equal(input.date_range_end, END - 1); assert.equal(input.date_range_start, END - 30 * 86400);
  assert.equal(input.filter, 1); assert.deepEqual(input.languages, ['all']); assert.equal(input.purchase_type, 0);
  assert(!('key' in input));
});
test('invalid/zero-length date windows and non-sentinels fail', () => {
  assert.throws(() => windowDays(0, 7), /invalid_window/);
  assert.throws(() => reviewInput(999), /sentinel_allowlist/);
  assert.throws(() => reviewInput(730, { window: { start: 10, endExclusive: 10 } }), /invalid_window/);
});
test('zero count is real zero, absent count is invalid', () => {
  const input = reviewInput(730);
  assert.equal(normalizeReviews(response([]), input).total, 0);
  assert.throws(() => normalizeReviews({ reviews: [] }, input), /invalid_review_schema/);
});
test('discard review text and author at parser boundary', () => {
  const value = normalizeReviews(response([row(1, END - 1)]), reviewInput(730));
  assert.equal(JSON.stringify(value).includes('MUST NEVER'), false);
  assert.equal(JSON.stringify(value).includes('PRIVATE_AUTHOR'), false);
});
test('out-of-window timestamps and duplicate IDs fail closed', () => {
  const input = reviewInput(730, { window: { start: 100, endExclusive: 200 }, pageSize: 100 });
  assert.throws(() => normalizeReviews(response([row(1, 200)]), input), /out_of_window/);
  assert.throws(() => normalizeReviews(response([row(1, 150), row(1, 150)]), input), /duplicate_review/);
});
test('caps cannot be relaxed', () => {
  assert.throws(() => createTransport({ caps: { ...LIMITS, maxRequests: 61 } }), /invalid_caps/);
  assert.throws(() => createTransport({ caps: { ...LIMITS, minIntervalMs: 0 } }), /invalid_caps/);
});
test('one-at-a-time spacing and request budget include every attempt', async () => {
  const time = clock(), dispatch = [];
  const transport = createTransport({ ...time, caps: { ...LIMITS, maxRequests: 2 }, call: async () => { dispatch.push(time.now()); return { data: {}, bytes: 12 }; } });
  await transport.request(ENDPOINTS.players, { appid: 730 }); await transport.request(ENDPOINTS.players, { appid: 730 });
  assert.deepEqual(dispatch, [0, 2000]); assert.equal(transport.counters.bytes, 24);
  await assert.rejects(() => transport.request(ENDPOINTS.players, { appid: 730 }), /request_limit/);
});
test('403 and 429 stop the source with no retry or fallback', async () => {
  for (const error of ['access_denied', 'throttled', 'redirect_blocked']) {
    let calls = 0; const transport = createTransport({ ...clock(), call: async () => { calls++; return { error, bytes: 0 }; } });
    await assert.rejects(() => transport.request(ENDPOINTS.players, { appid: 730 }), new RegExp(error));
    await assert.rejects(() => transport.request(ENDPOINTS.players, { appid: 730 }), new RegExp(error));
    assert.equal(calls, 1); assert.equal(transport.counters.retries, 0);
  }
});
test('transient retry is bounded and counted', async () => {
  let calls = 0; const transport = createTransport({ ...clock(), call: async () => ++calls === 1 ? { error: 'network_error', bytes: 2 } : { data: {}, bytes: 3 } });
  await transport.request(ENDPOINTS.players, { appid: 730 });
  assert.deepEqual(transport.counters, { requests: 2, retries: 1, bytes: 5, elapsedMs: 2000 });
});
test('aggregate retry allowance cannot be exceeded', async () => {
  let calls = 0; const transport = createTransport({ ...clock(), caps: { ...LIMITS, maxRetries: 1 }, call: async () => { calls++; return { error: 'network_error', bytes: 0 }; } });
  await assert.rejects(() => transport.request(ENDPOINTS.players, { appid: 730 }), /network_error/);
  await assert.rejects(() => transport.request(ENDPOINTS.players, { appid: 730 }), /network_error/);
  assert.equal(calls, 3); assert.equal(transport.counters.retries, 1);
});
test('a retry blocked before dispatch is not counted as an attempted request', async () => {
  const transport = createTransport({ ...clock(), caps: { ...LIMITS, maxRequests: 1 }, call: async () => ({ error: 'network_error', bytes: 0 }) });
  await assert.rejects(() => transport.request(ENDPOINTS.players, { appid: 730 }), /request_limit/);
  assert.equal(transport.counters.requests, 1); assert.equal(transport.counters.retries, 0);
});
test('byte and runtime caps stop work', async () => {
  const bytes = createTransport({ ...clock(), caps: { ...LIMITS, maxBytes: 10 }, call: async () => ({ data: {}, bytes: 11 }) });
  await assert.rejects(() => bytes.request(ENDPOINTS.players, { appid: 730 }), /byte_limit/);
  const time = clock(), runtime = createTransport({ ...time, caps: { ...LIMITS, maxRuntimeMs: 5 }, call: async () => { time.advance(6); return { data: {}, bytes: 0 }; } });
  await assert.rejects(() => runtime.request(ENDPOINTS.players, { appid: 730 }), /runtime_limit/);
});
test('bounded enumeration checks all distinct matching IDs without saving them', async () => {
  const transport = { caps: LIMITS, async request(_e, input) { return response(input.cursor === '*' ? [row(1, 100)] : [row(2, 100)], 2); } };
  const result = await enumerate({ transport, appid: 730, window: { start: 100, endExclusive: 101 } });
  assert.equal(result.total, 2); assert.equal(result.pages, 2);
});
test('enumeration page cap and changing totals cannot report a pass', async () => {
  const capped = { caps: { ...LIMITS, maxEnumerationPages: 1 }, async request() { return response([row(1, 100)], 2); } };
  await assert.rejects(() => enumerate({ transport: capped, appid: 730, window: { start: 100, endExclusive: 101 } }), /enumeration_page_limit/);
  let calls = 0; const changing = { caps: LIMITS, async request() { return response([row(++calls, 100)], calls === 1 ? 2 : 3); } };
  await assert.rejects(() => enumerate({ transport: changing, appid: 730, window: { start: 100, endExclusive: 101 } }), /enumeration_total_changed/);
});

function fixtureTransport({ badBoundary = false, noPlayers = false } = {}) {
  const rows = [row(10, END - 60), row(11, END - 3600), row(20, END - 86400 * 10), row(21, END - 86400 * 20), row(30, END - 86400 * 40)];
  return createTransport({ ...clock(), call: async ({ endpoint, input }) => {
    if (endpoint === ENDPOINTS.players) return { data: { response: noPlayers ? { result: 2 } : { result: 1, player_count: 3 } }, bytes: 50 };
    let filtered = rows.filter(r => input.date_range_start === undefined || r.timestamp_created >= input.date_range_start && r.timestamp_created <= input.date_range_end);
    if (badBoundary && input.date_range_start === END - 60 && input.date_range_end === END - 60) filtered = [];
    return { data: response(filtered.slice(0, input.num_per_page), filtered.length), bytes: 500 };
  } });
}
test('entire five-sentinel fixture plan passes in 36 calls, sanitized', async () => {
  const result = await validate({ transport: fixtureTransport(), end: END, now: () => new Date(END * 1000) });
  assert.equal(result.version, VERSION); assert.equal(result.status, 'passed'); assert.equal(result.games.length, 5);
  assert.equal(result.counters.requests, 36); assert.equal(result.checks.length, 13);
  assert.equal(JSON.stringify(result).includes('recommendationid'), false);
  assert.equal(JSON.stringify(result).includes('PRIVATE_AUTHOR'), false);
  assert.equal(JSON.stringify(result).includes('MUST NEVER'), false);
  assert.equal(result.games[0].observations.reviews7d.value, 2); assert.equal(result.games[0].observations.reviews30d.value, 4);
});
test('high-volume proof rejects vacuous and page-sized totals', () => {
  assert.throws(() => validateHighVolumePartition(0, 0, 0), /high_volume_discriminator_unexercised/);
  assert.throws(() => validateHighVolumePartition(1, 1, 2), /high_volume_discriminator_unexercised/);
  assert.throws(() => validateHighVolumePartition(2, 3, 6), /high_volume_partition_changed_or_failed/);
  assert.doesNotThrow(() => validateHighVolumePartition(2, 3, 5));
});
test('boundary failure is explicit and never a partial pass', async () => {
  const result = await validate({ transport: fixtureTransport({ badBoundary: true }), end: END });
  assert.equal(result.status, 'stopped'); assert.equal(result.errorCode, 'boundary_inclusion_failed');
});
test('missing CCU does not invent zero or block the unrelated review validation', async () => {
  const result = await validate({ transport: fixtureTransport({ noPlayers: true }), end: END });
  assert.equal(result.status, 'passed'); assert.equal(result.games[0].observations.players.value, null);
});
test('prior positive evidence is explicitly reused and has no new provenance invented', () => {
  const value = plan(END);
  assert.deepEqual(value.priorEvidence.positiveBoundaryAppids, [1054550, 1706090, 916350]);
  assert.equal(value.credentialsRead, false); assert.equal(value.writesDatabase, false); assert.equal(SENTINELS.length, 5);
});
