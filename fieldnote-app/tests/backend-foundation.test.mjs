import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, migrate } from '../scripts/database.mjs';
import { buildSeedStatements, validateSnapshot } from '../backend/seed.ts';
import { metricFreshness } from '../backend/evidence.ts';
import { readSnapshot } from '../backend/repository.ts';
import { handleRequest } from '../backend/worker.ts';

const snapshot = JSON.parse(readFileSync(new URL('../seed/snapshot.json',import.meta.url),'utf8'));
const directory = mkdtempSync(join(tmpdir(),'fieldnote-backend-test-'));
const filename = join(directory,'research.sqlite');
let db;
async function seed(database, input = snapshot) { await database.batch(buildSeedStatements(input).map(statement => database.prepare(statement.sql).bind(...statement.values))); }
async function api(path, options = {}, database = db) { return handleRequest(new Request(`http://localhost${path}`,options),{DB:database}); }
async function patch(value, extra = {}) { return api('/api/settings',{method:'PATCH',headers:{'content-type':'application/json',...extra},body:JSON.stringify(value)}); }
const count = table => db.raw.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
before(async () => { db = openDatabase(filename); migrate(db); await seed(db); });
after(() => { db.close(); rmSync(directory,{recursive:true,force:true}); });

test('versioned migrations apply exactly once and use a real on-disk database', () => {
  assert.deepEqual(migrate(db),[]); assert.equal(count('local_migrations'),3);
  assert.equal(db.raw.prepare('SELECT MAX(version) AS version FROM foundation_schema').get().version,3);
  assert.equal(readFileSync(filename).subarray(0,15).toString(),'SQLite format 3');
});

test('seed is reproducible, idempotent and fully reconstructs every preserved source field', async () => {
  assert.equal(count('games'),36); assert.equal(count('metric_observations'),108); assert.equal(count('identity_crosswalks'),36); assert.equal(count('marketing_events'),13); assert.equal(count('review_windows'),6);
  const tables = ['games','steam_tags','catalog_releases','catalog_labels','catalog_field_provenance','marketing_events']; const counts = tables.map(count);
  await seed(db); assert.deepEqual(tables.map(count),counts);
  const {foundation,...actual} = await readSnapshot(db,{includeEvidence:false}); assert.deepEqual(actual,snapshot);
  assert.equal(foundation.fixture,false); assert.equal(foundation.liveCollectionEnabled,false);
});

test('normalized columns, not whole-game or snapshot blobs, drive API data', async () => {
  const appid = snapshot.games[0].appid; const detail = JSON.parse(db.raw.prepare('SELECT detail_json FROM games WHERE appid = ?').get(appid).detail_json);
  for (const key of ['players','catalog','marketing','name']) assert.equal(key in detail,false);
  assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM snapshot_metadata WHERE key IN ('games','snapshot')").get().n,0);
  db.raw.prepare('UPDATE games SET name = ? WHERE appid = ?').run('Normalized row edit',appid);
  assert.equal((await (await api(`/api/games/${appid}`)).json()).name,'Normalized row edit'); await seed(db);
});

test('observations retain separate measurement and collection timestamps, scopes, units and methods', () => {
  const rows = db.raw.prepare('SELECT * FROM metric_observations').all();
  for (const row of rows) { assert.equal(row.measured_at,null); assert.ok(row.collected_at); assert.ok(row.source_scope); assert.ok(row.source_url); assert.ok(row.method_version); assert.ok(['reviews','concurrent_players'].includes(row.unit)); }
  const players = rows.find(row => row.metric === 'players'); assert.equal(players.evidence_status,'observed'); assert.equal(players.freshness,'fresh'); assert.equal(players.source_freshness,'accepted_run');
});

test('all six evidence states are accepted and freshness remains a separate dimension', async () => {
  const fixture = structuredClone(snapshot); const states = ['observed','reported','calculated','estimated','unknown','unavailable'];
  states.forEach((status,index) => { fixture.games[index].players.status = status; fixture.games[index].players.value = ['unknown','unavailable'].includes(status) ? null : 0; });
  fixture.games[0].players.freshness = 'stale_cache'; fixture.games[4].players.observedAt = null; fixture.games[2].players.sourceTimestamp = '2026-10-10T17:55:22.000Z';
  const memory = openDatabase(':memory:'); migrate(memory);
  try {
    await seed(memory,fixture); const actual = await readSnapshot(memory,{now:Date.parse(snapshot.meta.builtAt)});
    states.forEach((status,index) => assert.equal(actual.games[index].players.evidence.status,status));
    assert.equal(actual.games[0].players.evidence.freshness,'stale'); assert.equal(actual.games[0].players.value,0); assert.equal(actual.games[4].players.evidence.freshness,'unknown'); assert.equal(actual.games[2].players.evidence.measuredAt,'2026-10-10T17:55:22.000Z'); assert.equal(actual.games[4].players.value,null); assert.equal(actual.games[5].players.value,null);
  } finally { memory.close(); }
});

