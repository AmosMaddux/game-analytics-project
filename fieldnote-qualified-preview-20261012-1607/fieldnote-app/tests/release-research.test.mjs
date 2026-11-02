import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openDatabase, migrate } from '../scripts/database.mjs';
import { parseResearchSelection, readReleaseResearch } from '../backend/release-research.ts';
import { handleRequest } from '../backend/worker.ts';

const ASOF = '2026-10-11T12:00:00.000Z';
const at = '2026-10-10T12:00:00Z';
function setup() {
 const db = openDatabase(':memory:'); migrate(db);
 db.raw.exec("INSERT INTO genres VALUES('Action',0,'fixture'),('Puzzle',1,'fixture'),('Unresolved / needs review',2,'fixture'); INSERT INTO cohorts VALUES('original_30','Fixture legacy',0,0,'{}'),('recent_6','Fixture recent',0,1,'{}'),('m3_discovery','Fixture discovery',0,2,'{}')");
 return db;
}
function game(db,id,{genre='Action',cohort='original_30',date='Oct 5, 2026'}={}) {
 db.raw.prepare("INSERT INTO games(appid,source_id,name,steam_name,genre,cohort_id,release_display,store_url,collected_at,position) VALUES(?,?,?,?,?,?,?,?,?,?)").run(id,String(id),`Fixture ${id}`,`Fixture ${id}`,genre,cohort,date,`https://store.steampowered.com/app/${id}/`,at,id);
}
function type(db,id,value='game',suffix='',time=at) { db.raw.prepare('INSERT INTO research_application_evidence VALUES(?,?,?,?,?,?,?)').run(`type-${id}${suffix}`,id,value,1,`https://store.steampowered.com/app/${id}/`,time,'Test-only verified application type'); }
function release(db,id,{basis='first_playable',date='2026-10-05',precision='day',verified=1,status='released',phase=null,suffix='',source=`https://store.steampowered.com/app/${id}/`,time=at}={}) { db.raw.prepare('INSERT INTO research_release_evidence VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(`release-${id}-${basis}${suffix}`,id,basis,date,precision,verified,status,phase,source,time,'Test-only release history reconciliation'); }
function metric(db,id,value,{run='fixture-run',time=at,kind='players',method='fixture-method',scope='fixture scope',status='observed',suffix=''}={}) {
 db.raw.prepare('INSERT INTO metric_observations(observation_id,appid,metric,value,evidence_status,freshness,collected_at,source_url,source_scope,unit,method_version,run_id,original_keys_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(`obs-${id}-${run}-${kind}${suffix}`,id,kind,value,status,'fresh',time,`https://example.test/${id}`,scope,kind==='players'?'concurrent_players':'reviews',method,run,'[]');
}
const select = (extra={}) => parseResearchSelection(new URLSearchParams({asOf:ASOF,preset:'1m',...extra}));
async function using(callback) { const db=setup();try{await callback(db);}finally{db.close();} }

test('release API rejects unsupported, repeated, impossible or non-UTC selection values', async()=>using(async db=>{
 for(const query of ['population=all-steam','metric=score','basis=igdb','preset=30d','asOf=2026-02-30T00%3A00%3A00Z','asOf=2026-10-11','preset=custom&startDate=2026-10-11&endDate=2026-10-01','metric=players&metric=reviews','query=anything']) {
  const response=await handleRequest(new Request(`http://localhost/api/research/releases?${query}`),{DB:db}); assert.equal(response.status,400,query);
 }
 assert.equal((await handleRequest(new Request('http://localhost/api/research/releases',{method:'POST'}),{DB:db})).status,405);
}));
test('population and release cohort filter before aggregates; real zero remains observed', async()=>using(async db=>{
 for(let i=1;i<=4;i++){game(db,i,{cohort:i===4?'m3_discovery':'original_30'});type(db,i);release(db,i,{date:i===3?'2025-01-01':'2026-10-05'});metric(db,i,[0,10,1000,10000][i-1]);}
 const result=await readReleaseResearch(db,select({population:'legacy36'})); const row=result.genres.find(x=>x.genre==='Action');
 assert.equal(result.population.selectedCount,3);assert.equal(result.cohort.eligibleCount,2);assert.equal(row.observedCount,2);assert.equal(row.mean,5);assert.equal(row.median,5);assert.equal(row.iqr,5);assert.equal(row.coveragePercent,100);assert.equal(row.largestGameShare,1);assert.equal(row.sampleStatus,'insufficient_sample');assert.equal(row.rankable,false);assert.equal(result.cohort.exclusionCounts.outside_release_window,1);
}));
test('legacy store and IGDB dates are never promoted to reconciled Steam release evidence', async()=>using(async db=>{
 game(db,1);type(db,1);metric(db,1,10);
 db.raw.prepare("INSERT INTO catalog_games(appid,igdb_id,match_status,source,first_release_at,identity_json) VALUES(1,1,'matched','IGDB','2026-10-05T00:00:00Z','{}')").run();
 const result=await readReleaseResearch(db,select()); assert.equal(result.cohort.eligibleCount,0);assert.equal(result.cohort.exclusionCounts.missing_release_date,1);assert.equal(result.population.missingReleaseEvidenceCount,1);assert.equal(result.audit[0].legacyDisplayDate,'Oct 5, 2026');assert.equal(result.audit[0].igdbFirstReleaseDate,'2026-10-05T00:00:00Z');
}));
test('game types are independently verified before aggregation and conflicts fail closed',async()=>using(async db=>{
 for(let i=1;i<=4;i++){game(db,i);release(db,i);metric(db,i,9);}
 type(db,2,'demo');type(db,3);type(db,3,'dlc','-conflict');type(db,4);
 const result=await readReleaseResearch(db,select());assert.equal(result.cohort.eligibleCount,1);assert.equal(result.population.typeExcludedCount,3);assert.deepEqual(result.cohort.exclusionCounts,{unverified_application_type:1,excluded_application_type:1,conflicting_application_type:1});
}));
test('full release is independent, accepts omitted phase, and never backfills first playable',async()=>using(async db=>{
 game(db,1);type(db,1);release(db,1,{basis:'full_release'});metric(db,1,1);
 assert.equal((await readReleaseResearch(db,select())).cohort.eligibleCount,0);
 assert.equal((await readReleaseResearch(db,select({basis:'full_release'}))).cohort.eligibleCount,1);
}));
test('contradictory release chronology and dates survive the adapter and are excluded',async()=>using(async db=>{
 game(db,1);type(db,1);release(db,1);release(db,1,{basis:'full_release',date:'2026-10-01'});metric(db,1,5);
 const result=await readReleaseResearch(db,select());assert.equal(result.cohort.exclusionCounts.conflicting_release_chronology,1);
}));
test('one selected snapshot never backfills a missing game from an older run',async()=>using(async db=>{
 for(let i=1;i<=2;i++){game(db,i);type(db,i);release(db,i);metric(db,i,100,{run:'older',time:'2026-10-10T10:00:00Z'});}metric(db,1,0,{run:'newer'});
 const result=await readReleaseResearch(db,select());const row=result.genres[0];assert.equal(result.observations.available.length,2);assert.equal(result.observations.selected.runId,'newer');assert.equal(row.observedCount,1);assert.equal(row.missingCount,1);assert.equal(row.mean,0);assert.equal(row.coveragePercent,50);assert.equal(result.audit[1].observation.missingReason,'missing_in_selected_observation_set');
 const older=result.observations.available.find(x=>x.runId==='older');assert.equal((await readReleaseResearch(db,select({snapshot:older.id}))).genres[0].mean,100);
 await assert.rejects(()=>readReleaseResearch(db,select({snapshot:'bad'})),/unavailable/);
}));
test('metric method and source scope form independent snapshot contracts',async()=>using(async db=>{
 for(let i=1;i<=2;i++){game(db,i);type(db,i);release(db,i);}metric(db,1,10,{scope:'all language'});metric(db,2,100,{scope:'english'});
 const result=await readReleaseResearch(db,select());assert.equal(result.observations.available.length,2);assert.equal(result.genres[0].observedCount,1);assert.equal(result.genres[0].missingCount,1);
}));
test('same-run duplicate disagreement becomes missing, not a sum or last-write winner',async()=>using(async db=>{
 game(db,1);type(db,1);release(db,1);metric(db,1,10);metric(db,1,20,{time:'2026-10-10T12:01:00Z',suffix:'-later'});
 const result=await readReleaseResearch(db,select());assert.equal(result.genres[0].observedCount,0);assert.equal(result.genres[0].missingReasonCounts.conflicting_duplicate_values,1);assert.equal(result.audit[0].observation.value,null);assert.equal(result.audit[0].observation.missingReason,'conflicting_duplicate_values');
}));
test('estimated metrics cannot pass as direct observations; all-missing stays null',async()=>using(async db=>{
 game(db,1);type(db,1);release(db,1);metric(db,1,5,{status:'estimated'});
 const result=await readReleaseResearch(db,select());assert.equal(result.genres[0].mean,null);assert.equal(result.genres[0].coveragePercent,0);assert.equal(result.genres[0].missingReasonCounts.unsupported_evidence_status,1);
}));
test('review activity windows are independent and remain unvalidated/missing',async()=>using(async db=>{
 game(db,1);type(db,1);release(db,1);metric(db,1,999,{kind:'reviews'});
 const result=await readReleaseResearch(db,select({metric:'reviews7d'}));assert.equal(result.observations.selected,null);assert.equal(result.genres[0].observedCount,0);assert.equal(result.genres[0].missingReasonCounts.review_activity_source_gate_unvalidated,1);assert.equal(result.releaseWindow.kind,'release_cohort');assert.equal(result.reviewWindows.reviews30d.kind,'review_activity');assert.equal(Date.parse(result.reviewWindows.reviews30d.endExclusive)-Date.parse(result.reviewWindows.reviews30d.startInclusive),30*86400000);
}));
test('unknown genres remain audit-visible without fabricated statistical categories',async()=>using(async db=>{
 game(db,1,{genre:'Unresolved / needs review'});type(db,1);release(db,1);metric(db,1,1);
 const result=await readReleaseResearch(db,select());assert.equal(result.cohort.eligibleCount,1);assert.deepEqual(result.cohort.unclassifiedAppIds,['1']);assert.equal(result.genres.length,0);assert.equal(result.population.unresolvedGenreCount,1);
}));
test('future observations and evidence do not leak into an earlier evaluation cutoff',async()=>using(async db=>{
 game(db,1);release(db,1);type(db,1,'game','','2026-10-12T00:00:00Z');metric(db,1,1,{time:'2026-10-12T00:00:00Z'});
 const result=await readReleaseResearch(db,select());assert.equal(result.cohort.eligibleCount,0);assert.equal(result.observations.selected,null);assert.equal(result.audit[0].appType,'unknown');
}));
test('API reads saved rows without provider calls or changing any table',async()=>using(async db=>{
 game(db,1);type(db,1);release(db,1);metric(db,1,0);
 const tables=db.raw.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(x=>x.name);const before=tables.map(name=>db.raw.prepare(`SELECT * FROM ${name}`).all());const old=globalThis.fetch;globalThis.fetch=()=>{throw Error('Unexpected provider request');};
 try{const response=await handleRequest(new Request(`http://localhost/api/research/releases?asOf=${ASOF}`),{DB:db});assert.equal(response.status,200);assert.equal((await response.json()).cohort.eligibleCount,1);}finally{globalThis.fetch=old;}
 assert.deepEqual(tables.map(name=>db.raw.prepare(`SELECT * FROM ${name}`).all()),before);
}));
test('additive migration is idempotent and rollback leaves every original row untouched',async()=>using(async db=>{
 game(db,1);const legacy=db.raw.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'research_%' ORDER BY name").all().map(x=>x.name);const state=()=>legacy.map(name=>[name,db.raw.prepare(`SELECT * FROM ${name}${name==='local_migrations'?" WHERE name <> '0004_release_research.sql'":''}`).all()]);const before=state();assert.deepEqual(migrate(db),[]);
 db.raw.exec(readFileSync(new URL('../migrations/rollback/0004_release_research.sql',import.meta.url),'utf8'));assert.deepEqual(state(),before);assert.deepEqual(migrate(db),['0004_release_research.sql']);assert.deepEqual(state(),before);assert.equal(db.raw.prepare('PRAGMA integrity_check').get().integrity_check,'ok');assert.equal(db.raw.prepare('PRAGMA foreign_key_check').all().length,0);
}));
