import { request as httpsRequest, Agent } from 'node:https';
import { setTimeout as sleep } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import { writeFile, mkdir, lstat, readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

// No environment credential lookup, token creation, or authenticated request.
export const VERSION = 'steam-review-window-sentinels-1.1';
export const ENDPOINTS = Object.freeze({ reviews: 'https://api.steampowered.com/IUserReviewsService/GetAppReviews/v1/', players: 'https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/' });
export const LIMITS = Object.freeze({ maxRequests: 60, maxRetries: 4, retriesPerRequest: 1, minIntervalMs: 2000, requestTimeoutMs: 20000, maxRuntimeMs: 720000, maxResponseBytes: 1048576, maxBytes: 16777216, maxEnumerationPages: 3 });
export const FILTERS = Object.freeze({ filter: 1, languages: ['all'], review_type: 0, purchase_type: 0, filter_offtopic_activity: true, display_language: 'english' });
export const SENTINELS = Object.freeze([
  { appid: 730050, name: 'Verdant Skies', role: 'prior_empty_boundary_missing' },
  { appid: 693580, name: 'Goblins of Elderstone', role: 'prior_empty_boundary_missing' },
  { appid: 1368410, name: 'Psycron', role: 'prior_empty_boundary_missing' },
  { appid: 1054550, name: 'Phantom Rose', role: 'prior_positive_boundary_reused' },
  { appid: 730, name: 'Counter-Strike 2', role: 'high_volume' },
]);
export class Stop extends Error { constructor(code) { super(code); this.code = code; } }
const uint = value => Number.isSafeInteger(value) && value >= 0;
const check = (condition, code) => { if (!condition) throw new Stop(code); };
const safeCode = error => error instanceof Stop ? error.code : 'unexpected_failure';

export function windowDays(end, days) {
  check(uint(end) && end <= 4294967295 && uint(days) && days > 0 && end >= days * 86400, 'invalid_window');
  return { start: end - days * 86400, endExclusive: end };
}
export function reviewInput(appid, { window, pageSize = 1, cursor = '*' } = {}) {
  check(SENTINELS.some(s => s.appid === appid), 'sentinel_allowlist');
  check(uint(pageSize) && pageSize > 0 && pageSize <= 100 && typeof cursor === 'string' && cursor.length <= 4096, 'invalid_request');
  const result = { appid, ...FILTERS, num_per_page: pageSize, cursor };
  if (window) {
    check(uint(window.start) && uint(window.endExclusive) && window.endExclusive > window.start && window.endExclusive <= 4294967295, 'invalid_window');
    result.date_range_start = window.start;
    result.date_range_end = window.endExclusive - 1;
  }
  return result;
}
export function normalizeReviews(raw, input) {
  const value = raw?.response ?? raw;
  // The live API omits the empty repeated field while explicitly reporting
  // total_matching=0 and query_summary.num_reviews=0. Never default a missing
  // total to zero, or accept absent arrays for a positive total.
  const omittedEmpty = value?.total_matching === 0 && value?.query_summary?.num_reviews === 0 && !Object.hasOwn(value, 'reviews');
  const sourceReviews = omittedEmpty ? [] : value?.reviews;
  check(value && uint(value.total_matching) && Array.isArray(sourceReviews) && sourceReviews.length <= input.num_per_page, 'invalid_review_schema');
  const reviews = sourceReviews.map(row => {
    check(typeof row?.recommendationid === 'string' && /^\d{1,20}$/.test(row.recommendationid) && uint(row.timestamp_created), 'invalid_review_record');
    if (input.date_range_start !== undefined) check(row.timestamp_created >= input.date_range_start && row.timestamp_created <= input.date_range_end, 'out_of_window_review');
    // Review IDs exist in memory only for de-duplication and boundary tests.
    return { id: row.recommendationid, created: row.timestamp_created };
  });
  check(new Set(reviews.map(r => r.id)).size === reviews.length, 'duplicate_review_in_page');
  check(value.total_matching >= reviews.length, 'inconsistent_review_count');
  if (value.query_summary?.num_reviews !== undefined) check(value.query_summary.num_reviews === reviews.length, 'inconsistent_page_count');
  if (value.total_matching === 0) check(reviews.length === 0, 'nonempty_zero_count');
  let summary = null;
  if (input.cursor === '*' && value.query_summary) {
    const s = value.query_summary;
    if ([s.total_reviews, s.total_positive, s.total_negative].every(uint)) {
      check(s.total_positive + s.total_negative === s.total_reviews, 'inconsistent_lifetime_summary');
      summary = { total: s.total_reviews, positive: s.total_positive, negative: s.total_negative };
    }
  }
  return { total: value.total_matching, reviews, cursor: typeof value.cursor === 'string' && value.cursor.length <= 4096 ? value.cursor : null, summary };
}
function makeAgent(env = process.env) {
  check(!env.NODE_OPTIONS && env.NODE_TLS_REJECT_UNAUTHORIZED !== '0', 'unsafe_node_environment');
  const proxyEnv = Object.fromEntries(['HTTP_PROXY', 'http_proxy', 'HTTPS_PROXY', 'https_proxy', 'NO_PROXY', 'no_proxy'].filter(key => typeof env[key] === 'string').map(key => [key, env[key]]));
  check(!((env.ALL_PROXY || env.all_proxy || env.HTTP_PROXY || env.http_proxy) && !(env.HTTPS_PROXY || env.https_proxy)), 'unsupported_proxy_configuration');
  for (const key of ['HTTP_PROXY', 'http_proxy', 'HTTPS_PROXY', 'https_proxy']) if (proxyEnv[key]) {
    let url; try { url = new URL(proxyEnv[key]); } catch { throw new Stop('unsupported_proxy_configuration'); }
    check(!url.username && !url.password && ['http:', 'https:'].includes(url.protocol), 'unsupported_proxy_configuration');
  }
  return new Agent({ keepAlive: false, maxCachedSessions: 0, rejectUnauthorized: true, proxyEnv });
}
export async function wire({ endpoint, input, timeoutMs, maxBytes }) {
  check(Object.values(ENDPOINTS).includes(endpoint), 'endpoint_allowlist');
  const url = new URL(endpoint);
  if (endpoint === ENDPOINTS.reviews) url.searchParams.set('input_json', JSON.stringify(input));
  else url.searchParams.set('appid', String(input.appid));
  return new Promise(resolveResult => {
    let request, response, agent, settled = false, bytes = 0;
    const finish = result => { if (settled) return; settled = true; clearTimeout(timer); response?.destroy(); request?.destroy(); agent?.destroy(); resolveResult({ ...result, bytes }); };
    const timer = setTimeout(() => finish({ error: 'request_timeout' }), timeoutMs);
    try {
      agent = makeAgent();
      request = httpsRequest(url, { method: 'GET', headers: { accept: 'application/json', 'accept-encoding': 'identity' }, rejectUnauthorized: true, agent, maxHeaderSize: 8192 }, res => {
        response = res;
        if (res.statusCode !== 200) {
          const status = res.statusCode;
          // Stop the entire sentinel run on 429: no retries or alternative route.
          finish({ status, error: status === 401 || status === 403 ? 'access_denied' : status === 429 ? 'throttled' : status >= 300 && status < 400 ? 'redirect_blocked' : 'http_failure' }); return;
        }
        if (!/^application\/json(?:\s*;|$)/i.test(res.headers['content-type'] ?? '')) { finish({ error: 'invalid_content_type' }); return; }
        if (res.headers['content-encoding'] && res.headers['content-encoding'] !== 'identity') { finish({ error: 'unexpected_encoding' }); return; }
        const chunks = [];
        res.on('data', chunk => { bytes += chunk.length; if (bytes > maxBytes) finish({ error: 'byte_limit' }); else chunks.push(chunk); });
        res.on('end', () => { if (settled) return; try { finish({ data: JSON.parse(Buffer.concat(chunks).toString('utf8')) }); } catch { finish({ error: 'invalid_json' }); } });
        res.on('error', () => finish({ error: 'network_error' }));
        res.on('aborted', () => finish({ error: 'network_error' }));
        res.on('close', () => { if (!res.complete) finish({ error: 'network_error' }); });
      });
      request.on('error', () => finish({ error: 'network_error' })); request.end();
    } catch (error) { finish({ error: safeCode(error) }); }
  });
}
export function createTransport({ call = wire, now = Date.now, wait = sleep, caps = LIMITS } = {}) {
  for (const [key, value] of Object.entries(LIMITS)) check(uint(caps[key]) && (key === 'minIntervalMs' ? caps[key] >= value : caps[key] <= value), 'invalid_caps');
  const started = now(); let last = null, blocked = null;
  const counters = { requests: 0, retries: 0, bytes: 0, elapsedMs: 0 };
  const elapsed = () => counters.elapsedMs = Math.max(0, now() - started);
  return { counters, caps, async request(endpoint, input) {
    check(!blocked, blocked ?? 'blocked');
    check(Object.values(ENDPOINTS).includes(endpoint), 'endpoint_allowlist');
    for (let attempt = 0; attempt <= caps.retriesPerRequest; attempt++) {
      check(counters.requests < caps.maxRequests, 'request_limit');
      check(counters.bytes < caps.maxBytes, 'byte_limit');
      const pause = last === null ? 0 : Math.max(0, caps.minIntervalMs - (now() - last));
      check(elapsed() + pause < caps.maxRuntimeMs, 'runtime_limit');
      if (pause) await wait(pause);
      const timeoutMs = Math.min(caps.requestTimeoutMs, caps.maxRuntimeMs - elapsed());
      check(timeoutMs > 0, 'runtime_limit'); last = now(); counters.requests++;
      if (attempt > 0) counters.retries++;
      const result = await call({ endpoint, input, timeoutMs, maxBytes: Math.min(caps.maxResponseBytes, caps.maxBytes - counters.bytes) });
      check(uint(result.bytes), 'invalid_transport_bytes'); counters.bytes += result.bytes; elapsed();
      check(counters.bytes <= caps.maxBytes, 'byte_limit'); check(counters.elapsedMs <= caps.maxRuntimeMs, 'runtime_limit');
      if (result.data !== undefined) return result.data;
      const code = result.error ?? 'network_error';
      if (['access_denied', 'throttled', 'redirect_blocked'].includes(code)) blocked = code;
      const retryable = ['network_error', 'request_timeout'].includes(code) || [500, 502, 503, 504].includes(result.status);
      if (!retryable || attempt === caps.retriesPerRequest || counters.retries >= caps.maxRetries) throw new Stop(code);
    }
    throw new Stop('request_failed');
  } };
}
export async function enumerate({ transport, appid, window }) {
  let cursor = '*', total = null; const ids = new Map(), seenCursors = new Set();
  for (let page = 0; page < transport.caps.maxEnumerationPages; page++) {
    const input = reviewInput(appid, { window, pageSize: 100, cursor });
    const result = normalizeReviews(await transport.request(ENDPOINTS.reviews, input), input);
    if (total === null) total = result.total;
    check(total === result.total, 'enumeration_total_changed');
    for (const row of result.reviews) { check(!ids.has(row.id), 'enumeration_duplicate_id'); ids.set(row.id, row.created); }
    check(ids.size <= total, 'enumeration_count_exceeded');
    if (ids.size === total) return { total, ids, pages: page + 1 };
    check(result.reviews.length > 0 && result.cursor && !seenCursors.has(result.cursor), 'enumeration_stalled');
    cursor = result.cursor; seenCursors.add(cursor);
  }
  throw new Stop('enumeration_page_limit');
}
export function validateHighVolumePartition(seven, preceding23, thirty) {
  check([seven, preceding23, thirty].every(uint), 'invalid_review_count');
  // Every request returns only one review: larger totals demonstrate that
  // total_matching is neither a page-size count nor a vacuous zero partition.
  check(seven > 1 && preceding23 > 1, 'high_volume_discriminator_unexercised');
  check(seven + preceding23 === thirty, 'high_volume_partition_changed_or_failed');
}
export function remainingCampaignCaps(prior = { requests: 0, retries: 0, bytes: 0, elapsedMs: 0 }) {
  const fields = { requests: 'maxRequests', retries: 'maxRetries', bytes: 'maxBytes', elapsedMs: 'maxRuntimeMs' };
  const caps = { ...LIMITS };
  for (const [counter, cap] of Object.entries(fields)) {
    check(uint(prior[counter]) && (counter === 'retries' ? prior[counter] <= LIMITS[cap] : prior[counter] < LIMITS[cap]), 'campaign_budget_exhausted_or_invalid');
    caps[cap] -= prior[counter];
  }
  return caps;
}
export function plan(end = Math.floor(Date.now() / 86400000) * 86400) {
  const seven = windowDays(end, 7), thirty = windowDays(end, 30);
  return { version: VERSION, endPolicy: 'frozen_start_of_current_UTC_day_unless_explicit_as_of', windows: { seven, thirty }, sentinels: SENTINELS, filters: FILTERS, limits: LIMITS,
    priorEvidence: { runId: 'dates-20261010T180331650Z-2d32a062-1960-469e-8624-ae14ea485d4b', acceptedRequests: 24, completeEnumerations: 6, consistentPartitions: 6, positiveBoundaryAppids: [1054550, 1706090, 916350], note: 'Prior positive boundary checks are reused, not repeated. A zero window cannot supply a positive boundary timestamp.' },
    intendedChecks: ['five lifetime + 7/30-day counts', 'five timestamped CCU observations', 'three prior-empty sentinels: pre-review-era empty window and exact live positive boundary', 'high-volume boundary enumeration and 7-day plus preceding23-day partition'],
    nominalRequests: 36, writesDatabase: false, credentialsRead: false, reviewBodiesPersisted: false };
}
export async function validate({ transport, end, priorCounters = { requests: 0, retries: 0, bytes: 0, elapsedMs: 0 }, now = () => new Date(), onCheckpoint = async () => {} } = {}) {
  transport ??= createTransport({ caps: remainingCampaignCaps(priorCounters) });
  const config = plan(end);
  const report = { ...config, effectiveRunCaps: transport.caps, priorCampaignCounters: priorCounters, runId: `sentinels-${randomUUID()}`, startedAt: now().toISOString(), status: 'running', games: [], checks: [], counters: transport.counters };
  try {
    for (const sentinel of SENTINELS) {
      const game = { ...sentinel, observations: {} }; report.games.push(game);
      const snapshots = {};
      for (const [metric, window] of [['lifetime', undefined], ['reviews7d', config.windows.seven], ['reviews30d', config.windows.thirty]]) {
        const input = reviewInput(sentinel.appid, { window });
        const value = normalizeReviews(await transport.request(ENDPOINTS.reviews, input), input);
        snapshots[metric] = value;
        game.observations[metric] = { value: value.total, observedAt: now().toISOString(), window: window ?? null, unit: 'surviving_matching_review_count', sourceReported: true };
        if (metric === 'lifetime') game.lifetimeSummary = value.summary;
      }
      check(snapshots.reviews7d.total <= snapshots.reviews30d.total, 'nested_windows_inconsistent');
      const ccu = await transport.request(ENDPOINTS.players, { appid: sentinel.appid });
      const players = ccu?.response ?? ccu;
      game.observations.players = players?.result === 1 && uint(players.player_count)
        ? { value: players.player_count, observedAt: now().toISOString(), unit: 'current_online_players' }
        : { value: null, observedAt: now().toISOString(), unit: 'current_online_players', missingReason: 'players_unavailable_or_invalid_schema' };
      report.checks.push({ appid: sentinel.appid, check: 'nested_7_30', status: 'pass' });
      if (sentinel.role === 'prior_empty_boundary_missing') {
        // A zero boundary was observed to disable filtering. Both bounds here
        // are positive and well before Steam or Steam reviews existed.
        const emptyWindow = { start: 631152000, endExclusive: 631238400 };
        const empty = await enumerate({ transport, appid: sentinel.appid, window: emptyWindow });
        check(empty.total === 0, 'known_empty_window_nonzero');
        report.checks.push({ appid: sentinel.appid, check: 'known_empty', status: 'pass', total: 0, window: emptyWindow });
      }
      if (sentinel.role !== 'prior_positive_boundary_reused') {
        const anchor = snapshots.lifetime.reviews[0];
        check(anchor && anchor.created > 0 && anchor.created < 4294967294, 'positive_boundary_unavailable');
        const whole = await enumerate({ transport, appid: sentinel.appid, window: { start: anchor.created - 1, endExclusive: anchor.created + 1 } });
        const left = await enumerate({ transport, appid: sentinel.appid, window: { start: anchor.created - 1, endExclusive: anchor.created } });
        const right = await enumerate({ transport, appid: sentinel.appid, window: { start: anchor.created, endExclusive: anchor.created + 1 } });
        check(whole.ids.has(anchor.id) && right.ids.has(anchor.id) && !left.ids.has(anchor.id), 'boundary_inclusion_failed');
        check(whole.total === left.total + right.total && [...left.ids.keys()].every(id => !right.ids.has(id)) && [...left.ids.keys(), ...right.ids.keys()].every(id => whole.ids.has(id)), 'boundary_partition_failed');
        report.checks.push({ appid: sentinel.appid, check: 'positive_boundary_exact_enumeration', status: 'pass', anchorSecond: anchor.created, wholeCount: whole.total, leftCount: left.total, rightCount: right.total, enumerationPages: whole.pages + left.pages + right.pages });
      }
      if (sentinel.role === 'high_volume') {
        const window = { start: config.windows.thirty.start, endExclusive: config.windows.seven.start };
        const input = reviewInput(sentinel.appid, { window });
        const older = normalizeReviews(await transport.request(ENDPOINTS.reviews, input), input);
        validateHighVolumePartition(snapshots.reviews7d.total, older.total, snapshots.reviews30d.total);
        report.checks.push({ appid: sentinel.appid, check: 'high_volume_7_plus_23_equals_30', status: 'pass', preceding23d: older.total });
      }
      await onCheckpoint(report);
    }
    report.status = 'passed';
    report.interpretation = 'The documented date-filter/total_matching contract passed these bounded live checks. Counts refer to surviving matching reviews at retrieval, not immutable historic counts. No Steam release dates or popularity score are established.';
  } catch (error) { report.status = 'stopped'; report.errorCode = safeCode(error); }
  report.finishedAt = now().toISOString();
  report.campaignCounters = Object.fromEntries(Object.keys(priorCounters).map(key => [key, priorCounters[key] + (transport.counters[key] ?? 0)]));
  await onCheckpoint(report);
  return report;
}
async function main(args) {
  const flags = new Map();
  for (let i = 0; i < args.length; i++) {
    const key = args[i]; check(!flags.has(key) && ['--plan', '--run', '--as-of', '--output', '--campaign-ledger'].includes(key), 'invalid_command');
    const value = ['--plan', '--run'].includes(key) ? true : args[++i];
    check(value === true || (typeof value === 'string' && value.length > 0 && !value.startsWith('--')), 'invalid_command'); flags.set(key, value);
  }
  check(flags.has('--plan') !== flags.has('--run'), 'explicit_plan_or_run_required');
  const end = flags.has('--as-of') ? Math.floor(Date.parse(flags.get('--as-of')) / 1000) : undefined;
  if (flags.has('--as-of')) check(typeof flags.get('--as-of') === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(flags.get('--as-of')) && uint(end) && end <= Date.now() / 1000 && new Date(end * 1000).toISOString() === flags.get('--as-of').replace('Z', '.000Z'), 'invalid_as_of');
  if (flags.has('--plan')) { console.log(JSON.stringify(plan(end), null, 2)); return; }
  const [major, minor] = process.versions.node.split('.').map(Number);
  check(major === 24 && minor >= 5, 'node_24_5_required');
  const output = resolve(flags.get('--output') ?? resolve(import.meta.dirname, `review-validation-${randomUUID()}.json`));
  await mkdir(dirname(output), { recursive: true }); check(!(await lstat(dirname(output))).isSymbolicLink(), 'output_symlink_blocked');
  try { await lstat(output); throw new Stop('output_already_exists'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  let priorCounters = { requests: 0, retries: 0, bytes: 0, elapsedMs: 0 };
  if (flags.has('--campaign-ledger')) {
    const ledgerPath = resolve(flags.get('--campaign-ledger'));
    const stat = await lstat(ledgerPath); check(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 32768, 'invalid_campaign_ledger');
    const ledger = JSON.parse(await readFile(ledgerPath, 'utf8'));
    check(ledger.schemaVersion === 'fieldnote-source-validation-budget-1.0' && Array.isArray(ledger.entries) && ledger.entries.length <= 10, 'invalid_campaign_ledger');
    for (const entry of ledger.entries) {
      check(typeof entry.reportSha256 === 'string' && /^[a-f0-9]{64}$/.test(entry.reportSha256), 'invalid_campaign_ledger');
      for (const key of Object.keys(priorCounters)) { check(uint(entry.counters?.[key]), 'invalid_campaign_ledger'); priorCounters[key] += entry.counters[key]; }
    }
    remainingCampaignCaps(priorCounters);
  }
  const report = await validate({ end, priorCounters });
  await writeFile(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ status: report.status, errorCode: report.errorCode ?? null, requests: report.counters.requests, bytes: report.counters.bytes, output }));
  if (report.status !== 'passed') process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main(process.argv.slice(2)).catch(error => { console.error(JSON.stringify({ status: 'stopped', errorCode: safeCode(error) })); process.exitCode = 2; });
