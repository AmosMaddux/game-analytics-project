import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { CollectionError } from './transport.mjs';

const iso=ms=>new Date(ms).toISOString();
function processAlive(pid) {
  if(!Number.isSafeInteger(pid)||pid<1)throw new CollectionError('invalid_collection_lease');
  try{process.kill(pid,0);return true;}catch(error){if(error.code==='ESRCH')return false;return true;}
}

/** One process-wide collector on this local database. Never unlock a live PID. */
export async function acquireCollectionLease(db,{owner,now=Date.now,maxRuntimeMs,wait=sleep}={}) {
  if(typeof owner!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(owner)||typeof now!=='function'||!Number.isSafeInteger(maxRuntimeMs)||maxRuntimeMs<1||maxRuntimeMs>1500000)throw new CollectionError('invalid_collection_lease');
  const started=now(),lease={leaseId:`lease-${randomUUID()}`,deadlineAt:iso(started+maxRuntimeMs)};
  let delay=0;
  db.raw.exec('BEGIN IMMEDIATE');
  try {
    for(const row of db.raw.prepare("SELECT job_id,checkpoint_json FROM collection_jobs WHERE source='collector_control' AND kind='lease' AND status='running'").all()) {
      let checkpoint;try{checkpoint=JSON.parse(row.checkpoint_json);}catch{throw new CollectionError('invalid_collection_lease');}
      if(processAlive(checkpoint?.pid)){db.raw.exec('ROLLBACK');return null;}
      db.raw.prepare("UPDATE collection_jobs SET status='interrupted',finished_at=?,error_code='collector_process_interrupted' WHERE job_id=?").run(iso(started),row.job_id);
    }
    const prior=db.raw.prepare("SELECT finished_at FROM collection_jobs WHERE source='collector_control' AND kind='lease' AND finished_at IS NOT NULL ORDER BY julianday(finished_at) DESC LIMIT 1").get();
    if(prior) {
      const finished=Date.parse(prior.finished_at);
      if(!Number.isFinite(finished))throw new CollectionError('invalid_collection_lease');
      // Release follows the last response. A full interval between owners is
      // deliberately conservative, including after a dead process is reclaimed.
      delay=Math.min(1000,Math.max(0,finished+1000-started));
    }
    db.raw.prepare('INSERT INTO collection_jobs(job_id,source,kind,status,started_at,checkpoint_json,limits_json) VALUES(?,?,?,?,?,?,?)').run(lease.leaseId,'collector_control','lease','running',iso(started),JSON.stringify({pid:process.pid,owner,deadlineAt:lease.deadlineAt}),JSON.stringify({maxRuntimeMs,concurrency:1,minIntervalMs:1000}));
    db.raw.exec('COMMIT');
  }catch(error){db.raw.exec('ROLLBACK');throw error;}
  try {
    if(now()+delay>=Date.parse(lease.deadlineAt))throw new CollectionError('runtime_limit');
    if(delay)await wait(delay);
    if(now()>=Date.parse(lease.deadlineAt))throw new CollectionError('runtime_limit');
    return lease;
  }catch(error){releaseCollectionLease(db,lease,{status:'interrupted',errorCode:error instanceof CollectionError?error.code:'lease_wait_failed',now});throw error;}
}

export function releaseCollectionLease(db,lease,{status='complete',errorCode=null,now=Date.now}={}) {
  if(!/^[a-zA-Z0-9_-]{1,100}$/.test(status)||errorCode!==null&&!/^[a-zA-Z0-9_-]{1,100}$/.test(errorCode))throw new CollectionError('invalid_collection_lease');
  db.raw.prepare("UPDATE collection_jobs SET status=?,finished_at=?,error_code=? WHERE job_id=? AND source='collector_control' AND kind='lease' AND status='running' AND json_extract(checkpoint_json,'$.pid')=?").run(status,iso(now()),errorCode,lease.leaseId,process.pid);
}
