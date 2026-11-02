import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { openDatabase,migrate,defaultDatabasePath } from '../scripts/database.mjs';
import { CollectionError,createTransport,STEAM_LIMITS,wireRequest } from './transport.mjs';
import { collectSteamMetrics } from './steam.mjs';
import { beginJob,updateJob,saveObservation,saveAttempt } from './persistence.mjs';
import { acquireCollectionLease,releaseCollectionLease } from './lease.mjs';

export const MAX_SCHEDULE_MS=7*24*60*60*1000;
export const MAX_TICK_MS=25*60*1000;
export const WATCHLIST_LIMITS=Object.freeze({...STEAM_LIMITS,maxGames:20,maxRequests:120,maxPages:40,maxBytes:5242880,maxRuntimeMs:300000});
const RETRY_DELAY_MS=5*60*1000;
const definitions=Object.freeze({
  'daily-steam':{source:'steam_api',kind:'metrics',interval:24,limits:STEAM_LIMITS},
  'daily-catalog':{source:'igdb',kind:'catalog',interval:24,limits:null},
  'six-hour-watchlist':{source:'steam_api',kind:'watchlist',interval:6,limits:WATCHLIST_LIMITS},
});
const fatal=new Set(['access_denied','redirect_blocked','endpoint_blocked','request_parameters_blocked','invalid_players_schema','invalid_reviews_schema','invalid_json','invalid_content_type','unexpected_content_encoding','invalid_target_set','persistence_failed','collection_failed']);
const exhausted=new Set(['request_limit','byte_limit','runtime_limit']);
const iso=ms=>new Date(ms).toISOString();
const safeCode=error=>error instanceof CollectionError?error.code:'collection_failed';
const validAppid=id=>Number.isSafeInteger(id)&&id>0&&id<=4294967295;
function parseJson(value) { try{return JSON.parse(value);}catch{throw new CollectionError('invalid_schedule');} }
function dateMs(value) {
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value))throw new CollectionError('invalid_schedule_date');
  const ms=Date.parse(value);
  if(!Number.isFinite(ms)||![value,value.replace(/Z$/,'.000Z')].includes(iso(ms)))throw new CollectionError('invalid_schedule_date');
  return ms;
}
function definition(row) {
  const spec=definitions[row?.id];
  if(!spec||row.source!==spec.source||row.kind!==spec.kind||row.interval_hours!==spec.interval)throw new CollectionError('invalid_schedule');
  return spec;
}
function verifiedIds(db) {
  return db.raw.prepare(`SELECT g.appid FROM games g WHERE EXISTS (
    SELECT 1 FROM catalog_games c JOIN identity_crosswalks x ON x.appid=c.appid AND x.igdb_id=c.igdb_id
    WHERE c.appid=g.appid AND c.match_status='matched' AND x.steam_uid=CAST(g.appid AS TEXT)
    AND x.external_source_id=1 AND x.source_name='Steam'
    AND json_extract(c.identity_json,'$.status')='exact_steam_appid_verified'
  ) ORDER BY g.position LIMIT 501`).all().map(row=>row.appid);
}
function watchlistIds(value,verified) {
  if(!Array.isArray(value)||!value.length||value.length>20||value.some(id=>!validAppid(id))||new Set(value).size!==value.length)throw new CollectionError('invalid_watchlist');
  if(value.some(id=>!verified.has(id)))throw new CollectionError('unverified_watchlist_appid');
  return value;
}
function latestJob(db,id,dueAt) {
  return db.raw.prepare("SELECT * FROM collection_jobs WHERE source='steam_api' AND json_extract(checkpoint_json,'$.scheduleId')=? AND json_extract(checkpoint_json,'$.dueAt')=? ORDER BY started_at DESC,rowid DESC LIMIT 1").get(id,dueAt);
}
function savedLimits(value,spec) {
  if(!value||typeof value!=='object'||Array.isArray(value))throw new CollectionError('invalid_schedule_limits');
  if(!spec.limits) {
    if(Object.keys(value).some(key=>key!=='configuredAt'))throw new CollectionError('invalid_schedule_limits');
    return {};
  }
  if(Object.keys(value).some(key=>key!=='configuredAt'&&!Object.hasOwn(spec.limits,key)))throw new CollectionError('invalid_schedule_limits');
  const limits={};
  for(const [key,maximum] of Object.entries(spec.limits)) {
    const number=value[key];
    if(!Number.isSafeInteger(number)||number<0||(key==='minIntervalMs'?number<maximum:number>maximum))throw new CollectionError('invalid_schedule_limits');
    limits[key]=number;
  }
  return limits;
}
function inspectSchedule(db,row,now,verified) {
  const result={id:row.id,source:row.source,kind:row.kind,enabled:row.enabled===1,intervalHours:row.interval_hours,nextRunAt:row.next_run_at,expiresAt:row.expires_at,status:'disabled',sourceJobId:null};
  if(!result.enabled)return result;
  try {
    const spec=definition(row),values=parseJson(row.limits_json),limits=savedLimits(values,spec);
    const configuredAt=dateMs(values.configuredAt),expiresAt=dateMs(row.expires_at),dueAt=dateMs(row.next_run_at);
    if(configuredAt>now||expiresAt<=configuredAt||expiresAt-configuredAt>MAX_SCHEDULE_MS)throw new CollectionError('invalid_schedule_expiry');
    result.limits=limits;
    if(expiresAt<=now){result.status='expired';return result;}
    const watchlist=parseJson(row.watchlist_json);
    const appids=spec.kind==='watchlist'?watchlistIds(watchlist,verified):spec.source==='steam_api'?[...verified]:[];
    if(spec.kind!=='watchlist'&&(!Array.isArray(watchlist)||watchlist.length))throw new CollectionError('invalid_watchlist');
    if(spec.source==='steam_api'&&(!appids.length||appids.length>limits.maxGames))throw new CollectionError('invalid_target_set');
    result.targetCount=appids.length;
    if(spec.kind==='watchlist')result.watchlist=appids;
    const previous=latestJob(db,row.id,row.next_run_at);
    if(previous)result.sourceJobId=previous.job_id;
    if(dueAt>now){result.status='waiting';return result;}
    if(spec.source!=='steam_api'){result.status='user_run_required';return result;}
    const health=db.raw.prepare('SELECT status,last_error_code FROM source_health WHERE source=?').get(spec.source);
    if(health?.status==='blocked'&&fatal.has(health.last_error_code)){result.status='blocked';result.errorCode=health.last_error_code;return result;}
    if(previous&&['blocked','exhausted','complete'].includes(previous.status)){result.status=previous.status==='complete'?'completion_recovery_required':previous.status;result.errorCode=previous.error_code;return result;}
    if(previous?.next_run_at&&dateMs(previous.next_run_at)>now){result.status='retry_wait';result.retryAt=previous.next_run_at;return result;}
    result.status='due';
  }catch(error){result.status='invalid';result.errorCode=safeCode(error);}
  return result;
}

