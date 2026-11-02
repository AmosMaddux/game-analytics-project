import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openDatabase, migrate } from '../scripts/database.mjs';
import { buildSeedStatements } from '../backend/seed.ts';
import { parseResearchSelection, readReleaseResearch } from '../backend/release-research.ts';
import { handleRequest } from '../backend/worker.ts';

// Independent reviewer fixtures. These live only in isolated memory databases.
const seed = JSON.parse(readFileSync(new URL('../seed/snapshot.json', import.meta.url), 'utf8'));
const NOW = '2026-10-11T00:00:00.000Z';
async function fixture(t) {
  const db = openDatabase(':memory:'); migrate(db);
  await db.batch(buildSeedStatements(seed).map(row => db.prepare(row.sql).bind(...row.values)));
  t.after(() => db.close());
  const ids = seed.games.slice(0, 6).map(game => game.appid);
  for (const id of ids) db.raw.prepare("UPDATE games SET genre='Puzzle' WHERE appid=?").run(id);
  return { db, ids };
}
function type(db, appid, appType = 'game', suffix = '', retrievedAt = '2026-10-10T00:00:00Z') {
  db.raw.prepare('INSERT INTO research_application_evidence VALUES(?,?,?,?,?,?,?)').run(`type-${appid}-${suffix}`, appid, appType, 1, 'https://example.test/game-type', retrievedAt, 'Isolated reviewer fixture');
}
function release(db, appid, date = '2026-10-05', options = {}) {
  const { basis = 'first_playable', suffix = '', phase = null, retrievedAt = '2026-10-10T00:00:00Z', source = 'https://example.test/release', verified = 1 } = options;
  db.raw.prepare('INSERT INTO research_release_evidence VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(`release-${appid}-${suffix}`, appid, basis, date, 'day', verified, 'released', phase, source, retrievedAt, 'Isolated reviewer fixture');
}
function metric(db, appid, value, options = {}) {
  const { run = 'reviewer-run', suffix = '', at = '2026-10-10T20:00:00Z', status = value === null ? 'unknown' : 'observed', scope = 'Reviewer snapshot current concurrency', unit = 'concurrent_players', source = 'https://example.test/observation', measuredAt = null } = options;
  db.raw.prepare(`INSERT INTO metric_observations(observation_id,appid,metric,value,evidence_status,freshness,collected_at,measured_at,source_url,source_scope,unit,method_version,run_id,original_keys_json)
    VALUES(?,?,'players',?,?,'fresh',?,?,?,?,?,'reviewer-v1',?,'[]')`).run(`reviewer-${appid}-${run}-${suffix}`, appid, value, status, at, measuredAt, source, scope, unit, run);
}
function selection(extra = '') { return parseResearchSelection(new URLSearchParams(`asOf=${NOW}&preset=1m${extra}`)); }
function report(db, extra = '') { return readReleaseResearch(db, selection(extra)); }
function bucket(result) { return result.genres.find(genre => genre.genre === 'Puzzle'); }

test('reviewer: recent release filtering precedes stats and observed zero is not missing', async t => {
  const { db, ids } = await fixture(t);
  for (const id of ids.slice(0, 3)) type(db, id);
  release(db, ids[0]); release(db, ids[1]); release(db, ids[2], '2020-01-01');
  metric(db, ids[0], 0); metric(db, ids[1], null); metric(db, ids[2], 999999);
  const result = await report(db); const genre = bucket(result);
  assert.equal(result.cohort.eligibleCount, 2); assert.equal(genre.observedCount, 1); assert.equal(genre.missingCount, 1);
  assert.equal(genre.median, 0); assert.equal(genre.mean, 0); assert.equal(genre.coveragePercent, 50);
  assert.equal(genre.largestGameShare, null); assert.equal(genre.largestGameShareStatus, 'zero_total');
});

test('reviewer: Early Access and independently verified 1.0 never substitute for each other', async t => {
  const { db, ids } = await fixture(t); type(db, ids[0]);
  release(db, ids[0], '2020-01-01', { phase: 'early_access' });
  release(db, ids[0], '2026-10-05', { basis: 'full_release', suffix: 'full', phase: null }); metric(db, ids[0], 10);
  assert.equal((await report(db)).cohort.eligibleCount, 0);
  assert.equal((await report(db, '&basis=full_release')).cohort.eligibleCount, 1);
});

test('reviewer: missing observation in latest run never backfills an older value', async t => {
  const { db, ids } = await fixture(t);
  for (const id of ids.slice(0, 2)) { type(db, id); release(db, id); }
  metric(db, ids[0], 99, { run: 'earlier', at: '2026-10-10T19:00:00Z' });
  metric(db, ids[1], 0, { run: 'latest' });
  const result = await report(db); const genre = bucket(result);
  assert.equal(result.observations.selected.runId, 'latest'); assert.equal(genre.observedCount, 1);
  assert.equal(genre.missingCount, 1); assert.equal(genre.median, 0);
  assert.equal(result.audit.find(row => row.appid === ids[0]).observation.value, null);
});

test('reviewer: exact run scope prevents incompatible concurrent readings from mixing', async t => {
  const { db, ids } = await fixture(t);
  for (const id of ids.slice(0, 2)) { type(db, id); release(db, id); }
  metric(db, ids[0], 10, { scope: 'scope A', at: '2026-10-10T20:00:00Z' });
  metric(db, ids[1], 500, { scope: 'scope B', at: '2026-10-10T20:00:01Z' });
  const result = await report(db); assert.equal(result.observations.selected.scope, 'scope B');
  assert.equal(bucket(result).observedCount, 1); assert.equal(bucket(result).median, 500);
});

test('reviewer: conflicting metric duplicates remain missing and identical duplicates count once', async t => {
  const { db, ids } = await fixture(t);
  for (const id of ids.slice(0, 2)) { type(db, id); release(db, id); }
  metric(db, ids[0], 0); metric(db, ids[0], 0, { suffix: 'again', at: '2026-10-10T20:00:01Z' });
  metric(db, ids[1], 5); metric(db, ids[1], 6, { suffix: 'again', at: '2026-10-10T20:00:01Z' });
  const result = await report(db); const genre = bucket(result);
  assert.equal(genre.observedCount, 1); assert.equal(genre.median, 0); assert.equal(genre.missingCount, 1);
  assert.equal(genre.missingReasonCounts.conflicting_duplicate_values, 1);
});

test('reviewer: type conflict, unsafe evidence source, and future retrieval all fail closed', async t => {
  const { db, ids } = await fixture(t);
  for (const id of ids.slice(0, 3)) { type(db, id); metric(db, id, 999); }
  type(db, ids[0], 'demo', 'conflicting'); release(db, ids[0]);
  release(db, ids[1], '2026-10-05', { source: 'javascript:alert(1)' });
  release(db, ids[2], '2026-10-05', { retrievedAt: '2026-10-12T00:00:00Z' });
  const result = await report(db); assert.equal(result.cohort.eligibleCount, 0);
  assert.ok(result.audit.find(row => row.appid === ids[0]).reasons.includes('conflicting_application_type'));
  assert.equal(bucket(result).observedCount, 0); assert.equal(bucket(result).median, null);
});

test('reviewer: date/basis/filter errors and repeated query parameters reject before database reads', async () => {
  const broken = { prepare() { throw new Error('A bad query must not read the DB'); } };
  const queries = ['population=__proto__','basis=constructor','metric=storeReviews','preset=1m&preset=1y',
    'asOf=2026-02-30T00:00:00Z','asOf=2026-10-11T00:00:00+00:00','preset=custom&startDate=2026-10-12&endDate=2026-10-11',
    'preset=custom&startDate=2026-02-29&endDate=2026-03-01','preset=7d&startDate=2026-10-01','unknown=1'];
  for (const query of queries) {
    const response = await handleRequest(new Request(`http://localhost/api/research/releases?${query}`), { DB: broken });
    assert.equal(response.status, 400, query);
  }
});

test('reviewer: GET is read-only, makes no external requests and gated review activity is unavailable', async t => {
  const { db } = await fixture(t);
  const before = db.raw.prepare('SELECT total_changes() AS n').get().n;
  const originalFetch = globalThis.fetch; let fetchCalls = 0;
  globalThis.fetch = async () => { fetchCalls++; throw new Error('Provider request prohibited'); };
  try {
    const response = await handleRequest(new Request(`http://localhost/api/research/releases?asOf=${NOW}&metric=reviews7d`), { DB: db });
    assert.equal(response.status, 200); const result = await response.json();
    assert.equal(result.observations.selected, null); assert.equal(result.observations.status, 'unavailable');
    assert.equal(result.cohort.eligibleCount, 0); assert.equal(fetchCalls, 0);
    assert.equal(db.raw.prepare('SELECT total_changes() AS n').get().n, before);
    assert.equal((await handleRequest(new Request('http://localhost/api/research/releases', { method: 'POST' }), { DB: db })).status, 405);
  } finally { globalThis.fetch = originalFetch; }
});

test('reviewer: null and invalid verified day dates are counted as release-evidence coverage gaps', async t => {
  const { db, ids } = await fixture(t);
  for (const id of ids.slice(0, 2)) type(db, id);
  release(db, ids[0], null); release(db, ids[1], '2026-02-30');
  const result = await report(db);
  assert.equal(result.population.missingReleaseEvidenceCount, 36);
  assert.equal(result.cohort.eligibleCount, 0);
});

test('reviewer: audit timestamp and source belong to the candidate supplying the chosen observed value', async t => {
  const { db, ids } = await fixture(t); type(db, ids[0]); release(db, ids[0]);
  metric(db, ids[0], null, { at: '2026-10-10T20:00:00Z', source: 'https://example.test/missing-attempt' });
  metric(db, ids[0], 0, { suffix: 'observed', at: '2026-10-10T20:00:01Z', source: 'https://example.test/observed-zero' });
  const result = await report(db); const observed = result.audit.find(row => row.appid === ids[0]).observation;
  assert.equal(observed.value, 0); assert.equal(observed.collectedAt, '2026-10-10T20:00:01Z');
  assert.equal(observed.sourceUrl, 'https://example.test/observed-zero');
});
