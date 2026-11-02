import {open,unlink} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {readJson,sha,canonical,authoritativeStatePath,atomicState,validateSourceEvidence,runJob,observation,panelInput,APPROVED_294_SHA} from './collect-review-campaign.mjs';
import {validateCampaignState} from './qualification-campaign.mjs';
import {preflightExports,finishExports} from './campaign-exports.mjs';
import {Stop} from './validate-reviews.mjs';
const check=(ok,code)=>{if(!ok)throw new Stop(code);};
export const DIAGNOSTIC_SHA='ffe944dc84fcff62f85db027d4cbfbe15a8e1741fce13e33317cc5ad903890ac';
export const VALIDATION_SHA='a8efd1423272343178ed1813ad03660a18e74169f032c0e06fceb90bd2e40b6f';
export const RUN='panelmetrics-9a53ddb8-22e8-48f1-b765-e6406c988919';
export function repairRecorded404(ledger){
 validateCampaignState(ledger);const j=ledger.job,a=j.attempts.at(-1);
 check(j.runId===RUN&&j.panel.manifestSha256===APPROVED_294_SHA&&j.status==='stopped'&&j.errorCode==='http_failure'&&!j.permanentStop&&j.pending===null&&j.counters.requests===161&&j.counters.retries===1&&j.observations.length===159&&ledger.usedRequests===1755&&ledger.bootstrapUsed===947,'exact_diagnostic_state_required');
 check(a.sequence===161&&a.requestKey==='917640:players'&&a.status==='failed'&&a.errorCode==='http_failure'&&a.httpStatus===404&&a.responseObservedAt==='2026-10-12T16:44:51.297Z'&&j.requestAttempts['917640:players']===2&&!j.observations.some(o=>o.appid===917640&&o.metric==='players'),'exact_failed_404_receipt_required');
 check(!j.attempts.some(x=>['access_denied','throttled','redirect_blocked'].includes(x.errorCode)),'source_lane_disabled');
 const row=observation(j,917640,'players',panelInput(917640,'players',j),{},a.responseObservedAt);row.missingReason='source_http_404';j.observations.push(row);j.status='paused';delete j.errorCode;validateCampaignState(ledger);return row;
}
export async function continueRecorded404(ledger,options={}){const {persist=async()=>{}}=options;repairRecorded404(ledger);await persist(ledger);return runJob(ledger,options);}
export async function main(args){const allowed=['--state','--output','--validation','--expected-ledger-sha'],opts={};for(let i=0;i<args.length;i+=2){check(allowed.includes(args[i])&&!(args[i]in opts)&&typeof args[i+1]==='string','invalid_command');opts[args[i]]=args[i+1];}check(Object.keys(opts).length===4&&opts['--expected-ledger-sha']===DIAGNOSTIC_SHA,'explicit_404_resume_inputs_required');
 const [major,minor]=process.versions.node.split('.').map(Number);check(major===24&&minor>=5,'node_24_5_required');
 const statePath=resolve(opts['--state']),paths={output:resolve(opts['--output'])},validation=await readJson(resolve(opts['--validation']));validateSourceEvidence(validation.raw,VALIDATION_SHA);
 const pre=await readJson(statePath,16777216);check(sha(pre.raw)===DIAGNOSTIC_SHA,'diagnostic_ledger_hash_mismatch');authoritativeStatePath(pre.value.baseline,statePath);validateCampaignState(pre.value);
 const lockPath=statePath+'.lock',lock=await open(lockPath,'wx',0o600).catch(()=>{throw new Stop('collector_locked_check_existing_process_before_recovery');});await lock.writeFile(JSON.stringify({pid:process.pid,startedAt:new Date().toISOString(),purpose:'same_job_ccu404_unavailable_continuation'}));await lock.sync();
 try{const state=await readJson(statePath,16777216);check(sha(state.raw)===DIAGNOSTIC_SHA,'diagnostic_ledger_changed');const ledger=state.value;authoritativeStatePath(ledger.baseline,statePath);validateCampaignState(ledger);
  check(canonical(paths)===canonical(ledger.qualificationCampaign.panelOutputPaths),'frozen_output_path_changed');const panel=await readJson(ledger.qualificationCampaign.panelInput.path);check(sha(panel.raw)===ledger.qualificationCampaign.panelInput.sha256,'frozen_panel_changed');
  let discoveryRaw;for(const [name,record]of Object.entries(ledger.qualificationCampaign.inputFiles)){const f=await readJson(record.path,33554432);check(sha(f.raw)===record.sha256,'frozen_source_changed');if(name==='candidatesRaw')discoveryRaw=f.raw;}check(typeof discoveryRaw==='string','frozen_candidate_missing');await preflightExports(ledger,discoveryRaw,paths);
  const persist=async value=>{validateCampaignState(value);await atomicState(statePath,value);};await continueRecorded404(ledger,{persist});
  let outputs=[];if(['completed','completed_with_missing'].includes(ledger.job.status))outputs=await finishExports(ledger,discoveryRaw,paths,persist);
  console.log(JSON.stringify({status:ledger.job.status,errorCode:ledger.job.errorCode??null,permanentStop:ledger.job.permanentStop??null,runId:ledger.job.runId,requests:ledger.job.counters.requests,retries:ledger.job.counters.retries,observations:ledger.job.observations.length,unavailableCcu:ledger.job.observations.filter(o=>o.missingReason==='source_http_404').length,monthlyUsed:ledger.usedRequests,bootstrapUsed:ledger.bootstrapUsed,outputs}));if(!outputs.length)process.exitCode=1;
 }finally{await lock.close();await unlink(lockPath);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main(process.argv.slice(2)).catch(error=>{console.error(JSON.stringify({status:'stopped',errorCode:error instanceof Stop?error.code:'unexpected_failure'}));process.exitCode=2;});
