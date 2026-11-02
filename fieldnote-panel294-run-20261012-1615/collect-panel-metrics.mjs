import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, lstat, open, rename, unlink, mkdir } from 'node:fs/promises';
import { resolve, dirname, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { ENDPOINTS, FILTERS, VERSION as VALIDATION_VERSION, Stop, normalizeReviews, windowDays, wire } from './validate-reviews.mjs';

export const POLICY = 'steam-dated-counts-1.0';
export const CAPS = Object.freeze({ maxRequests: 1500, maxRetries: 100, retriesPerRequest: 1, minIntervalMs: 2000, requestTimeoutMs: 20000, maxRuntimeMs: 5400000, maxResponseBytes: 131072, maxBytes: 33554432, monthlyRequests: 12000 });
export const QUALIFICATION_CAPS = Object.freeze({...CAPS,maxRequests:1200,maxRuntimeMs:2400000});
const isQualification = job => job.schemaVersion === 'fieldnote-candidate-review-qualification-1.0';
const profile = job => ({caps:isQualification(job)?QUALIFICATION_CAPS:CAPS,metrics:isQualification(job)?['lifetimeReviews']:['lifetimeReviews','reviews7d','reviews30d','players']});
const expectedRows = job => job.panel.appids.length*profile(job).metrics.length;
const uint = value => Number.isSafeInteger(value) && value >= 0;
const check = (condition, code) => { if (!condition) throw new Stop(code); };
export const canonical = value => JSON.stringify(value === null || typeof value !== 'object' ? value : Array.isArray(value) ? value.map(x => JSON.parse(canonical(x))) : Object.fromEntries(Object.keys(value).sort().map(key => [key, JSON.parse(canonical(value[key]))])));
export const sha = value => createHash('sha256').update(value).digest('hex');
const validSha = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const iso = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 19) === value.slice(0, 19);
const errorCode = error => error instanceof Stop ? error.code : 'unexpected_failure';
export function authoritativeStatePath(baseline, requested) {
  check(typeof baseline.authoritativeLedgerPath==='string' && isAbsolute(baseline.authoritativeLedgerPath) && baseline.authoritativeLedgerPath.endsWith(`/fieldnote-source-budget-${baseline.month}.json`) && resolve(requested)===resolve(baseline.authoritativeLedgerPath),'use_authoritative_monthly_state_path');
  return resolve(baseline.authoritativeLedgerPath);
}

