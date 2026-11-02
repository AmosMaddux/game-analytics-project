import {readFile,mkdir,lstat,open,rename} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {runProbe,createTransport,createRouteAgent,validatePilot,LIMITS,ProbeError} from './probe-core.mjs';
import {verifiedBundle,ROOT} from './verify-bundle.mjs';

export function parseArgs(args){
  if(args.length===1&&['--pilot','--plan'].includes(args[0]))return {mode:args[0].slice(2)};
  if(args.length===3&&args[0]==='--cohort'&&args[1]==='--pilot-report'&&/^outputs\/pilot-[a-zA-Z0-9-]+\/report\.json$/.test(args[2]))return {mode:'cohort',pilotPath:args[2]};
  throw new ProbeError('usage_run_with_plan_pilot_or_cohort_and_pilot_report_only');
}
async function readPilot(relative){
  let at=ROOT;for(const part of relative.split('/')){at=path.join(at,part);const st=await lstat(at);if(st.isSymbolicLink())throw new ProbeError('pilot_symlink_refused');}
  const st=await lstat(at);if(!st.isFile()||st.size>1048576)throw new ProbeError('invalid_pilot_file');
  return JSON.parse(await readFile(at,'utf8'));
}
async function outputWriter(mode){
  const root=path.join(ROOT,'outputs');await mkdir(root,{mode:0o700}).catch(e=>{if(e.code!=='EEXIST')throw e;});
  const st=await lstat(root);if(!st.isDirectory()||st.isSymbolicLink())throw new ProbeError('output_directory_refused');
  const runId=`${mode}-${new Date().toISOString().replace(/[^0-9TZ]/g,'')}-${randomUUID()}`;
  const dir=path.join(root,runId);await mkdir(dir,{mode:0o700});
  const file=path.join(dir,'report.json');let seq=0;
  const write=async report=>{
    const temp=path.join(dir,`.checkpoint-${seq++}.json`);const h=await open(temp,'wx',0o600);
    try{await h.writeFile(JSON.stringify(report,null,2)+'\n');await h.sync();}finally{await h.close();}
    await rename(temp,file);
  };
  return {runId,write,relative:`outputs/${runId}/report.json`};
}
export async function main(args){
  const cli=parseArgs(args),bundle=await verifiedBundle();
  const cohort=JSON.parse(await readFile(path.join(ROOT,'data/frozen-targets.json'),'utf8'));
  if(cli.mode==='plan'){
    console.log(JSON.stringify({status:'planned_not_executed',credential_free:true,requests_made:0,pilot_appids:cohort.pilot_appids,pilot_rationale:cohort.pilot_rationale,
      cohort_games:36,original_date_probe_appids:cohort.original_date_probe_appids,date_window:cohort.original_date_window,limits:LIMITS,
      maximum_cohort_planned_requests:114,live_tags_enabled:false,baseline_counts:cohort.baseline_counts,bundle_fingerprint:bundle.fingerprint},null,2));return 0;
  }
  if(cli.mode==='cohort')validatePilot(await readPilot(cli.pilotPath),{fingerprint:bundle.fingerprint,pilotAppids:cohort.pilot_appids});
  // This process receives only the launcher's bounded system/proxy environment.
  // Only fixed proxy keys are consulted; no authentication/config files exist in this workflow.
  const route=()=>createRouteAgent({env:process.env});
  const check=route();check.destroy(); // Validate route support before creating a run or dispatching.
  const output=await outputWriter(cli.mode);let lastPrinted=0;
  const report=await runProbe({mode:cli.mode,cohort,transport:createTransport({agentFactory:route}),runId:output.runId,kind:'live',bundleFingerprint:bundle.fingerprint,
    onCheckpoint:async r=>{await output.write(r);const o=r.observations.at(-1);if(o&&o.status!=='attempting'&&o.sequence>lastPrinted){lastPrinted=o.sequence;console.log(`request=${o.sequence} appid=${o.appid} method=${o.method} purpose=${o.purpose} status=${o.status} http=${o.http_status??'none'} error=${o.error_code??'none'}`);}}});
  console.log(`REPORT=${output.relative}`);
  console.log(JSON.stringify({status:report.status,healthy:report.healthy,request_counts:report.request_counts,review_window_verdict:report.review_window_verdict,stop_reason:report.stop_reason}));
  if(report.status==='stopped')return 2;
  if(cli.mode==='pilot')console.log(`NEXT_MANUAL_COMMAND=bash scripts/run-steam-validation.sh --cohort --pilot-report ${output.relative}`);
  return 0;
}
