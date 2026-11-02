import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CAPS, QUALIFICATION_CAPS, canonical, sha, validateInputs, newLedger, newJob, panelInput, runJob, completedBundle, authoritativeStatePath, qualificationIds, newQualificationJob, advanceLedgerToPanel } from './collect-panel-metrics.mjs';
import { ENDPOINTS } from './validate-reviews.mjs';
import { joinQualified } from './join-qualified-candidates.mjs';

const validationRaw = await readFile(new URL('./passed-sentinel-evidence.json', import.meta.url), 'utf8');
const validationSha = 'a8efd1423272343178ed1813ad03660a18e74169f032c0e06fceb90bd2e40b6f';
const NOW = Date.parse('2026-10-11T19:00:00Z'), END = Date.parse('2026-10-11T00:00:00Z') / 1000;
function panelFixture() {
  const members = []; let id = 50000000;
  for (const [allocationGroup, size] of [['popular_reference',75],['recent_releases',100],['older_2021',20],['older_2022',20],['older_2023',20],['older_2024',20],['older_2025',20],['low_traction_controls',25]]) for (let i=0;i<size;i++) members.push({ appid: ++id, name: 'SYNTHETIC OFFLINE FIXTURE', allocationGroup, reason: 'Offline transport test only, never a collection manifest.' });
  const body = { schemaVersion:'fieldnote-panel-candidates-1.0', policyVersion:'test-only-policy', asOf:'2026-10-11T18:30:00.000Z', releaseBasis:'igdb_pc', selectedCount:300, targetCount:300, shortfallCount:0, members };
  const hash = sha(canonical(body)); return {...body, manifestSha256:hash, panelId:`panel-${hash.slice(0,24)}`};
}
function baseline(used=41) { return { schemaVersion:'fieldnote-source-budget-baseline-1.0', month:'2026-10',authoritativeLedgerPath:'/tmp/fieldnote-source-budget-2026-10.json', entries:[{id:'actual-sentinel-campaign',requests:used}], scheduleEnabled:false,reservedScheduledRequests:0,bootstrapAllowance:1500 }; }
function fresh(kind='manual', used=41) {
  const ledger = newLedger(baseline(used)); ledger.job = newJob({panel:panelFixture(),validationRaw,expectedSha:validationSha,end:END,kind,now:new Date(NOW).toISOString()}); return ledger;
}
function clock() { let time=NOW; return {now:()=>time,wait:async ms=>{time+=ms;},advance:ms=>{time+=ms;}}; }
async function goodCall({endpoint,input}) {
  if(endpoint===ENDPOINTS.players)return {data:{response:{result:1,player_count:12}},bytes:100};
  const total=input.date_range_start===undefined?1000:input.date_range_end-input.date_range_start<8*86400?10:40;
  return {data:{response:{total_matching:total,query_summary:{num_reviews:1},reviews:[{recommendationid:'100',timestamp_created:input.date_range_start?input.date_range_start+1:END-1,review:'DO NOT SAVE',author:{steamid:'DO NOT SAVE AUTHOR'}}]}},bytes:100};
}
test('real independently audited source proof is accepted only by exact hash',()=>{
  assert.equal(sha(validationRaw),validationSha); assert.equal(validateInputs(panelFixture(),validationRaw,validationSha).appids.length,300);
  assert.throws(()=>validateInputs(panelFixture(),validationRaw,'0'.repeat(64)),/validation_hash/);
});
test('stopped proof and repeated checks cannot enable collection',()=>{
  const proof=JSON.parse(validationRaw); proof.status='stopped';let raw=JSON.stringify(proof);
  assert.throws(()=>validateInputs(panelFixture(),raw,sha(raw)),/passed_live_validation/);
  proof.status='passed';proof.checks[1]=proof.checks[0];raw=JSON.stringify(proof);
  assert.throws(()=>validateInputs(panelFixture(),raw,sha(raw)),/validation_checks/);
});
test('shortfall, duplicate IDs and corrupted membership are rejected',()=>{
  const p=panelFixture();p.selectedCount=299;assert.throws(()=>validateInputs(p,validationRaw,validationSha),/complete_300/);
  const p2=panelFixture();p2.members[0].appid=p2.members[1].appid;assert.throws(()=>validateInputs(p2,validationRaw,validationSha),/panel_hash/);
});
test('an actual populated baseline is mandatory and schedules remain disabled',()=>{
  assert.throws(()=>newLedger({schemaVersion:'fieldnote-source-budget-baseline-1.0',month:'2026-10',entries:[]}),/actual_budget/);
  assert.throws(()=>newLedger({...baseline(),scheduleEnabled:true}),/schedule_policy/);
  assert.equal(newLedger(baseline(123)).usedRequests,123);
});
test('one authoritative monthly state is required, so alternate per-run paths cannot reset budget',()=>{
  assert.equal(authoritativeStatePath(baseline(),'/tmp/fieldnote-source-budget-2026-10.json'),'/tmp/fieldnote-source-budget-2026-10.json');
  assert.throws(()=>authoritativeStatePath(baseline(),'/tmp/another-campaign.json'),/authoritative_monthly_state/);
});
test('all four requests are minimal, fixed-filter and credential-free',()=>{
  const job=fresh().job;
  for(const metric of ['lifetimeReviews','reviews7d','reviews30d','players']) {
    const r=panelInput(job.panel.appids[0],metric,job); assert(!('key' in r.input));
    if(metric!=='players'){assert.equal(r.input.num_per_page,1);assert.equal(r.input.purchase_type,0);assert.deepEqual(r.input.languages,['all']);}
    if(metric==='reviews7d')assert.equal(r.input.date_range_end,END-1);
  }
  assert.throws(()=>panelInput(1,'reviews7d',job),/panel_appid_not_allowed/);
});
test('complete mocked 300-game job gives1200 real-shaped observations, no source payloads',async()=>{
  const ledger=fresh(),time=clock();let calls=0,reserved=0;
  const job=await runJob(ledger,{...time,call:async args=>{calls++;assert(ledger.job.pending);assert(ledger.usedRequests>=41+calls);return goodCall(args);},persist:async state=>{if(state.job.pending)reserved++;}});
  assert.equal(job.status,'completed');assert.equal(job.observations.length,1200);assert.equal(calls,1200);assert.equal(reserved,1200);
  assert.equal(job.counters.requests,1200);assert.equal(ledger.usedRequests,1241);assert.equal(job.counters.bytes,120000);
  assert.equal(job.counters.elapsedMs,2398000);assert.equal(JSON.stringify(job).includes('DO NOT SAVE'),false);
  const bundle=completedBundle(job,time.now());assert.equal(bundle.observations.length,1200);assert(!('attempts' in bundle));assert(!('pending' in bundle));
  // A complete durable checkpoint can be exported after an output-write failure
  // without repeating any source calls.
  assert.deepEqual(completedBundle(JSON.parse(JSON.stringify(job)),time.now()),bundle);
});
test('paused run resumes without duplicate observations and keeps inter-run pacing',async()=>{
  const ledger=fresh(),time=clock();let calls=0;
  const args={...time,call:async x=>{calls++;return goodCall(x);},stopAfterGames:1};
  await runJob(ledger,args);assert.equal(ledger.job.status,'paused');assert.equal(calls,4);assert.equal(ledger.job.observations.length,4);
  const before=time.now();await runJob(ledger,args);assert.equal(calls,8);assert.equal(ledger.job.observations.length,8);assert.equal(new Set(ledger.job.observations.map(x=>x.observationKey)).size,8);assert(time.now()-before>=8000);
});
test('a crashed reservation remains charged on resume',async()=>{
  const ledger=fresh(),time=clock();let first=true,calls=0;
  await runJob(ledger,{...time,call:async x=>{calls++;return goodCall(x);},persist:async state=>{if(first&&state.job.pending){first=false;throw Error('simulated_write_boundary_interruption');}}});
  assert.equal(calls,0);assert.equal(ledger.job.status,'stopped');assert.equal(ledger.job.counters.requests,1);assert.equal(ledger.usedRequests,42);assert(ledger.job.pending);
  const heldBytes=ledger.job.counters.bytes;
  await runJob(ledger,{...time,call:goodCall,stopAfterGames:1});assert.equal(ledger.job.counters.requests,5);assert.equal(ledger.usedRequests,46);assert.equal(ledger.job.counters.bytes,heldBytes+400);assert.equal(ledger.job.observations.length,4);
});
test('403 and429 permanently stop the lane without retry',async()=>{
  for(const error of ['access_denied','throttled']){const ledger=fresh(),time=clock();let calls=0;
    const job=await runJob(ledger,{...time,call:async()=>{calls++;return {error,bytes:0};}});
    assert.equal(job.status,'stopped');assert.equal(calls,1);assert.equal(job.counters.retries,0);
    await assert.rejects(()=>runJob(ledger,{...time,call:goodCall}),/source_lane_disabled/);
  }
});
test('denial is durable in the first result checkpoint and reconstructed on resume',async()=>{
  const ledger=fresh(),time=clock();let denialCheckpoint=null;
  await runJob(ledger,{...time,call:async()=>({error:'access_denied',bytes:0}),persist:async state=>{if(state.job.attempts.some(x=>x.errorCode==='access_denied')&&!denialCheckpoint)denialCheckpoint=structuredClone(state);}});
  assert.equal(denialCheckpoint.job.permanentStop,'access_denied');delete denialCheckpoint.job.permanentStop;
  let calls=0;await assert.rejects(()=>runJob(denialCheckpoint,{...time,call:async x=>{calls++;return goodCall(x);}}),/source_lane_disabled/);assert.equal(calls,0);
});
test('resume cannot reset a failed logical request retry allowance',async()=>{
  const ledger=fresh(),time=clock();let calls=0;
  const options={...time,call:async()=>{calls++;return {error:'network_error',bytes:0};}};
  await runJob(ledger,options);assert.equal(calls,2);assert.equal(ledger.job.counters.retries,1);
  await runJob(ledger,options);assert.equal(calls,2);assert.equal(ledger.job.counters.retries,1);assert.equal(ledger.job.errorCode,'logical_request_attempt_budget_exhausted');
});
test('transient retry counts against both budgets and cannot duplicate a measurement',async()=>{
  const ledger=fresh(),time=clock();let calls=0;
  await runJob(ledger,{...time,stopAfterGames:1,call:async x=>{calls++;return calls===1?{error:'network_error',bytes:0}:goodCall(x);}});
  assert.equal(calls,5);assert.equal(ledger.job.counters.retries,1);assert.equal(ledger.usedRequests,46);assert.equal(ledger.job.observations.length,4);
});
test('monthly and explicit bootstrap ceilings stop before additional calls',async()=>{
  const ledger=fresh('manual',11999),time=clock();let calls=0;
  await runJob(ledger,{...time,call:async x=>{calls++;return goodCall(x);}});assert.equal(calls,1);assert.equal(ledger.usedRequests,12000);assert.equal(ledger.job.errorCode,'request_budget_exhausted');
  const bootstrap=fresh('bootstrap');bootstrap.baseline.bootstrapAllowance=1;bootstrap.baselineSha256=sha(canonical(bootstrap.baseline));
  await runJob(bootstrap,{...clock(),call:goodCall});assert.equal(bootstrap.bootstrapUsed,1);assert.equal(bootstrap.job.errorCode,'bootstrap_allowance_exhausted');
});
test('unknown CCU remains null while review schema failure cannot publish',async()=>{
  const ledger=fresh(),time=clock();await runJob(ledger,{...time,stopAfterGames:1,call:async x=>x.endpoint===ENDPOINTS.players?{data:{response:{result:2}},bytes:10}:goodCall(x)});
  assert.equal(ledger.job.observations.find(x=>x.metric==='players').value,null);
  const broken=fresh();await runJob(broken,{...clock(),call:async()=>({data:{response:{}},bytes:2})});assert.equal(broken.job.status,'stopped');assert.equal(broken.job.observations.length,0);
});
test('inconsistent7/30/lifetime values stop publication',async()=>{
  const ledger=fresh();await runJob(ledger,{...clock(),call:async x=>{const result=await goodCall(x);if(x.endpoint===ENDPOINTS.reviews&&x.input.date_range_start===undefined)result.data.response.total_matching=20;return result;}});
  assert.equal(ledger.job.status,'stopped');assert.equal(ledger.job.errorCode,'nested_windows_or_lifetime_inconsistent');
});
test('runtime and byte limits are enforced',async()=>{
  const ledger=fresh(),time=clock();ledger.job.counters.elapsedMs=CAPS.maxRuntimeMs-1;
  await runJob(ledger,{...time,call:async x=>{time.advance(2);return goodCall(x);}});assert.equal(ledger.job.status,'stopped');assert.equal(ledger.job.errorCode,'runtime_budget_exhausted');
  const bytes=fresh();bytes.job.counters.bytes=CAPS.maxBytes;
  await assert.rejects(()=>runJob(bytes,{...clock(),call:goodCall}),/attempt_ledger_mismatch/);
});
test('resume rejects corrupted observations, windows and provenance without coercion',async()=>{
  const ledger=fresh(),time=clock();await runJob(ledger,{...time,call:goodCall,stopAfterGames:1});
  for(const change of [j=>{j.observations[0].value=null;},j=>{j.observations[0].value='1000';},j=>{j.observations[0].sourceUrl='https://example.com/';},j=>{j.observations[0].extra='DO NOT LEAK';},j=>{j.windows.seven.start++;}]){
    const copy=structuredClone(ledger);change(copy.job);await assert.rejects(()=>runJob(copy,{...time,call:goodCall}),/checkpoint|configuration/);
  }
});
function discoveryFixture(count=1000){return {schemaVersion:'fieldnote-population-discovery-1.0',status:'complete',candidates:Array.from({length:count},(_,i)=>({appid:50000001+i,igdbId:i+1,name:'SYNTHETIC OFFLINE FIXTURE',rejection:null,identity:{status:'verified',typeBasis:'derived_game_only_query',sourceUrl:'https://api.steampowered.com/IStoreService/GetAppList/v1/',steamFetchedAt:'2026-10-11T18:30:00.000Z',steamName:'SYNTHETIC OFFLINE FIXTURE'}}))};}
function qualificationLedger(count=1000){const ledger=newLedger({...baseline(),bootstrapAllowance:2700});const discovery=discoveryFixture(count),discoveryRaw=JSON.stringify(discovery);ledger.job=newQualificationJob({discovery,discoveryRaw,validationRaw,expectedSha:validationSha,end:END,now:new Date(NOW).toISOString()});return ledger;}
test('qualification accepts1..1000 exact verified IDs, deduplicates identical identities, excludes pending',()=>{
  const source=discoveryFixture(2);source.candidates.push(structuredClone(source.candidates[0]));assert.equal(qualificationIds(source).length,2);
  source.candidates[1].identity.status='pending_steam_verification';assert.equal(qualificationIds(source).length,1);
  source.candidates[2].igdbId=999;assert.throws(()=>qualificationIds(source),/conflicting_duplicate/);
  assert.throws(()=>qualificationIds(discoveryFixture(1001)),/bounded_discovery/);
  assert.throws(()=>qualificationIds(discoveryFixture(0)),/verified_candidate_count/);
});
test('qualification has only lifetime requests and a separate40-minute1200-attempt cap',async()=>{
  const ledger=qualificationLedger(),time=clock();let calls=0;
  const job=await runJob(ledger,{...time,call:async x=>{calls++;assert.equal(x.endpoint,ENDPOINTS.reviews);assert.equal(x.input.date_range_start,undefined);return goodCall(x);}});
  assert.equal(job.status,'completed');assert.equal(calls,1000);assert.equal(job.observations.length,1000);assert.equal(job.counters.elapsedMs,1998000);
  assert.equal(job.limits.maxRequests,1200);assert.equal(job.limits.maxRuntimeMs,40*60000);assert.equal(ledger.usedRequests,1041);assert.equal(ledger.bootstrapUsed,1000);
  const bundle=completedBundle(job,time.now());assert.equal(bundle.schemaVersion,'fieldnote-candidate-review-qualification-1.0');assert.equal(bundle.metricScope,'lifetime_only');assert.equal(bundle.candidateSet.appids.length,1000);assert(!('panel'in bundle));assert(!('windows'in bundle));
  assert.throws(()=>panelInput(job.panel.appids[0],'players',job),/metric_not_in_job_phase/);
});
test('qualification pause/resume uses the same strict retry and denial protection',async()=>{
  const ledger=qualificationLedger(3),time=clock();await runJob(ledger,{...time,call:goodCall,stopAfterGames:1});assert.equal(ledger.job.observations.length,1);
  await runJob(ledger,{...time,call:goodCall});assert.equal(ledger.job.status,'completed');assert.equal(ledger.job.counters.requests,3);
  const blocked=qualificationLedger(1);await runJob(blocked,{...clock(),call:async()=>({error:'throttled',bytes:0})});await assert.rejects(()=>runJob(blocked,{...clock(),call:goodCall}),/source_lane_disabled/);
});
test('advancing qualification to panel preserves every charged request and frozen qualifying evidence',async()=>{
  const ledger=qualificationLedger(300),time=clock();await runJob(ledger,{...time,call:goodCall});
  const qualifyingJob=ledger.job,raw=JSON.stringify(completedBundle(qualifyingJob,time.now()));qualifyingJob.exportedBundle={path:'/unused-test-fixture',sha256:sha(raw)};
  const panel=panelFixture();for(const member of panel.members){const obs=qualifyingJob.observations.find(row=>row.appid===member.appid);member.eligibility={lifetimeReviews:obs.value,reviewEvidence:{runId:qualifyingJob.runId,collectedAt:obs.observedAt}};}
  panel.asOf=new Date(time.now()).toISOString();delete panel.panelId;delete panel.manifestSha256;const hash=sha(canonical(panel));panel.manifestSha256=hash;panel.panelId=`panel-${hash.slice(0,24)}`;
  advanceLedgerToPanel(ledger,{panel,qualificationRaw:raw,validationRaw,expectedSha:validationSha,end:END,now:new Date(time.now()).toISOString()});
  assert.equal(ledger.usedRequests,341);assert.equal(ledger.bootstrapUsed,300);assert.equal(ledger.completedJobs[0].requests,300);
  const phaseBoundary=time.now();let firstPanelDispatch=null;
  await runJob(ledger,{...time,call:async request=>{if(firstPanelDispatch===null)firstPanelDispatch=time.now();return goodCall(request);},stopAfterGames:1});
  assert(firstPanelDispatch>=phaseBoundary+CAPS.minIntervalMs);assert.equal(ledger.usedRequests,345);assert.equal(ledger.bootstrapUsed,304);assert.equal(ledger.job.observations.length,4);
});
test('qualification cannot use the panel90-minute cap to continue',async()=>{
  const ledger=qualificationLedger(1),time=clock();ledger.job.counters.elapsedMs=QUALIFICATION_CAPS.maxRuntimeMs-1;
  await runJob(ledger,{...time,call:async x=>{time.advance(2);return goodCall(x);}});assert.equal(ledger.job.status,'stopped');assert.equal(ledger.job.errorCode,'runtime_budget_exhausted');
});
test('offline qualification join supplies one compatible lifetime-evidence population',async()=>{
  const source=discoveryFixture(2);source.panelCandidates=source.candidates.map(row=>({appid:row.appid,name:row.name,lifetimeReviews:null}));
  const raw=JSON.stringify(source),ledger=newLedger({...baseline(),bootstrapAllowance:2700}),time=clock();ledger.job=newQualificationJob({discovery:source,discoveryRaw:raw,validationRaw,expectedSha:validationSha,end:END,now:new Date(NOW).toISOString()});
  await runJob(ledger,{...time,call:goodCall});const qualifiedRaw=JSON.stringify(completedBundle(ledger.job,time.now()));
  const joined=joinQualified(raw,qualifiedRaw,validationRaw,validationSha);assert.equal(joined.panelCandidates[0].lifetimeReviews,1000);assert.equal(joined.panelCandidates[0].reviewEvidence.contract.sourceField,'total_matching');assert.equal(joined.panelCandidates[1].reviewEvidence.runId,ledger.job.runId);assert.equal(joined.panelCandidates[0].reviewEvidence.unit,'reviews');
  assert.throws(()=>joinQualified(raw+' ',qualifiedRaw,validationRaw,validationSha),/candidate_hash_mismatch/);
});