export function validateSourceEvidence(validationRaw, expectedSha) {
  check(validSha(expectedSha) && sha(validationRaw) === expectedSha, 'validation_hash_mismatch');
  const validation = JSON.parse(validationRaw);
  check(validation.version === VALIDATION_VERSION && validation.status === 'passed' && iso(validation.finishedAt) && typeof validation.runId === 'string', 'passed_live_validation_required');
  check(canonical(validation.filters) === canonical(FILTERS), 'validation_filters_mismatch');
  const sentinelIds = [730050, 693580, 1368410, 1054550, 730];
  const expectedChecks = new Set(sentinelIds.map(id => `${id}:nested_7_30`));
  for (const id of [730050, 693580, 1368410]) expectedChecks.add(`${id}:known_empty`);
  for (const id of [730050, 693580, 1368410, 730]) expectedChecks.add(`${id}:positive_boundary_exact_enumeration`);
  expectedChecks.add('730:high_volume_7_plus_23_equals_30');
  check(Array.isArray(validation.checks) && validation.checks.length === 13 && validation.checks.every(row => row.status === 'pass'), 'validation_checks_missing');
  for (const row of validation.checks) {
    const key = `${row.appid}:${row.check}`; check(expectedChecks.delete(key), 'validation_checks_missing_or_duplicated');
    if (row.check === 'known_empty') check(row.total === 0 && row.window?.start > 0 && row.window.endExclusive > row.window.start, 'invalid_empty_proof');
    if (row.check === 'positive_boundary_exact_enumeration') check([row.anchorSecond, row.wholeCount, row.leftCount, row.rightCount, row.enumerationPages].every(uint) && row.anchorSecond > 0 && row.rightCount > 0 && row.wholeCount === row.leftCount + row.rightCount && row.enumerationPages >= 3 && row.enumerationPages <= 9, 'invalid_boundary_proof');
  }
  check(expectedChecks.size === 0 && Array.isArray(validation.games) && validation.games.length === 5 && new Set(validation.games.map(row => row.appid)).size === 5, 'invalid_sentinel_coverage');
  for (const name of ['seven', 'thirty']) check(uint(validation.windows?.[name]?.start) && uint(validation.windows?.[name]?.endExclusive) && validation.windows[name].endExclusive - validation.windows[name].start === (name === 'seven' ? 7 : 30) * 86400, 'invalid_validation_window');
  check(validation.windows.seven.endExclusive === validation.windows.thirty.endExclusive, 'invalid_validation_window');
  for (const row of validation.games) {
    check(sentinelIds.includes(row.appid), 'invalid_sentinel_coverage');
    for (const metric of ['lifetime', 'reviews7d', 'reviews30d']) {
      const obs = row.observations?.[metric]; check(obs && uint(obs.value) && obs.sourceReported === true && iso(obs.observedAt) && obs.unit === 'surviving_matching_review_count', 'invalid_sentinel_observation');
      check(canonical(obs.window) === canonical(metric === 'lifetime' ? null : validation.windows[metric === 'reviews7d' ? 'seven' : 'thirty']), 'invalid_sentinel_observation');
    }
    check(row.observations.reviews7d.value <= row.observations.reviews30d.value, 'inconsistent_sentinel_windows');
  }
  const cs2 = validation.games.find(row => row.appid === 730), partition = validation.checks.find(row => row.check === 'high_volume_7_plus_23_equals_30');
  check(uint(partition.preceding23d) && partition.preceding23d > 1 && cs2.observations.reviews7d.value > 1 && partition.preceding23d + cs2.observations.reviews7d.value === cs2.observations.reviews30d.value, 'invalid_high_volume_proof');
  return validation;
}
export function validateInputs(panel, validationRaw, expectedSha) {
  const validation=validateSourceEvidence(validationRaw,expectedSha);
  check(panel.schemaVersion === 'fieldnote-panel-candidates-1.0' && panel.selectedCount === 300 && panel.targetCount === 300 && panel.shortfallCount === 0 && Array.isArray(panel.members) && panel.members.length === 300, 'complete_300_panel_required');
  const { panelId, manifestSha256, ...body } = panel;
  check(sha(canonical(body)) === manifestSha256 && panelId === `panel-${manifestSha256.slice(0, 24)}`, 'panel_hash_mismatch');
  const ids = panel.members.map(row => row.appid);
  check(ids.every(id => uint(id) && id > 0 && id <= 4294967295) && new Set(ids).size === 300 && iso(panel.asOf), 'invalid_panel_membership');
  const counts = {};
  for (const row of panel.members) { check(typeof row.reason === 'string' && row.reason.length > 0, 'panel_reason_missing'); counts[row.allocationGroup] = (counts[row.allocationGroup] ?? 0) + 1; }
  const year = new Date(panel.asOf).getUTCFullYear();
  check(counts.popular_reference === 75 && counts.recent_releases === 100 && counts.low_traction_controls === 25, 'panel_quotas_mismatch');
  for (let y = year - 5; y < year; y++) check(counts[`older_${y}`] === 20, 'panel_older_quotas_mismatch');
  check(Object.keys(counts).length === 8 && ['first_playable', 'igdb_pc'].includes(panel.releaseBasis), 'panel_policy_mismatch');
  return { validation, appids: ids.sort((a, b) => a - b) };
}
export function qualificationIds(discovery) {
  check(discovery.schemaVersion==='fieldnote-population-discovery-1.0'&&Array.isArray(discovery.candidates)&&discovery.candidates.length<=1000,'bounded_discovery_report_required');
  const ids=new Map();
  for(const row of discovery.candidates){
    if(row.rejection||row.identity?.status!=='verified')continue;
    check(uint(row.appid)&&row.appid>0&&row.appid<=4294967295&&row.identity.typeBasis==='derived_game_only_query'&&row.identity.sourceUrl==='https://api.steampowered.com/IStoreService/GetAppList/v1/'&&iso(row.identity.steamFetchedAt)&&typeof row.identity.steamName==='string'&&row.identity.steamName.trim(),'verified_steam_identity_required');
    const identity=canonical([row.igdbId,row.identity.steamName]);
    check(!ids.has(row.appid)||ids.get(row.appid)===identity,'conflicting_duplicate_candidate');ids.set(row.appid,identity);
  }
  check(ids.size>0&&ids.size<=1000,'verified_candidate_count_out_of_range');return [...ids.keys()].sort((a,b)=>a-b);
}
export function newLedger(baseline) {
  check(baseline.schemaVersion === 'fieldnote-source-budget-baseline-1.0' && /^\d{4}-\d\d$/.test(baseline.month) && Array.isArray(baseline.entries) && baseline.entries.length > 0, 'actual_budget_baseline_required');
  check(baseline.entries.every(row => typeof row.id === 'string' && row.id.length > 0 && uint(row.requests)) && new Set(baseline.entries.map(row => row.id)).size === baseline.entries.length, 'invalid_budget_baseline');
  check(baseline.scheduleEnabled === false && baseline.reservedScheduledRequests === 0, 'schedule_policy_requires_review');
  check(typeof baseline.authoritativeLedgerPath === 'string' && isAbsolute(baseline.authoritativeLedgerPath) && baseline.authoritativeLedgerPath.endsWith(`/fieldnote-source-budget-${baseline.month}.json`), 'authoritative_monthly_ledger_required');
  check(uint(baseline.bootstrapAllowance) && baseline.bootstrapAllowance <= 3000, 'explicit_bootstrap_allowance_required');
  const usedRequests = baseline.entries.reduce((n, row) => n + row.requests, 0);
  check(usedRequests <= CAPS.monthlyRequests, 'monthly_budget_exhausted');
  return { schemaVersion: 'fieldnote-source-budget-ledger-1.0', month: baseline.month, baselineSha256: sha(canonical(baseline)), baseline, usedRequests, bootstrapUsed: 0, job: null, completedJobs: [] };
}
export function newJob({ panel, validationRaw, expectedSha, end, kind = 'manual', now = new Date().toISOString() }) {
  const { validation, appids } = validateInputs(panel, validationRaw, expectedSha);
  check(['manual', 'bootstrap'].includes(kind) && iso(now) && end * 1000 <= Date.parse(now), 'invalid_job_configuration');
  check(Date.parse(now) >= Date.parse(validation.finishedAt) && Date.parse(now) >= Date.parse(panel.asOf), 'future_evidence');
  const job = { schemaVersion: 'fieldnote-panel-metrics-1.0', status: 'staged', runId: `panelmetrics-${randomUUID()}`, kind, startedAt: now, sourcePolicyVersion: POLICY,
    validationEvidence: { reportSha256: expectedSha, reportRunId: validation.runId, validatedAt: validation.finishedAt },
    panel: { manifestSha256: panel.manifestSha256, populationVersion: panel.policyVersion, appids },
    windows: { seven: windowDays(end, 7), thirty: windowDays(end, 30) }, filters: FILTERS, observations: [], attempts: [],
    limits: CAPS, counters: { requests: 0, retries: 0, bytes: 0, elapsedMs: 0 }, requestAttempts: {}, pending: null };
  job.configurationSha256 = configurationHash(job); return job;
}
export function newQualificationJob({discovery,discoveryRaw,validationRaw,expectedSha,end,kind='bootstrap',now=new Date().toISOString()}){
  const validation=validateSourceEvidence(validationRaw,expectedSha),appids=qualificationIds(discovery);
  check(canonical(discovery)===canonical(JSON.parse(discoveryRaw))&&iso(now)&&Date.parse(now)>=Date.parse(validation.finishedAt)&&end*1000<=Date.parse(now)&&['manual','bootstrap'].includes(kind),'invalid_qualification_inputs');
  check(discovery.candidates.filter(row=>!row.rejection&&row.identity?.status==='verified').every(row=>Date.parse(row.identity.steamFetchedAt)<=Date.parse(now)),'future_candidate_identity');
  const job={schemaVersion:'fieldnote-candidate-review-qualification-1.0',status:'staged',runId:`panelmetrics-${randomUUID()}`,kind,startedAt:now,sourcePolicyVersion:POLICY,
    validationEvidence:{reportSha256:expectedSha,reportRunId:validation.runId,validatedAt:validation.finishedAt},panel:{manifestSha256:sha(discoveryRaw),populationVersion:'candidate-review-qualification-1.0',appids},windows:{seven:windowDays(end,7),thirty:windowDays(end,30)},filters:FILTERS,observations:[],attempts:[],limits:QUALIFICATION_CAPS,counters:{requests:0,retries:0,bytes:0,elapsedMs:0},requestAttempts:{},pending:null};
  job.configurationSha256=configurationHash(job);return job;
}
function configurationHash(job) { return sha(canonical({ schemaVersion:job.schemaVersion,runId:job.runId,kind:job.kind,startedAt:job.startedAt,sourcePolicyVersion:job.sourcePolicyVersion,validationEvidence:job.validationEvidence,panel:job.panel,windows:job.windows,filters:job.filters,limits:job.limits })); }
function exactKeys(value, keys) { return value !== null && typeof value === 'object' && !Array.isArray(value) && canonical(Object.keys(value).sort()) === canonical([...keys].sort()); }
const observationKeys = ['observationKey','appid','metric','value','missingReason','observedAt','window','sourceUrl','sourceField','unit','methodVersion'];
export function validateJobCheckpoint(job, at = Date.now()) {
  const {caps,metrics}=profile(job);
  check(['fieldnote-panel-metrics-1.0','fieldnote-candidate-review-qualification-1.0'].includes(job?.schemaVersion) && job.sourcePolicyVersion === POLICY && canonical(job.limits) === canonical(caps) && ['manual','bootstrap'].includes(job.kind), 'invalid_checkpoint');
  check(typeof job.runId === 'string' && /^panelmetrics-[a-f0-9-]{36}$/.test(job.runId) && iso(job.startedAt) && Date.parse(job.startedAt) <= at, 'invalid_checkpoint_time');
  check(['staged','running','paused','stopped','completed','completed_with_missing'].includes(job.status),'invalid_checkpoint_status');
  if(['completed','completed_with_missing'].includes(job.status))check(iso(job.finishedAt)&&Date.parse(job.finishedAt)>=Date.parse(job.startedAt)&&Date.parse(job.finishedAt)<=at,'invalid_checkpoint_finish_time');
  check(validSha(job.configurationSha256) && configurationHash(job) === job.configurationSha256 && canonical(job.filters) === canonical(FILTERS), 'frozen_configuration_changed');
  check(exactKeys(job.panel,['manifestSha256','populationVersion','appids']) && validSha(job.panel.manifestSha256) && Array.isArray(job.panel.appids) && (isQualification(job)?job.panel.appids.length>=1&&job.panel.appids.length<=1000:job.panel.appids.length===300) && job.panel.appids.every(id => uint(id) && id > 0 && id <= 4294967295) && new Set(job.panel.appids).size === job.panel.appids.length, 'invalid_checkpoint_panel');
  check(exactKeys(job.validationEvidence,['reportSha256','reportRunId','validatedAt']) && validSha(job.validationEvidence.reportSha256) && iso(job.validationEvidence.validatedAt) && Date.parse(job.validationEvidence.validatedAt) <= Date.parse(job.startedAt), 'invalid_checkpoint_validation');
  for (const [name,days] of [['seven',7],['thirty',30]]) { const window=job.windows?.[name];check(exactKeys(window,['start','endExclusive']) && uint(window.start) && window.start > 0 && uint(window.endExclusive) && window.endExclusive <= 4294967295 && window.endExclusive-window.start === days*86400 && window.endExclusive*1000 <= Date.parse(job.startedAt), 'invalid_checkpoint_windows'); }
  check(job.windows.seven.endExclusive === job.windows.thirty.endExclusive && Array.isArray(job.observations) && job.observations.length <= expectedRows(job), 'invalid_checkpoint_windows');
  const keys=new Set();
  for (const row of job.observations) {
    check(exactKeys(row,observationKeys) && job.panel.appids.includes(row.appid) && metrics.includes(row.metric), 'invalid_checkpoint_observation');
    const key=`${row.appid}:${row.metric}`;check(!keys.has(key),'duplicate_checkpoint_observation');keys.add(key);
    const review=row.metric!=='players',request=panelInput(row.appid,row.metric,job);
    check(row.value===null ? !review && row.missingReason==='players_unavailable_or_invalid_schema' : uint(row.value) && row.missingReason===null, 'invalid_checkpoint_value');
    check(iso(row.observedAt) && Date.parse(row.observedAt) >= Date.parse(job.startedAt) && Date.parse(row.observedAt) <= at, 'invalid_checkpoint_observation_time');
    check(canonical(row.window)===canonical(request.window) && row.sourceUrl===request.endpoint && row.sourceField===(review?'total_matching':'player_count') && row.unit===(review?'surviving_matching_review_count':'current_online_players') && row.methodVersion===POLICY, 'invalid_checkpoint_provenance');
    check(row.observationKey===`pm-${sha(canonical([job.runId,row.appid,row.metric,row.window,FILTERS,POLICY]))}`, 'invalid_checkpoint_observation_key');
  }
  check(Array.isArray(job.attempts) && job.attempts.length <= caps.maxRequests && exactKeys(job.counters,['requests','retries','bytes','elapsedMs']), 'invalid_attempt_checkpoint');
  for(const key of ['requests','retries','bytes','elapsedMs'])check(uint(job.counters[key]),'invalid_checkpoint_counters');
  const requestKeys=new Set(job.panel.appids.flatMap(id=>metrics.map(metric=>`${id}:${metric}`)));
  check(job.requestAttempts && Object.keys(job.requestAttempts).every(key=>requestKeys.has(key)) && Object.values(job.requestAttempts).every(value=>uint(value)&&value>0&&value<=2), 'invalid_request_attempt_checkpoint');
  check(Object.values(job.requestAttempts).reduce((n,v)=>n+v,0)===job.counters.requests && Object.values(job.requestAttempts).reduce((n,v)=>n+Math.max(0,v-1),0)===job.counters.retries, 'attempt_counter_mismatch');
  const sequence=new Set(), counts={},rows=[...job.attempts,...(job.pending?[job.pending]:[])];let bytes=0;
  for(const row of rows){
    check(uint(row.sequence)&&row.sequence>0&&row.sequence<=job.counters.requests&&!sequence.has(row.sequence)&&requestKeys.has(row.requestKey),'invalid_attempt_sequence');sequence.add(row.sequence);counts[row.requestKey]=(counts[row.requestKey]??0)+1;
    if(['reserved_before_dispatch','interrupted_unknown_outcome'].includes(row.status)){check(exactKeys(row,['sequence','requestKey','maxBytes','timeoutMs','status'])&&uint(row.maxBytes)&&row.maxBytes>0&&row.maxBytes<=CAPS.maxResponseBytes&&uint(row.timeoutMs)&&row.timeoutMs>0&&row.timeoutMs<=CAPS.requestTimeoutMs,'invalid_reservation');bytes+=row.maxBytes;}
    else {check(exactKeys(row,['sequence','requestKey','status','errorCode','bytes'])&&['received','failed'].includes(row.status)&&uint(row.bytes)&&(row.status==='received'?row.errorCode===null:typeof row.errorCode==='string'&&/^[a-z_]{1,80}$/.test(row.errorCode)),'invalid_attempt_result');bytes+=row.bytes;}
  }
  check(rows.length===job.counters.requests && canonical(counts)===canonical(job.requestAttempts) && bytes===job.counters.bytes, 'attempt_ledger_mismatch');
  const received=new Set(job.attempts.filter(row=>row.status==='received').map(row=>row.requestKey));
  check(job.observations.every(row=>received.has(`${row.appid}:${row.metric}`)),'observation_without_received_attempt');
  if(job.pending)check(job.pending.status==='reserved_before_dispatch'&&job.pending.sequence===job.counters.requests,'invalid_pending_reservation');
}
export function panelInput(appid, metric, job) {
  check(job.panel.appids.includes(appid), 'panel_appid_not_allowed');
  check(profile(job).metrics.includes(metric),'metric_not_in_job_phase');
  if (metric === 'players') return { endpoint: ENDPOINTS.players, input: { appid }, window: null };
  check(['lifetimeReviews', 'reviews7d', 'reviews30d'].includes(metric), 'invalid_metric');
  const window = metric === 'reviews7d' ? job.windows.seven : metric === 'reviews30d' ? job.windows.thirty : null;
  const input = { appid, ...FILTERS, num_per_page: 1, cursor: '*' };
  if (window) { check(window.start > 0, 'zero_boundary_not_supported'); input.date_range_start = window.start; input.date_range_end = window.endExclusive - 1; }
  return { endpoint: ENDPOINTS.reviews, input, window };
}
export function observation(job, appid, metric, request, raw, observedAt) {
  let value, missingReason = null;
  if (metric === 'players') {
    const source = raw?.response ?? raw;
    value = source?.result === 1 && uint(source.player_count) ? source.player_count : null;
    if (value === null) missingReason = 'players_unavailable_or_invalid_schema';
  } else value = normalizeReviews(raw, request.input).total;
  return { observationKey: `pm-${sha(canonical([job.runId, appid, metric, request.window, FILTERS, POLICY]))}`, appid, metric, value, missingReason, observedAt, window: request.window, sourceUrl: request.endpoint, sourceField: metric === 'players' ? 'player_count' : 'total_matching', unit: metric === 'players' ? 'current_online_players' : 'surviving_matching_review_count', methodVersion: POLICY };
}
function validateLedger(ledger, at = Date.now()) {
  check(ledger?.schemaVersion === 'fieldnote-source-budget-ledger-1.0' && ledger.month === new Date().toISOString().slice(0, 7) && uint(ledger.usedRequests) && ledger.usedRequests <= CAPS.monthlyRequests, 'invalid_or_stale_budget_ledger');
  check(ledger.baseline.scheduleEnabled === false && ledger.baseline.reservedScheduledRequests === 0 && validSha(ledger.baselineSha256) && sha(canonical(ledger.baseline)) === ledger.baselineSha256, 'budget_policy_mismatch');
  const job = ledger.job;
  validateJobCheckpoint(job, at);
  const base = ledger.baseline.entries.reduce((sum, row) => sum + row.requests, 0);
  check(Array.isArray(ledger.completedJobs)&&ledger.completedJobs.length<=1&&ledger.completedJobs.every(row=>row.schemaVersion==='fieldnote-candidate-review-qualification-1.0'&&uint(row.requests)&&row.requests<=QUALIFICATION_CAPS.maxRequests&&['manual','bootstrap'].includes(row.kind)&&validSha(row.bundleSha256)),'invalid_completed_job_ledger');
  check(ledger.usedRequests === base + ledger.completedJobs.reduce((sum,row)=>sum+row.requests,0) + job.counters.requests, 'budget_counter_mismatch');
  check(ledger.bootstrapUsed === ledger.completedJobs.filter(row=>row.kind==='bootstrap').reduce((sum,row)=>sum+row.requests,0)+(job.kind==='bootstrap'?job.counters.requests:0), 'bootstrap_counter_mismatch');
}
export async function runJob(ledger, { call = wire, persist = async () => {}, now = Date.now, wait = sleep, stopAfterGames = 1000 } = {}) {
  validateLedger(ledger, now());
  const job = ledger.job;
  const {caps,metrics}=profile(job);
  check(uint(stopAfterGames) && stopAfterGames > 0 && stopAfterGames <= 1000, 'invalid_batch_size');
  check(!['completed', 'completed_with_missing'].includes(job.status), 'job_already_completed');
  const savedDenial = job.attempts.find(row => ['access_denied', 'throttled', 'redirect_blocked'].includes(row.errorCode));
  if (savedDenial) job.permanentStop = savedDenial.errorCode;
  check(!job.permanentStop, 'source_lane_disabled');
  const invocationStarted = now(), priorElapsed = job.counters.elapsedMs;
  let finishedGames = 0;
  const elapsed = () => priorElapsed + Math.max(0, now() - invocationStarted);
  // A crash reservation remains fully charged. It is never refunded on resume.
  if (job.pending) { job.attempts.push({ ...job.pending, status: 'interrupted_unknown_outcome' }); job.pending = null; }
  job.status = 'running'; delete job.errorCode; await persist(ledger);
  async function request(data) {
    const previousAttempts = job.requestAttempts[data.key] ?? 0;
    check(previousAttempts <= caps.retriesPerRequest, 'logical_request_attempt_budget_exhausted');
    for (let attempt = previousAttempts; attempt <= caps.retriesPerRequest; attempt++) {
      check(ledger.month === new Date(now()).toISOString().slice(0, 7), 'month_rollover_requires_budget_review');
      check(job.counters.requests < caps.maxRequests && ledger.usedRequests < caps.monthlyRequests, 'request_budget_exhausted');
      check(job.counters.bytes < caps.maxBytes, 'byte_budget_exhausted');
      if (attempt > 0) check(job.counters.retries < caps.maxRetries, 'retry_budget_exhausted');
      if (job.kind === 'bootstrap') check(ledger.bootstrapUsed < ledger.baseline.bootstrapAllowance, 'bootstrap_allowance_exhausted');
      const pause = Math.max(0, (job.nextAllowedAt ?? 0) - now());
      check(elapsed() + pause < caps.maxRuntimeMs, 'runtime_budget_exhausted'); if (pause) await wait(pause);
      const timeoutMs = Math.min(caps.requestTimeoutMs, caps.maxRuntimeMs - elapsed());
      const maxBytes = Math.min(caps.maxResponseBytes, caps.maxBytes - job.counters.bytes);
      const reserved = { sequence: job.counters.requests + 1, requestKey: data.key, maxBytes, timeoutMs, status: 'reserved_before_dispatch' };
      job.counters.requests++; ledger.usedRequests++; if (job.kind === 'bootstrap') ledger.bootstrapUsed++;
      job.requestAttempts[data.key] = attempt + 1;
      if (attempt > 0) job.counters.retries++;
      job.counters.bytes += maxBytes; job.counters.elapsedMs = elapsed() + timeoutMs; job.pending = reserved;
      job.nextAllowedAt = now() + timeoutMs + caps.minIntervalMs;
      await persist(ledger);
      // Checkpoint time is part of the runtime. A consumed reservation is safe
      // even if the process stops before dispatch; it is never undercounted.
      const remaining = caps.maxRuntimeMs - elapsed(); check(remaining > 0, 'runtime_budget_exhausted');
      let result; try { result = await call({ endpoint: data.endpoint, input: data.input, timeoutMs: Math.min(timeoutMs, remaining), maxBytes }); } catch { result = { error: 'network_error', bytes: 0 }; }
      check(uint(result.bytes) && result.bytes <= maxBytes + caps.maxResponseBytes, 'invalid_transport_bytes');
      job.counters.bytes += result.bytes - maxBytes; job.counters.elapsedMs = elapsed(); job.pending = null;
      job.nextAllowedAt = now() + caps.minIntervalMs;
      const code = result.error ?? (result.data === undefined ? 'network_error' : null);
      if (['access_denied', 'throttled', 'redirect_blocked'].includes(code)) job.permanentStop = code;
      job.attempts.push({ sequence: reserved.sequence, requestKey: data.key, status: code ? 'failed' : 'received', errorCode: code, bytes: result.bytes });
      await persist(ledger);
      check(job.counters.bytes <= caps.maxBytes, 'byte_budget_exhausted'); check(elapsed() <= caps.maxRuntimeMs, 'runtime_budget_exhausted');
      if (result.data !== undefined) return result.data;
      if (job.permanentStop) throw new Stop(code);
      const retryable = ['network_error', 'request_timeout'].includes(code) || [500, 502, 503, 504].includes(result.status);
      if (!retryable || attempt === caps.retriesPerRequest || job.counters.retries >= caps.maxRetries) throw new Stop(code);
    }
    throw new Stop('request_failed');
  }
  try {
    const seen = new Set(job.observations.map(row => `${row.appid}:${row.metric}`));
    check(seen.size === job.observations.length, 'duplicate_checkpoint_observation');
    for (const appid of job.panel.appids) {
      let needed = false;
      for (const metric of metrics) {
        const key = `${appid}:${metric}`; if (seen.has(key)) continue; needed = true;
        const data = { ...panelInput(appid, metric, job), key };
        const raw = await request(data);
        job.observations.push(observation(job, appid, metric, data, raw, new Date(now()).toISOString())); seen.add(key);
        await persist(ledger);
      }
      if(!isQualification(job)){
      const seven = job.observations.find(row => row.appid === appid && row.metric === 'reviews7d');
      const thirty = job.observations.find(row => row.appid === appid && row.metric === 'reviews30d');
      const lifetime = job.observations.find(row => row.appid === appid && row.metric === 'lifetimeReviews');
      check(seven.value <= thirty.value && thirty.value <= lifetime.value, 'nested_windows_or_lifetime_inconsistent');
      }
      if (needed && ++finishedGames >= stopAfterGames && job.observations.length < expectedRows(job)) { job.status = 'paused'; break; }
    }
    if (job.observations.length === expectedRows(job)) { job.status = job.observations.some(row => row.value === null) ? 'completed_with_missing' : 'completed'; job.finishedAt = new Date(now()).toISOString(); }
  } catch (error) { job.status = 'stopped'; job.errorCode = errorCode(error); }
  job.counters.elapsedMs = Math.max(job.counters.elapsedMs, elapsed()); await persist(ledger); return job;
}
export function completedBundle(job, at = Date.now()) {
  validateJobCheckpoint(job,at);
  check(['completed', 'completed_with_missing'].includes(job.status) && job.observations.length === expectedRows(job) && job.pending === null, 'complete_bundle_required');
  const unique = new Set();
  for (const row of job.observations) {
    check(job.panel.appids.includes(row.appid) && ['lifetimeReviews', 'reviews7d', 'reviews30d', 'players'].includes(row.metric), 'invalid_completed_observation');
    const key = `${row.appid}:${row.metric}`; check(!unique.has(key), 'duplicate_completed_observation'); unique.add(key);
  }
  const bundle={};for(const key of ['schemaVersion','status','runId','kind','startedAt','finishedAt','sourcePolicyVersion','validationEvidence','panel','windows','filters','limits','counters'])bundle[key]=structuredClone(job[key]);
  bundle.observations=job.observations.map(row=>Object.fromEntries(observationKeys.map(key=>[key,structuredClone(row[key])])));
  if(isQualification(job)){bundle.candidateSet=bundle.panel;delete bundle.panel;delete bundle.windows;bundle.metricScope='lifetime_only';}
  return bundle;
}
export function advanceLedgerToPanel(ledger,{panel,qualificationRaw,validationRaw,expectedSha,end,now=new Date().toISOString()}){
  validateLedger(ledger,Date.parse(now));const prior=ledger.job;
  check(isQualification(prior)&&prior.status==='completed'&&ledger.completedJobs.length===0&&prior.exportedBundle?.sha256===sha(qualificationRaw),'completed_qualification_export_required');
  check(canonical(JSON.parse(qualificationRaw))===canonical(completedBundle(prior,Date.parse(now))),'qualification_export_mismatch');
  check(prior.validationEvidence.reportSha256===expectedSha,'validation_changed_between_phases');
  const byId=new Map(prior.observations.map(row=>[row.appid,row]));
  for(const member of panel.members??[]){const obs=byId.get(member.appid);check(obs&&member.eligibility?.lifetimeReviews===obs.value&&member.eligibility?.reviewEvidence?.runId===prior.runId&&member.eligibility.reviewEvidence.collectedAt===obs.observedAt,'panel_requires_exact_qualification_evidence');}
  const job=newJob({panel,validationRaw,expectedSha,end,kind:prior.kind,now});
  // Both phases share one source lane; completing qualification does not reset pacing.
  job.nextAllowedAt=prior.nextAllowedAt;
  check(ledger.usedRequests+1200<=CAPS.monthlyRequests,'insufficient_budget_for_complete_panel');
  if(job.kind==='bootstrap')check(ledger.bootstrapUsed+1200<=ledger.baseline.bootstrapAllowance,'insufficient_bootstrap_allowance_for_panel');
  ledger.completedJobs.push({schemaVersion:prior.schemaVersion,runId:prior.runId,kind:prior.kind,requests:prior.counters.requests,bundleSha256:prior.exportedBundle.sha256});ledger.job=job;return ledger;
}
async function readJson(path, cap = 8388608) {
  const stat = await lstat(path); check(stat.isFile() && !stat.isSymbolicLink() && stat.size <= cap, 'unsafe_input_file');
  const raw = await readFile(path, 'utf8'); return { raw, value: JSON.parse(raw) };
}
async function atomicState(path, value) {
  const raw = JSON.stringify(value); check(Buffer.byteLength(raw) <= 16777216, 'checkpoint_size_limit');
  const tmp = `${path}.${randomUUID()}.tmp`; const file = await open(tmp, 'wx', 0o600);
  try { await file.writeFile(raw + '\n'); await file.sync(); } finally { await file.close(); }
  try { await rename(tmp, path);const directory=await open(dirname(path),'r');try{await directory.sync();}finally{await directory.close();} } catch (error) { await unlink(tmp).catch(() => {}); throw error; }
}
async function main(args) {
  const opts = {};
  const actions=['--run','--resume','--advance-to-panel'];
  for (let i = 0; i < args.length; i++) { const key = args[i]; check([...actions, '--panel','--candidates', '--validation', '--validation-sha', '--budget-baseline', '--state', '--output', '--as-of', '--kind', '--batch-games'].includes(key) && !(key in opts), 'invalid_command'); opts[key] = actions.includes(key) ? true : args[++i]; }
  check(actions.filter(key=>opts[key]).length===1 && Boolean(opts['--panel'])!==Boolean(opts['--candidates']) && ['--validation', '--validation-sha', '--state', '--output'].every(key => typeof opts[key] === 'string' && opts[key].length > 0), 'explicit_command_required');
  if (opts['--resume']) check(!opts['--as-of'] && !opts['--kind'] && !opts['--budget-baseline'], 'resume_must_preserve_frozen_configuration');
  if(opts['--advance-to-panel'])check(opts['--panel']&&!opts['--budget-baseline']&&!opts['--kind'],'panel_transition_preserves_monthly_ledger');
  const [major, minor] = process.versions.node.split('.').map(Number); check(major === 24 && minor >= 5, 'node_24_5_required');
  const statePath = resolve(opts['--state']), output = resolve(opts['--output']); check(statePath !== output, 'output_must_differ_from_state');
  await mkdir(dirname(statePath), { recursive: true }); check(!(await lstat(dirname(statePath))).isSymbolicLink(), 'state_symlink_blocked');
  try { await lstat(output); throw new Stop('output_already_exists'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const inputFile=await readJson(resolve(opts['--panel']??opts['--candidates']),33554432),validation=await readJson(resolve(opts['--validation']));
  validateSourceEvidence(validation.raw,opts['--validation-sha']);
  if(opts['--panel'])validateInputs(inputFile.value,validation.raw,opts['--validation-sha']);else qualificationIds(inputFile.value);
  const budgetBaseline=!opts['--run']?(await readJson(statePath,16777216)).value.baseline:(await readJson(resolve(opts['--budget-baseline'] ?? ''))).value;
  authoritativeStatePath(budgetBaseline,statePath);
  const lockPath = `${statePath}.lock`; const lock = await open(lockPath, 'wx', 0o600).catch(() => { throw new Stop('collector_locked_check_existing_process_before_recovery'); });
  await lock.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), purpose: 'bounded_panel_metrics' })); await lock.sync();
  try {
    let ledger;
    if (!opts['--run']) {
      ledger = (await readJson(statePath, 16777216)).value;
      if(opts['--advance-to-panel']){
        check(typeof ledger.job.exportedBundle?.path==='string','completed_qualification_export_required');
        const qualification=await readJson(ledger.job.exportedBundle.path,16777216);
        const end=opts['--as-of']?Math.floor(Date.parse(opts['--as-of'])/1000):Math.floor(Date.now()/86400000)*86400;
        check(!opts['--as-of']||iso(opts['--as-of']),'invalid_as_of');
        advanceLedgerToPanel(ledger,{panel:inputFile.value,qualificationRaw:qualification.raw,validationRaw:validation.raw,expectedSha:opts['--validation-sha'],end});await atomicState(statePath,ledger);
      }else{
        check(isQualification(ledger.job)===Boolean(opts['--candidates']),'resume_phase_changed');
        const expectedIds=opts['--candidates']?qualificationIds(inputFile.value):inputFile.value.members.map(row=>row.appid).sort((a,b)=>a-b);
        check(ledger.job.panel.manifestSha256===(opts['--candidates']?sha(inputFile.raw):inputFile.value.manifestSha256)&&ledger.job.validationEvidence.reportSha256===opts['--validation-sha'],'resume_inputs_changed');
        check(canonical(ledger.job.panel.appids)===canonical(expectedIds),'resume_panel_ids_changed');
      }
    } else {
      check(typeof opts['--budget-baseline'] === 'string', 'actual_budget_baseline_required');
      try { await lstat(statePath); throw new Stop('state_exists_use_resume'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      ledger = newLedger(budgetBaseline);
      const end = opts['--as-of'] ? Math.floor(Date.parse(opts['--as-of']) / 1000) : Math.floor(Date.now() / 86400000) * 86400;
      check(!opts['--as-of'] || iso(opts['--as-of']), 'invalid_as_of');
      const common={validationRaw:validation.raw,expectedSha:opts['--validation-sha'],end,kind:opts['--kind']??(opts['--candidates']?'bootstrap':'manual')};
      ledger.job=opts['--candidates']?newQualificationJob({...common,discovery:inputFile.value,discoveryRaw:inputFile.raw}):newJob({...common,panel:inputFile.value});
      check(CAPS.monthlyRequests-ledger.usedRequests>=expectedRows(ledger.job),'insufficient_budget_for_complete_phase');
      if(ledger.job.kind==='bootstrap')check(ledger.baseline.bootstrapAllowance>=expectedRows(ledger.job),'insufficient_bootstrap_allowance_for_phase');
    }
    const job = ['completed', 'completed_with_missing'].includes(ledger.job.status) ? ledger.job : await runJob(ledger, { persist: value => atomicState(statePath, value), stopAfterGames: opts['--batch-games'] ? Number(opts['--batch-games']) : 1000 });
    if (['completed', 'completed_with_missing'].includes(job.status)){
      const raw=JSON.stringify(completedBundle(job),null,2)+'\n',file=await open(output,'wx',0o600);try{await file.writeFile(raw);await file.sync();}finally{await file.close();}
      const directory=await open(dirname(output),'r');try{await directory.sync();}finally{await directory.close();}
      job.exportedBundle={path:output,sha256:sha(raw)};await atomicState(statePath,ledger);
    }
    console.log(JSON.stringify({ status: job.status, errorCode: job.errorCode ?? null, runId: job.runId, requests: job.counters.requests, monthlyUsed: ledger.usedRequests, observations: job.observations.length, output: ['completed', 'completed_with_missing'].includes(job.status) ? output : null, state: statePath }));
    if (!['completed', 'completed_with_missing'].includes(job.status)) process.exitCode = 1;
  } finally { await lock.close(); await unlink(lockPath); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main(process.argv.slice(2)).catch(error => { console.error(JSON.stringify({ status: 'stopped', errorCode: errorCode(error) })); process.exitCode = 2; });
