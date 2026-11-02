import {open,unlink,lstat,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {readJson,sha,canonical,authoritativeStatePath,atomicState,validateSourceEvidence,runJob,APPROVED_294_SHA} from './collect-review-campaign.mjs';
import {validateCampaignState,advanceCampaignToPanel} from './qualification-campaign.mjs';
import {preflightExports,finishExports} from './campaign-exports.mjs';
import {Stop} from './validate-reviews.mjs';
const check=(ok,code)=>{if(!ok)throw new Stop(code);};
export const PANEL_FILE_SHA='c9b5d6497d6a2d4ddf15f7ca07a8d87f2603ac89da8b7998ca03137830e84220';
export const PRIOR_LEDGER_SHA='f14af4ede086cb7616335a17875a28770869ea9605a241c06e5c6b1ca154b705';
export const CAMPAIGN_SHA='b31ba4d90a768c9ff191c8b4d54df9016ecc7df1a462e49bee35e7ea8c150532';
export const VALIDATION_SHA='a8efd1423272343178ed1813ad03660a18e74169f032c0e06fceb90bd2e40b6f';
export const WINDOW_END='2026-10-12T00:00:00Z';
export function transitionApproved294({ledgerRaw,panelRaw,campaignRaw,validationRaw,approvedManifestSha,windowEnd=WINDOW_END,now=new Date().toISOString()}){
 check(approvedManifestSha===APPROVED_294_SHA&&sha(ledgerRaw)===PRIOR_LEDGER_SHA&&sha(panelRaw)===PANEL_FILE_SHA&&sha(campaignRaw)===CAMPAIGN_SHA&&sha(validationRaw)===VALIDATION_SHA&&windowEnd===WINDOW_END,'exact_user_approved_294_inputs_required');
 const ledger=JSON.parse(ledgerRaw);advanceCampaignToPanel(ledger,{panel:JSON.parse(panelRaw),campaignRaw,validationRaw,expectedSha:VALIDATION_SHA,end:Date.parse(WINDOW_END)/1000,now});
 ledger.qualificationCampaign.partialPanelApproval={manifestSha256:APPROVED_294_SHA,manifestFileSha256:PANEL_FILE_SHA,selectedCount:294,targetCount:300,shortfallCount:6,decisionAt:'2026-10-12T16:08:26Z',scope:'Explicit user-approved294 option, original quotas retained with6 missing recent slots'};
 return ledger;
}
function approvedState(ledger){validateCampaignState(ledger);const a=ledger.qualificationCampaign.partialPanelApproval;check(ledger.job.schemaVersion==='fieldnote-panel-metrics-1.0'&&ledger.job.panel.manifestSha256===APPROVED_294_SHA&&a?.manifestSha256===APPROVED_294_SHA&&a.manifestFileSha256===PANEL_FILE_SHA&&a.selectedCount===294&&a.targetCount===300&&a.shortfallCount===6&&ledger.job.validationEvidence.reportSha256===VALIDATION_SHA&&ledger.job.windows.seven.endExclusive===Date.parse(WINDOW_END)/1000&&ledger.job.windows.thirty.endExclusive===Date.parse(WINDOW_END)/1000,'approved_294_state_required');}
async function frozenSource(ledger){const files=ledger.qualificationCampaign.inputFiles,names=['previousCandidatesRaw','previousSourceReportRaw','previousSourceCheckpointRaw','candidatesRaw','sourceReportRaw','sourceCheckpointRaw'];check(files&&Object.keys(files).length===names.length,'frozen_source_inputs_missing');const values={};for(const name of names){check(typeof files[name]?.path==='string','frozen_source_inputs_missing');const file=await readJson(files[name].path,33554432);check(sha(file.raw)===files[name].sha256,'frozen_source_inputs_changed');values[name]=file.raw;}check(sha(values.candidatesRaw)===ledger.qualificationCampaign.plan.candidateSha256,'frozen_candidate_hash_changed');return values.candidatesRaw;}
export async function main(args){
 const actions=['--advance','--resume'],allowed=[...actions,'--state','--output','--validation','--validation-sha','--panel','--campaign','--as-of','--approve-panel294-sha'],opts={};
 for(let i=0;i<args.length;i++){const key=args[i];check(allowed.includes(key)&&!(key in opts),'invalid_command');opts[key]=actions.includes(key)?true:args[++i];check(opts[key]!==undefined,'missing_command_value');}
 check(actions.filter(a=>opts[a]).length===1&&['--state','--output','--validation'].every(k=>typeof opts[k]==='string')&&opts['--validation-sha']===VALIDATION_SHA,'explicit_command_required');
 if(opts['--advance'])check(opts['--panel']&&opts['--campaign']&&opts['--as-of']===WINDOW_END&&opts['--approve-panel294-sha']===APPROVED_294_SHA,'explicit_294_transition_approval_required');
 else check(!opts['--panel']&&!opts['--campaign']&&!opts['--as-of']&&!opts['--approve-panel294-sha'],'resume_cannot_change_frozen_inputs');
 const [major,minor]=process.versions.node.split('.').map(Number);check(major===24&&minor>=5,'node_24_5_required');
 const statePath=resolve(opts['--state']),paths={output:resolve(opts['--output'])};check(paths.output!==statePath,'output_must_differ_from_state');
 const validation=await readJson(resolve(opts['--validation']));validateSourceEvidence(validation.raw,VALIDATION_SHA);
 const pre=await readJson(statePath,16777216);authoritativeStatePath(pre.value.baseline,statePath);
 await mkdir(dirname(paths.output),{recursive:true});check(!(await lstat(dirname(paths.output))).isSymbolicLink(),'output_directory_symlink');
 const lockPath=statePath+'.lock',lock=await open(lockPath,'wx',0o600).catch(()=>{throw new Stop('collector_locked_check_existing_process_before_recovery');});
 await lock.writeFile(JSON.stringify({pid:process.pid,startedAt:new Date().toISOString(),purpose:'explicit_approved294_panel_metrics'}));await lock.sync();
 try{
  const state=await readJson(statePath,16777216);authoritativeStatePath(state.value.baseline,statePath);let ledger=state.value;
  if(opts['--advance']){
   const panel=await readJson(resolve(opts['--panel'])),campaign=await readJson(resolve(opts['--campaign']),16777216);
   ledger=transitionApproved294({ledgerRaw:state.raw,panelRaw:panel.raw,campaignRaw:campaign.raw,validationRaw:validation.raw,approvedManifestSha:opts['--approve-panel294-sha'],windowEnd:opts['--as-of']});
   ledger.qualificationCampaign.panelInput={path:resolve(opts['--panel']),sha256:sha(panel.raw)};ledger.qualificationCampaign.panelOutputPaths=paths;
  }else{
   approvedState(ledger);check(canonical(paths)===canonical(ledger.qualificationCampaign.panelOutputPaths),'resume_output_paths_changed');
   const panel=await readJson(ledger.qualificationCampaign.panelInput.path);check(sha(panel.raw)===PANEL_FILE_SHA&&ledger.qualificationCampaign.panelInput.sha256===PANEL_FILE_SHA,'frozen_panel_file_changed');
  }
  const discoveryRaw=await frozenSource(ledger);await preflightExports(ledger,discoveryRaw,paths);
  const persist=async value=>{approvedState(value);await atomicState(statePath,value);};
  if(opts['--advance'])await persist(ledger);
  if(!['completed','completed_with_missing'].includes(ledger.job.status))await runJob(ledger,{persist});
  let outputs=[];if(['completed','completed_with_missing'].includes(ledger.job.status))outputs=await finishExports(ledger,discoveryRaw,paths,persist);
  console.log(JSON.stringify({status:ledger.job.status,errorCode:ledger.job.errorCode??null,runId:ledger.job.runId,panelCount:294,targetCount:300,shortfallCount:6,requests:ledger.job.counters.requests,retries:ledger.job.counters.retries,observations:ledger.job.observations.length,monthlyUsed:ledger.usedRequests,bootstrapUsed:ledger.bootstrapUsed,outputs}));
  if(!outputs.length)process.exitCode=1;
 }finally{await lock.close();await unlink(lockPath);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main(process.argv.slice(2)).catch(error=>{console.error(JSON.stringify({status:'stopped',errorCode:error instanceof Stop?error.code:'unexpected_failure'}));process.exitCode=2;});
