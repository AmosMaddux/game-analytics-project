import { readFile, lstat, mkdir, open } from 'node:fs/promises';
import { resolve, join, basename } from 'node:path';
import { VERSION, SafeError, hash, clone, validTime } from './domain.mjs';
import { validateState, applyCachedIdentities, resultOf } from './runner.mjs';
export const MATERIALIZATION_VERSION='fieldnote-cached-identity-materialization-1.0';
const MAX_BYTES=32*1024*1024;
async function readExpectedJson(path,expected) {
  if(!/^[a-f0-9]{64}$/.test(expected??'')||!path.endsWith('.json'))throw new SafeError('explicit_source_json_hash_required');
  const stat=await lstat(path);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>MAX_BYTES)throw new SafeError('invalid_source_file');
  const bytes=await readFile(path);if(bytes.length>MAX_BYTES||hash(bytes.toString('utf8'))!==expected)throw new SafeError('source_file_hash_mismatch');
  try{return JSON.parse(bytes.toString('utf8'));}catch{throw new SafeError('invalid_source_json');}
}
function originalResultMatches(bundle,state) {
  const projected=resultOf(state);
  // Additive v1.0.1 output fields were absent from the frozen v1.0 result.
  if(!Object.hasOwn(bundle,'finishedAt'))delete projected.finishedAt;
  for(const field of ['parserVersion','lastShape'])if(!Object.hasOwn(bundle.steamIdentity??{},field))delete projected.steamIdentity[field];
  return JSON.stringify(bundle)===JSON.stringify(projected);
}
async function writeNew(path,body){const file=await open(path,'wx',0o600);try{await file.writeFile(body);await file.sync();}finally{await file.close();}}
/** Offline only: no config/environment credentials, transport, auth, API, or database operations. */
export async function materialize({candidatePath,checkpointPath,outputDirectory,expectCandidateSha256,expectCheckpointSha256,now=()=>new Date().toISOString()}) {
  const bundle=await readExpectedJson(candidatePath,expectCandidateSha256),envelope=await readExpectedJson(checkpointPath,expectCheckpointSha256);
  if(!envelope?.state||envelope.sha256!==hash(envelope.state))throw new SafeError('checkpoint_integrity_failure');
  const state=clone(envelope.state);validateState(state);
  if(bundle.schemaVersion!==VERSION||!originalResultMatches(bundle,state))throw new SafeError('candidate_checkpoint_mismatch');
  const originalEvidence={plan:clone(state.plan),planHash:state.planHash,budget:clone(state.budget),gameIds:clone(state.gameIds),metadataDone:clone(state.metadataDone),streams:clone(state.streams),steam:clone(state.steam)};
  const preserved=hash(originalEvidence);
  applyCachedIdentities(state);validateState(state);
  if(preserved!==hash({plan:state.plan,planHash:state.planHash,budget:state.budget,gameIds:state.gameIds,metadataDone:state.metadataDone,streams:state.streams,steam:state.steam}))throw new SafeError('source_evidence_preservation_failure');
  const materializedAt=now();if(!validTime(materializedAt))throw new SafeError('invalid_materialization_time');
  const result=resultOf(state);
  result.materialization={version:MATERIALIZATION_VERSION,method:'apply_saved_exact_appid_and_title_evidence_only',materializedAt,sourceCandidatesSha256:expectCandidateSha256,sourceCheckpointSha256:expectCheckpointSha256,sourceStateSha256:envelope.sha256,sourcePlanHash:state.planHash,networkRequests:0,credentialReads:0,databaseWrites:0};
  const body=JSON.stringify(result)+'\n';if(Buffer.byteLength(body)>MAX_BYTES)throw new SafeError('output_byte_limit');
  const filename='cached-identity-candidates.json',outputSha=hash(body);
  const manifest={schemaVersion:MATERIALIZATION_VERSION,materializedAt,sources:{candidates:{filename:basename(candidatePath),sha256:expectCandidateSha256},checkpoint:{filename:basename(checkpointPath),sha256:expectCheckpointSha256,stateSha256:envelope.sha256}},output:{filename,sha256:outputSha,bytes:Buffer.byteLength(body)},sourceStatus:state.status,sourceStopReason:state.stopReason,sourceFinishedAt:state.finishedAt,sourcePlanHash:state.planHash,sourceEvidenceSha256:preserved,countersPreserved:state.budget,steamCoveragePreserved:{cachedMatches:state.steam.matches.length,acceptedPages:state.steam.pages,checkedThroughAppid:state.steam.cursor,fullCatalogComplete:state.steam.complete},summary:result.summary,networkRequests:0,credentialReads:0,databaseWrites:0,originalFilesModified:false};
  await mkdir(outputDirectory,{recursive:false,mode:0o700});
  await writeNew(join(outputDirectory,filename),body);
  await writeNew(join(outputDirectory,'materialization-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  return manifest;
}
export async function main(args){const opts={};for(let i=0;i<args.length;i++){if(!['--candidates','--checkpoint','--out-dir','--expect-candidates-sha256','--expect-checkpoint-sha256'].includes(args[i])||!args[i+1]||Object.hasOwn(opts,args[i]))throw new SafeError('invalid_offline_command');opts[args[i++]]=args[i];}if(Object.keys(opts).length!==5)throw new SafeError('all_offline_source_paths_and_hashes_required');const result=await materialize({candidatePath:resolve(opts['--candidates']),checkpointPath:resolve(opts['--checkpoint']),outputDirectory:resolve(opts['--out-dir']),expectCandidateSha256:opts['--expect-candidates-sha256'],expectCheckpointSha256:opts['--expect-checkpoint-sha256']});console.log(JSON.stringify({status:'offline_materialization_complete',...result}));}
if(process.argv[1]&&resolve(process.argv[1])===resolve(import.meta.dirname,'materialize-cached-identities.mjs'))main(process.argv.slice(2)).catch(error=>{console.error(JSON.stringify({status:'stopped',errorCode:error instanceof SafeError?error.code:'offline_materialization_failed'}));process.exitCode=2;});
