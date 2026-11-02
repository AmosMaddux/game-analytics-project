import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase, migrate } from '../scripts/database.mjs';
import { parseResearchSelection, readReleaseResearch } from '../backend/release-research.ts';
import { applyToDisposableDatabase, canonicalJson, databaseSnapshot, planImport, runCli, sealManifest, validateManifest, verifyPreservation } from '../scripts/release-evidence-import.mjs';

const pilot = JSON.parse(readFileSync(new URL('../evidence/five-game-reviewed-pilot-2026-10-11.json', import.meta.url), 'utf8'));
const NOW = '2026-10-11T18:00:00Z';
const options = { now: NOW };
const copy = () => structuredClone(pilot);
const edited = edit => { const m = copy(); edit(m); return sealManifest(m); };
function setup(filename = ':memory:') {
  const db = openDatabase(filename); migrate(db);
  db.raw.exec("INSERT INTO genres VALUES ('Action',0,'fixture'); INSERT INTO cohorts VALUES('original_30','Fixture',0,0,'{}')");
  for (const appid of pilot.scope.appids) db.raw.prepare("INSERT INTO games(appid,source_id,name,steam_name,genre,cohort_id,release_display,store_url,collected_at,position) VALUES(?,?,?,?,?,?,?,?,?,?)").run(appid,String(appid),`Fixture ${appid}`,`Fixture ${appid}`,'Action','original_30','Original reference',`https://store.steampowered.com/app/${appid}/`,'2026-10-10T00:00:00Z',appid);
  db.raw.exec("CREATE TABLE preserved (id TEXT PRIMARY KEY, value TEXT); INSERT INTO preserved VALUES('history','do not mutate')");
  return db;
}
function using(callback) { const db = setup(); try { return callback(db); } finally { db.close(); } }
function insertRelease(db, { id='old', appid=2142790, basis='first_playable', date='2024-08-05', precision='day', verified=1, status='released', phase='early_access', source=`https://store.steampowered.com/app/${appid}/`, time='2026-10-10T00:00:00Z' } = {}) {
 db.raw.prepare('INSERT INTO research_release_evidence VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id,appid,basis,date,precision,verified,status,phase,source,time,'Pre-existing fixture');
}
function type(db, value, id=value) { db.raw.prepare('INSERT INTO research_application_evidence VALUES(?,?,?,?,?,?,?)').run(id,2142790,value,1,'https://store.steampowered.com/app/2142790/','2026-10-10T00:00:00Z','Existing type fixture'); }
const select = extra => parseResearchSelection(new URLSearchParams({asOf:NOW,preset:'custom',startDate:'1990-01-01',endDate:'2026-10-11',...extra}));

test('pilot validation and dry run are offline, append-only, and do not create registry tables', () => using(db => {
 const before = databaseSnapshot(db.raw), old = globalThis.fetch;
 globalThis.fetch = () => { throw Error('Network is forbidden'); };
 try { validateManifest(pilot, options); const plan = planImport(db.raw, pilot, options); assert.equal(plan.acceptedReleaseRows,5); assert.equal(plan.acceptedTypeRows,5); assert.equal(plan.pendingAssertions,7); }
 finally { globalThis.fetch = old; }
 assert.deepEqual(databaseSnapshot(db.raw),before);
 assert.equal(db.raw.prepare("SELECT 1 FROM sqlite_master WHERE name='research_evidence_imports'").get(),undefined);
}));
test('transactional import preserves every legacy row; same-manifest replay and new-manifest shared assertions are no-ops for facts', () => using(db => {
 const before = databaseSnapshot(db.raw), first = applyToDisposableDatabase(db.raw,pilot,options);
 assert.equal(first.acceptedReleaseRows,5); assert.equal(verifyPreservation(before,databaseSnapshot(db.raw)),true);
 const after = databaseSnapshot(db.raw), second = applyToDisposableDatabase(db.raw,pilot,options);
 assert.equal(second.replay,true); assert.equal(second.acceptedReleaseRows,0); assert.deepEqual(databaseSnapshot(db.raw),after);
 const other = edited(m => {m.manifestId='repeat-other-manifest';});
 const third = applyToDisposableDatabase(db.raw,other,options); assert.equal(third.acceptedReleaseRows,0); assert.equal(db.raw.prepare('SELECT count(*) AS n FROM research_release_evidence').get().n,5);
 assert.equal(db.raw.prepare('SELECT count(*) AS n FROM research_application_evidence').get().n,5);
}));
test('pending plans and generic dates never enter accepted rows; partial date support is rejected', () => using(db => {
 applyToDisposableDatabase(db.raw,pilot,options);
 assert.equal(db.raw.prepare("SELECT count(*) AS n FROM research_release_evidence WHERE release_status<>'released' OR appid IN(70,274520)").get().n,0);
 for (const change of [
  m => { const a=m.assertions.find(a=>a.assertionId==='kings-planned-full-release');a.disposition='accepted';a.confidence='reviewed_primary_corroborated'; },
  m => { const a=m.assertions.find(a=>a.assertionId==='darkwood-full-release-pending');a.disposition='accepted';a.confidence='reviewed_primary_corroborated';a.method='steam_full_release_corroborated_v1';a.status='released'; },
  m => { const a=m.assertions[0];a.precision='month';a.date='2024-08'; },
  m => {m.assertions[0].firstPlayablePolicy=null;},
  m => {m.assertions[0].basis='full_release';},
  m => {m.assertions[1].supportingObservationIds=['mistria-display','mistria-plan'];},
 ]) assert.throws(()=>validateManifest(edited(change),options));
}));
test('strict source registry rejects wrong AppID, host, path, insecure or authenticated URLs, forged roles and IGDB relabeling', () => {
 for (const change of [
  m=>{m.observations[0].sourceUrl='https://store.steampowered.com/app/70/';},
  m=>{m.observations[0].sourceUrl='https://store.steampowered.com.evil.test/app/2142790/';},
  m=>{m.observations[0].sourceUrl='http://store.steampowered.com/app/2142790/';},
  m=>{m.observations[0].sourceUrl='https://user:password@store.steampowered.com/app/2142790/';},
  m=>{m.observations[0].sourceUrl+='&key=secret';},
  m=>{m.observations[0].sourceKind='igdb';},
  m=>{m.observations[0].role='full_release_available';},
  m=>{m.observations[0].appid=70;},
  m=>{m.assertions[0].supportingObservationIds=['storm-ea-date','mistria-state'];},
 ]) assert.throws(()=>validateManifest(edited(change),options));
});
test('strict dates, UTC retrieval, intervals, capture provenance and future release claims fail closed', () => {
 for (const change of [
  m=>{m.observations[0].date='0000-01-01';},
  m=>{m.observations[0].retrieved.start='0000-01-01T00:00:00Z';},
  m=>{m.observations[0].date='2024-02-30';},
  m=>{m.observations[0].date='2024-8-5';},
  m=>{m.observations[0].retrieved.end='2026-02-30T17:30:00Z';},
  m=>{m.observations[0].retrieved.end='2026-10-11T17:30:00+00:00';},
  m=>{m.observations[0].retrieved.end='2026-10-11';},
  m=>{m.observations[0].retrieved.start='2026-10-11T17:31:00Z';},
  m=>{m.observations[0].retrieved.precision='instant';},
  m=>{m.observations[0].retrieved.end='2027-10-11T17:30:00Z';},
  m=>{m.observations[0].capture.responseSha256='invented';},
  m=>{m.observations[0].date='2027-08-05';m.assertions[0].date='2027-08-05';},
  m=>{m.review.reviewedAt='2026-10-12T00:00:00Z';},
 ]) assert.throws(()=>validateManifest(edited(change),options));
});
test('tampered content hash, duplicate IDs/facts, unknown fields and missing existing AppIDs are rejected', () => using(db => {
 const invalid=copy(); invalid.assertions[0].date='2000-01-01';assert.throws(()=>validateManifest(invalid,options),/hash/);
 for(const change of [
  m=>{m.assertions.push({...m.assertions[0]});},
  m=>{m.assertions.push({...m.assertions[0],assertionId:'same-fact-new-id'});},
  m=>{m.observations.push({...m.observations[0]});},
  m=>{m.assertions[0].approved=true;},
  m=>{m.scope.reconstructedTypeDisposition='verified';},
  m=>{m.scope.appids.push(999);},
  m=>{m.assertions[0].supportingObservationIds.push(m.assertions[0].supportingObservationIds[0]);},
 ]) assert.throws(()=>validateManifest(edited(change),options));
 db.raw.prepare('DELETE FROM games WHERE appid=70').run();assert.throws(()=>planImport(db.raw,pilot,options),/Unknown existing AppID/);
}));
test('unknown and reconstructed types cannot be upgraded to verified under this policy', () => {
 for (const appid of [2142790,70,2784470]) assert.throws(()=>validateManifest(edited(m=>{const a=m.assertions.find(a=>a.kind==='application_type'&&a.appid===appid&&a.disposition==='accepted');a.disposition='accepted';a.confidence='high_reviewed_classification';a.method='saved_game_only_catalog_reconstruction';a.supportingObservationIds=[m.observations.find(o=>o.appid===appid).observationId];}),options),/manual game classification required/);
});
test('changed manifest or assertion IDs abort atomically; missing/tampered prior facts do not pass replay', () => using(db => {
 applyToDisposableDatabase(db.raw,pilot,options);const state=databaseSnapshot(db.raw);
 assert.throws(()=>applyToDisposableDatabase(db.raw,edited(m=>{m.assertions[0].note+=' changed';}),options),/manifest ID/);
 assert.throws(()=>applyToDisposableDatabase(db.raw,edited(m=>{m.manifestId='new-id';m.assertions[0].note+=' changed';}),options),/assertion ID/);
 assert.deepEqual(databaseSnapshot(db.raw),state);
 db.raw.prepare("UPDATE research_release_evidence SET verification_note='tampered' WHERE evidence_id=?").run('reviewed-mistria-first-playable');
 assert.throws(()=>planImport(db.raw,pilot,options),/missing or modified/);
}));
test('existing planned rows block released claims even unverified, older and with null dates', () => {
 for (const verified of [0,1]) using(db=>{insertRelease(db,{status:'planned',verified,date:null,precision:'unknown'});const before=databaseSnapshot(db.raw);assert.throws(()=>applyToDisposableDatabase(db.raw,pilot,options),/Stale planned/);assert.deepEqual(databaseSnapshot(db.raw),before);});
});
test('verified unknown poisoning, type disagreement, competing dates and cross-basis chronology block import', () => {
 using(db=>{type(db,'unknown');assert.throws(()=>planImport(db.raw,pilot,options),/Verified unknown/);});
 using(db=>{type(db,'game');type(db,'demo');assert.throws(()=>planImport(db.raw,pilot,options),/Conflicting application type/);});
 using(db=>{insertRelease(db,{date:'2024-08-04'});assert.throws(()=>planImport(db.raw,pilot,options),/Conflicting release dates/);});
 using(db=>{insertRelease(db,{basis:'full_release',date:'2024-07-01',phase:'full_release'});assert.throws(()=>planImport(db.raw,edited(m=>{m.assertions=m.assertions.filter(a=>a.assertionId!=='mistria-full-release');}),options),/chronology/);});
});
test('insertion failure and trigger mutation both roll back facts, registry and legacy rows', () => {
 using(db=>{db.raw.exec("CREATE TRIGGER forced_failure BEFORE INSERT ON research_release_evidence WHEN NEW.release_basis='full_release' BEGIN SELECT RAISE(ABORT,'fixture write failure'); END;");const before=databaseSnapshot(db.raw);assert.throws(()=>applyToDisposableDatabase(db.raw,pilot,options),/fixture write failure/);assert.deepEqual(databaseSnapshot(db.raw),before);});
 using(db=>{db.raw.exec("CREATE TRIGGER unexpected_mutation AFTER INSERT ON research_release_evidence BEGIN UPDATE preserved SET value='changed'; END;");const before=databaseSnapshot(db.raw);assert.throws(()=>applyToDisposableDatabase(db.raw,pilot,options),/Changed original/);assert.deepEqual(databaseSnapshot(db.raw),before);});
});
test('duplicate pre-existing accepted fact is linked, not reinserted', () => using(db=>{
 const plan=planImport(db.raw,pilot,options), original=plan.rows[0];
 db.raw.prepare(`INSERT INTO research_release_evidence (${Object.keys(original).join(',')}) VALUES(${Object.keys(original).map(()=>'?').join(',')})`).run(...Object.values({...original,evidence_id:'external-same-fact'}));
 const result=applyToDisposableDatabase(db.raw,pilot,options);assert.equal(result.acceptedReleaseRows,4);assert.equal(db.raw.prepare('SELECT count(*) AS n FROM research_release_evidence').get().n,5);
}));
test('actual release filters retain type gate and time semantics; fixtures independently exercise both date bases', async()=>{
 const db=setup();try{
 applyToDisposableDatabase(db.raw,pilot,options);
 const gated=await readReleaseResearch(db,select());assert.equal(gated.cohort.eligibleCount,3);assert.equal(gated.population.missingReleaseEvidenceCount,2);assert.equal(gated.population.typeExcludedCount,0);
 // Test-only independently verified types prove the date discriminator, never enter pilot manifest.
 for(const appid of pilot.scope.appids) db.raw.prepare('INSERT INTO research_application_evidence VALUES(?,?,?,?,?,?,?)').run(`fixture-type-${appid}`,appid,'game',1,`https://store.steampowered.com/app/${appid}/`,'2026-10-10T00:00:00Z','Test-only type');
 const first=await readReleaseResearch(db,select()), full=await readReleaseResearch(db,select({basis:'full_release'}));
 assert.equal(first.cohort.eligibleCount,3);assert.equal(full.cohort.eligibleCount,2);assert.equal(full.population.missingReleaseEvidenceCount,3);
 assert.equal(first.audit.find(r=>r.appid===2142790).releaseDate,'2024-08-05');assert.equal(full.audit.find(r=>r.appid===2142790).releaseDate,'2026-08-05');
 assert.equal(full.audit.find(r=>r.appid===2784470).eligible,false);assert.equal(first.audit.find(r=>r.appid===70).releaseDate,null);
 const earlier=await readReleaseResearch(db,select({asOf:'2026-10-11T17:29:59Z'}));assert.equal(earlier.cohort.eligibleCount,0);assert.equal(earlier.population.missingReleaseEvidenceCount,5);
 }finally{db.close();}
});
test('CLI defaults to read-only dry run, requires explicit paths, and applies only to a new disposable copy',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'fieldnote-evidence-cli-'));
 try{
 const source=join(dir,'source.sqlite'), destination=join(dir,'throwaway.sqlite'), manifest=join(dir,'manifest.json');
 const db=setup(source);db.close();writeFileSync(manifest,JSON.stringify(pilot));const bytes=readFileSync(source);
 const result=await runCli(['--manifest',manifest,'--database',source]);assert.equal(result.mode,'dry_run');assert.deepEqual(readFileSync(source),bytes);
 for(const args of [[],['--manifest',manifest],['--manifest',manifest,'--database',source,'--apply',source],['--manifest',manifest,'--database',source,'--database',source]]) await assert.rejects(()=>runCli(args));
 await assert.rejects(()=>runCli(['--manifest',manifest,'--database',source,'--apply-copy',source]));
 const applied=await runCli(['--manifest',manifest,'--database',source,'--apply-copy',destination]);assert.equal(applied.preservation,'all original rows preserved');assert.equal(applied.replay,'no_op_verified');assert.deepEqual(readFileSync(source),bytes);
 const copied=new DatabaseSync(destination,{readOnly:true});try{assert.equal(copied.prepare('SELECT count(*) AS n FROM research_release_evidence').get().n,5);}finally{copied.close();}
 await assert.rejects(()=>runCli(['--manifest',manifest,'--database',source,'--apply-copy',destination]),/EEXIST/);assert.equal(existsSync(destination),true);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('canonical hash is property-order independent; changed value changes content identity',()=>{
 const a=copy();assert.equal(sealManifest(JSON.parse(canonicalJson(a))).contentSha256,a.contentSha256);a.limitations[0]+=' New finding';assert.notEqual(sealManifest(a).contentSha256,pilot.contentSha256);
});
