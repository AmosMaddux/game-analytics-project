import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openDatabase, migrate } from '../scripts/database.mjs';
import { buildSeedStatements } from '../backend/seed.ts';
import { readSources } from '../backend/source-health.ts';
import { handleRequest } from '../backend/worker.ts';

const snapshot = JSON.parse(readFileSync(new URL('../seed/snapshot.json',import.meta.url),'utf8'));
const now = Date.parse('2026-10-10T20:00:00Z');
async function database() { const db = openDatabase(':memory:'); migrate(db); await db.batch(buildSeedStatements(snapshot).map(row => db.prepare(row.sql).bind(...row.values))); return db; }
const request = (db,method = 'GET') => handleRequest(new Request('http://localhost/api/sources',{method}),{DB:db});

test('read-only health reflects normalized catalog, per-genre gaps and original evidence dates', async () => {
  const db = await database();
  try {
    const report = await readSources(db,now);
    assert.equal(report.schemaVersion,3); assert.equal(report.catalog.totalGames,36); assert.equal(report.catalog.verifiedCrosswalkGames,36);
    assert.equal(report.catalog.genres.length,7); assert.equal(report.catalog.genresBelowMinimum,7);
    assert.equal(report.catalog.genres.reduce((sum,row) => sum + row.games,0),36);
    assert.ok(report.catalog.genres.every(row => row.belowMinimum === (row.games < 15)));
    assert.equal(report.coverage.find(row => row.metric === 'players').supported,36);
    assert.equal(report.coverage.find(row => row.metric === 'players').fresh,36);
    assert.equal(report.coverage.find(row => row.metric === 'players').sourceMeasurementUnknown,36);
    assert.equal(report.coverage.find(row => row.metric === 'tags').stale,36);
    assert.equal(report.preservedSnapshot.builtAt,snapshot.meta.builtAt);
    assert.deepEqual(report.preservedSnapshot.metricWindow,snapshot.meta.steamMetricsIntegration.fetchWindow);
    assert.deepEqual(report.preservedSnapshot.tagWindow,snapshot.meta.tagCollectionWindow);
    assert.equal(report.jobs.total,0); assert.equal(report.attempts.total,0);
    assert.equal(report.scheduler.enabledSchedules,0); assert.equal(report.scheduler.status,'not_running_in_web_app');
    assert.ok(report.schedules.items.every(row => row.enabled === false));
    assert.equal(report.collectionControlsAvailable,false);
    const api = await request(db); assert.equal(api.status,200); assert.match(api.headers.get('cache-control'),/no-store/);
    assert.equal((await api.json()).mode,'read_only_saved_collection_state');
  } finally { db.close(); }
});

test('missing, stale, future/unknown dates and observed zero remain different states', async () => {
  const db = await database();
  try {
    const ids = snapshot.games.slice(0,5).map(game => game.appid);
    db.raw.prepare("UPDATE metric_observations SET value = NULL, evidence_status = 'unknown' WHERE appid = ? AND metric = 'players'").run(ids[0]);
    db.raw.prepare("UPDATE metric_observations SET value = 0 WHERE appid = ? AND metric = 'players'").run(ids[1]);
    db.raw.prepare("UPDATE metric_observations SET source_freshness = 'stale_cache' WHERE appid = ? AND metric = 'players'").run(ids[2]);
    db.raw.prepare("UPDATE metric_observations SET collected_at = '2026-10-11T01:00:00Z' WHERE appid = ? AND metric = 'players'").run(ids[3]);
    db.raw.prepare("UPDATE metric_observations SET collected_at = NULL WHERE appid = ? AND metric = 'players'").run(ids[4]);
    const report = await readSources(db,now); const players = report.coverage.find(row => row.metric === 'players');
    assert.equal(players.supported,35); assert.equal(players.missing,1); assert.equal(players.fresh,32); assert.equal(players.stale,1); assert.equal(players.freshnessUnknown,2);
    assert.equal(players.evidenceStates.unknown,1); assert.equal(players.sourceMeasurementUnknown,35);
    assert.equal(players.fresh + players.stale + players.freshnessUnknown,players.supported);
    assert.deepEqual(players.sourceMeasurementWindow,{start:null,end:null});
    assert.deepEqual(report.preservedSnapshot.metricWindow,snapshot.meta.steamMetricsIntegration.fetchWindow);
  } finally { db.close(); }
});