test('freshness expires without changing evidence status or inventing missing timestamps', () => {
  const collected = '2026-10-10T00:00:00Z'; assert.equal(metricFreshness(collected,'2026-10-11T00:00:00Z'),'stale'); assert.equal(metricFreshness(collected,'2026-10-11T00:00:01Z'),'stale'); assert.equal(metricFreshness(null,'2026-10-11T00:00:01Z'),'unknown'); assert.equal(metricFreshness(collected,'2026-10-09T23:59:59Z'),'unknown'); assert.equal(metricFreshness(collected,'2026-10-10T01:00:00Z','stale_cache'),'stale');
});

test('date-window zeros preserve unexercised boundaries and no fabricated per-record collection time', () => {
  const zeros = db.raw.prepare('SELECT * FROM review_windows WHERE matching_reviews = 0').all(); assert.equal(zeros.length,3);
  for (const row of zeros) { assert.equal(row.evidence_status,'observed'); assert.equal(row.boundary_exercised,0); assert.equal(row.source_status,'empty_window_boundary_unexercised'); assert.equal(row.measured_at,null); assert.equal(row.collected_at,null); assert.ok(row.collection_window_start); assert.ok(row.collection_window_end); }
});

test('release platform/region/precision and marketing date meanings stay separate', () => {
  const releases = db.raw.prepare('SELECT * FROM catalog_releases WHERE appid = 413150').all(); assert.ok(releases.length > 3); assert.ok(releases.some(row => JSON.parse(row.date_format_json).format === 'YYYY')); assert.ok(new Set(releases.map(row => row.platform_id)).size > 1);
  const linked = db.raw.prepare("SELECT * FROM marketing_events WHERE date_kind = 'linked_by_publication_not_video_upload'").get(); assert.equal(linked.source_date,'2022-09-22'); assert.equal(linked.published_at,null); assert.equal(linked.event_at,null); assert.equal(linked.discovered_at,null);
});

test('identity validation refuses mismatched editions, providers, URLs and duplicate AppIDs', () => {
  const cases = [game => { game.appid = '413150'; }, game => { game.id = '000413150'; }, game => { game.storeUrl = 'https://store.steampowered.com/app/999999/'; }, game => { game.catalog.identity.steamAppid = 999999; }, game => { game.catalog.identity.crosswalk[0].uid = '999999'; }, game => { game.catalog.identity.crosswalk[0].gameId = 123; }, game => { game.catalog.identity.crosswalk[0].sourceId = 2; }, game => { game.catalog.identity.crosswalk[0].url = 'https://example.com/app/413150'; }, game => { game.catalog.identity.crosswalk = []; }];
  for (const mutation of cases) { const fixture = structuredClone(snapshot); mutation(fixture.games[0]); assert.throws(() => buildSeedStatements(fixture),/Seed validation/); }
  const duplicate = structuredClone(snapshot); duplicate.games.push(duplicate.games[0]); assert.throws(() => validateSnapshot(duplicate),/duplicate Steam AppID/);
  const malformed = structuredClone(snapshot); malformed.games[0].players.value = -1; assert.throws(() => validateSnapshot(malformed),/invalid metric/);
});

test('same-name games do not merge: only exact AppIDs identify records', async () => {
  const fixture = structuredClone(snapshot); fixture.games[1].name = fixture.games[0].name; fixture.games[1].steamName = fixture.games[0].steamName; fixture.games[1].catalog.name = fixture.games[0].catalog.name; const memory = openDatabase(':memory:'); migrate(memory);
  try { await seed(memory,fixture); const actual = await readSnapshot(memory,{includeEvidence:false}); assert.equal(actual.games.length,36); assert.equal(actual.games[0].name,actual.games[1].name); assert.notEqual(actual.games[0].appid,actual.games[1].appid); assert.notEqual(actual.games[0].catalog.sourceId,actual.games[1].catalog.sourceId); } finally { memory.close(); }
});

