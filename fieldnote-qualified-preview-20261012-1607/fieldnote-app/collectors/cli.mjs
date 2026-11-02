import { resolve } from 'node:path';
import { appRoot,openDatabase,migrate } from '../scripts/database.mjs';
import { createTransport,CollectionError,IGDB_LIMITS,STEAM_LIMITS,STEAM_CATALOG_LIMITS } from './transport.mjs';
import { discoverIgdb,refreshIgdb } from './igdb.mjs';
import { collectSteamCatalog } from './steam-catalog.mjs';
import { collectSteamMetrics } from './steam.mjs';
import { beginJob,updateJob,saveObservation,saveAttempt,importCandidates } from './persistence.mjs';
import { readPrivateConfig,dataDirectory,saveCheckpoint,loadCheckpoint } from './io.mjs';
import { acquireCollectionLease,releaseCollectionLease } from './lease.mjs';
import { TAXONOMY_VERSION } from './taxonomy.mjs';

const validId=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(value);
const safeError=error=>error instanceof CollectionError?error.code:'collection_failed';
function options(args) {
  const result={command:args[0]};
  for(let i=1;i<args.length;i++) {
    if(args[i]==='--run')result.run=true;
    else if(['--config','--resume'].includes(args[i])&&args[i+1])result[args[i++].slice(2)]=args[i];
    else throw new CollectionError('invalid_command');
  }
  if(!['catalog','catalog-refresh','steam'].includes(result.command)||!result.run||(result.resume&&!validId(result.resume))||(result.command==='steam'&&result.config))throw new CollectionError('explicit_bounded_command_required');
  return result;
}
export async function main(args) {
  const opts=options(args),directory=await dataDirectory(appRoot),db=openDatabase(process.env.FIELDNOTE_DB);
  migrate(db);
  if(!db.raw.prepare('SELECT COUNT(*) AS n FROM games').get().n){db.close();throw new CollectionError('seed_required');}
  let lease;
  try {
    lease=await acquireCollectionLease(db,{owner:opts.command.startsWith('catalog')?'manual_catalog':'manual_metrics',maxRuntimeMs:opts.command.startsWith('catalog')?IGDB_LIMITS.maxRuntimeMs+STEAM_CATALOG_LIMITS.maxRuntimeMs:STEAM_LIMITS.maxRuntimeMs});
    if(!lease){console.log(JSON.stringify({status:'busy',errorCode:'collector_already_running'}));return 1;}
    if(opts.command.startsWith('catalog')) {
      if(opts.command==='catalog'&&!opts.resume&&db.raw.prepare('SELECT COUNT(*) AS n FROM games').get().n>=360)throw new CollectionError('catalog_capacity_reached_use_refresh');
      if(!opts.config)throw new CollectionError('private_config_path_required');
      const credentials=await readPrivateConfig(resolve(opts.config));
      const job=beginJob(db,{source:'igdb',kind:opts.command==='catalog-refresh'?'catalog_refresh':'catalog',limits:IGDB_LIMITS,jobId:opts.resume,resume:!!opts.resume});
      const state=opts.resume?await loadCheckpoint(directory,`${job.job_id}.json`):{discovery:null,steam:null,steamCounters:{},target:Math.max(1,360-db.raw.prepare('SELECT COUNT(*) AS n FROM games').get().n),excludedAppids:db.raw.prepare('SELECT DISTINCT appid FROM collection_rejections WHERE appid IS NOT NULL ORDER BY appid LIMIT 5001').all().map(row=>row.appid)};
      if((state.excludedAppids?.length??0)>5000)throw new CollectionError('quarantine_review_required');
      const igdb=createTransport({source:'igdb',credentials:{clientId:credentials.clientId,clientSecret:credentials.clientSecret},limits:job.limits,counters:job.counters,onBudget:async counters=>updateJob(db,job.job_id,{counters,checkpoint:{pageIndex:state.discovery?.pagesCompleted??0}})});
      const save=async()=>{await saveCheckpoint(directory,`${job.job_id}.json`,state);updateJob(db,job.job_id,{counters:igdb.counters,checkpoint:{pageIndex:state.discovery?.pagesCompleted??0,targetCount:state.discovery?.candidates?.length??0,discoveryComplete:state.discoveryComplete===true}});};
      console.log(JSON.stringify({jobId:job.job_id,phase:opts.command,limits:{igdb:IGDB_LIMITS,steamCatalog:STEAM_CATALOG_LIMITS},target:state.target,excludedQuarantines:state.excludedAppids?.length??0,note:'Bounded user-run collection. Credentials are never printed or saved.'}));
      try {
        if(!state.discoveryComplete) {
          await igdb.authenticate();
          const existingGames=db.raw.prepare('SELECT g.appid,g.genre,c.igdb_id FROM games g JOIN catalog_games c USING(appid) ORDER BY g.position').all().map(row=>({appid:row.appid,genre:row.genre,catalog:{sourceId:row.igdb_id}}));
          const collect=opts.command==='catalog-refresh'?refreshIgdb:discoverIgdb;
          const result=await collect({transport:igdb,target:state.target,checkpoint:state.discovery,existingGames,excludedAppids:state.excludedAppids??[],onCheckpoint:async checkpoint=>{state.discovery=checkpoint;igdb.counters.pages=checkpoint.pagesCompleted;await save();}});
          state.discovery=result.checkpoint;state.discoveryComplete=result.status==='complete';await save();
          if(!state.discoveryComplete)throw new CollectionError(result.errors?.[0]?.code??'discovery_incomplete');
        }
        const steam=createTransport({source:'steam_catalog',credentials:{steamKey:credentials.steamKey},counters:state.steamCounters,onBudget:async counters=>{state.steamCounters=counters;await saveCheckpoint(directory,`${job.job_id}.json`,state);if(state.steamJobId)updateJob(db,state.steamJobId,{counters,checkpoint:{cursor:state.steam?.cursor??0,pageIndex:state.steam?.pageIndex??0}});}});
        let steamEvidence=state.steamEvidence;
        if(!steamEvidence) {
          const steamJob=beginJob(db,{source:'steam_catalog',kind:'identity',limits:STEAM_CATALOG_LIMITS,jobId:state.steamJobId,resume:!!state.steamJobId});state.steamJobId=steamJob.job_id;await save();
          try {
            steamEvidence=await collectSteamCatalog({transport:steam,checkpoint:state.steam??{},onCheckpoint:async checkpoint=>{state.steam=checkpoint;state.steamCounters={...steam.counters};await save();updateJob(db,steamJob.job_id,{counters:steam.counters,checkpoint:{cursor:checkpoint.cursor,pageIndex:checkpoint.pageIndex}});}});
            state.steamEvidence=steamEvidence;state.steam=null;await save();updateJob(db,steamJob.job_id,{status:'complete',counters:steam.counters,checkpoint:{pageIndex:steamEvidence.pageCount}});
          }catch(error){state.steamCounters={...steam.counters};updateJob(db,steamJob.job_id,{status:'interrupted',counters:steam.counters,errorCode:safeError(error)});throw error;}
        }
        const imported=await importCandidates(db,{jobId:job.job_id,candidates:state.discovery.candidates,steamEvidence,maxGames:360});
        updateJob(db,job.job_id,{status:'complete',counters:{...igdb.counters,accepted:imported.admitted+imported.updated,rejected:imported.rejected},checkpoint:{discoveryComplete:true,targetCount:state.discovery.candidates.length}});
        await saveCheckpoint(directory,`${job.job_id}.json`,{jobId:job.job_id,status:'complete',completedAt:new Date().toISOString(),taxonomyVersion:TAXONOMY_VERSION,...imported,igdbIds:state.discovery.candidates.map(item=>item.catalog.sourceId),steamAppids:state.discovery.candidates.map(item=>item.appid),retention:'Completed provider payloads discarded; normalized current metadata and observation history remain in SQLite.'});
        console.log(JSON.stringify({jobId:job.job_id,status:'complete',...imported,verifiedTargetMet:imported.totalGames>=300,steamMetrics:'Run separately: node scripts/collect.mjs steam --run'}));
      }catch(error){await saveCheckpoint(directory,`${job.job_id}.json`,state);updateJob(db,job.job_id,{status:'interrupted',counters:igdb.counters,checkpoint:{pageIndex:state.discovery?.pagesCompleted??0,targetCount:state.discovery?.candidates?.length??0},errorCode:safeError(error)});console.log(JSON.stringify({jobId:job.job_id,status:'interrupted',errorCode:safeError(error),resumable:true}));return 1;}
    } else {
      const job=beginJob(db,{source:'steam_api',kind:'metrics',limits:STEAM_LIMITS,jobId:opts.resume,resume:!!opts.resume});
      const appids=job.checkpoint.appids??db.raw.prepare('SELECT appid FROM games ORDER BY position LIMIT 500').all().map(row=>row.appid);
      const transport=createTransport({source:'steam_api',limits:job.limits,counters:job.counters,onBudget:async counters=>updateJob(db,job.job_id,{counters,checkpoint:checkpoint()})});
      const completed=new Set(db.raw.prepare("SELECT item_key FROM collection_attempts WHERE job_id=? AND status='accepted'").all(job.job_id).map(row=>row.item_key));
      const checkpoint=()=>({appids,completedItems:db.raw.prepare("SELECT COUNT(*) AS n FROM collection_attempts WHERE job_id=? AND status='accepted'").get(job.job_id).n,targetCount:appids.length});
      updateJob(db,job.job_id,{counters:transport.counters,checkpoint:checkpoint()});
      console.log(JSON.stringify({jobId:job.job_id,phase:'steam_metrics',targetCount:appids.length,limits:STEAM_LIMITS}));
      try {
        const result=await collectSteamMetrics({appids,transport,completed,onObservation:value=>saveObservation(db,job.job_id,value),onAttempt:attempt=>{saveAttempt(db,job.job_id,attempt);updateJob(db,job.job_id,{counters:transport.counters,checkpoint:checkpoint()});}});
        updateJob(db,job.job_id,{status:result.failed?'partial':'complete',counters:{...transport.counters,...result},checkpoint:checkpoint()});console.log(JSON.stringify({jobId:job.job_id,status:result.failed?'partial':'complete',...result}));
      }catch(error){updateJob(db,job.job_id,{status:'interrupted',counters:transport.counters,checkpoint:checkpoint(),errorCode:safeError(error)});console.log(JSON.stringify({jobId:job.job_id,status:'interrupted',errorCode:safeError(error),resumable:true}));return 1;}
    }
    return 0;
  } finally {if(lease)releaseCollectionLease(db,lease,{});db.close();}
}
if(process.argv[1]&&resolve(process.argv[1])===resolve(import.meta.dirname,'cli.mjs'))main(process.argv.slice(2)).then(code=>{process.exitCode=code;}).catch(error=>{console.error(JSON.stringify({status:'stopped',errorCode:safeError(error)}));process.exitCode=2;});
