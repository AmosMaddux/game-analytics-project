import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createTransport,CollectionError,STEAM_LIMITS,IGDB_LIMITS,ENDPOINTS } from '../collectors/transport.mjs';
import { metricRequest,parseMetric,collectSteamMetrics } from '../collectors/steam.mjs';
import { parsePrivateConfig } from '../collectors/io.mjs';
import { collectSteamCatalog } from '../collectors/steam-catalog.mjs';
import { openDatabase,migrate } from '../scripts/database.mjs';
import { seedLocal } from '../scripts/seed-local.mjs';
import { beginJob,updateJob,importCandidates,saveObservation,saveAttempt } from '../collectors/persistence.mjs';
import { readGames } from '../build/collection.mjs';

const clock=()=>{let t=100000;return {now:()=>t,wait:async ms=>{t+=ms;},advance:ms=>{t+=ms;}};};
test('fixed keyless endpoint grammar rejects authentication and arbitrary query inputs',async()=>{
  let calls=0;const transport=createTransport({source:'steam_api',wire:async()=>{calls++;return {data:{},bytes:2};}});
  for(const url of [`${ENDPOINTS.players}?appid=10&key=synthetic`,`${ENDPOINTS.players}?appid=0`,'https://example.com/',`${ENDPOINTS.reviews}?input_json={}`])await assert.rejects(transport.request(url));
  assert.equal(calls,0);
});
test('throttle retries honor full Retry-After and stop when it cannot fit runtime',async()=>{
  const time=clock();let calls=0;
  const transport=createTransport({source:'steam_api',...time,wire:async()=>++calls===1?{errorCode:'throttled',retryAfter:45,bytes:0}:{data:{response:{result:1,player_count:0}},bytes:20}});
  await transport.request(metricRequest(10,'players'));assert.equal(calls,2);assert.ok(transport.counters.elapsedMs>=45000);
  const second=createTransport({source:'steam_api',...clock(),limits:{...STEAM_LIMITS,maxRuntimeMs:10000},wire:async()=>({errorCode:'throttled',retryAfter:60,bytes:0})});
  await assert.rejects(second.request(metricRequest(10,'players')),/runtime_limit/);assert.equal(second.counters.requests,1);
});
test('authentication/permission failure stops without retry or fallback',async()=>{
  let calls=0;const transport=createTransport({source:'steam_api',...clock(),wire:async()=>{calls++;return {errorCode:'access_denied',httpStatus:403,bytes:0};}});
  await assert.rejects(transport.request(metricRequest(10,'players')),/access_denied/);await assert.rejects(transport.request(metricRequest(20,'players')),/access_denied/);assert.equal(calls,1);
});
test('checkpoint cumulative request and elapsed bounds reject further dispatch',async()=>{
  let calls=0;for(const counters of [{requests:STEAM_LIMITS.maxRequests},{elapsedMs:STEAM_LIMITS.maxRuntimeMs}]){
    const transport=createTransport({source:'steam_api',...clock(),counters,wire:async()=>{calls++;return {data:{},bytes:2};}});await assert.rejects(transport.request(metricRequest(10,'players')));
  }assert.equal(calls,0);
});
test('durable reservation latency cannot compress actual request spacing or overrun dispatch deadline',async()=>{
  const time=clock(),starts=[];let reservations=0;
  const transport=createTransport({source:'steam_api',...time,onBudget:async row=>{if(row.pendingReservation&&++reservations===1)time.advance(900);},wire:async()=>{starts.push(time.now());return {data:{},bytes:2};}});
  await transport.request(metricRequest(10,'players'));await transport.request(metricRequest(11,'players'));assert.ok(starts[1]-starts[0]>=1000);
  let calls=0;const late=clock();const blocked=createTransport({source:'steam_api',...late,limits:{...STEAM_LIMITS,maxRuntimeMs:1000},onBudget:async row=>{if(row.pendingReservation)late.advance(1001);},wire:async()=>{calls++;return {data:{},bytes:2};}});await assert.rejects(blocked.request(metricRequest(10,'players')),/runtime_limit/);assert.equal(calls,0);
});
test('IGDB auth is once-only and provider credential reflection is rejected',async()=>{
  const transport=createTransport({source:'igdb',credentials:{clientId:'synthetic-client-id',clientSecret:'synthetic-client-secret'},...clock(),wire:async({endpoint})=>endpoint===ENDPOINTS.token?{data:{access_token:'synthetic-access-token',token_type:'bearer'},bytes:50}:{data:[{name:'synthetic-client-secret'}],bytes:40}});
  await transport.authenticate();await assert.rejects(transport.authenticate(),/already_authenticated/);await assert.rejects(transport.request(ENDPOINTS.igdb,'fields id; limit 1;'),/credential_reflection_blocked/);
});
test('escaped provider credential reflections never reach persistence callbacks',async()=>{
  const secret='synthetic-"quote\\backslash';let calls=0;
  const transport=createTransport({source:'igdb',credentials:{clientId:'synthetic-client-id',clientSecret:secret},...clock(),wire:async()=>++calls===1?{data:{access_token:'synthetic-token',token_type:'bearer'},bytes:50}:{data:[{summary:secret}],bytes:50}});
  await transport.authenticate();await assert.rejects(transport.request(ENDPOINTS.igdb,'fields id; limit 1;'),/credential_reflection_blocked/);
});
test('metrics preserve genuine zero, reject missing values and discard reviewer data',()=>{
  assert.equal(parseMetric({response:{result:1,player_count:0}},'players').value,0);
  assert.throws(()=>parseMetric({response:{result:1}},'players'));
  const result=parseMetric({response:{query_summary:{total_reviews:2,total_positive:1,total_negative:1},reviews:[{review:'private text',author:{steamid:'123'}}]}},'reviews');assert.equal(result.value,2);assert.ok(!JSON.stringify(result).includes('private text'));assert.ok(!JSON.stringify(result).includes('steamid'));
  assert.equal(parseMetric({response:{query_summary:{num_reviews:0,total_reviews:0,total_positive:0,total_negative:0},total_matching:0}},'reviews').value,0);
  assert.throws(()=>parseMetric({response:{query_summary:{total_reviews:0,total_positive:0,total_negative:0}}},'reviews'));
});
test('secret config parser accepts only expected keys without shell expansion',()=>{
  const value=parsePrivateConfig('IGNORED=anything\nIGDB_CLIENT_ID=synthetic-id\nIGDB_CLIENT_SECRET="synthetic-secret"\nSTEAM_API_KEY=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');assert.deepEqual(Object.keys(value),['clientId','clientSecret','steamKey']);
  assert.throws(()=>parsePrivateConfig('IGDB_CLIENT_ID=x\nIGDB_CLIENT_ID=y'));assert.throws(()=>parsePrivateConfig('IGDB_CLIENT_ID=x\nIGDB_CLIENT_SECRET=y\nSTEAM_API_KEY=bad'));
});
test('official Steam catalog pagination strips extra metadata and rejects stalled cursor',async()=>{
  const transport={limits:{maxPages:3},counters:{},request:async()=>({response:{apps:[{appid:10,name:'Synthetic game',price_change_number:'ignored'}],have_more_results:false}})};
  const value=await collectSteamCatalog({transport});assert.deepEqual(value.apps,[{appid:10,name:'Synthetic game'}]);assert.equal(value.sourceUrl,ENDPOINTS.steamCatalog);assert.ok(!JSON.stringify(value).includes('key='));
  await assert.rejects(collectSteamCatalog({transport:{...transport,request:async()=>({response:{apps:[],have_more_results:true}})}}),/catalog_pagination_stalled/);
});
test('admissions are identity-verified idempotent and preserve the entire original cohort',async t=>{
  const db=openDatabase(':memory:');t.after(()=>db.close());migrate(db);await seedLocal(db);
  const original=await readGames(db,{includeEvidence:false});
  const source=JSON.parse(await readFile(new URL('../seed/snapshot.json',import.meta.url),'utf8')).games[0];
  const candidate={appid:4000001,name:'Synthetic Admission',genre:source.genre,storeUrl:'https://store.steampowered.com/app/4000001/',catalog:structuredClone(source.catalog),taxonomy:{version:'editorial-expanded-1.0'},tractionProxy:{stratum:'low'}};
  Object.assign(candidate.catalog,{sourceId:4000002,name:candidate.name});candidate.catalog.identity.crosswalk=candidate.catalog.identity.crosswalk.map(item=>({...item,uid:'4000001',gameId:4000002,url:candidate.storeUrl}));
  const evidence={version:'steam-catalog-evidence-1.0',source:'Steam',sourceUrl:ENDPOINTS.steamCatalog,status:'complete',collectedAt:'2026-10-10T20:00:00Z',apps:[{appid:candidate.appid,name:candidate.name}]};
  const job=beginJob(db,{source:'igdb',kind:'catalog',limits:IGDB_LIMITS});
  const imported=await importCandidates(db,{jobId:job.job_id,candidates:[candidate],steamEvidence:evidence});assert.equal(imported.admitted,1);assert.equal(imported.totalGames,37);
  const repeated=await importCandidates(db,{jobId:job.job_id,candidates:[candidate],steamEvidence:evidence});assert.equal(repeated.admitted,0);assert.equal(repeated.updated,1);
  assert.deepEqual((await readGames(db,{includeEvidence:false})).slice(0,36),original);assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM steam_tags WHERE appid=4000001').get().n,0);
  const conflicting={...candidate,name:'Wrong title'};assert.equal((await importCandidates(db,{jobId:job.job_id,candidates:[conflicting],steamEvidence:evidence})).rejected,1);
  await assert.rejects(seedLocal(db),/collection history is protected/);
});
test('repeat metric run inserts once, later runs append history, failure retains prior value/date',async t=>{
  const db=openDatabase(':memory:');t.after(()=>db.close());migrate(db);await seedLocal(db);
  const appid=413150,job=beginJob(db,{source:'steam_api',kind:'metrics',limits:STEAM_LIMITS});
  const value={appid,metric:'players',value:0,collectedAt:'2026-10-11T00:00:00Z',sourceUrl:metricRequest(appid,'players'),sourceLabel:'Steam',unit:'concurrent_players',scope:'test snapshot',methodVersion:'steam-aggregate-2.0'};
  saveObservation(db,job.job_id,value);saveObservation(db,job.job_id,{...value,collectedAt:'2026-10-11T00:01:00Z'});
  assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM metric_observations WHERE run_id=?').get(job.job_id).n,1);
  saveAttempt(db,job.job_id,{appid,metric:'players',itemKey:`${appid}:players`,status:'failed',attemptedAt:'2026-10-11T01:00:00Z',errorCode:'network_error'});
  const game=(await readGames(db,{appids:[appid],includeEvidence:false}))[0];assert.equal(game.players.value,0);assert.equal(game.players.observedAt,value.collectedAt);
  assert.equal(game.players.freshness,'stale_cache');assert.equal(game.players.scoreEligible,false);assert.equal(game.players.refresh.reason,'network_error');
  const next=beginJob(db,{source:'steam_api',kind:'metrics',limits:STEAM_LIMITS});saveObservation(db,next.job_id,{...value,value:1,collectedAt:'2026-10-12T00:00:00Z'});assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM metric_observations WHERE appid=? AND metric='players'").get(appid).n,3);
  const recovered=(await readGames(db,{appids:[appid],now:Date.parse('2026-10-12T01:00:00Z')}))[0];assert.equal(recovered.players.value,1);assert.equal(recovered.players.scoreEligible,true);assert.equal(recovered.players.freshness,'accepted_run');
  const aged=(await readGames(db,{appids:[appid],now:Date.parse('2026-10-14T00:00:00Z')}))[0];assert.equal(aged.players.value,1);assert.equal(aged.players.savedScoreEligible,true);assert.equal(aged.players.scoreEligible,false);assert.equal(aged.players.evidence.freshness,'stale');
});
test('interrupted metrics skip previously accepted targets and stop affected source on denial',async()=>{
  const attempts=[],observations=[];let calls=0;
  const transport={limits:STEAM_LIMITS,request:async()=>{calls++;throw new CollectionError('access_denied');}};
  await assert.rejects(collectSteamMetrics({appids:[10,20],transport,completed:new Set(['10:players']),onObservation:row=>observations.push(row),onAttempt:row=>attempts.push(row)}),/access_denied/);
  assert.equal(calls,1);assert.equal(attempts[0].metric,'reviews');assert.equal(observations.length,0);
});