test('verified crosswalk count is distinct and requires exact verified identity', async () => {
  const db = await database();
  try {
    db.raw.prepare("UPDATE catalog_games SET identity_json = json_set(identity_json, '$.status', 'unverified') WHERE appid = ?").run(snapshot.games[0].appid);
    assert.equal((await readSources(db,now)).catalog.verifiedCrosswalkGames,35);
    db.raw.prepare('DELETE FROM identity_crosswalks WHERE appid = ?').run(snapshot.games[1].appid);
    assert.equal((await readSources(db,now)).catalog.verifiedCrosswalkGames,34);
  } finally { db.close(); }
});

test('failed attempts preserve stale evidence and sanitize bounded-job metadata', async () => {
  const db = await database();
  try {
    db.raw.prepare('INSERT INTO collection_jobs(job_id,source,kind,status,started_at,finished_at,checkpoint_json,limits_json,counters_json,error_code) VALUES(?,?,?,?,?,?,?,?,?,?)').run('test-only-job','steam_api','metrics','failed','2026-10-10T19:00:00Z','2026-10-10T19:01:00Z',JSON.stringify({streamIndex:1,cursor:'SECRET-CURSOR',targetCount:36,discoveryComplete:true,authorization:'SECRET-AUTH'}),JSON.stringify({maxRequests:20,maxBytes:2000,token:'SECRET-TOKEN'}),JSON.stringify({requests:2,failed:1,password:'SECRET-PASSWORD'}),'http_429');
    db.raw.prepare('INSERT INTO collection_attempts(job_id,item_key,source,appid,metric,status,attempted_at,error_code) VALUES(?,?,?,?,?,?,?,?)').run('test-only-job','PRIVATE-ITEM','steam_api',snapshot.games[0].appid,'players','failed','2026-10-10T19:00:40Z','http_429');
    db.raw.prepare("UPDATE source_health SET last_attempt_at = '2026-10-10T19:00:00Z', last_error_code = 'http_429' WHERE source = 'steam_api'").run();
    const immediate = (await readSources(db,now)).coverage.find(row => row.metric === 'players');
    assert.equal(immediate.stale,1); assert.equal(immediate.fresh,35); assert.equal(immediate.supported,36);
    const report = await readSources(db,now + 24 * 3600 * 1000); const job = report.jobs.items[0];
    assert.equal(report.coverage.find(row => row.metric === 'players').supported,36); assert.equal(report.coverage.find(row => row.metric === 'players').stale,36);
    assert.equal(job.status,'failed'); assert.equal(job.errorCode,'http_429'); assert.equal(job.hasSavedCursor,true);
    assert.deepEqual(job.limits,{maxRequests:20,maxBytes:2000}); assert.deepEqual(job.counters,{requests:2,failed:1});
    assert.equal(report.sources.find(row => row.source === 'steam_api').lastFailureAt,'2026-10-10T19:01:00Z');
    assert.equal(report.sources.find(row => row.source === 'steam_api').lastFailureCode,'http_429');
    assert.equal(job.checkpoint.discoveryComplete,true); assert.equal(report.attempts.items[0].errorCode,'http_429');
    assert.doesNotMatch(JSON.stringify(report),/SECRET-|PRIVATE-ITEM/);
  } finally { db.close(); }
});

