import { createTransport, ENDPOINTS, FILTERS, LIMITS, Stop, reviewInput, windowDays } from './validate-reviews.mjs';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const CAPS = Object.freeze({ ...LIMITS, maxRequests: 3, maxRetries: 0, retriesPerRequest: 0, maxRuntimeMs: 120000, maxBytes: 3145728 });
const own = (obj, key) => obj !== null && typeof obj === 'object' && Object.hasOwn(obj, key);
const type = value => value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
const field = (obj, key) => ({ present: own(obj, key), type: type(obj?.[key]) });
const aggregate = (obj, key) => ({ ...field(obj, key), value: Number.isSafeInteger(obj?.[key]) && obj[key] >= 0 ? obj[key] : null });
export function describeShape(raw) {
  const value = raw?.response ?? raw;
  const fields = ['total_matching', 'query_summary', 'reviews', 'cursor', 'day_range_used', 'success', 'error', 'message'];
  const first = Array.isArray(value?.reviews) ? value.reviews[0] : undefined;
  return {
    topLevelType: type(raw), responseWrapper: field(raw, 'response'),
    topLevelKeyCount: raw && typeof raw === 'object' ? Object.keys(raw).length : null,
    responseType: type(value), responseKeyCount: value && typeof value === 'object' ? Object.keys(value).length : null,
    fields: Object.fromEntries(fields.map(key => [key, field(value, key)])),
    totalMatching: aggregate(value, 'total_matching'),
    reviewArrayLength: Array.isArray(value?.reviews) ? value.reviews.length : null,
    firstReviewType: type(first),
    firstReviewFieldTypes: Object.fromEntries(['recommendationid', 'timestamp_created', 'timestamp_updated', 'author', 'review'].map(key => [key, field(first, key)])),
    summary: Object.fromEntries(['num_reviews', 'total_reviews', 'total_positive', 'total_negative', 'review_score'].map(key => [key, aggregate(value?.query_summary, key)])),
  };
}
export async function diagnose({ transport = createTransport({ caps: CAPS }) } = {}) {
  const end = Date.parse('2026-10-11T00:00:00Z') / 1000;
  const requests = [
    { label: 'failed_verdant_7d', appid: 730050, window: windowDays(end, 7) },
    { label: 'known_empty_verdant', appid: 730050, window: { start: 0, endExclusive: 86400 } },
    { label: 'populated_cs2_7d', appid: 730, window: windowDays(end, 7) },
  ];
  const result = { version: 'steam-review-shape-diagnostic-1.0', startedAt: new Date().toISOString(), status: 'running', filters: FILTERS, caps: CAPS, priorSentinelRequests: 2, cases: [], counters: transport.counters };
  try {
    for (const request of requests) {
      const data = await transport.request(ENDPOINTS.reviews, reviewInput(request.appid, { window: request.window }));
      result.cases.push({ ...request, observedAt: new Date().toISOString(), shape: describeShape(data) });
    }
    result.status = 'completed_shape_only';
  } catch (error) { result.status = 'stopped'; result.errorCode = error instanceof Stop ? error.code : 'unexpected_failure'; }
  result.finishedAt = new Date().toISOString();
  result.interpretation = 'Structure-only diagnosis. Does not establish that any missing value is zero or that the review-window validation passed.';
  return result;
}
async function main() {
  if (process.argv.length !== 5 || process.argv[2] !== '--run' || process.argv[3] !== '--output' || !process.argv[4]) throw new Stop('explicit_command_required');
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major !== 24 || minor < 5) throw new Stop('node_24_5_required');
  const result = await diagnose();
  const output = resolve(process.argv[4]);
  await writeFile(output, JSON.stringify(result, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  console.log(JSON.stringify({ status: result.status, output, requests: result.counters.requests, bytes: result.counters.bytes }));
  if (result.status === 'stopped') process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(error => { console.error(JSON.stringify({ status: 'stopped', errorCode: error instanceof Stop ? error.code : 'unexpected_failure' })); process.exitCode = 2; });
