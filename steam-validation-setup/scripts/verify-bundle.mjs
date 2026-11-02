import {readFile,lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';

export const ROOT=path.resolve(import.meta.dirname,'..');
export const FILES=Object.freeze(['README.md','SOURCE-NOTES.md','data/frozen-targets.json','scripts/probe-core.mjs','scripts/run-steam-validation.sh','scripts/launch.mjs','scripts/steam-validation.mjs','scripts/verify-bundle.mjs','tests/probe.test.mjs']);
export async function verifiedBundle(){
  const mpath=path.join(ROOT,'bundle-manifest.json');
  const stat=await lstat(mpath);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>32768)throw Error('invalid_bundle_manifest');
  const raw=await readFile(mpath),manifest=JSON.parse(raw);
  if(manifest.schema_version!=='1.0'||manifest.files?.length!==FILES.length)throw Error('invalid_bundle_manifest');
  for(const file of FILES){
    const e=manifest.files.find(x=>x.path===file);if(!e||!/^[a-f0-9]{64}$/.test(e.sha256))throw Error('invalid_bundle_manifest');
    // Every directory and file is checked; no symbolic links are followed.
    let at=ROOT;
    for(const piece of file.split('/')){at=path.join(at,piece);const s=await lstat(at);if(s.isSymbolicLink())throw Error('bundle_symlink_refused');}
    const s=await lstat(at);if(!s.isFile()||s.size!==e.bytes||s.size>262144)throw Error('bundle_file_size_mismatch');
    const b=await readFile(at);if(createHash('sha256').update(b).digest('hex')!==e.sha256)throw Error('bundle_hash_mismatch');
  }
  return {fingerprint:createHash('sha256').update(raw).digest('hex'),manifest};
}