/** Pure database reads: no timers, network, credentials, migrations or writes. */
export function planSchedules(db,{now=Date.now()}={}) {
  const verified=new Set(verifiedIds(db));
  const items=db.raw.prepare('SELECT * FROM collection_schedules ORDER BY interval_hours,id').all().map(row=>inspectSchedule(db,row,now,verified));
  return {status:'plan',asOf:iso(now),mode:'one_bounded_manual_tick',maxJobsPerTick:1,maxRuntimeMs:MAX_TICK_MS,concurrency:1,items};
}

export function configureSchedule(db,{id,expires,watchlist,now=Date.now()}={}) {
  const row=db.raw.prepare('SELECT * FROM collection_schedules WHERE id=?').get(id??''),spec=definition(row);
  const expiry=dateMs(expires);
  if(expiry<=now||expiry-now>MAX_SCHEDULE_MS)throw new CollectionError('expiry_within_seven_days_required');
  const ids=spec.kind==='watchlist'?watchlistIds(watchlist,new Set(verifiedIds(db))):[];
  if(spec.kind!=='watchlist'&&watchlist!==undefined)throw new CollectionError('watchlist_not_applicable');
  db.raw.prepare('UPDATE collection_schedules SET enabled=1,watchlist_json=?,next_run_at=?,expires_at=?,limits_json=? WHERE id=?').run(JSON.stringify(ids),iso(now),iso(expiry),JSON.stringify({...spec.limits,configuredAt:iso(now)}),id);
  return planSchedules(db,{now}).items.find(item=>item.id===id);
}
export function disableSchedule(db,{id}={}) {
  definition(db.raw.prepare('SELECT * FROM collection_schedules WHERE id=?').get(id??''));
  db.raw.prepare('UPDATE collection_schedules SET enabled=0 WHERE id=?').run(id);
  return {id,status:'disabled'};
}

