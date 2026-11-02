import { randomUUID } from 'node:crypto';
import { canonical, sha, qualificationIds, validateSourceEvidence, validateLedger, validateJobCheckpoint, completedBundle, newQualificationJob, newJob, configurationHash, ADDENDUM_SCHEMA, ADDENDUM_CAPS, POLICY, CAPS } from './collect-review-campaign.mjs';
import { FILTERS, ENDPOINTS, Stop } from './validate-reviews.mjs';
const check=(condition,code)=>{if(!condition)throw new Stop(code);};
const uint=x=>Number.isSafeInteger(x)&&x>=0;
const iso=x=>typeof x==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(x)&&Number.isFinite(Date.parse(x));
const eq=(a,b)=>canonical(a)===canonical(b);
export const encoded=value=>JSON.stringify(value,null,2)+'\n';
export const TEMPORAL_SCOPE='multi_batch_observations_not_instantaneous_snapshot';
export const SCOPE='All-language surviving matching reviews; purchase_type=0; off-topic filtered; lifetime total.';
export const CONTRACT=Object.freeze({metric:'lifetimeReviews',unit:'reviews',sourceField:'total_matching',population:'Steam-purchase matching reviews (purchase_type=0)',languages:'all',offTopicFiltered:true});
export function checkpoint(raw){const obj=JSON.parse(raw);check(obj&&obj.sha256===sha(JSON.stringify(obj.state)),'source_checkpoint_hash_mismatch');return obj.state;}
function reportState(reportRaw,checkpointRaw){
 const report=JSON.parse(reportRaw),state=checkpoint(checkpointRaw);
 check(report.schemaVersion==='fieldnote-population-discovery-1.0'&&state.version===report.schemaVersion&&['complete','partial'].includes(state.status)&&!state.budget?.pendingReservation&&!state.budget?.blocked&&iso(state.finishedAt),'stopped_source_report_required');
 check(report.planHash===state.planHash&&report.asOf===state.plan.asOf&&report.status===state.status&&report.stopReason===state.stopReason&&eq(report.counters,state.budget)&&eq(report.candidates,state.candidates)&&(!report.finishedAt||report.finishedAt===state.finishedAt),'source_report_checkpoint_mismatch');
 return {report,state};
}
const cleanCandidate=row=>{const {identity,rejection,...metadata}=row;return metadata;};
function keyed(rows,key){check(Array.isArray(rows),'source_rows_missing');const result=new Map();for(const row of rows){check(!result.has(row[key]),'source_duplicate_identity');result.set(row[key],row);}return result;}
function verifiedCache(candidate,cache){const match=cache.get(candidate.appid);return match&&match.name===candidate.identity?.steamName&&match.fetchedAt===candidate.identity?.steamFetchedAt;}
export function planAddendum({ledgerRaw,expectedLedgerSha,previousCandidatesRaw,previousSourceReportRaw,previousSourceCheckpointRaw,candidatesRaw,sourceReportRaw,sourceCheckpointRaw,validationRaw,expectedSha,now=new Date().toISOString()}){
 check(sha(ledgerRaw)===expectedLedgerSha,'original_completed_ledger_hash_mismatch');
 const ledger=JSON.parse(ledgerRaw),prior=ledger.job,oldCandidates=JSON.parse(previousCandidatesRaw),candidateSource=JSON.parse(candidatesRaw);
 validateLedger(ledger,Date.parse(now));validateSourceEvidence(validationRaw,expectedSha);
 check(iso(now)&&prior.schemaVersion==='fieldnote-candidate-review-qualification-1.0'&&prior.kind==='bootstrap'&&prior.status==='completed'&&prior.panel.appids.length===625&&ledger.completedJobs.length===0&&!ledger.qualificationCampaign&&!(ledger.sourceReconciliations??[]).length,'single_original_625_qualification_required');
 check(prior.validationEvidence.reportSha256===expectedSha&&prior.panel.manifestSha256===sha(previousCandidatesRaw)&&prior.exportedBundle?.sha256===sha(encoded(completedBundle(prior,Date.parse(now)))),'original_qualification_receipt_mismatch');
 check(eq(qualificationIds(oldCandidates),prior.panel.appids),'original_candidate_membership_mismatch');
 const old=reportState(previousSourceReportRaw,previousSourceCheckpointRaw),next=reportState(sourceReportRaw,sourceCheckpointRaw);
 check(oldCandidates.materialization?.sourceCandidatesSha256===sha(previousSourceReportRaw)&&oldCandidates.materialization.sourceCheckpointSha256===sha(previousSourceCheckpointRaw)&&oldCandidates.materialization.sourceStateSha256===sha(JSON.stringify(old.state))&&oldCandidates.materialization.networkRequests===0,'previous_materialization_chain_mismatch');
 // This reconstruction accepts only the actual owner-resumed report itself, not another derived output.
 check(candidatesRaw===sourceReportRaw,'new_candidates_must_be_exact_source_report');
 check(old.report.planHash===next.report.planHash&&old.report.asOf===next.report.asOf&&eq(old.state.plan,next.state.plan)&&eq(old.state.gameIds,next.state.gameIds)&&eq(old.state.metadataDone,next.state.metadataDone)&&old.state.discoveryPages===next.state.discoveryPages&&old.state.budget.igdbPages===next.state.budget.igdbPages&&old.state.budget.igdbBytes===next.state.budget.igdbBytes,'discovery_population_changed');
 check(Date.parse(next.state.finishedAt)>=Date.parse(old.state.finishedAt)&&Date.parse(next.state.finishedAt)<=Date.parse(now)&&next.state.finishedAt.slice(0,7)===ledger.month,'source_time_outside_campaign_month');
 const before=keyed(oldCandidates.candidates,'igdbId'),after=keyed(candidateSource.candidates,'igdbId'),rawBefore=keyed(old.report.candidates,'igdbId');
 check(before.size===1000&&after.size===before.size&&rawBefore.size===before.size,'discovery_candidate_population_changed');
 const oldCache=keyed(old.state.steam.matches,'appid'),newCache=keyed(next.state.steam.matches,'appid');
 for(const [id,row] of oldCache)check(eq(newCache.get(id),row),'saved_steam_identity_changed');
 for(const [id,row] of before){check(eq(cleanCandidate(row),cleanCandidate(after.get(id)))&&eq(cleanCandidate(row),cleanCandidate(rawBefore.get(id))),'candidate_metadata_changed');}
 const oldIds=qualificationIds(oldCandidates),newIds=qualificationIds(candidateSource),oldSet=new Set(oldIds),newSet=new Set(newIds);
 const pending=before.values();const pendingIds=new Set([...pending].filter(row=>!row.rejection&&row.identity?.status==='pending_steam_verification').map(row=>row.appid));
 check(pendingIds.size===184&&oldIds.every(id=>newSet.has(id)),'original_pending_or_verified_pool_changed');
 for(const row of before.values())if(oldSet.has(row.appid)){const current=after.get(row.igdbId);check(eq(row.identity,current.identity)&&verifiedCache(row,oldCache)&&verifiedCache(current,newCache),'original_verified_identity_changed');}
 const addedIds=newIds.filter(id=>!oldSet.has(id));check(addedIds.length>0&&addedIds.length<=184&&addedIds.every(id=>pendingIds.has(id)&&!oldCache.has(id)),'addendum_must_only_add_original_pending_ids');
 for(const row of after.values())if(newSet.has(row.appid))check(verifiedCache(row,newCache),'verified_identity_not_in_saved_source');
 check(uint(next.state.steam.pages)&&next.state.steam.pages>=old.state.steam.pages&&next.state.steam.pages<=12&&next.state.steam.cursor>=old.state.steam.cursor,'nonmonotonic_steam_catalog_evidence');
 const sourceDelta=next.state.budget.requests-old.state.budget.requests;
 check(uint(sourceDelta)&&sourceDelta>0&&sourceDelta<=36&&next.state.budget.requests<=180&&next.state.budget.steamPages>=old.state.budget.steamPages&&next.state.budget.retries>=old.state.budget.retries,'invalid_source_request_delta');
 const receipt=ledger.baseline.entries.filter(row=>row.reportSha256===sha(previousSourceReportRaw)&&row.checkpointSha256===sha(previousSourceCheckpointRaw));
 check(receipt.length===1&&receipt[0].requests===old.state.budget.requests,'original_source_budget_receipt_missing');
 check(ledger.usedRequests+sourceDelta+addedIds.length<=CAPS.monthlyRequests&&ledger.bootstrapUsed+sourceDelta+addedIds.length<=ledger.baseline.bootstrapAllowance,'insufficient_shared_budget_for_addendum');
 const sourceReconciliation={kind:'bootstrap',requests:sourceDelta,previousReportSha256:sha(previousSourceReportRaw),reportSha256:sha(sourceReportRaw),previousCheckpointSha256:sha(previousSourceCheckpointRaw),checkpointSha256:sha(sourceCheckpointRaw),finishedAt:next.state.finishedAt};
 return {schemaVersion:'fieldnote-qualification-addendum-plan-1.0',originalLedgerSha256:expectedLedgerSha,previousCandidateSha256:sha(previousCandidatesRaw),candidateSha256:sha(candidatesRaw),validationSha256:expectedSha,originalRunId:prior.runId,originalBundleSha256:prior.exportedBundle.sha256,addedIds,addedIdsSha256:sha(JSON.stringify(addedIds)),sourceVerifiedCount:newIds.length,sourceReconciliation,baselineSha256:ledger.baselineSha256,monthlyUsedAfterSource:ledger.usedRequests+sourceDelta,bootstrapUsedAfterSource:ledger.bootstrapUsed+sourceDelta,nominalRequests:addedIds.length,maximumAttempts:Math.min(184,addedIds.length+10),limits:ADDENDUM_CAPS};
}
export function extendQualification(ledger,plan,{approvedPlanSha,discovery,discoveryRaw,validationRaw,expectedSha,now=new Date().toISOString()}){
 check(approvedPlanSha===sha(canonical(plan)),'explicit_plan_approval_hash_required');
 check(sha(encoded(ledger))===plan.originalLedgerSha256||sha(JSON.stringify(ledger)+'\n')===plan.originalLedgerSha256||sha(JSON.stringify(ledger))===plan.originalLedgerSha256,'original_completed_ledger_hash_mismatch');
 const prior=structuredClone(ledger.job);validateLedger(ledger,Date.parse(now));
 check(!ledger.qualificationCampaign&&!ledger.sourceReconciliations?.length&&ledger.completedJobs.length===0&&prior.status==='completed'&&prior.runId===plan.originalRunId&&prior.exportedBundle?.sha256===plan.originalBundleSha256,'addendum_already_used_or_wrong_parent');
 check(sha(discoveryRaw)===plan.candidateSha256&&expectedSha===plan.validationSha256&&ledger.baselineSha256===plan.baselineSha256&&plan.sourceReconciliation.requests+ledger.usedRequests===plan.monthlyUsedAfterSource&&plan.sourceReconciliation.requests+ledger.bootstrapUsed===plan.bootstrapUsedAfterSource,'plan_inputs_changed');
 const job=newQualificationJob({discovery,discoveryRaw,validationRaw,expectedSha,end:Math.floor(Date.parse(now)/1000),kind:'bootstrap',now});
 check(plan.addedIds.length>0&&plan.addedIds.length<=184&&eq(qualificationIds(discovery).filter(id=>!prior.panel.appids.includes(id)),plan.addedIds),'plan_added_ids_changed');
 job.schemaVersion=ADDENDUM_SCHEMA;job.limits=ADDENDUM_CAPS;job.panel={manifestSha256:plan.candidateSha256,populationVersion:'fieldnote-population-discovery-1.0',appids:plan.addedIds,membershipMode:'new_verified_subset_of_source',sourceVerifiedCount:plan.sourceVerifiedCount,parentQualificationRunId:prior.runId,parentBundleSha256:plan.originalBundleSha256};job.configurationSha256=configurationHash(job);job.nextAllowedAt=Math.max(prior.nextAllowedAt??0,Date.parse(plan.sourceReconciliation.finishedAt)+2000);
 ledger.completedJobs=[receiptOf(prior)];ledger.sourceReconciliations=[structuredClone(plan.sourceReconciliation)];ledger.usedRequests=plan.monthlyUsedAfterSource;ledger.bootstrapUsed=plan.bootstrapUsedAfterSource;ledger.job=job;
 ledger.qualificationCampaign={schemaVersion:'fieldnote-qualification-campaign-state-1.0',campaignId:`qualification-campaign-${randomUUID()}`,temporalScope:TEMPORAL_SCOPE,approvedPlanSha,plan:structuredClone(plan),originalJob:prior,addendumRunId:job.runId};validateCampaignState(ledger,Date.parse(now));return ledger;
}
const receiptOf=job=>({schemaVersion:job.schemaVersion,runId:job.runId,kind:job.kind,requests:job.counters.requests,bundleSha256:job.exportedBundle.sha256});
export function validateCampaignState(ledger,at=Date.now()){
 validateLedger(ledger,at);const c=ledger.qualificationCampaign;check(c?.schemaVersion==='fieldnote-qualification-campaign-state-1.0'&&/^qualification-campaign-[a-f0-9-]{36}$/.test(c.campaignId)&&c.temporalScope===TEMPORAL_SCOPE&&c.approvedPlanSha===sha(canonical(c.plan)),'invalid_campaign_state');
 const plan=c.plan,original=c.originalJob;validateJobCheckpoint(original,at);
 check(original.schemaVersion==='fieldnote-candidate-review-qualification-1.0'&&original.status==='completed'&&original.panel.appids.length===625&&original.runId===plan.originalRunId&&original.panel.manifestSha256===plan.previousCandidateSha256&&original.exportedBundle?.sha256===plan.originalBundleSha256&&sha(encoded(completedBundle(original,at)))===plan.originalBundleSha256,'original_campaign_archive_changed');
 check(eq(ledger.sourceReconciliations,[plan.sourceReconciliation])&&ledger.baselineSha256===plan.baselineSha256&&ledger.baselineSha256===sha(canonical(ledger.baseline)),'campaign_budget_receipt_changed');
 const addendum=ledger.job.schemaVersion===ADDENDUM_SCHEMA?ledger.job:c.addendumJob;check(addendum,'addendum_archive_missing');validateJobCheckpoint(addendum,at);
 check(addendum.schemaVersion===ADDENDUM_SCHEMA&&addendum.runId===c.addendumRunId&&addendum.panel.manifestSha256===plan.candidateSha256&&eq(addendum.panel.appids,plan.addedIds)&&plan.addedIdsSha256===sha(JSON.stringify(plan.addedIds))&&plan.addedIds.every(id=>!original.panel.appids.includes(id))&&addendum.panel.parentQualificationRunId===original.runId&&addendum.panel.parentBundleSha256===plan.originalBundleSha256&&addendum.panel.sourceVerifiedCount===625+plan.addedIds.length&&addendum.panel.membershipMode==='new_verified_subset_of_source'&&addendum.validationEvidence.reportSha256===plan.validationSha256&&original.validationEvidence.reportSha256===plan.validationSha256,'campaign_batch_scope_changed');
 const expected=[receiptOf(original)];if(c.addendumJob){check(addendum.exportedBundle?.sha256===sha(encoded(completedBundle(addendum,at))),'addendum_archive_receipt_changed');expected.push(receiptOf(addendum));}
 check(eq(ledger.completedJobs,expected),'campaign_completed_receipts_changed');
 return {campaign:c,original,addendum};
}
export function campaignBundle(ledger,at=Date.now()){
 const {campaign:c,original,addendum}=validateCampaignState(ledger,at);const oldBundle=completedBundle(original,at),newBundle=completedBundle(addendum,at),newHash=sha(encoded(newBundle));
 check(addendum.status==='completed'&&addendum.exportedBundle?.sha256===newHash,'completed_addendum_export_required');
 const batches=[oldBundle,newBundle].map((bundle,i)=>({runId:bundle.runId,schemaVersion:bundle.schemaVersion,candidateSha256:bundle.candidateSet.manifestSha256,bundleSha256:i?newHash:c.plan.originalBundleSha256,startedAt:bundle.startedAt,finishedAt:bundle.finishedAt,observations:bundle.observations.length,requests:bundle.counters.requests}));
 const observations=[oldBundle,newBundle].flatMap((bundle,i)=>bundle.observations.map(row=>({...row,observationRunId:bundle.runId,sourceBundleSha256:batches[i].bundleSha256})));
 check(new Set(observations.map(row=>row.appid)).size===observations.length,'duplicate_campaign_identity');
 return {schemaVersion:'fieldnote-candidate-review-campaign-1.0',status:'completed',runId:c.campaignId,metricScope:'lifetime_only',temporalScope:TEMPORAL_SCOPE,startedAt:original.startedAt,finishedAt:addendum.finishedAt,sourcePolicyVersion:POLICY,validationEvidence:structuredClone(addendum.validationEvidence),filters:structuredClone(FILTERS),candidateSet:{manifestSha256:c.plan.candidateSha256,populationVersion:'fieldnote-population-discovery-1.0',appids:observations.map(row=>row.appid).sort((a,b)=>a-b)},batches,observations};
}
export function joinCampaign(discoveryRaw,campaignRaw,ledger,at=Date.now()){
 const source=JSON.parse(discoveryRaw),bundle=JSON.parse(campaignRaw);check(eq(bundle,campaignBundle(ledger,at)),'campaign_export_mismatch');
 check(bundle.candidateSet.manifestSha256===sha(discoveryRaw)&&eq(qualificationIds(source),bundle.candidateSet.appids),'campaign_source_population_mismatch');
 const byId=new Map(bundle.observations.map(row=>[row.appid,row]));check(Array.isArray(source.panelCandidates)&&source.panelCandidates.length===byId.size&&new Set(source.panelCandidates.map(row=>row.appid)).size===byId.size&&source.panelCandidates.every(row=>byId.has(row.appid)),'candidate_adapter_coverage_mismatch');
 const panelCandidates=source.panelCandidates.map(candidate=>{const row=byId.get(candidate.appid);return {...candidate,lifetimeReviews:row.value,reviewEvidence:{runId:bundle.runId,observationRunId:row.observationRunId,methodVersion:POLICY,scope:SCOPE,unit:'reviews',contract:CONTRACT,collectedAt:row.observedAt,sourceUrl:ENDPOINTS.reviews,sourceBundleSha256:row.sourceBundleSha256,campaignBundleSha256:sha(campaignRaw),temporalScope:TEMPORAL_SCOPE}};});
 return {...source,panelCandidates,reviewQualification:{schemaVersion:bundle.schemaVersion,runId:bundle.runId,bundleSha256:sha(campaignRaw),validationSha256:bundle.validationEvidence.reportSha256,startedAt:bundle.startedAt,finishedAt:bundle.finishedAt,candidateCount:byId.size,temporalScope:TEMPORAL_SCOPE,batches:bundle.batches,scope:SCOPE,contract:CONTRACT},notes:[...(source.notes??[]).filter(note=>!note.startsWith('Identity-only output')),'Lifetime Steam-purchase review counts were joined from two separately timestamped batches in one bounded qualification campaign. This is not an instantaneous snapshot. Panel membership is not selected by this join.']};
}
export function advanceCampaignToPanel(ledger,{panel,campaignRaw,validationRaw,expectedSha,end,now=new Date().toISOString()}){
 const {campaign:c,addendum}=validateCampaignState(ledger,Date.parse(now));check(ledger.job.schemaVersion===ADDENDUM_SCHEMA&&!c.addendumJob&&c.exportedCampaign?.sha256===sha(campaignRaw),'single_completed_campaign_transition_required');
 const expected=campaignBundle(ledger,Date.parse(now));check(eq(expected,JSON.parse(campaignRaw))&&expected.validationEvidence.reportSha256===expectedSha,'campaign_export_mismatch');
 const observations=new Map(expected.observations.map(row=>[row.appid,row]));
 for(const member of panel.members??[]){const row=observations.get(member.appid),e=member.eligibility?.reviewEvidence;check(row&&member.eligibility.lifetimeReviews===row.value&&e?.runId===c.campaignId&&e.observationRunId===row.observationRunId&&e.collectedAt===row.observedAt&&e.sourceBundleSha256===row.sourceBundleSha256&&e.campaignBundleSha256===sha(campaignRaw)&&e.temporalScope===TEMPORAL_SCOPE&&e.methodVersion===POLICY&&eq(e.contract,CONTRACT),'panel_requires_exact_campaign_receipts');}
 const job=newJob({panel,validationRaw,expectedSha,end,kind:'bootstrap',now});check(ledger.usedRequests+job.panel.appids.length*4<=CAPS.monthlyRequests&&ledger.bootstrapUsed+job.panel.appids.length*4<=ledger.baseline.bootstrapAllowance,'insufficient_shared_budget_for_panel');
 job.nextAllowedAt=addendum.nextAllowedAt;c.addendumJob=structuredClone(addendum);ledger.completedJobs.push(receiptOf(addendum));ledger.job=job;validateCampaignState(ledger,Date.parse(now));return ledger;
}
