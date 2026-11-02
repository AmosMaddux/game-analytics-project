import { randomUUID } from 'node:crypto';
import { open,lstat,readFile,link,unlink } from 'node:fs/promises';
import { dirname,resolve } from 'node:path';
import { sha,completedBundle } from './collect-review-campaign.mjs';
import { encoded,campaignBundle,joinCampaign,validateCampaignState } from './qualification-campaign.mjs';
import { Stop } from './validate-reviews.mjs';
const check=(ok,code)=>{if(!ok)throw new Stop(code);};
async function present(path){try{const s=await lstat(path);check(s.isFile()&&!s.isSymbolicLink()&&s.size<=33554432,'unsafe_output_file');return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
export async function writeIdentical(path,raw,{write=async(file,value)=>file.writeFile(value)}={}){
 if(await present(path)){check(await readFile(path,'utf8')===raw,'output_collision');return;}
 // A final pathname never contains a partial write. A crash can leave only an
 // unreferenced temp file, or a complete atomically published immutable output.
 const temporary=`${path}.${randomUUID()}.tmp`;
 try{
  const f=await open(temporary,'wx',0o600);try{await write(f,raw);await f.sync();}finally{await f.close();}
  try{await link(temporary,path);}catch(error){if(error.code!=='EEXIST')throw error;check(await present(path)&&await readFile(path,'utf8')===raw,'output_collision');}
  const d=await open(dirname(path),'r');try{await d.sync();}finally{await d.close();}
 }finally{await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}
export function expectedExports(ledger,discoveryRaw,paths,at=Date.now()){
 validateCampaignState(ledger,at);check(['completed','completed_with_missing'].includes(ledger.job.status),'completed_export_required');
 const draft=structuredClone(ledger),raw=encoded(completedBundle(draft.job,at));
 const exports=[{role:'batch',path:resolve(paths.output),raw,sha256:sha(raw)}];
 draft.job.exportedBundle={path:exports[0].path,sha256:exports[0].sha256};
 if(draft.job.schemaVersion==='fieldnote-candidate-review-addendum-1.0'){
  check(paths.campaignOutput&&paths.joinedOutput,'three_addendum_output_paths_required');
  const campaignRaw=encoded(campaignBundle(draft,at));exports.push({role:'campaign',path:resolve(paths.campaignOutput),raw:campaignRaw,sha256:sha(campaignRaw)});
  const joinedRaw=encoded(joinCampaign(discoveryRaw,campaignRaw,draft,at));exports.push({role:'joined',path:resolve(paths.joinedOutput),raw:joinedRaw,sha256:sha(joinedRaw)});
 }
 check(new Set(exports.map(x=>x.path)).size===exports.length,'distinct_output_paths_required');
 const receipts={batch:ledger.job.exportedBundle,campaign:ledger.qualificationCampaign.exportedCampaign,joined:ledger.qualificationCampaign.exportedJoined};
 for(const row of exports){const receipt=receipts[row.role];if(receipt)check(receipt.sha256===row.sha256&&receipt.path===row.path,'saved_export_receipt_mismatch');}
 return exports;
}
export async function preflightExports(ledger,discoveryRaw,paths,at=Date.now()){
 const completed=['completed','completed_with_missing'].includes(ledger.job.status);
 const exports=completed?expectedExports(ledger,discoveryRaw,paths,at):[paths.output,paths.campaignOutput,paths.joinedOutput].filter(Boolean).map(path=>({path:resolve(path),raw:null}));
 check(new Set(exports.map(x=>x.path)).size===exports.length,'distinct_output_paths_required');
 for(const row of exports){if(await present(row.path))check(completed&&await readFile(row.path,'utf8')===row.raw,'output_collision');}
 return exports;
}
export async function finishExports(ledger,discoveryRaw,paths,persist,at=Date.now()){
 const outputs=await preflightExports(ledger,discoveryRaw,paths,at);
 for(const item of outputs){
  await writeIdentical(item.path,item.raw);
  const receipt={path:item.path,sha256:item.sha256};
  if(item.role==='batch')ledger.job.exportedBundle=receipt;
  else if(item.role==='campaign')ledger.qualificationCampaign.exportedCampaign=receipt;
  else ledger.qualificationCampaign.exportedJoined=receipt;
  await persist(ledger);
 }
 return outputs.map(({role,path,sha256})=>({role,path,sha256}));
}