test('database constraints protect identity and evidence enums outside the importer', () => {
  assert.throws(() => db.raw.prepare('UPDATE identity_crosswalks SET steam_uid = ? WHERE appid = ?').run('999999',413150),/CHECK/); assert.throws(() => db.raw.exec("UPDATE metric_observations SET evidence_status = 'stale'"),/CHECK/); assert.throws(() => db.raw.exec("UPDATE metric_observations SET freshness = 'observed'"),/CHECK/); assert.throws(() => db.raw.exec('UPDATE games SET source_id = 999999 WHERE appid = 413150'),/CHECK/);
});

test('failed seed transaction rolls back all partial imported changes', async () => {
  const statements = buildSeedStatements(snapshot).map(row => db.prepare(row.sql).bind(...row.values)); statements.push(db.prepare('INSERT INTO games(appid) VALUES (-1)')); await assert.rejects(db.batch(statements));
  const {foundation,...saved} = await readSnapshot(db,{includeEvidence:false}); assert.deepEqual(saved,snapshot);
});

test('health and compatibility snapshot report a seeded offline foundation', async () => {
  const health = await api('/api/health'); assert.equal(health.status,200); assert.equal((await health.json()).gameCount,36);
  const response = await api('/api/snapshot'); assert.equal(response.status,200); const data = await response.json(); assert.equal(data.games.length,36); assert.equal(data.foundation.liveCollectionEnabled,false); assert.equal(data.games[0].players.evidence.status,'observed'); assert.match(response.headers.get('cache-control'),/no-store/); assert.equal(response.headers.get('x-content-type-options'),'nosniff'); assert.equal(response.headers.get('access-control-allow-origin'),null);
});

test('search supports IDs/names/tags/genres and bounded results without SQL or wildcard injection', async () => {
  assert.equal((await (await api('/api/games?query=Stardew')).json()).games[0].appid,413150); assert.equal((await (await api('/api/games?query=413150')).json()).games[0].appid,413150); assert.ok((await (await api('/api/games?query=Farming%20Sim')).json()).count > 0); assert.equal((await (await api('/api/games?query=%25')).json()).count,0); assert.equal((await (await api('/api/games?query=%27%20OR%201%3D1--')).json()).count,0); assert.equal((await (await api('/api/games?limit=2')).json()).count,2); assert.equal((await api('/api/games?limit=101')).status,400); assert.equal((await api('/api/games?limit=NaN')).status,400); assert.equal((await api(`/api/games?query=${'a'.repeat(201)}`)).status,400); assert.equal(count('games'),36);
});

test('detail endpoints reject name joins, malformed identifiers, unknown IDs and unsupported methods', async () => {
  assert.equal((await api('/api/games/413150')).status,200); assert.equal((await api('/api/games/999999')).status,404);
  for (const id of ['Stardew','0413150','-1','0','413150x','4294967296']) assert.equal((await api(`/api/games/${id}`)).status,400);
  assert.equal((await api('/api/snapshot',{method:'POST'})).status,405); assert.equal((await api('/api/settings',{method:'DELETE'})).status,405); assert.equal((await api('/api/unknown')).status,404);
});

test('billing remains unknown and all unconnected providers remain unavailable', async () => {
  const settings = await (await api('/api/settings')).json(); assert.equal(settings.usage.status,'unknown'); assert.equal(settings.usage.billedUsd,null); assert.equal(settings.preferences.monthlyBudgetUsd,30); assert.ok(settings.providers.every(provider => provider.status === 'unavailable' && provider.connected === false)); assert.match(settings.usage.note,/does not enforce or authorize spending/);
});

test('safe preferences persist after database close/reopen and evidence reseed', async () => {
  assert.equal((await patch({monthlyBudgetUsd:22,compactTables:true,showEvidenceDetails:false})).status,200); db.close(); db = openDatabase(filename);
  let settings = await (await api('/api/settings')).json(); assert.equal(settings.preferences.monthlyBudgetUsd,22); assert.equal(settings.preferences.compactTables,true); assert.equal(settings.preferences.showEvidenceDetails,false); assert.ok(settings.preferences.updatedAt);
  await seed(db); settings = await (await api('/api/settings')).json(); assert.equal(settings.preferences.monthlyBudgetUsd,22); assert.equal(settings.preferences.compactTables,true); assert.equal((await (await api('/api/health')).json()).gameCount,36);
});

