import { open, mkdir, lstat, readFile, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import { hash, SafeError } from './domain.mjs';
const MAX_STATE_BYTES=32*1024*1024;
export async function ensurePrivateDirectory(directory) {
  await mkdir(directory,{recursive:true,mode:0o700});const stat=await lstat(directory);
  if(!stat.isDirectory()||stat.isSymbolicLink()||(process.getuid&&stat.uid!==process.getuid())||(stat.mode&0o077))throw new SafeError('output_directory_not_private');
}
export async function readPrivateConfig(path) {
  const file=await open(path,'r');
  try {
    const [linkStat,stat]=await Promise.all([lstat(path),file.stat()]);
    if(linkStat.isSymbolicLink()||!stat.isFile()||linkStat.ino!==stat.ino||stat.size>65536||(stat.mode&0o077)||(process.getuid&&stat.uid!==process.getuid()))throw new SafeError('private_config_permissions_required');
    const values={};
    for(const line of (await file.readFile('utf8')).split(/\r?\n/)){
      const match=/^\s*(?:export\s+)?(IGDB_CLIENT_ID|IGDB_CLIENT_SECRET|IGDB_ACCESS_TOKEN|STEAM_API_KEY)\s*=\s*(.*?)\s*$/.exec(line);
      if(!match)continue;
      if(Object.hasOwn(values,match[1]))throw new SafeError('duplicate_config_key');
      let value=match[2];
      if(value.startsWith('"')||value.startsWith("'")){if(value.length<2||value.at(-1)!==value[0])throw new SafeError('invalid_config_assignment');value=value.slice(1,-1);} else value=value.replace(/\s+#.*$/,'').trim();
      if(value && !/^[a-zA-Z0-9_.-]{8,4096}$/.test(value))throw new SafeError('invalid_config_assignment');
      values[match[1]]=value;
    }
    const result={clientId:values.IGDB_CLIENT_ID,clientSecret:values.IGDB_CLIENT_SECRET,accessToken:values.IGDB_ACCESS_TOKEN,steamKey:values.STEAM_API_KEY};
    if(!result.clientId||(!result.accessToken&&!result.clientSecret))throw new SafeError('igdb_credentials_required');
    if(result.steamKey&&!/^[a-fA-F0-9]{32}$/.test(result.steamKey))throw new SafeError('invalid_steam_key');
    return result;
  } finally {await file.close();}
}
export async function atomicJson(directory,name,value) {
  if(!/^[a-z][a-z0-9.-]*\.json$/.test(name))throw new SafeError('invalid_output_name');
  await ensurePrivateDirectory(directory);
  const path=join(directory,name),temp=join(directory,`.${name}.${randomUUID()}.tmp`),body=JSON.stringify(value)+'\n';
  if(Buffer.byteLength(body)>MAX_STATE_BYTES)throw new SafeError('output_byte_limit');
  try {const old=await lstat(path);if(!old.isFile()||old.isSymbolicLink())throw new SafeError('unsafe_output_file');}catch(error){if(error.code!=='ENOENT')throw error;}
  const handle=await open(temp,'wx',0o600);
  try {await handle.writeFile(body);await handle.sync();} finally {await handle.close();}
  await rename(temp,path);
  const dir=await open(directory,'r');try{await dir.sync();}finally{await dir.close();}
}
export async function saveState(directory,state) {await atomicJson(directory,'checkpoint.json',{sha256:hash(state),state});}
export async function loadState(directory) {
  const path=join(directory,'checkpoint.json'),stat=await lstat(path);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>MAX_STATE_BYTES)throw new SafeError('invalid_checkpoint_file');
  let envelope;try{envelope=JSON.parse(await readFile(path,'utf8'));}catch{throw new SafeError('invalid_checkpoint_json');}
  if(!envelope?.state||envelope.sha256!==hash(envelope.state))throw new SafeError('checkpoint_integrity_failure');
  return envelope.state;
}
export async function acquireLease(root) {
  await ensurePrivateDirectory(root);
  const path=join(root,'active.lock'),identity={pid:process.pid,host:hostname(),nonce:randomUUID()};
  for(let attempt=0;attempt<2;attempt++){
    try {const file=await open(path,'wx',0o600);try{await file.writeFile(JSON.stringify(identity));await file.sync();}finally{await file.close();}return async()=>{let current;try{current=JSON.parse(await readFile(path,'utf8'));}catch{return;}if(current.nonce===identity.nonce)await unlink(path);};}
    catch(error){if(error.code!=='EEXIST')throw error;const stat=await lstat(path);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>4096)throw new SafeError('unsafe_lease');let prior;try{prior=JSON.parse(await readFile(path,'utf8'));}catch{throw new SafeError('lease_review_required');}if(prior.host!==hostname()||!Number.isSafeInteger(prior.pid)||prior.pid<1)throw new SafeError('lease_review_required');try{process.kill(prior.pid,0);throw new SafeError('collector_already_running');}catch(check){if(check.code!=='ESRCH')throw new SafeError('collector_already_running');}throw new SafeError('stale_lease_review_required');}
  }
  throw new SafeError('collector_already_running');
}