function beginTick(db,lease,now) {
  // Holding the global lease proves no older scheduler tick is still active.
  db.raw.prepare("UPDATE collection_jobs SET status='interrupted',finished_at=?,error_code='scheduler_process_interrupted' WHERE source='scheduler' AND kind='tick' AND status='running'").run(iso(now));
  const tick={tickId:`tick-${randomUUID()}`,deadlineAt:lease.deadlineAt,lease};
  db.raw.prepare('INSERT INTO collection_jobs(job_id,source,kind,status,started_at,checkpoint_json,limits_json) VALUES(?,?,?,?,?,?,?)').run(tick.tickId,'scheduler','tick','running',iso(now),JSON.stringify({leaseId:lease.leaseId,deadlineAt:tick.deadlineAt,maxJobs:1}),JSON.stringify({maxRuntimeMs:MAX_TICK_MS,maxJobs:1,concurrency:1}));
  return tick;
}
function finishTick(db,tick,result,now) {
  db.raw.prepare('UPDATE collection_jobs SET status=?,finished_at=?,counters_json=?,checkpoint_json=?,error_code=? WHERE job_id=?').run(result.status==='complete'||result.status==='idle'||result.status==='user_run_required'?'complete':'interrupted',iso(now),JSON.stringify(result.counters??{}),JSON.stringify({deadlineAt:tick.deadlineAt,maxJobs:1,sourceJobId:result.sourceJobId??null,scheduleId:result.scheduleId??null}),result.errorCode??null,tick.tickId);
  releaseCollectionLease(db,tick.lease,{status:result.status==='complete'||result.status==='idle'||result.status==='user_run_required'?'complete':'interrupted',errorCode:result.errorCode??null,now:()=>now});
  return {...result,tickId:tick.tickId};
}