test('preference validation blocks provider activation, unsafe budgets and invalid types', async () => {
  for (const value of [{},{providers:{openai:true}},{monthlyBudgetUsd:31},{monthlyBudgetUsd:-1},{monthlyBudgetUsd:'22'},{compactTables:1},{showEvidenceDetails:'yes'},[],null]) assert.equal((await patch(value)).status,400); assert.equal((await (await api('/api/settings')).json()).preferences.monthlyBudgetUsd,22);
});

test('writes reject cross-origin attempts, oversize payloads, malformed JSON and wrong content type', async () => {
  assert.equal((await patch({compactTables:false},{origin:'https://attacker.example'})).status,403); assert.equal((await patch({compactTables:false},{'sec-fetch-site':'cross-site'})).status,403); assert.equal((await api('/api/settings',{method:'PATCH',headers:{'content-type':'text/plain'},body:'{}'})).status,415); assert.equal((await api('/api/settings',{method:'PATCH',headers:{'content-type':'application/json'},body:'{broken'})).status,400); assert.equal((await api('/api/settings',{method:'PATCH',headers:{'content-type':'application/json'},body:' '.repeat(4097)})).status,413); assert.equal((await patch({compactTables:true},{origin:'http://localhost'})).status,200);
});

test('chat is unavailable and no backend route makes a network/model/provider call', async () => {
  const original = globalThis.fetch; let calls = 0; globalThis.fetch = async () => { calls++; throw new Error('Network forbidden in offline backend'); };
  try { for (const path of ['/api/health','/api/settings','/api/snapshot','/api/games?query=puzzle']) assert.equal((await api(path)).status,200); const chat = await api('/api/chat',{method:'POST',body:JSON.stringify({question:'Test question'})}); assert.equal(chat.status,503); assert.equal((await chat.json()).error.code,'source_not_connected'); assert.equal(calls,0); } finally { globalThis.fetch = original; }
});

test('database failures return safe errors without internal exception details', async () => {
  const broken = {prepare() { throw new Error('private database /secrets/test.db contents'); }}; const result = await api('/api/snapshot',{},broken); assert.equal(result.status,503); const text = await result.text(); assert.match(text,/database_unavailable/); assert.doesNotMatch(text,/\/secrets|private database/);
});


test('arbitrary numeric values never become observed without accepted source status and evidence', () => {
  for (const status of ['rejected','failed','garbage','stale','captured','',null,undefined]) {
    const fixture = structuredClone(snapshot); fixture.games[0].players.status = status;
    assert.throws(() => validateSnapshot(fixture),/unsupported evidence status/);
  }
  for (const state of ['observed','reported']) for (const patch of [{sourceUrl:null},{sourceUrl:'javascript:alert(1)'},{observedAt:null},{observedAt:'not-a-date'},{value:null}]) {
    const fixture = structuredClone(snapshot); Object.assign(fixture.games[0].players,{status:state},patch);
    assert.throws(() => validateSnapshot(fixture),/requires a numeric value|invalid collection timestamp/);
  }
  for (const patch of [{sourceUrl:null},{observedAt:null}]) {
    const fixture = structuredClone(snapshot); Object.assign(fixture.games[0].storeReviews,patch);
    assert.throws(() => validateSnapshot(fixture),/unknown\/unavailable values must remain null|requires a numeric value/);
  }
  assert.doesNotThrow(() => validateSnapshot(snapshot));
});


test('crosswalks fail closed for console platforms, unverified identity, editions and absent base-game type', () => {
  const cases = [
    game => { game.catalog.identity.crosswalk[0].platformId = 48; },
    game => { game.catalog.platforms = [{id:48,name:'PlayStation 4',abbreviation:'PS4'}]; },
    game => { game.provenance.identityVerified = false; },
    game => { delete game.provenance.identityVerified; },
    game => { game.catalog.gameType = {id:1,type:'DLC'}; },
    game => { game.catalog.gameType = {id:4,type:'Main Game'}; },
    game => { delete game.catalog.gameType; },
    game => { game.catalog.parent_game_id = 999; },
    game => { game.catalog.parentGameId = 999; },
    game => { game.catalog.version_parent_id = 999; },
    game => { game.catalog.versionTitle = 'Deluxe Edition'; },
    game => { game.catalog.name = 'An unrelated edition'; },
  ];
  for (const mutation of cases) { const fixture = structuredClone(snapshot); mutation(fixture.games[0]); assert.throws(() => validateSnapshot(fixture),/Seed validation/); }
  const desktop = structuredClone(snapshot); desktop.games[0].catalog.identity.crosswalk[0].platformId = 6;
  assert.doesNotThrow(() => validateSnapshot(desktop));
});
