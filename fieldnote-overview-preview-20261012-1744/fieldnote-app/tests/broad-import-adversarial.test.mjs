import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {openDatabase,migrate} from '../scripts/database.mjs';
import {readSnapshot} from '../backend/repository.ts';
import {validateSnapshot} from '../backend/seed.ts';
import {validateBroadCatalog,importBroadCatalog} from '../scripts/import-broad-catalog.mjs';
import {broadFixture,encode,REVIEWER_NOW as now} from './fixtures/reviewer-broad.mjs';
const sha=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
function context(t){const dir=mkdtempSync(join(tmpdir(),'reviewer-broad-import-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const source=join(dir,'original.sqlite'),candidates=join(dir,'input.json'),output=join(dir,'copy.sqlite');const db=openDatabase(source);migrate(db);db.close();const fixture=broadFixture(),encoded=encode(fixture);writeFileSync(candidates,encoded.raw);return {dir,source,candidates,output,fixture,...encoded,options:{source,candidates,expectedSha:encoded.expectedSha,now}};}

test('broad preflight rejects malformed envelope, future times, identity conflicts and compact spoofing',()=>{
 const base=broadFixture();const valid=encode(base);assert.equal(validateBroadCatalog(valid.raw,valid.expectedSha,{now}).verified.length,1);
 const changes=[x=>delete x.sourceContract,x=>x.finishedAt='2027-01-01T00:00:00.000Z',x=>x.candidates[0].fetchedAt='2026-02-30T00:00:00.000Z',x=>x.candidates[0].crosswalk[0].uid='42',x=>x.panelCandidates[0].releaseDate='2020-01-01',x=>x.panelCandidates[0].sourceUrl='https://evil.example/spoof',x=>x.panelCandidates[0].source='Steam',x=>x.panelCandidates[0].lifetimeReviews=1000];
 for(const change of changes){const modified=structuredClone(base);change(modified);const e=encode(modified);assert.throws(()=>validateBroadCatalog(e.raw,e.expectedSha,{now}),String(change));}
 assert.throws(()=>validateBroadCatalog(valid.raw,'0'.repeat(64),{now}));
});

test('copy-only import retains source hash and exact raw snapshot; replay is idempotent and output cannot overwrite',async t=>{
 const f=context(t),before=sha(f.source);const dry=await importBroadCatalog(f.options);assert.equal(dry.mode,'read_only_dry_run');assert.equal(existsSync(f.output),false);
 const actual=await importBroadCatalog({...f.options,applyCopy:f.output});assert.equal(actual.newGames,1);assert.equal(sha(f.source),before);
 const copy=new DatabaseSync(f.output,{readOnly:true});try{assert.equal(copy.prepare('SELECT count(*) n FROM games').get().n,1);const stored=JSON.parse(copy.prepare('SELECT raw_json FROM research_catalog_records').get().raw_json);assert.deepEqual(stored,f.fixture.candidates[0]);assert.equal(copy.prepare("SELECT declared_count FROM cohorts WHERE id='broad_discovery'").get().declared_count,0);}finally{copy.close();}
 const replay=join(f.dir,'replay.sqlite');assert.equal((await importBroadCatalog({...f.options,source:f.output,applyCopy:replay})).mode,'idempotent_new_copy');
 const check=new DatabaseSync(replay,{readOnly:true});try{assert.equal(check.prepare('SELECT count(*) n FROM games').get().n,1);assert.equal(check.prepare('SELECT count(*) n FROM research_catalog_records').get().n,1);}finally{check.close();}
 await assert.rejects(()=>importBroadCatalog({...f.options,applyCopy:f.output}),/new separate/);await assert.rejects(()=>importBroadCatalog({...f.options,applyCopy:f.source}),/new separate/);
});

test('a transaction failure leaves every copied original row intact and no partial admission',async t=>{
 const f=context(t),db=openDatabase(f.source);db.raw.exec("CREATE TRIGGER fail_reviewer_record BEFORE INSERT ON research_catalog_records BEGIN SELECT RAISE(ABORT,'independent injected failure'); END");db.close();const before=sha(f.source);
 await assert.rejects(()=>importBroadCatalog({...f.options,applyCopy:f.output}),/independent injected failure/);assert.equal(sha(f.source),before);
 const copy=new DatabaseSync(f.output,{readOnly:true});try{for(const table of ['games','catalog_games','research_catalog_records','research_catalog_imports'])assert.equal(copy.prepare(`SELECT count(*) n FROM ${table}`).get().n,0,table);assert.equal(copy.prepare('PRAGMA integrity_check').get().integrity_check,'ok');}finally{copy.close();}
});

test('existing AppID with a different IGDB identity fails before creating destination',async t=>{
 const f=context(t);await importBroadCatalog({...f.options,applyCopy:f.output});
 const modified=structuredClone(f.fixture);modified.candidates[0].igdbId++;modified.candidates[0].crosswalk[0].gameId++;const e=encode(modified);writeFileSync(f.candidates,e.raw);const next=join(f.dir,'conflicting.sqlite'),before=sha(f.output);
 await assert.rejects(()=>importBroadCatalog({...f.options,source:f.output,expectedSha:e.expectedSha,applyCopy:next}),/identity conflict/);assert.equal(existsSync(next),false);assert.equal(sha(f.output),before);
});

test('broad Browse count derives additions while stored placeholder and prior cohort counts remain unchanged',async t=>{
 const f=context(t);await importBroadCatalog({...f.options,applyCopy:f.output});const db=openDatabase(f.output);try{
 db.raw.prepare('INSERT INTO snapshot_metadata VALUES(?,?)').run('builtAt',JSON.stringify(now));db.raw.prepare('INSERT INTO cohorts VALUES(?,?,?,?,?)').run('original_30','Original preserved count',30,999,'{}');
 const snapshot=await readSnapshot(db,{now:Date.parse(now)});assert.equal(snapshot.meta.cohorts.find(x=>x.id==='broad_discovery').count,1);assert.equal(snapshot.meta.cohorts.find(x=>x.id==='original_30').count,30);assert.equal(db.raw.prepare("SELECT declared_count FROM cohorts WHERE id='broad_discovery'").get().declared_count,0);
 }finally{db.close();}
});

test('MDK2/MDK 2 title normalization is scoped to reviewed broad cohort and rule version',async t=>{
 const f=context(t);await importBroadCatalog({...f.options,applyCopy:f.output});const db=openDatabase(f.output);try{
 db.raw.prepare('INSERT INTO snapshot_metadata VALUES(?,?)').run('builtAt',JSON.stringify(now));const snapshot=await readSnapshot(db,{now:Date.parse(now)});snapshot.meta.mode='offline_preserved_evidence';snapshot.genres=['Unresolved / needs review'];assert.equal(snapshot.games[0].catalog.name,'MDK2');assert.equal(snapshot.games[0].steamName,'MDK 2');assert.doesNotThrow(()=>validateSnapshot(snapshot));
 const other=structuredClone(snapshot);other.meta.cohorts.push({id:'original_30'});other.games[0].cohort='original_30';assert.throws(()=>validateSnapshot(other),/title conflict/);
 const unreviewed=structuredClone(snapshot);unreviewed.games[0].catalog.identity.ruleVersion='legacy-unreviewed';assert.throws(()=>validateSnapshot(unreviewed),/title conflict/);
 }finally{db.close();}
});