/** Exactly one bounded keyless job. The caller must explicitly invoke a tick. */
export async function tickSchedules(db,{now=Date.now,wait,wire=wireRequest}={}) {
  const lease=await acquireCollectionLease(db,{owner:'scheduler',now,maxRuntimeMs:MAX_TICK_MS,...(wait?{wait}:{})});
  if(!lease)return {status:'busy',errorCode:'collector_already_running'};
  let tick,job,transport,checkpoint;
  try {
    tick=beginTick(db,lease,now());
    const plan=planSchedules(db,{now:now()});
    const userRunRequired=plan.items.filter(item=>item.status==='user_run_required').map(item=>item.id);
    if(userRunRequired.length)db.raw.prepare("UPDATE source_health SET status='user_run_required' WHERE source='igdb'").run();
    const selected=plan.items.find(item=>item.status==='due');
    if(!selected) {
      const blocked=plan.items.find(item=>['blocked','exhausted','invalid','completion_recovery_required'].includes(item.status));
      return finishTick(db,tick,{status:blocked?'blocked':userRunRequired.length?'user_run_required':'idle',...(blocked?{scheduleId:blocked.id,sourceJobId:blocked.sourceJobId,errorCode:blocked.errorCode??blocked.status}:{}),userRunRequired},now());
    }
    const row=db.raw.prepare('SELECT * FROM collection_schedules WHERE id=?').get(selected.id);
    const previous=latestJob(db,row.id,row.next_run_at);
    const appids=previous?parseJson(previous.checkpoint_json).appids:row.kind==='watchlist'?parseJson(row.watchlist_json):verifiedIds(db);
    const verified=new Set(verifiedIds(db));
    if(!Array.isArray(appids)||!appids.length||appids.length>selected.limits.maxGames||new Set(appids).size!==appids.length||appids.some(id=>!validAppid(id)||!verified.has(id)))throw new CollectionError('invalid_target_set');
    job=beginJob(db,{source:'steam_api',kind:row.kind,limits:selected.limits,jobId:previous?.job_id,resume:!!previous});
    const original=previous?parseJson(previous.checkpoint_json):{};
    const deadline=Math.min(dateMs(tick.deadlineAt),dateMs(row.expires_at));
    const completed=new Set(db.raw.prepare("SELECT item_key FROM collection_attempts WHERE job_id=? AND status='accepted'").all(job.job_id).map(item=>item.item_key));
    let lastError=null;
    checkpoint=()=>({...original,scheduleId:row.id,dueAt:row.next_run_at,appids,targetCount:appids.length,completedItems:db.raw.prepare("SELECT COUNT(*) AS n FROM collection_attempts WHERE job_id=? AND status='accepted'").get(job.job_id).n,tickId:tick.tickId,deadlineAt:iso(deadline)});
    const remaining=Math.max(0,deadline-now());
    const transportLimits={...job.limits,maxRuntimeMs:Math.min(job.limits.maxRuntimeMs,(job.counters.elapsedMs??0)+remaining)};
    transport=createTransport({source:'steam_api',limits:transportLimits,counters:job.counters,now,...(wait?{wait}:{}),wire:async request=>{
      const available=deadline-now();
      if(available<=0)throw new CollectionError('runtime_limit');
      return wire({...request,timeoutMs:Math.min(request.timeoutMs,available)});
    },onBudget:async counters=>{
      if(now()>=deadline)throw new CollectionError('runtime_limit');
      const current=db.raw.prepare('SELECT enabled,next_run_at,expires_at,watchlist_json,limits_json FROM collection_schedules WHERE id=?').get(row.id);
      if(!current?.enabled)throw new CollectionError('schedule_disabled');
      if(['next_run_at','expires_at','watchlist_json','limits_json'].some(key=>current[key]!==row[key]))throw new CollectionError('schedule_changed');
      updateJob(db,job.job_id,{counters,checkpoint:checkpoint()});
    }});
    updateJob(db,job.job_id,{counters:transport.counters,checkpoint:checkpoint()});
    const result=await collectSteamMetrics({appids,transport,completed,now:()=>new Date(now()),onObservation:value=>{
      try{saveObservation(db,job.job_id,value);}catch{throw new CollectionError('persistence_failed');}
    },onAttempt:attempt=>{
      try{saveAttempt(db,job.job_id,attempt);updateJob(db,job.job_id,{counters:transport.counters,checkpoint:checkpoint()});}catch{throw new CollectionError('persistence_failed');}
      if(attempt.errorCode)lastError=attempt.errorCode;
      if(fatal.has(attempt.errorCode)||['schedule_disabled','schedule_changed'].includes(attempt.errorCode))throw new CollectionError(attempt.errorCode);
    }});
    const status=result.failed?'partial':'complete',counters={...transport.counters,...result};
    // Completion and advancing the due period commit together. A crash cannot
    // create a completed-but-still-due replacement job with a fresh budget.
    db.raw.exec('BEGIN IMMEDIATE');
    try {
      updateJob(db,job.job_id,{status,counters,checkpoint:checkpoint(),errorCode:lastError});
      if(status==='complete')db.raw.prepare('UPDATE collection_schedules SET next_run_at=? WHERE id=? AND next_run_at=?').run(iso(now()+row.interval_hours*3600000),row.id,row.next_run_at);
      else db.raw.prepare('UPDATE collection_jobs SET next_run_at=? WHERE job_id=?').run(iso(now()+RETRY_DELAY_MS),job.job_id);
      db.raw.exec('COMMIT');
    }catch(error){db.raw.exec('ROLLBACK');throw error;}
    return finishTick(db,tick,{status,scheduleId:row.id,sourceJobId:job.job_id,counters,userRunRequired,nextRunAt:db.raw.prepare('SELECT next_run_at FROM collection_schedules WHERE id=?').get(row.id).next_run_at},now());
  }catch(error) {
    const errorCode=safeCode(error),status=fatal.has(errorCode)?'blocked':exhausted.has(errorCode)?'exhausted':'interrupted';
    if(job) {
      updateJob(db,job.job_id,{status,errorCode,counters:transport?.counters??job.counters,checkpoint:checkpoint?.()??job.checkpoint});
      if(status==='interrupted')db.raw.prepare('UPDATE collection_jobs SET next_run_at=? WHERE job_id=?').run(iso(now()+RETRY_DELAY_MS),job.job_id);
    }
    const result={status,errorCode,sourceJobId:job?.job_id??null,counters:transport?.counters??{}};
    return tick?finishTick(db,tick,result,now()):result;
  }finally {
    // finishTick normally releases first; this conditional update is also safe
    // after an exception while creating/finalizing the tick ledger itself.
    releaseCollectionLease(db,lease,{status:'interrupted',errorCode:'scheduler_interrupted',now});
  }
}

