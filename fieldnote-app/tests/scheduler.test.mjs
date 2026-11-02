import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync,readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { openDatabase,migrate } from '../scripts/database.mjs';
import { seedLocal } from '../scripts/seed-local.mjs';
import { planSchedules,configureSchedule,disableSchedule,tickSchedules,parseScheduleOptions,MAX_SCHEDULE_MS,MAX_TICK_MS,WATCHLIST_LIMITS } from '../collectors/scheduler.mjs';
import { acquireCollectionLease,releaseCollectionLease } from '../collectors/lease.mjs';

const START=Date.parse('2026-10-10T20:00:00.000Z');
const clock=()=>{let time=START;return {now:()=>time,wait:async ms=>{time+=ms;},advance:ms=>{time+=ms;}};};
async function database(t) {
  const directory=mkdtempSync(join(tmpdir(),'fieldnote-scheduler-')),filename=join(directory,'fixture.sqlite'),db=openDatabase(filename);
  t.after(()=>{db.close();rmSync(directory,{recursive:true,force:true});});
  migrate(db);await seedLocal(db);return {db,filename,directory};
}
const watchlist=(db,now=START,ids=[413150])=>configureSchedule(db,{id:'six-hour-watchlist',expires:new Date(now+MAX_SCHEDULE_MS).toISOString(),watchlist:ids,now});
const wireOk=async request=>({bytes:100,data:request.endpoint.includes('GetNumberOfCurrentPlayers')?{response:{result:1,player_count:0}}:{response:{query_summary:{total_reviews:2,total_positive:1,total_negative:1},reviews:[{review:'discard this',author:{steamid:'private'}}]}}});

