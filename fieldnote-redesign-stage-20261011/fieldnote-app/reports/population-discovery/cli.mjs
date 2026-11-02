import { resolve,join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { VERSION, SafeError, makePlan } from './domain.mjs';
import { initialState, validateState, discover, collectIdentities, finishState, canResume, resultOf } from './runner.mjs';
import { createTransport } from './transport.mjs';
import { ensurePrivateDirectory, readPrivateConfig, atomicJson, saveState, loadState, acquireLease } from './io.mjs';
function options(args) {
  const opts={};for(let i=0;i<args.length;i++){const flag=args[i];if(['--run','--dry-run'].includes(flag)){if(opts[flag.slice(2)])throw new SafeError('duplicate_argument');opts[flag.slice(2)]=true;}else if(['--config','--as-of','--resume'].includes(flag)&&args[i+1]&&!args[i+1].startsWith('--')){if(opts[flag.slice(2)])throw new SafeError('duplicate_argument');opts[flag.slice(2)]=args[++i];}else throw new SafeError('invalid_command');}
  if(Boolean(opts.run)===Boolean(opts['dry-run'])||(opts.run&&!opts.config)||(opts['dry-run']&&(opts.config||opts.resume))||(opts.resume&&(!/^[0-9T-]+_[a-f0-9-]{36}$/.test(opts.resume)||opts['as-of'])))throw new SafeError('explicit_run_or_dry_run_required');
  return opts;
}
export async function main(args) {
  const opts=options(args);
  if(opts['dry-run']){console.log(JSON.stringify({mode:'offline_plan_only',version:VERSION,plan:makePlan(opts['as-of']),credentialsRead:false,networkRequests:0,databaseWrites:0},null,2));return 0;}
  const root=join(import.meta.dirname,'.runs');await ensurePrivateDirectory(root);const release=await acquireLease(root);let state,directory;
  try {
    const id=opts.resume??`${new Date().toISOString().replace(/[:.Z]/g,'-')}_${randomUUID()}`;
    directory=join(root,id);await ensurePrivateDirectory(directory);
    state=opts.resume?await loadState(directory):initialState(makePlan(opts['as-of']));validateState(state);
    if(state.status==='complete'){console.log(JSON.stringify({runId:id,status:'complete',cached:true,...resultOf(state).summary}));return 0;}
    if(state.budget.blocked)throw new SafeError(state.budget.blocked);
    await saveState(directory,state);
    const credentials=await readPrivateConfig(resolve(opts.config));
    const save=async()=>saveState(directory,state);
    const transport=createTransport({credentials,initial:state.budget,saveBudget:async budget=>{state.budget=budget;await save();}});
    console.log(JSON.stringify({runId:id,status:'running',scope:'metadata_candidates_only',authMode:credentials.accessToken?'user_provided_token':'user_executed_client_credentials',steamIdentity:credentials.steamKey?'official_game_only_catalog':'pending_missing_key'}));
    try {
      if(state.metadataDone.length!==state.gameIds.length||!state.referencesVerified||state.streams.some((s,i)=>!s.exhausted&&s.selected.length<state.plan.streams[i].target&&s.pages<state.plan.streams[i].maxPages)&&state.discoveryPages<state.plan.limits.discoveryPages)await transport.authenticate();
      await discover({state,transport,save});
      await collectIdentities({state,transport,save,hasSteamKey:Boolean(credentials.steamKey)});
      finishState(state);await save();
    } catch(error){state.status=state.budget.blocked?'blocked':'partial';state.stopReason=error instanceof SafeError?error.code:'collection_failed';state.finishedAt=new Date().toISOString();await save();}
    const result=resultOf(state);await atomicJson(directory,'candidates.json',result);
    console.log(JSON.stringify({runId:id,status:state.status,stopReason:state.stopReason,...result.summary,output:`.runs/${id}/candidates.json`,resumeAllowed:canResume(state)}));
    return state.status==='complete'?0:1;
  } finally {await release();}
}
if(process.argv[1]&&resolve(process.argv[1])===resolve(import.meta.dirname,'cli.mjs'))main(process.argv.slice(2)).then(code=>{process.exitCode=code;}).catch(error=>{console.error(JSON.stringify({status:'stopped',errorCode:error instanceof SafeError?error.code:'operation_failed'}));process.exitCode=2;});
