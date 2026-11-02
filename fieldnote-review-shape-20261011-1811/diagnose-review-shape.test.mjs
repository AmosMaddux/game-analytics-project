import test from 'node:test';
import assert from 'node:assert/strict';
import { CAPS, describeShape, diagnose } from './diagnose-review-shape.mjs';
test('shape output excludes review content, IDs, author and unknown field names/values', () => {
  const result = describeShape({ response: { reviews: [{ recommendationid: 'SECRET_ID', author: { steamid: 'SECRET_AUTHOR' }, review: 'SECRET_TEXT', timestamp_created: 10 }], total_matching: 42, cursor: 'SECRET_CURSOR', SECRET_FIELD: 'SECRET_VALUE' } });
  assert.equal(result.totalMatching.value, 42);
  assert.equal(result.reviewArrayLength, 1);
  assert.equal(result.firstReviewFieldTypes.recommendationid.type, 'string');
  assert.equal(JSON.stringify(result).includes('SECRET'), false);
});
test('omitted fields are described rather than imputed to zero', () => {
  const result = describeShape({ response: { query_summary: { num_reviews: 0 } } });
  assert.equal(result.totalMatching.present, false); assert.equal(result.totalMatching.value, null);
  assert.equal(result.reviewArrayLength, null); assert.equal(result.summary.num_reviews.value, 0);
});
test('exactly three allowlisted fixed requests, no pagination', async () => {
  const calls = [];
  const result = await diagnose({ transport: { counters: { requests: 0 }, async request(endpoint, input) { calls.push({ endpoint, input }); this.counters.requests++; return { response: {} }; } } });
  assert.equal(result.status, 'completed_shape_only'); assert.equal(calls.length, 3);
  assert.deepEqual(calls.map(x => x.input.appid), [730050, 730050, 730]);
  assert(calls.every(x => x.input.num_per_page === 1 && x.input.cursor === '*' && !('key' in x.input)));
  assert.equal(CAPS.maxRequests, 3); assert.equal(CAPS.maxRetries, 0);
});