test('official links and public gate details are allowlisted rather than raw configuration', async () => {
  const db = await database();
  try {
    db.raw.prepare('UPDATE source_health SET details_json = ?, last_error_code = ? WHERE source = ?').run(JSON.stringify({label:'Test-only source',privateConfig:{access_token:'SECRET-CONFIG'},gate:{status:'blocked',note:'Permission required.'},allowedHosts:['api.steampowered.com','https://secret.invalid/?token=SECRET-URL'],officialLinks:[{label:'Valid',url:'https://partner.steamgames.com/doc/webapi_overview'},{label:'Terms',url:'https://steamcommunity.com/dev/apiterms'},{label:'Bad',url:'javascript:alert(1)'},{label:'Bad',url:'https://example.invalid/SECRET-LINK'},{label:'Bad',url:'https://partner.steamgames.com/?token=SECRET-QUERY'}]}),'Provider failed with SECRET-BODY','steam_api');
    const report = await readSources(db,now); const source = report.sources.find(row => row.source === 'steam_api');
    assert.equal(source.details.officialLinks.length,2); assert.deepEqual(source.details.allowedHosts,['api.steampowered.com']);
    assert.equal(source.lastErrorCode,'unknown'); assert.doesNotMatch(JSON.stringify(report),/SECRET-/);
  } finally { db.close(); }
});

test('scheduled records stay disabled unless actually enabled and never imply a web timer', async () => {
  const db = await database();
  try {
    db.raw.prepare('INSERT INTO collection_schedules(id,source,kind,enabled,interval_hours,watchlist_json,next_run_at,expires_at,limits_json) VALUES(?,?,?,?,?,?,?,?,?)').run('test-only-watchlist','steam_api','watchlist',1,6,'[413150,413150,730050]','2026-10-10T21:00:00Z','2026-10-10T19:00:00Z','{"maxGames":2}');
    const report = await readSources(db,now); const schedule = report.schedules.items.find(row => row.id === 'test-only-watchlist');
    assert.equal(schedule.enabled,true); assert.equal(schedule.expired,true); assert.equal(schedule.watchlistCount,2);
    assert.equal(report.scheduler.enabledSchedules,1); assert.equal(report.scheduler.status,'not_running_in_web_app'); assert.equal(report.collectionControlsAvailable,false);
  } finally { db.close(); }
});

test('health is bounded, read-only and does not make a provider request', async () => {
  const db = await database(); const original = globalThis.fetch; let calls = 0;
  try {
    for (let index = 0; index < 60; index++) { const id = `test-only-${String(index).padStart(2,'0')}`; db.raw.prepare('INSERT INTO collection_jobs(job_id,source,kind,status,started_at,limits_json) VALUES(?,?,?,?,?,?)').run(id,'steam_api','metrics','completed','2026-10-10T19:00:00Z','{}'); db.raw.prepare('INSERT INTO collection_attempts(job_id,item_key,source,status,attempted_at) VALUES(?,?,?,?,?)').run(id,id,'steam_api','accepted','2026-10-10T19:00:00Z'); }
    const report = await readSources(db,now); assert.equal(report.jobs.total,60); assert.equal(report.jobs.items.length,20); assert.equal(report.attempts.total,60); assert.equal(report.attempts.items.length,50);
    globalThis.fetch = async () => { calls++; throw new Error('Forbidden provider call'); };
    assert.equal((await request(db)).status,200);
    for (const method of ['POST','PATCH','DELETE']) { const response = await request(db,method); assert.equal(response.status,405); assert.equal(response.headers.get('allow'),'GET'); }
    assert.equal(calls,0); assert.equal((await readSources(db,now)).jobs.total,60);
  } finally { globalThis.fetch = original; db.close(); }
});

test('health tolerates an empty collector ledger and gives safe database errors', async () => {
  const db = await database();
  try {
    db.raw.exec('DELETE FROM collection_schedules; DELETE FROM source_health;');
    const report = await readSources(db,now); assert.deepEqual(report.sources,[]); assert.equal(report.schedules.total,0); assert.equal(report.scheduler.enabledSchedules,0);
    const response = await request({prepare() { throw new Error('PRIVATE SQL /secret/path'); }}); assert.equal(response.status,503); assert.doesNotMatch(await response.text(),/PRIVATE|secret\/path/);
  } finally { db.close(); }
});
