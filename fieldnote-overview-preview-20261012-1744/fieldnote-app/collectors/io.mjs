import { constants } from 'node:fs';
import { open, mkdir, lstat, writeFile, rename, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { CollectionError } from './transport.mjs';
export function parsePrivateConfig(text) {
  if(typeof text!=='string'||Buffer.byteLength(text)>16384)throw new CollectionError('invalid_private_config');
  const values={};
  for(const line of text.replace(/^\uFEFF/,'').split(/\r?\n/)) {
    const match=/^\s*(?:export\s+)?(IGDB_CLIENT_ID|IGDB_CLIENT_SECRET|STEAM_API_KEY)\s*=(.*)$/.exec(line);
    if(!match)continue;
    const [,key,raw]=match;if(Object.hasOwn(values,key))throw new CollectionError('invalid_private_config');
    const value=raw.trim(),quoted=/^(['"])([^\r\n]*)\1\s*(?:#.*)?$/.exec(value);
    const result=quoted?quoted[2]:value.replace(/\s+#.*$/,'').trim();
    if(!/^[\x21-\x7e]{1,4096}$/.test(result)||(!quoted&&/^['"]/.test(value)))throw new CollectionError('invalid_private_config');
    values[key]=result;
  }
  if(!values.IGDB_CLIENT_ID||!values.IGDB_CLIENT_SECRET||!/^[a-fA-F0-9]{32}$/.test(values.STEAM_API_KEY??''))throw new CollectionError('required_private_config_missing');
  return {clientId:values.IGDB_CLIENT_ID,clientSecret:values.IGDB_CLIENT_SECRET,steamKey:values.STEAM_API_KEY};
}
/** Only invoked inside the personally run catalog command, never build/server. */
export async function readPrivateConfig(filename) {
  let file;try {
    file=await open(resolve(filename),constants.O_RDONLY|constants.O_NOFOLLOW);
    const stat=await file.stat();if(!stat.isFile()||stat.size>16384||(stat.mode&0o077)!==0)throw new CollectionError('private_config_permissions_required');
    const bytes=Buffer.alloc(16385);try{const {bytesRead}=await file.read(bytes,0,bytes.length,0);return parsePrivateConfig(bytes.toString('utf8',0,bytesRead));}finally{bytes.fill(0);}
  }catch(error){throw error instanceof CollectionError?error:new CollectionError('private_config_unreadable');}finally{await file?.close();}
}
export async function dataDirectory(root) {
  const directory=resolve(root,'.data');await mkdir(directory,{recursive:true});
  const stat=await lstat(directory);if(stat.isSymbolicLink()||!stat.isDirectory())throw new CollectionError('data_directory_blocked');return directory;
}
export async function saveCheckpoint(directory,name,value) {
  if(!/^[a-zA-Z0-9_-]+\.json$/.test(name))throw new CollectionError('invalid_checkpoint_name');
  const target=resolve(directory,name),temporary=resolve(directory,`checkpoint-${randomUUID()}.tmp`);
  try{if((await lstat(target)).isSymbolicLink())throw new CollectionError('checkpoint_symlink_blocked');}catch(error){if(error.code!=='ENOENT')throw error;}
  await writeFile(temporary,JSON.stringify(value)+'\n',{mode:0o600,flag:'wx'});await rename(temporary,target);return target;
}
export async function loadCheckpoint(directory,name) {
  if(!/^[a-zA-Z0-9_-]+\.json$/.test(name))throw new CollectionError('invalid_checkpoint_name');
  const target=resolve(directory,name),stat=await lstat(target);if(stat.isSymbolicLink()||!stat.isFile()||stat.size>67108864)throw new CollectionError('checkpoint_file_blocked');
  return JSON.parse(await readFile(target,'utf8'));
}
