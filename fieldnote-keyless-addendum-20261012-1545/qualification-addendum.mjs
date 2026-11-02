import {open,unlink,lstat,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {readJson,sha,canonical,authoritativeStatePath,atomicState,validateSourceEvidence,runJob} from './collect-review-campaign.mjs';
import {planAddendum,extendQualification,validateCampaignState,advanceCampaignToPanel,encoded} from './qualification-campaign.mjs';
import {writeIdentical,preflightExports,finishExports} from './campaign-exports.mjs';
import {Stop} from './validate-reviews.mjs';
const check=(ok,code)=>{if(!ok)throw new Stop(code);};
const sourceOptions={'--previous-candidates':'previousCandidatesRaw','--previous-source-report':'previousSourceReportRaw','--previous-source-checkpoint':'previousSourceCheckpointRaw','--candidates':'candidatesRaw','--source-report':'sourceReportRaw','--source-checkpoint':'sourceCheckpointRaw'};
async function loadSources(opts){const values={},files={};for(const [key,name] of Object.entries(sourceOptions)){check(typeof opts[key]==='string','explicit_source_inputs_required');const path=resolve(opts[key]),file=await readJson(path,33554432);values[name]=file.raw;files[name]={path,sha256:sha(file.raw)};}return {values,files};}
async function frozenSources(ledger){const files=ledger.qualificationCampaign?.inputFiles;check(files&&Object.keys(files).length===6,'frozen_source_inputs_missing');const values={};for(const name of Object.values(sourceOptions)){check(typeof files[name]?.path==='string','frozen_source_inputs_missing');const file=await readJson(files[name].path,33554432);check(sha(file.raw)===files[name].sha256,'frozen_source_inputs_changed');values[name]=file.raw;}check(sha(values.candidatesRaw)===ledger.qualificationCampaign.plan.candidateSha256,'frozen_candidate_hash_changed');return values;}
const outputPaths=opts=>({output:resolve(opts['--output']),...(opts['--campaign-output']?{campaignOutput:resolve(opts['--campaign-output'])}:{}),...(opts['--joined-output']?{joinedOutput:resolve(opts['--joined-output'])}:{})});
export async function main(args){
 const actions=['--plan','--extend','--resume','--advance'],opts={};
 const allowed=[...actions,...Object.keys(sourceOptions),'--validation','--validation-sha','--state','--expected-ledger-sha','--approved-plan-sha','--plan-output','--output','--campaign-output','--joined-output','--panel','--campaign','--as-of'];
 for(let i=0;i<args.length;i++){const key=args[i];check(allowed.includes(key)&&!(key in opts),'invalid_command');opts[key]=actions.includes(key)?true:args[++i];check(opts[key]!==undefined,'missing_command_value');}
 check(actions.filter(a=>opts[a]).length===1&&['--validation','--validation-sha','--state'].every(k=>typeof opts[k]==='string'),'explicit_command_required');
 const [major,minor]=process.versions.node.split('.').map(Number);check(major===24&&minor>=5,'node_24_5_required');
 const statePath=resolve(opts['--state']),validation=await readJson(resolve(opts['--validation']));validateSourceEvidence(validation.raw,opts['--validation-sha']);
 if(opts['--plan']){
  const state=await readJson(statePath,16777216),source=await loadSources(opts);
  const plan=planAddendum({...source.values,ledgerRaw:state.raw,expectedLedgerSha:opts['--expected-ledger-sha'],validationRaw:validation.raw,expectedSha:opts['--validation-sha']});
  if(opts['--plan-output'])await writeIdentical(resolve(opts['--plan-output']),encoded(plan));
  console.log(JSON.stringify({status:'planned_offline',planSha256:sha(canonical(plan)),addedIdsSha256:plan.addedIdsSha256,candidateSha256:plan.candidateSha256,addedCount:plan.addedIds.length,sourceDelta:plan.sourceReconciliation.requests,maximumAttempts:plan.maximumAttempts,monthlyAfterSource:plan.monthlyUsedAfterSource,bootstrapAfterSource:plan.bootstrapUsedAfterSource}));return;
 }
 check(typeof opts['--output']==='string','explicit_output_required');
 if(opts['--resume'])check(!opts['--expected-ledger-sha']&&!opts['--approved-plan-sha']&&!opts['--as-of']&&!opts['--panel']&&!opts['--campaign']&&!Object.keys(sourceOptions).some(k=>opts[k]),'resume_cannot_change_frozen_inputs');
 if(opts['--extend'])check(opts['--campaign-output']&&opts['--joined-output']&&!opts['--panel']&&!opts['--campaign']&&!opts['--as-of'],'explicit_addendum_outputs_required');
 if(opts['--advance'])check(opts['--panel']&&opts['--campaign']&&opts['--as-of']&&!opts['--campaign-output']&&!opts['--joined-output']&&!Object.keys(sourceOptions).some(k=>opts[k]),'explicit_panel_transition_required');
 const pre=await readJson(statePath,16777216);authoritativeStatePath(pre.value.baseline,statePath);
 const paths=outputPaths(opts);check(Object.values(paths).every(p=>p!==statePath),'output_must_differ_from_state');
 for(const p of Object.values(paths)){await mkdir(dirname(p),{recursive:true});check(!(await lstat(dirname(p))).isSymbolicLink(),'output_directory_symlink');}
 const lockPath=statePath+'.lock',lock=await open(lockPath,'wx',0o600).catch(()=>{throw new Stop('collector_locked_check_existing_process_before_recovery');});
 await lock.writeFile(JSON.stringify({pid:process.pid,startedAt:new Date().toISOString(),purpose:'bounded_qualification_addendum'}));await lock.sync();
 try{
  const state=await readJson(statePath,16777216);let ledger=state.value,sources;
  if(opts['--extend']){
   const loaded=await loadSources(opts);sources=loaded.values;
   const plan=planAddendum({...sources,ledgerRaw:state.raw,expectedLedgerSha:opts['--expected-ledger-sha'],validationRaw:validation.raw,expectedSha:opts['--validation-sha']});
   extendQualification(ledger,plan,{approvedPlanSha:opts['--approved-plan-sha'],discovery:JSON.parse(sources.candidatesRaw),discoveryRaw:sources.candidatesRaw,validationRaw:validation.raw,expectedSha:opts['--validation-sha']});
   ledger.qualificationCampaign.inputFiles=loaded.files;ledger.qualificationCampaign.outputPaths=paths;
   await preflightExports(ledger,sources.candidatesRaw,paths);await atomicState(statePath,ledger);
  }else{
   validateCampaignState(ledger);check(ledger.job.validationEvidence.reportSha256===opts['--validation-sha'],'source_validation_changed');sources=await frozenSources(ledger);
   if(opts['--advance']){
    const panel=await readJson(resolve(opts['--panel'])),campaign=await readJson(resolve(opts['--campaign']),16777216),end=Date.parse(opts['--as-of'])/1000;
    check(Number.isSafeInteger(end)&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.000)?Z$/.test(opts['--as-of']),'invalid_as_of');
    advanceCampaignToPanel(ledger,{panel:panel.value,campaignRaw:campaign.raw,validationRaw:validation.raw,expectedSha:opts['--validation-sha'],end});
    ledger.qualificationCampaign.panelInput={path:resolve(opts['--panel']),sha256:sha(panel.raw)};ledger.qualificationCampaign.panelOutputPaths=paths;
    await preflightExports(ledger,sources.candidatesRaw,paths);await atomicState(statePath,ledger);
   }else{
    const frozen=ledger.job.schemaVersion==='fieldnote-candidate-review-addendum-1.0'?ledger.qualificationCampaign.outputPaths:ledger.qualificationCampaign.panelOutputPaths;
    check(canonical(paths)===canonical(frozen),'resume_output_paths_changed');
    if(ledger.qualificationCampaign.panelInput){const p=await readJson(ledger.qualificationCampaign.panelInput.path);check(sha(p.raw)===ledger.qualificationCampaign.panelInput.sha256,'frozen_panel_file_changed');}
    await preflightExports(ledger,sources.candidatesRaw,paths);
   }
  }
  const persist=async value=>{validateCampaignState(value);await atomicState(statePath,value);};
  if(!['completed','completed_with_missing'].includes(ledger.job.status))await runJob(ledger,{persist});
  let outputs=[];if(['completed','completed_with_missing'].includes(ledger.job.status))outputs=await finishExports(ledger,sources.candidatesRaw,paths,persist);
  console.log(JSON.stringify({status:ledger.job.status,errorCode:ledger.job.errorCode??null,runId:ledger.job.runId,requests:ledger.job.counters.requests,retries:ledger.job.counters.retries,observations:ledger.job.observations.length,monthlyUsed:ledger.usedRequests,bootstrapUsed:ledger.bootstrapUsed,outputs}));
  if(!outputs.length)process.exitCode=1;
 }finally{await lock.close();await unlink(lockPath);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main(process.argv.slice(2)).catch(error=>{console.error(JSON.stringify({status:'stopped',errorCode:error instanceof Stop?error.code:'unexpected_failure'}));process.exitCode=2;});