export function parseScheduleOptions(args) {
  const opts={command:args[0]??'plan'};
  for(let index=1;index<args.length;index++) {
    const flag=args[index],key=flag.slice(2);
    if(Object.hasOwn(opts,key))throw new CollectionError('invalid_command');
    if(flag==='--run')opts.run=true;
    else if(['--id','--expires','--watchlist'].includes(flag)&&args[index+1]&&!args[index+1].startsWith('--'))opts[key]=args[++index];
    else throw new CollectionError('invalid_command');
  }
  const allowed={plan:[],configure:['id','expires','watchlist','run'],disable:['id','run'],tick:['run']}[opts.command];
  if(!allowed||Object.keys(opts).some(key=>key!=='command'&&!allowed.includes(key)))throw new CollectionError('invalid_command');
  if(opts.command!=='plan'&&!opts.run)throw new CollectionError('explicit_bounded_command_required');
  if(['configure','disable'].includes(opts.command)&&!definitions[opts.id])throw new CollectionError('invalid_schedule');
  if(opts.command==='configure'&&!opts.expires)throw new CollectionError('explicit_expiry_required');
  if(opts.watchlist!==undefined) {
    if(!/^\d+(?:,\d+)*$/.test(opts.watchlist))throw new CollectionError('invalid_watchlist');
    opts.watchlist=opts.watchlist.split(',').map(Number);
  }
  return opts;
}

export async function main(args) {
  const opts=parseScheduleOptions(args),filename=process.env.FIELDNOTE_DB??defaultDatabasePath;
  // A plan cannot create a database, run migrations or alter saved records.
  const db=opts.command==='plan'?{raw:new DatabaseSync(filename,{readOnly:true}),close(){this.raw.close();}}:openDatabase(filename);
  try {
    if(opts.run)migrate(db);
    const result=opts.command==='plan'?planSchedules(db):opts.command==='configure'?configureSchedule(db,opts):opts.command==='disable'?disableSchedule(db,opts):await tickSchedules(db);
    console.log(JSON.stringify(result));
    return ['blocked','interrupted','exhausted','busy'].includes(result.status)?1:0;
  }finally{db.close();}
}
if(process.argv[1]&&resolve(process.argv[1])===resolve(import.meta.dirname,'scheduler.mjs'))main(process.argv.slice(2)).then(code=>{process.exitCode=code;}).catch(error=>{console.error(JSON.stringify({status:'stopped',errorCode:safeCode(error)}));process.exitCode=2;});