test('schedule plans are inert and all migration defaults remain disabled',async t=>{
  const {db}=await database(t),before=db.raw.prepare('SELECT total_changes() AS n').get().n;
  const plan=planSchedules(db,{now:START});
  assert.equal(plan.maxJobsPerTick,1);assert.equal(plan.maxRuntimeMs,1500000);assert.equal(plan.concurrency,1);
  assert.equal(plan.items.length,3);assert.ok(plan.items.every(row=>row.status==='disabled'));
  assert.equal(db.raw.prepare('SELECT total_changes() AS n').get().n,before);
  assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM collection_jobs').get().n,0);
});
test('configuration requires an explicit expiry within seven days and verified small unique watchlist',async t=>{
  const {db}=await database(t),ids=db.raw.prepare('SELECT appid FROM games ORDER BY position LIMIT 21').all().map(row=>row.appid);
  for(const expires of [undefined,'tomorrow','2026-02-31T20:00:00Z',new Date(START).toISOString(),new Date(START+MAX_SCHEDULE_MS+1).toISOString()])assert.throws(()=>configureSchedule(db,{id:'daily-steam',expires,now:START}));
  for(const list of [[],[0],[1],[413150,413150],ids,ids.map(String)])assert.throws(()=>watchlist(db,START,list));
  const admitted=watchlist(db,START,ids.slice(0,20));assert.equal(admitted.targetCount,20);assert.equal(admitted.limits.maxRequests,120);assert.equal(admitted.status,'due');
  db.raw.prepare("UPDATE catalog_games SET identity_json=json_set(identity_json,'$.status','unverified') WHERE appid=?").run(ids[0]);
  assert.throws(()=>watchlist(db,START,[ids[0]]),/unverified_watchlist_appid/);
  assert.equal(planSchedules(db,{now:START}).items.find(row=>row.id==='six-hour-watchlist').status,'invalid');
  assert.throws(()=>configureSchedule(db,{id:'daily-steam',expires:new Date(START+1000).toISOString(),watchlist:[413150],now:START}),/watchlist_not_applicable/);
});
test('CLI mutation syntax rejects implicit run, unknown schedules, configs and widened options',()=>{
  assert.deepEqual(parseScheduleOptions([]),{command:'plan'});
  for(const args of [['tick'],['configure','--id','daily-steam','--run'],['tick','--config','/private','--run'],['plan','--run'],['configure','--id','new','--expires','2026-10-11T00:00:00Z','--run'],['disable','--id','daily-steam','--run','--run'],['tick','--watchlist','413150','--run']])assert.throws(()=>parseScheduleOptions(args));
  assert.deepEqual(parseScheduleOptions(['configure','--id','six-hour-watchlist','--watchlist','413150,730050','--expires','2026-10-11T00:00:00Z','--run']).watchlist,[413150,730050]);
});
test('one tick gives the watchlist priority, persists source linkage and advances only its completed period',async t=>{
  const {db}=await database(t),time=clock();let calls=0,inFlight=0,maxInFlight=0;
  watchlist(db);configureSchedule(db,{id:'daily-steam',expires:new Date(START+MAX_SCHEDULE_MS).toISOString(),now:START});
  const result=await tickSchedules(db,{...time,wire:async request=>{calls++;inFlight++;maxInFlight=Math.max(maxInFlight,inFlight);await Promise.resolve();inFlight--;return wireOk(request);}});
  assert.equal(result.status,'complete');assert.equal(result.scheduleId,'six-hour-watchlist');assert.equal(calls,2);assert.equal(maxInFlight,1);
  const job=db.raw.prepare('SELECT * FROM collection_jobs WHERE job_id=?').get(result.sourceJobId),checkpoint=JSON.parse(job.checkpoint_json);
  assert.equal(job.source,'steam_api');assert.equal(checkpoint.scheduleId,result.scheduleId);assert.equal(checkpoint.tickId,result.tickId);assert.equal(checkpoint.dueAt,new Date(START).toISOString());
  assert.ok(Date.parse(checkpoint.deadlineAt)-START<=MAX_TICK_MS);assert.equal(checkpoint.completedItems,2);
  const values=db.raw.prepare('SELECT value,detail_json FROM metric_observations WHERE run_id=?').all(result.sourceJobId);
  assert.equal(values.length,2);assert.equal(values[0].value,0);assert.doesNotMatch(JSON.stringify(values),/discard this|private/);
  assert.equal(db.raw.prepare("SELECT next_run_at FROM collection_schedules WHERE id='daily-steam'").get().next_run_at,new Date(START).toISOString());
  assert.equal(result.nextRunAt,new Date(time.now()+6*3600000).toISOString());
  assert.equal(db.raw.prepare("SELECT status FROM source_health WHERE source='steam_api'").get().status,'complete');
});
test('disabled and expired schedules cannot dispatch and keyed catalog work is user-run only',async t=>{
  const {db}=await database(t),time=clock();let calls=0;
  watchlist(db);disableSchedule(db,{id:'six-hour-watchlist'});
  assert.equal((await tickSchedules(db,{...time,wire:async()=>{calls++;return {};}})).status,'idle');
  watchlist(db);time.advance(MAX_SCHEDULE_MS);
  assert.equal(planSchedules(db,{now:time.now()}).items.find(row=>row.id==='six-hour-watchlist').status,'expired');
  assert.equal((await tickSchedules(db,{...time,wire:async()=>{calls++;return {};}})).status,'idle');
  configureSchedule(db,{id:'daily-catalog',expires:new Date(time.now()+3600000).toISOString(),now:time.now()});
  const catalog=await tickSchedules(db,{...time,wire:async()=>{calls++;return {};}});
  assert.equal(catalog.status,'user_run_required');assert.deepEqual(catalog.userRunRequired,['daily-catalog']);assert.equal(calls,0);
  assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM collection_jobs WHERE source IN ('igdb','steam_catalog')").get().n,0);
  assert.equal(db.raw.prepare("SELECT status FROM source_health WHERE source='igdb'").get().status,'user_run_required');
});
test('concurrent ticks in different connections share one durable local lock',async t=>{
  const {db,filename}=await database(t),second=openDatabase(filename),time=clock();t.after(()=>second.close());watchlist(db);
  let unlock,started;const pending=new Promise(resolve=>{unlock=resolve;}),entered=new Promise(resolve=>{started=resolve;});let calls=0;
  const first=tickSchedules(db,{...time,wire:async request=>{calls++;started();await pending;return wireOk(request);}});
  await entered;
  const other=await tickSchedules(second,{...time,wire:async()=>{throw new Error('must never dispatch');}});
  assert.equal(other.status,'busy');assert.equal(other.errorCode,'collector_already_running');unlock();assert.equal((await first).status,'complete');assert.equal(calls,2);
});
test('live expired lock never unlocks on elapsed wall time and absent process locks are reclaimed',async t=>{
  const {db}=await database(t),time=clock();watchlist(db);
  db.raw.prepare('INSERT INTO collection_jobs(job_id,source,kind,status,started_at,checkpoint_json,limits_json) VALUES(?,?,?,?,?,?,?)').run('synthetic-active-tick','collector_control','lease','running',new Date(START-MAX_TICK_MS).toISOString(),JSON.stringify({pid:process.pid,deadlineAt:new Date(START-1).toISOString()}),'{}');
  assert.equal((await tickSchedules(db,{...time,wire:wireOk})).status,'busy');
  db.raw.prepare('UPDATE collection_jobs SET checkpoint_json=? WHERE job_id=?').run(JSON.stringify({pid:2147483647,deadlineAt:new Date(START-1).toISOString()}),'synthetic-active-tick');
  assert.equal((await tickSchedules(db,{...time,wire:wireOk})).status,'complete');
  assert.equal(db.raw.prepare('SELECT status FROM collection_jobs WHERE job_id=?').get('synthetic-active-tick').status,'interrupted');
});
test('a manual collector lease blocks scheduler dispatch and owner transitions preserve spacing',async t=>{
  const {db}=await database(t),time=clock();watchlist(db);let calls=0;
  const manual=await acquireCollectionLease(db,{owner:'manual-steam',maxRuntimeMs:MAX_TICK_MS,...time});
  assert.ok(manual.leaseId);assert.equal((await tickSchedules(db,{...time,wire:async()=>{calls++;return {};}})).status,'busy');assert.equal(calls,0);
  releaseCollectionLease(db,manual,{now:time.now});
  const next=await tickSchedules(db,{...time,wire:async request=>{assert.ok(time.now()>=START+1000);calls++;return wireOk(request);}});
  assert.equal(next.status,'complete');assert.equal(calls,2);
});
test('the manual collection entry point honors a scheduler-owned shared lease',async t=>{
  const {db,filename}=await database(t),time=clock();
  const lease=await acquireCollectionLease(db,{owner:'scheduler',maxRuntimeMs:MAX_TICK_MS,...time});
  const program=`import https from 'node:https'; import { syncBuiltinESMExports } from 'node:module'; https.request=()=>{throw new Error('network_forbidden_in_test');}; syncBuiltinESMExports(); const {main}=await import(${JSON.stringify(new URL('../collectors/cli.mjs',import.meta.url).href)}); process.exitCode=await main(['steam','--run']);`;
  const result=spawnSync(process.execPath,['--input-type=module','-e',program],{encoding:'utf8',timeout:3000,env:{...process.env,FIELDNOTE_DB:filename}});
  releaseCollectionLease(db,lease,{now:time.now});
  assert.equal(result.status,1,result.stderr);assert.equal(JSON.parse(result.stdout).errorCode,'collector_already_running');
  assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM collection_jobs WHERE source='steam_api'").get().n,0);
});
test('permission denial stops after one request and cannot be retried through another schedule',async t=>{
  const {db}=await database(t),time=clock();watchlist(db);configureSchedule(db,{id:'daily-steam',expires:new Date(START+MAX_SCHEDULE_MS).toISOString(),now:START});let calls=0;
  const denied=await tickSchedules(db,{...time,wire:async()=>{calls++;return {errorCode:'access_denied',httpStatus:403,bytes:0};}});
  assert.equal(denied.status,'blocked');assert.equal(denied.errorCode,'access_denied');assert.equal(calls,1);
  time.advance(6*3600000);const retried=await tickSchedules(db,{...time,wire:async()=>{calls++;return {};}});
  assert.equal(retried.status,'blocked');assert.equal(calls,1);
  assert.equal(db.raw.prepare("SELECT next_run_at FROM collection_schedules WHERE id='six-hour-watchlist'").get().next_run_at,new Date(START).toISOString());
  assert.equal(db.raw.prepare("SELECT last_error_code FROM source_health WHERE source='steam_api'").get().last_error_code,'access_denied');
});
test('provider schema integrity failure blocks the affected job immediately',async t=>{
  const {db}=await database(t),time=clock();watchlist(db);let calls=0;
  const result=await tickSchedules(db,{...time,wire:async()=>{calls++;return {data:{response:{result:1}},bytes:10};}});
  assert.equal(result.status,'blocked');assert.equal(result.errorCode,'invalid_players_schema');assert.equal(calls,1);
  assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM metric_observations WHERE run_id=?').get(result.sourceJobId).n,0);
});
test('partial jobs retain due time, wait before explicit retry, and resume the same cumulative allowance',async t=>{
  const {db}=await database(t),time=clock();watchlist(db);let calls=0;
  const first=await tickSchedules(db,{...time,wire:async request=>{calls++;return request.endpoint.includes('GetNumberOfCurrentPlayers')?wireOk(request):{errorCode:'request_timeout',bytes:0};}});
  assert.equal(first.status,'partial');assert.equal(calls,4);
  assert.equal(db.raw.prepare("SELECT next_run_at FROM collection_schedules WHERE id='six-hour-watchlist'").get().next_run_at,new Date(START).toISOString());
  assert.equal((await tickSchedules(db,{...time,wire:wireOk})).status,'idle');
  time.advance(5*60000);
  const second=await tickSchedules(db,{...time,wire:async request=>{calls++;return wireOk(request);}});
  assert.equal(second.status,'complete');assert.equal(second.sourceJobId,first.sourceJobId);assert.equal(second.counters.requests,5);assert.equal(second.counters.skipped,1);assert.equal(calls,5);
  assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM metric_observations WHERE run_id=?').get(first.sourceJobId).n,2);
});
test('a small saved per-job cap cannot multiply across ticks or resume',async t=>{
  const {db}=await database(t),time=clock();watchlist(db);let calls=0;
  db.raw.prepare("UPDATE collection_schedules SET limits_json=json_set(limits_json,'$.maxRequests',1) WHERE id='six-hour-watchlist'").run();
  const first=await tickSchedules(db,{...time,wire:async request=>{calls++;return wireOk(request);}});
  assert.equal(first.status,'exhausted');assert.equal(first.errorCode,'request_limit');assert.equal(calls,1);
  time.advance(6*3600000);
  const second=await tickSchedules(db,{...time,wire:async()=>{calls++;return {};}});
  assert.equal(second.status,'blocked');assert.equal(second.sourceJobId,first.sourceJobId);assert.equal(calls,1);
});
test('crashed source jobs resume their pessimistic reservations rather than receiving a fresh budget',async t=>{
  const {db}=await database(t),time=clock();watchlist(db);let calls=0;
  db.raw.prepare('INSERT INTO collection_jobs(job_id,source,kind,status,started_at,checkpoint_json,limits_json,counters_json) VALUES(?,?,?,?,?,?,?,?)').run('synthetic-crashed-watchlist','steam_api','watchlist','running',new Date(START).toISOString(),JSON.stringify({scheduleId:'six-hour-watchlist',dueAt:new Date(START).toISOString(),appids:[413150]}),JSON.stringify(WATCHLIST_LIMITS),JSON.stringify({requests:120,bytes:131072,elapsedMs:15000,pendingReservation:1}));
  db.raw.prepare('INSERT INTO collection_jobs(job_id,source,kind,status,started_at,checkpoint_json,limits_json) VALUES(?,?,?,?,?,?,?)').run('synthetic-crashed-lease','collector_control','lease','running',new Date(START).toISOString(),JSON.stringify({pid:2147483647}),'{}');
  const result=await tickSchedules(db,{...time,wire:async()=>{calls++;return {};}});
  assert.equal(result.status,'exhausted');assert.equal(result.sourceJobId,'synthetic-crashed-watchlist');assert.equal(result.errorCode,'request_limit');assert.equal(calls,0);assert.equal(result.counters.requests,120);
});
test('expiry bounds request timeout and runtime exhaustion cannot dispatch after the deadline',async t=>{
  const {db}=await database(t),time=clock();let calls=0;
  configureSchedule(db,{id:'six-hour-watchlist',watchlist:[413150],expires:new Date(START+50).toISOString(),now:START});
  const result=await tickSchedules(db,{...time,wire:async request=>{calls++;assert.ok(request.timeoutMs<=50);time.advance(50);return wireOk(request);}});
  assert.equal(result.status,'exhausted');assert.equal(result.errorCode,'runtime_limit');assert.equal(calls,1);
});
test('tampered source, overlong saved duration and widened limits are inert',async t=>{
  const {db}=await database(t),time=clock();watchlist(db);let calls=0;
  db.raw.prepare("UPDATE collection_schedules SET limits_json=json_set(limits_json,'$.maxRequests',121) WHERE id='six-hour-watchlist'").run();
  assert.equal((await tickSchedules(db,{...time,wire:async()=>{calls++;return {};}})).status,'blocked');
  watchlist(db);db.raw.prepare("UPDATE collection_schedules SET expires_at=? WHERE id='six-hour-watchlist'").run(new Date(START+MAX_SCHEDULE_MS+1).toISOString());
  assert.equal(planSchedules(db,{now:START}).items.find(row=>row.id==='six-hour-watchlist').errorCode,'invalid_schedule_expiry');
  watchlist(db);db.raw.prepare("UPDATE collection_schedules SET source='steam_catalog' WHERE id='six-hour-watchlist'").run();
  assert.equal((await tickSchedules(db,{...time,wire:async()=>{calls++;return {};}})).status,'blocked');assert.equal(calls,0);
  assert.equal(WATCHLIST_LIMITS.maxGames,20);
});
test('lease cancellation before dispatch releases the durable lock',async t=>{
  const {db}=await database(t),time=clock();
  const first=await acquireCollectionLease(db,{owner:'manual_metrics',maxRuntimeMs:MAX_TICK_MS,...time});releaseCollectionLease(db,first,{now:time.now});
  await assert.rejects(acquireCollectionLease(db,{owner:'manual_metrics',maxRuntimeMs:MAX_TICK_MS,now:time.now,wait:async()=>{throw new Error('synthetic cancellation');}}),/synthetic cancellation/);
  assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM collection_jobs WHERE source='collector_control' AND kind='lease' AND status='running'").get().n,0);
});
test('disabling an active schedule stops further dispatch without starting another job',async t=>{
  const {db}=await database(t),time=clock();watchlist(db);let calls=0;
  const result=await tickSchedules(db,{...time,wire:async request=>{calls++;disableSchedule(db,{id:'six-hour-watchlist'});return wireOk(request);}});
  assert.equal(result.status,'interrupted');assert.equal(result.errorCode,'schedule_disabled');assert.equal(calls,1);
  assert.equal((await tickSchedules(db,{...time,wire:async()=>{calls++;return {};}})).status,'idle');assert.equal(calls,1);
});
test('clean launcher supports read-only planning and strips credential/config/debug environment',async t=>{
  const {db,filename}=await database(t),before=db.raw.prepare('SELECT total_changes() AS n').get().n;
  const launcher=new URL('../scripts/schedule.mjs',import.meta.url);
  const source=readFileSync(launcher,'utf8');
  assert.doesNotMatch(source,/process\.env\.(?:IGDB|STEAM|NODE_OPTIONS)|readPrivateConfig|\.\.\.process\.env/);
  assert.match(source,/timeout:1500000,killSignal:'SIGTERM'/);
  const result=spawnSync(process.execPath,[launcher.pathname,'plan'],{encoding:'utf8',env:{...process.env,FIELDNOTE_DB:filename,IGDB_CLIENT_SECRET:'synthetic-no-read',STEAM_API_KEY:'synthetic-no-read'}});
  assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).status,'plan');assert.doesNotMatch(result.stdout,/synthetic-no-read/);
  assert.equal(db.raw.prepare('SELECT total_changes() AS n').get().n,before);
  const blocked=spawnSync(process.execPath,[launcher.pathname,'tick','--config','/does-not-exist','--run'],{encoding:'utf8',env:{...process.env,FIELDNOTE_DB:filename}});
  assert.equal(blocked.status,2);assert.equal(JSON.parse(blocked.stderr.trim().split('\n').find(line=>line.startsWith('{'))).errorCode,'invalid_command');
});
