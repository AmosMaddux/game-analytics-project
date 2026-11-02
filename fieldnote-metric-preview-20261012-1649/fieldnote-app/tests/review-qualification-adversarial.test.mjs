import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';import{tmpdir}from'node:os';import{join}from'node:path';import{DatabaseSync}from'node:sqlite';
import{openDatabase,migrate}from'../scripts/database.mjs';import{importBroadCatalog}from'../scripts/import-broad-catalog.mjs';import{validateQualification,importQualification}from'../scripts/import-review-qualification.mjs';
import{broadFixture,encode}from'./fixtures/reviewer-broad.mjs';import{sentinelFixture,hash}from'./fixtures/reviewer-metrics.mjs';import{REVIEW_FILTERS}from'../scripts/import-panel-metrics.mjs';
const now='2026-10-12T15:00:00.000Z';
function qualification(sourceSha,validationRaw,appids=[900001]){const validation=JSON.parse(validationRaw);return {schemaVersion:'fieldnote-candidate-review-qualification-1.0',status:'completed',metricScope:'lifetime_only',sourcePolicyVersion:'steam-dated-counts-1.0',runId:'panelmetrics-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',startedAt:'2026-10-12T10:00:00.000Z',finishedAt:'2026-10-12T11:00:00.000Z',filters:structuredClone(REVIEW_FILTERS),validationEvidence:{reportSha256:hash(validationRaw),reportRunId:validation.runId,validatedAt:validation.finishedAt},candidateSet:{populationVersion:'candidate-review-qualification-1.0',manifestSha256:sourceSha,appids},observations:appids.map(appid=>({observationKey:`qualification-${appid}`,appid,metric:'lifetimeReviews',window:null,value:0,missingReason:null,sourceUrl:'https://api.steampowered.com/IUserReviewsService/GetAppReviews/v1/',sourceField:'total_matching',unit:'surviving_matching_review_count',methodVersion:'steam-dated-counts-1.0',observedAt:'2026-10-12T10:30:00.000Z'}))};}
async function context(t){const dir=mkdtempSync(join(tmpdir(),'reviewer-qualification-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const original=join(dir,'original.sqlite'),source=join(dir,'broad.sqlite'),candidates=join(dir,'source.json'),qualificationFile=join(dir,'qualification.json'),validationFile=join(dir,'validation.json'),output=join(dir,'qualified.sqlite');const db=openDatabase(original);migrate(db);db.close();const sourceData=broadFixture(),e=encode(sourceData);writeFileSync(candidates,e.raw);await importBroadCatalog({source:original,candidates,expectedSha:e.expectedSha,applyCopy:source,now});const validationRaw=JSON.stringify(sentinelFixture(),null,2)+'\n';writeFileSync(validationFile,validationRaw);const bundle=qualification(e.expectedSha,validationRaw),encoded=encode(bundle);writeFileSync(qualificationFile,encoded.raw);return {dir,original,source,sourceData,sourceSha:e.expectedSha,candidates,qualificationFile,validationFile,validationRaw,bundle,output,...encoded,options:{source,qualificationFile,validationFile,expectedSha:encoded.expectedSha,now}};}
const shaFile=p=>hash(readFileSync(p));
function rows(path){const db=new DatabaseSync(path,{readOnly:true});try{return Object.fromEntries(['games','metric_observations','research_activity_observations','research_panel_memberships','research_qualification_imports'].map(name=>[name,db.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all().map(row=>({...row}))]));}finally{db.close();}}

test('qualification requires exact SHA, complete singleton membership and source/time semantics',()=>{
 const validationRaw=JSON.stringify(sentinelFixture()),bundle=qualification('a'.repeat(64),validationRaw),valid=encode(bundle);assert.equal(validateQualification(valid.raw,validationRaw,valid.expectedSha,{now}).bundle.observations.length,1);
 for(const change of [x=>x.observations[0].value=null,x=>x.observations[0].value=-1,x=>x.observations[0].unit='reviews',x=>x.observations[0].sourceField='query_summary.total_reviews',x=>x.observations[0].observedAt='2026-10-12T09:59:59.999Z',x=>x.observations[0].observedAt='2026-10-12T11:00:00.001Z',x=>x.candidateSet.appids=[900002],x=>x.observations.push({...x.observations[0]}),x=>x.filters.purchase_type=1,x=>x.finishedAt='2026-02-30T00:00:00.000Z']){const changed=structuredClone(bundle);change(changed);const e=encode(changed);assert.throws(()=>validateQualification(e.raw,validationRaw,e.expectedSha,{now}),String(change));}
 assert.throws(()=>validateQualification(valid.raw,validationRaw,'0'.repeat(64),{now}));
});

test('qualification knownzero import preserves prior metrics and is idempotent without players/activity/membership',async t=>{
 const f=await context(t),before=rows(f.source),hashBefore=shaFile(f.source);assert.equal((await importQualification(f.options)).mode,'read_only_dry_run');assert.equal(existsSync(f.output),false);
 await importQualification({...f.options,applyCopy:f.output});assert.equal(shaFile(f.source),hashBefore);const after=rows(f.output);assert.deepEqual(after.games,before.games);assert.deepEqual(after.metric_observations.slice(0,before.metric_observations.length),before.metric_observations);const added=after.metric_observations.slice(before.metric_observations.length);assert.equal(added.length,1);assert.equal(added[0].metric,'reviews');assert.equal(added[0].value,0);assert.equal(added[0].evidence_status,'observed');assert.deepEqual(after.research_activity_observations,[]);assert.deepEqual(after.research_panel_memberships,[]);
 const replay=join(f.dir,'replay.sqlite');assert.equal((await importQualification({...f.options,source:f.output,applyCopy:replay})).mode,'idempotent_new_copy');assert.deepEqual(rows(replay),after);
 await assert.rejects(()=>importQualification({...f.options,applyCopy:f.source}),/separate/);
});

test('qualification run-ID and observation-key conflicts fail dryrun and before destination creation',async t=>{
 const f=await context(t);await importQualification({...f.options,applyCopy:f.output});const hashBefore=shaFile(f.output);
 for(const keyConflict of [false,true]){const bad=structuredClone(f.bundle);if(keyConflict)bad.runId='panelmetrics-bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee';else bad.observations[0].value=1;const e=encode(bad);writeFileSync(f.qualificationFile,e.raw);const options={...f.options,source:f.output,expectedSha:e.expectedSha};await assert.rejects(()=>importQualification(options),/conflict/);const destination=join(f.dir,`conflict-${keyConflict}.sqlite`);await assert.rejects(()=>importQualification({...options,applyCopy:destination}),/conflict/);assert.equal(existsSync(destination),false);assert.equal(shaFile(f.output),hashBefore);}
});

test('qualification transaction rollback prevents partial metric and run-ledger writes',async t=>{
 const f=await context(t),db=openDatabase(f.source);db.raw.exec("CREATE TRIGGER block_review BEFORE INSERT ON metric_observations WHEN NEW.evidence_status='observed' BEGIN SELECT RAISE(ABORT,'reviewer injected failure'); END");db.close();const before=rows(f.source),hashBefore=shaFile(f.source);await assert.rejects(()=>importQualification({...f.options,applyCopy:f.output}),/reviewer injected failure/);assert.deepEqual(rows(f.output),before);assert.equal(shaFile(f.source),hashBefore);
});

test('qualification cannot use a source hash whose imported frozen membership differs',async t=>{
 const f=await context(t),bad=structuredClone(f.bundle);bad.candidateSet.appids=[900002];bad.observations[0].appid=900002;const e=encode(bad);writeFileSync(f.qualificationFile,e.raw);await assert.rejects(()=>importQualification({...f.options,expectedSha:e.expectedSha,applyCopy:f.output}),/membership/);assert.equal(existsSync(f.output),false);
});

async function addendumContext(t){
 const f=await context(t);await importQualification({...f.options,applyCopy:f.output});
 const expanded=structuredClone(f.sourceData),raw=structuredClone(expanded.candidates[0]),compact=structuredClone(expanded.panelCandidates[0]);
 raw.appid=900002;raw.igdbId=900002;raw.name='MDK3';raw.sourceUrl='https://www.igdb.com/games/mdk3';raw.identity.steamName='MDK3';raw.identity.steamFetchedAt='2026-10-12T11:30:00.000Z';raw.crosswalk[0]={...raw.crosswalk[0],id:2,gameId:900002,uid:'900002',url:'https://store.steampowered.com/app/900002/'};
 Object.assign(compact,{appid:900002,name:raw.name,sourceUrl:raw.sourceUrl});expanded.candidates.push(raw);expanded.panelCandidates.push(compact);expanded.summary.identityVerified=2;expanded.finishedAt='2026-10-12T11:45:00.000Z';const e=encode(expanded);writeFileSync(f.candidates,e.raw);
 const expandedDb=join(f.dir,'expanded.sqlite');await importBroadCatalog({source:f.output,candidates:f.candidates,expectedSha:e.expectedSha,applyCopy:expandedDb,now});
 const bundle=qualification(e.expectedSha,f.validationRaw,[900002]);bundle.schemaVersion='fieldnote-candidate-review-addendum-1.0';bundle.runId='panelmetrics-bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee';bundle.startedAt='2026-10-12T12:00:00.000Z';bundle.finishedAt='2026-10-12T13:00:00.000Z';bundle.observations[0].observedAt='2026-10-12T12:30:00.000Z';bundle.observations[0].value=23;Object.assign(bundle.candidateSet,{populationVersion:'fieldnote-population-discovery-1.0',membershipMode:'new_verified_subset_of_source',sourceVerifiedCount:2,parentQualificationRunId:f.bundle.runId,parentBundleSha256:f.expectedSha});
 const encoded=encode(bundle),addendumFile=join(f.dir,'addendum.json');writeFileSync(addendumFile,encoded.raw);return {...f,expandedDb,addendum:bundle,addendumOptions:{source:expandedDb,qualificationFile:addendumFile,validationFile:f.validationFile,expectedSha:encoded.expectedSha,now}};
}

test('qualification addendum imports only new identities while preserving old run/value/time provenance',async t=>{
 const f=await addendumContext(t),destination=join(f.dir,'added.sqlite'),before=rows(f.expandedDb);const result=await importQualification({...f.addendumOptions,applyCopy:destination});assert.equal(result.accepted,1);assert.equal(result.membershipMode,'new_verified_subset_of_source');const after=rows(destination);
 assert.deepEqual(after.metric_observations.slice(0,before.metric_observations.length),before.metric_observations);const added=after.metric_observations.slice(before.metric_observations.length);assert.equal(added.length,1);assert.equal(added[0].appid,900002);assert.equal(added[0].value,23);assert.equal(added[0].run_id,f.addendum.runId);assert.equal(after.research_qualification_imports.length,2);
 assert.deepEqual(after.research_activity_observations,[]);assert.deepEqual(after.research_panel_memberships,[]);
});

test('qualification addendum rejects wrong parent receipt, replayed original membership and observations before new identity proof',async t=>{
 const f=await addendumContext(t);
 for(const change of [x=>x.candidateSet.parentBundleSha256='0'.repeat(64),x=>{x.candidateSet.appids=[900001];x.observations[0].appid=900001;},x=>{x.startedAt='2026-10-12T11:05:00.000Z';x.observations[0].observedAt='2026-10-12T11:10:00.000Z';},x=>{x.startedAt='2026-10-12T11:35:00.000Z';x.observations[0].observedAt='2026-10-12T11:40:00.000Z';}]){
  const modified=structuredClone(f.addendum);change(modified);const e=encode(modified);writeFileSync(f.addendumOptions.qualificationFile,e.raw);const destination=join(f.dir,'rejected.sqlite');await assert.rejects(()=>importQualification({...f.addendumOptions,expectedSha:e.expectedSha,applyCopy:destination}));assert.equal(existsSync(destination),false);
 }
});
