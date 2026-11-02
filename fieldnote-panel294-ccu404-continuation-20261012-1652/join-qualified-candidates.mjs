import { readFile, writeFile, lstat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { canonical, sha, qualificationIds, validateSourceEvidence, POLICY } from './collect-panel-metrics.mjs';
import { ENDPOINTS, FILTERS, Stop } from './validate-reviews.mjs';
const check=(condition,code)=>{if(!condition)throw new Stop(code);};
const instant=value=>typeof value==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)&&Number.isFinite(Date.parse(value));
const scope='All-language surviving matching reviews; purchase_type=0; off-topic filtered; lifetime total.';
const contract=Object.freeze({metric:'lifetimeReviews',unit:'reviews',sourceField:'total_matching',population:'Steam-purchase matching reviews (purchase_type=0)',languages:'all',offTopicFiltered:true});
export function joinQualified(discoveryRaw,qualificationRaw,validationRaw,expectedSha){
  const source=JSON.parse(discoveryRaw),qualification=JSON.parse(qualificationRaw),validation=validateSourceEvidence(validationRaw,expectedSha),ids=qualificationIds(source);
  check(qualification.schemaVersion==='fieldnote-candidate-review-qualification-1.0'&&qualification.status==='completed'&&qualification.metricScope==='lifetime_only'&&qualification.sourcePolicyVersion===POLICY,'completed_qualification_required');
  check(qualification.candidateSet?.manifestSha256===sha(discoveryRaw)&&canonical(qualification.candidateSet.appids)===canonical(ids),'qualification_candidate_hash_mismatch');
  check(qualification.validationEvidence?.reportSha256===expectedSha&&qualification.validationEvidence.reportRunId===validation.runId&&qualification.validationEvidence.validatedAt===validation.finishedAt&&canonical(qualification.filters)===canonical(FILTERS),'qualification_source_contract_mismatch');
  check(typeof qualification.runId==='string'&&/^panelmetrics-[a-f0-9-]{36}$/.test(qualification.runId)&&instant(qualification.finishedAt)&&Array.isArray(qualification.observations)&&qualification.observations.length===ids.length,'invalid_qualification_bundle');
  const byId=new Map();
  for(const row of qualification.observations){
    check(ids.includes(row.appid)&&!byId.has(row.appid)&&row.metric==='lifetimeReviews'&&Number.isSafeInteger(row.value)&&row.value>=0&&row.missingReason===null&&row.window===null&&row.sourceUrl===ENDPOINTS.reviews&&row.sourceField==='total_matching'&&row.unit==='surviving_matching_review_count'&&row.methodVersion===POLICY,'invalid_qualification_observation');
    check(instant(row.observedAt)&&Date.parse(row.observedAt)>=Date.parse(validation.finishedAt)&&Date.parse(row.observedAt)<=Date.parse(qualification.finishedAt),'invalid_qualification_time');byId.set(row.appid,row);
  }
  check(Array.isArray(source.panelCandidates)&&source.panelCandidates.length===ids.length&&new Set(source.panelCandidates.map(row=>row.appid)).size===ids.length&&source.panelCandidates.every(row=>byId.has(row.appid)),'candidate_adapter_coverage_mismatch');
  const panelCandidates=source.panelCandidates.map(candidate=>{const row=byId.get(candidate.appid);return {...candidate,lifetimeReviews:row.value,reviewEvidence:{runId:qualification.runId,methodVersion:POLICY,scope,unit:'reviews',contract,collectedAt:row.observedAt,sourceUrl:ENDPOINTS.reviews,sourceBundleSha256:sha(qualificationRaw)}};});
  return {...source,panelCandidates,reviewQualification:{schemaVersion:qualification.schemaVersion,runId:qualification.runId,bundleSha256:sha(qualificationRaw),validationSha256:expectedSha,finishedAt:qualification.finishedAt,candidateCount:ids.length,scope,contract},notes:[...(source.notes??[]).filter(note=>!note.startsWith('Identity-only output')), 'Lifetime Steam-purchase review counts were joined from one complete bounded qualification run. Panel membership is not selected by this join.']};
}
async function main(args){
  const allowed=['--candidates','--qualification','--validation','--validation-sha','--output'],opts={};
  for(let i=0;i<args.length;i+=2){check(allowed.includes(args[i])&&!opts[args[i]]&&typeof args[i+1]==='string','invalid_command');opts[args[i]]=args[i+1];}
  check(allowed.every(key=>opts[key]),'all_inputs_required');
  async function load(key){const path=resolve(opts[key]),stat=await lstat(path);check(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=33554432,'unsafe_input_file');return readFile(path,'utf8');}
  const result=joinQualified(await load('--candidates'),await load('--qualification'),await load('--validation'),opts['--validation-sha']);
  const output=resolve(opts['--output']);await writeFile(output,JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify({status:'joined_offline',candidateCount:result.panelCandidates.length,output}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main(process.argv.slice(2)).catch(error=>{console.error(JSON.stringify({status:'stopped',errorCode:error instanceof Stop?error.code:'unexpected_failure'}));process.exitCode=2;});
