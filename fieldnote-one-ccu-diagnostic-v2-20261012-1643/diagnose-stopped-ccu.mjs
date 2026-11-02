import {open,unlink,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {sha,readJson,atomicState,authoritativeStatePath,validateSourceEvidence,runJob,APPROVED_294_SHA} from './collect-review-campaign.mjs';
import {validateCampaignState} from './qualification-campaign.mjs';
import {Stop,wire} from './validate-reviews.mjs';
const check=(ok,code)=>{if(!ok)throw new Stop(code);};
export const STOPPED_SHA='0ca45bbca754e1a216f25b254a6c08dd8ad01d6dea57375c389f946add0a6015';
export const RUN='panelmetrics-9a53ddb8-22e8-48f1-b765-e6406c988919';
export const VALIDATION_SHA='a8efd1423272343178ed1813ad03660a18e74169f032c0e06fceb90bd2e40b6f';
export function validateDiagnosticScope(ledger){
 validateCampaignState(ledger);const j=ledger.job,last=j.attempts.at(-1);
 check(j.runId===RUN&&j.schemaVersion==='fieldnote-panel-metrics-1.0'&&j.panel.manifestSha256===APPROVED_294_SHA&&j.status==='stopped'&&j.errorCode==='http_failure'&&!j.permanentStop&&j.pending===null&&j.counters.requests===160&&j.counters.retries===0&&j.observations.length===159&&j.requestAttempts['917640:players']===1&&last?.sequence===160&&last.requestKey==='917640:players'&&last.status==='failed'&&last.errorCode==='http_failure','exact_stopped_ccu_retry_scope_required');
 check(j.observations.filter(x=>x.appid===917640).length===3&&!j.observations.some(x=>x.appid===917640&&x.metric==='players')&&ledger.usedRequests===1754&&ledger.bootstrapUsed===946,'saved_progress_or_budget_changed');
 check(!j.attempts.some(x=>['access_denied','throttled','redirect_blocked'].includes(x.errorCode)),'source_lane_disabled');
 return j;
}
export async function diagnose(ledger,options={}){
 validateDiagnosticScope(ledger);let calls=0;const call=options.call??wire;
 const limits={...options,stopAfterGames:1};limits.call=async args=>{check(++calls===1&&args.endpoint==='https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/'&&args.input.appid===917640,'diagnostic_dispatch_outside_scope');return call(args);};
 await runJob(ledger,limits);const j=ledger.job;check(j.counters.requests<=161&&j.counters.retries<=1&&j.observations.length<=160,'diagnostic_exceeded_scope');return j;
}
export async function main(args){const opts={};for(let i=0;i<args.length;i+=2){check(['--state','--expected-ledger-sha','--validation'].includes(args[i])&&!(args[i]in opts)&&typeof args[i+1]==='string','invalid_command');opts[args[i]]=args[i+1];}check(Object.keys(opts).length===3&&opts['--expected-ledger-sha']===STOPPED_SHA,'explicit_diagnostic_inputs_required');const [major,minor]=process.versions.node.split('.').map(Number);check(major===24&&minor>=5,'node_24_5_required');
 const path=resolve(opts['--state']),proof=await readJson(resolve(opts['--validation']));validateSourceEvidence(proof.raw,VALIDATION_SHA);
 const before=await readJson(path,16777216);check(sha(before.raw)===opts['--expected-ledger-sha'],'stopped_ledger_hash_mismatch');authoritativeStatePath(before.value.baseline,path);validateDiagnosticScope(before.value);
 const lockPath=path+'.lock',lock=await open(lockPath,'wx',0o600).catch(()=>{throw new Stop('collector_locked_check_existing_process_before_recovery');});await lock.writeFile(JSON.stringify({pid:process.pid,purpose:'one_charged_same_job_ccu_diagnostic',startedAt:new Date().toISOString()}));await lock.sync();
 try{const input=await readJson(path,16777216);check(sha(input.raw)===opts['--expected-ledger-sha'],'stopped_ledger_changed');const ledger=input.value;validateDiagnosticScope(ledger);
  const files=ledger.qualificationCampaign.inputFiles;for(const record of Object.values(files)){const f=await readJson(record.path,33554432);check(sha(f.raw)===record.sha256,'frozen_source_changed');}
  const panel=await readJson(ledger.qualificationCampaign.panelInput.path);check(sha(panel.raw)===ledger.qualificationCampaign.panelInput.sha256,'frozen_panel_changed');
  await diagnose(ledger,{persist:async state=>{validateCampaignState(state);await atomicState(path,state);}});
  const j=ledger.job,last=j.attempts.at(-1);console.log(JSON.stringify({status:j.status,errorCode:j.errorCode??null,permanentStop:j.permanentStop??null,runId:j.runId,requests:j.counters.requests,retries:j.counters.retries,observations:j.observations.length,monthlyUsed:ledger.usedRequests,bootstrapUsed:ledger.bootstrapUsed,lastAttempt:last,ccu:j.observations.find(x=>x.appid===917640&&x.metric==='players')??null}));
 }finally{await lock.close();await unlink(lockPath);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main(process.argv.slice(2)).catch(error=>{console.error(JSON.stringify({status:'stopped',errorCode:error instanceof Stop?error.code:'unexpected_failure'}));process.exitCode=2;});
