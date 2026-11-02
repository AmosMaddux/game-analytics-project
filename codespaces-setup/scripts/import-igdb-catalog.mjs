import {request as httpsRequest} from 'node:https';
import {readFile, mkdir, open, lstat} from 'node:fs/promises';
import {createHash, randomUUID} from 'node:crypto';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {setTimeout as sleep} from 'node:timers/promises';
import {readLocalConfig, createRouteAgent, classifyTokenError, TOKEN_ENDPOINT} from './check-igdb-connection.mjs';

// Importing this module performs no filesystem or network I/O. Real requests
// happen only through the separate, personally invoked --run launcher.
export const ENDPOINTS = Object.freeze({token: TOKEN_ENDPOINT, sources: 'https://api.igdb.com/v4/external_game_sources', crosswalk: 'https://api.igdb.com/v4/external_games', games: 'https://api.igdb.com/v4/games'});
export const LIMITS = Object.freeze({requests: 80, timeout_ms: 20_000, interval_ms: 1000, token_bytes: 16_384, catalog_bytes: 2_097_152, page_size: 100, source_pages: 3, mapping_pages_per_batch: 3, batch_size: 12, candidate_games: 144, cohort_size: 36});
export const COHORT_SHA256 = '1670b52a56c804070acc00e33f151d0b77df62559a3a6195e7862ef563b9ac6d';
const ROOT = path.resolve(import.meta.dirname, '..');
const safeCredential = x => typeof x === 'string' && x.length > 0 && x.length <= 4096 && /^[\x21-\x7e]+$/.test(x);
const id = x => Number.isSafeInteger(x) && x > 0 ? x : null;
const refId = x => id(x?.id) ?? id(x);
const str = (x, max = 512) => typeof x === 'string' && x.trim() && x.length <= max && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(x) ? x : null;
const arr = x => Array.isArray(x) ? x : [];
const bool = x => typeof x === 'boolean' ? x : null;
const unix = x => Number.isSafeInteger(x) && x >= 0 && x <= 253402300799 ? x : null;
const iso = x => unix(x) === null ? null : new Date(x * 1000).toISOString();
const named = x => x && typeof x === 'object' && id(x.id) ? {id: x.id, name: str(x.name)} : null;
// Migrated enum tables retain old values, including 0 for Main Game/date precision.
const typed = (x, key) => x && typeof x === 'object' && Number.isSafeInteger(x.id) && x.id >= 0 ? {id: x.id, [key]: str(x[key])} : null;
const platform = x => named(x) ? {...named(x), abbreviation: str(x.abbreviation)} : null;
const sortedUnique = values => [...new Set(values)].sort((a,b) => a-b);
const chunks = (values, size = LIMITS.batch_size) => Array.from({length: Math.ceil(values.length / size)}, (_, i) => values.slice(i * size, (i + 1) * size));
export const normalizeTitle = x => (str(x) ?? '').replace(/[™®]/g, '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const mainGame = x => str(x?.type)?.toLowerCase().replace(/[ _-]+/g, ' ') === 'main game';
export function safeUrl(value, host) {
  if (!str(value, 2048)) return null;
  try { const u = new URL(value); return ['https:', 'http:'].includes(u.protocol) && !u.username && !u.password && (!host || u.hostname === host || u.hostname === `www.${host}`) ? u.href : null; } catch { return null; }
}
function steamUrlMatches(url, appid) {
  if (!url) return true; // Mapping UID remains the required evidence; absent URL is recorded.
  const safe = safeUrl(url, 'store.steampowered.com');
  return Boolean(safe && new URL(safe).hostname === 'store.steampowered.com' && new URL(safe).pathname.match(/^\/app\/(\d+)(?:\/|$)/)?.[1] === String(appid));
}
export const GAME_FIELDS = [
  'id','name','summary','url','updated_at','first_release_date','parent_game','version_parent','version_title','game_type.id','game_type.type',
  'platforms.id','platforms.name','platforms.abbreviation',
  'release_dates.id','release_dates.date','release_dates.human','release_dates.y','release_dates.m','release_dates.d','release_dates.updated_at',
  'release_dates.platform.id','release_dates.platform.name','release_dates.platform.abbreviation','release_dates.date_format.id','release_dates.date_format.format','release_dates.release_region.id','release_dates.release_region.region','release_dates.status.id','release_dates.status.name',
  'involved_companies.id','involved_companies.developer','involved_companies.publisher','involved_companies.porting','involved_companies.supporting','involved_companies.updated_at','involved_companies.company.id','involved_companies.company.name',
  'genres.id','genres.name','themes.id','themes.name','keywords.id','keywords.name','websites.id','websites.url','websites.type.id','websites.type.type','websites.trusted',
  'external_games.id','external_games.uid','external_games.game','external_games.external_game_source.id','external_games.external_game_source.name','external_games.url','external_games.platform','external_games.updated_at',
].join(',');
const CROSSWALK_FIELDS = 'id,uid,game,external_game_source.id,external_game_source.name,url,platform,updated_at';
const FIELD_PATHS = Object.freeze({name:'games.name',summary:'games.summary',platforms:'games.platforms',release_dates:'games.release_dates',developers:'games.involved_companies[developer=true].company',publishers:'games.involved_companies[publisher=true].company',companies:'games.involved_companies',genres:'games.genres',themes:'games.themes',keywords:'games.keywords',websites:'games.websites',game_type:'games.game_type',parent_game_id:'games.parent_game',version_parent_id:'games.version_parent',first_release_date:'games.first_release_date',external_ids:'games.external_games'});

// Fixed endpoints, verified TLS, no redirects/retries, an end-to-end deadline,
// and separate token/catalog byte caps. All provider error text is discarded.
export function createCatalogTransport({request = httpsRequest, agentFactory = () => createRouteAgent(), timeoutMs = LIMITS.timeout_ms} = {}) {
  return async (endpoint, headers, body) => {
    if (!Object.values(ENDPOINTS).includes(endpoint)) throw new Error('Endpoint not allowed');
    if (typeof body !== 'string' || Buffer.byteLength(body) > 16_384) throw new Error('Request too large');
    return new Promise(resolve => {
      let settled = false, req, response, agent, tokenHttpError;
      const finish = result => { if (settled) return; settled = true; clearTimeout(timer); agent?.destroy(); resolve(result); };
      const stop = result => { finish(result); response?.destroy(); req?.destroy(); };
      const timer = setTimeout(() => stop(tokenHttpError ?? {kind:'network_error'}), timeoutMs);
      try {
        agent = agentFactory();
        req = request(endpoint, {method:'POST', headers:{...headers, Accept:'application/json', 'Content-Length':Buffer.byteLength(body)}, agent, rejectUnauthorized:true, maxHeaderSize:8192}, res => {
          response = res;
          const status = res.statusCode;
          if (!Number.isInteger(status) || status < 200 || status >= 300) {
            if (endpoint !== ENDPOINTS.token || !Number.isInteger(status) || status < 400 || status > 599) { stop({kind:'http_error', httpStatus:Number.isInteger(status) ? status : null}); return; }
            tokenHttpError = {kind:'http_error', httpStatus:status, reason:'unknown'};
          }
          if (!/^application\/json(?:\s*;|$)/i.test(res.headers['content-type'] || '')) { stop(tokenHttpError ?? {kind:'invalid_response'}); return; }
          const cap = endpoint === ENDPOINTS.token ? LIMITS.token_bytes : LIMITS.catalog_bytes;
          let bytes = 0; const pieces = [];
          res.on('data', part => { bytes += part.length; if (bytes > cap) stop(tokenHttpError ?? {kind:'response_too_large'}); else pieces.push(part); });
          res.on('end', () => {
            if (settled) return;
            try { const data = JSON.parse(Buffer.concat(pieces).toString('utf8')); finish(tokenHttpError ? {...tokenHttpError, reason:classifyTokenError(data)} : {kind:'json',data,bytes}); }
            catch { finish(tokenHttpError ?? {kind:'invalid_response'}); }
          });
          res.on('error', () => finish(tokenHttpError ?? {kind:'network_error'}));
          res.on('aborted', () => finish(tokenHttpError ?? {kind:'network_error'}));
          res.on('close', () => { if (!res.complete) finish(tokenHttpError ?? {kind:'network_error'}); });
        });
        req.on('error', () => finish(tokenHttpError ?? {kind:'network_error'}));
        req.end(body);
      } catch { stop({kind:'network_error'}); }
    });
  };
}

export function normalizeCrosswalk(value, fetchedAt) {
  return {id:id(value?.id),uid:str(value?.uid),game_id:refId(value?.game),external_game_source:named(value?.external_game_source),url:safeUrl(value?.url),url_validation:value?.url == null ? 'absent' : safeUrl(value.url) ? 'valid' : 'invalid',platform_id:refId(value?.platform),source_updated_at:iso(value?.updated_at),fetched_at:fetchedAt};
}
export function normalizeGame(value) {
  const companies = arr(value?.involved_companies).map(x => ({id:id(x?.id),company:named(x?.company),developer:bool(x?.developer),publisher:bool(x?.publisher),porting:bool(x?.porting),supporting:bool(x?.supporting),source_updated_at:iso(x?.updated_at)}));
  const roles = role => companies.filter(x => x[role] === true && x.company?.name).map(x => x.company);
  return {
    name:str(value?.name),summary:str(value?.summary, 100_000),platforms:arr(value?.platforms).map(platform).filter(Boolean),
    release_dates:arr(value?.release_dates).map(x => ({id:id(x?.id),date:unix(x?.date),iso_date:iso(x?.date),human:str(x?.human),year:Number.isInteger(x?.y) ? x.y : null,month:Number.isInteger(x?.m) ? x.m : null,day:Number.isInteger(x?.d) ? x.d : null,platform:platform(x?.platform),date_format:typed(x?.date_format,'format'),region:typed(x?.release_region,'region'),status:named(x?.status),source_updated_at:iso(x?.updated_at),scope:'IGDB platform/region release; not a Steam-specific release date'})),
    developers:roles('developer'),publishers:roles('publisher'),companies,
    genres:arr(value?.genres).map(named).filter(Boolean),themes:arr(value?.themes).map(named).filter(Boolean),keywords:arr(value?.keywords).map(named).filter(Boolean),
    websites:arr(value?.websites).map(x => ({id:id(x?.id),url:safeUrl(x?.url),type:typed(x?.type,'type'),trusted:bool(x?.trusted)})),
    game_type:typed(value?.game_type,'type'),parent_game_id:refId(value?.parent_game),version_parent_id:refId(value?.version_parent),version_title:str(value?.version_title),first_release_date:unix(value?.first_release_date),
    external_ids:arr(value?.external_games).map(x => normalizeCrosswalk(x, null)),source_updated_at:iso(value?.updated_at),
  };
}
function makeEvidence(value, fetchedAt) {
  const catalog = normalizeGame(value);
  for (const external of catalog.external_ids) external.fetched_at = fetchedAt;
  const provenance = {source:'IGDB',source_url:safeUrl(value.url,'igdb.com'),source_id:id(value.id),fetched_at:fetchedAt,source_updated_at:catalog.source_updated_at,field_paths:FIELD_PATHS,scope:'IGDB catalog; Steam data remain separate',retention_rule:'pending_rights_review'};
  return {igdb_game_id:id(value.id),igdb_url:provenance.source_url,fetched_at:fetchedAt,catalog,provenance,field_provenance:Object.fromEntries(Object.entries(FIELD_PATHS).map(([field, source_field]) => [field,{source:'IGDB',source_id:id(value.id),source_url:provenance.source_url,source_field,fetched_at:fetchedAt,source_updated_at:catalog.source_updated_at,source_updated_at_scope:'Parent game updated_at; nested source timestamps retained separately when available',status:catalog[field] == null || (Array.isArray(catalog[field]) && !catalog[field].length) ? 'missing' : 'observed',units:['first_release_date'].includes(field) ? 'Unix seconds' : 'catalog field',scope:field === 'release_dates' ? 'platform/region/date precision; phase only if provider status gives it' : 'IGDB game catalog',retention_rule:'pending_rights_review'}]))};
}
function baseRecord(item) {
  return {steam_appid:item.appid,steam_name:item.name,cohort_membership:item.cohort_membership,cohort_group:item.cohort_group,review_volume_band:item.review_volume_band,steam_baseline:{source_url:item.source_url,official_store_url:item.official_store_url,fetched_at:item.fetched_at,verified_identity:item.verified_identity,release_date_display:item.release_date_display,source_file:item.steam_baseline_source_file},match_status:'unattempted',match_reason:'not_requested',igdb_game_id:null,igdb_url:null,fetched_at:null,crosswalk:[],catalog:null,provenance:null,field_provenance:{},catalog_evidence:[],discrepancies:[]};
}
export function reconcileRecord(record, source, mappingComplete, evidenceById) {
  const row = {...record,discrepancies:[]};
  row.catalog_evidence = sortedUnique(row.crosswalk.map(x => x.game_id).filter(Boolean)).map(x => evidenceById.get(x)).filter(Boolean);
  if (!mappingComplete) { row.match_status = row.crosswalk.length ? 'quarantined' : 'unattempted'; row.match_reason = row.crosswalk.length ? 'mapping_scan_incomplete' : 'not_requested'; return row; }
  if (!row.crosswalk.length) { row.match_status='unmatched'; row.match_reason='no_exact_steam_mapping'; return row; }
  row.match_status='quarantined';
  const invalid = row.crosswalk.some(x => !x.id || !x.game_id || x.uid !== String(row.steam_appid) || x.external_game_source?.id !== source?.id || x.external_game_source?.name?.trim().toLowerCase() !== 'steam' || x.url_validation === 'invalid' || !steamUrlMatches(x.url,row.steam_appid));
  if (invalid) { row.match_reason='invalid_crosswalk_evidence'; return row; }
  const candidates = sortedUnique(row.crosswalk.map(x => x.game_id));
  if (candidates.length !== 1) { row.match_status='ambiguous'; row.match_reason='multiple_igdb_games_for_steam_app'; return row; }
  const evidence = evidenceById.get(candidates[0]);
  if (!evidence) { row.match_reason='candidate_details_unavailable'; return row; }
  const c = evidence.catalog;
  if (!evidence.igdb_url) { row.match_reason='igdb_source_url_unavailable'; return row; }
  if (normalizeTitle(row.steam_name) !== normalizeTitle(c.name)) {
    row.discrepancies.push({field:'name',steam_value:row.steam_name,igdb_value:c.name,steam_source:row.steam_baseline.source_url,igdb_source:evidence.igdb_url,status:'unresolved',reason:'catalog_title_difference',chosen_display_source:'Steam saved baseline'});
    row.match_reason='title_conflict_requires_review'; return row;
  }
  if (!mainGame(c.game_type) || c.parent_game_id || c.version_parent_id || c.version_title) { row.match_reason='entity_type_or_edition_requires_review'; return row; }
  const desktop = c.platforms.filter(x => /^(PC \(Microsoft Windows\)|Linux|Mac|macOS)$/i.test(x.name ?? '') || /^(PC|Win|Linux|Mac)$/i.test(x.abbreviation ?? ''));
  if (!desktop.length) { row.match_reason='steam_platform_unverified'; return row; }
  if (row.crosswalk.some(x => x.platform_id && !desktop.some(p => p.id === x.platform_id))) { row.match_reason='crosswalk_platform_conflict'; return row; }
  row.match_status='matched'; row.match_reason='exact_steam_appid_unique_main_game';
  Object.assign(row,{igdb_game_id:evidence.igdb_game_id,igdb_url:evidence.igdb_url,fetched_at:evidence.fetched_at,catalog:c,provenance:evidence.provenance,field_provenance:evidence.field_provenance});
  row.discrepancies.push({field:'release_dates',steam_value:row.steam_baseline.release_date_display,igdb_values:c.release_dates,steam_source:row.steam_baseline.source_url,igdb_source:evidence.igdb_url,status:'scopes_preserved',reason:'Steam displayed release and IGDB platform/region records are not assumed equivalent',chosen_display_source:'Steam for Steam-specific release'});
  return row;
}
function summarize(records, requests, error) {
  const statusCounts = Object.fromEntries(['matched','unmatched','ambiguous','quarantined','unattempted'].map(x => [x,records.filter(r=>r.match_status===x).length]));
  const matched = records.filter(r=>r.match_status==='matched');
  const tests = {name:c=>Boolean(c.name),summary:c=>Boolean(c.summary),platforms:c=>c.platforms.some(x=>x.name),platform_release:c=>c.release_dates.some(x=>x.platform?.name && (x.date!==null || x.human)),developer:c=>c.developers.length>0,publisher:c=>c.publishers.length>0,official_website:c=>c.websites.some(x=>x.url && x.type?.type?.toLowerCase()==='official'),genres:c=>c.genres.some(x=>x.name),themes:c=>c.themes.some(x=>x.name),keywords:c=>c.keywords.some(x=>x.name)};
  const coverage = Object.fromEntries(Object.entries(tests).map(([name, fn]) => { const n=matched.filter(r=>fn(r.catalog)).length; return [name,{covered:n,cohort_denominator:records.length,matched_denominator:matched.length,cohort_percent:100*n/records.length,matched_percent:matched.length ? 100*n/matched.length : null}]; }));
  const groups = key => Object.fromEntries([...new Set(records.map(r=>r[key]))].map(value=>{const members=records.filter(r=>r[key]===value); return [value,{cohort:members.length,matched:members.filter(r=>r.match_status==='matched').length}];}));
  return {cohort:records.length,...statusCounts,coverage,by_cohort:groups('cohort_membership'),by_editorial_group:groups('cohort_group'),by_saved_review_band:groups('review_volume_band'),requests_attempted:requests.length,requests_successful:requests.filter(x=>x.status==='success').length,payload_bytes:requests.reduce((n,x)=>n+(x.payload_bytes??0),0),errors:error ? [error] : [],gates:{G0:'rights_and_production_use_pending',G1:matched.length>=33 ? 'coverage_target_met_review_ledger_required' : 'below_proposed_33_of_36_target',G2:['name','summary','platforms','platform_release','developer'].every(k=>coverage[k].covered>=33) ? 'coverage_targets_met' : 'one_or_more_proposed_targets_missing',G3:'field_provenance_recorded_manual_conflict_review_pending',G4:'Steam_tags_unchanged_not_recollected',G5:'catalog_only_no_new_Steam_metrics_or_history',G6:'remaining_Steam_validation_pending',G7:'private_pilot_only_production_not_promoted'},unresolved_steam_appids:records.filter(x=>x.match_status!=='matched').map(x=>x.steam_appid)};
}

export async function readCohort(root = ROOT) {
  const bytes = await readFile(path.join(root,'data/cohort-36.json'));
  if (createHash('sha256').update(bytes).digest('hex') !== COHORT_SHA256) throw new Error('Invalid cohort');
  const data=JSON.parse(bytes);
  if (!Array.isArray(data) || data.length!==LIMITS.cohort_size || new Set(data.map(x=>x.appid)).size!==LIMITS.cohort_size || data.some(x=>!id(x.appid) || !str(x.name) || x.verified_identity!==true || !steamUrlMatches(x.official_store_url,x.appid))) throw new Error('Invalid cohort');
  return data;
}

class ImportFailure extends Error { constructor(code, phase, httpStatus, reason) { super(code); this.detail={code,phase,...(Number.isInteger(httpStatus) ? {http_status:httpStatus} : {}),...(reason ? {reason} : {})}; } }
export async function importCatalog({cohort,credentials,transport=createCatalogTransport(),now=()=>new Date(),wait=sleep,runId=randomUUID()}={}) {
  const startedAt=now().toISOString();
  const records=cohort.map(baseRecord), completed=new Set(), evidenceById=new Map(), requestLog=[];
  let source=null, token, failure=null, phase='config';
  const request = async (label,body,headers) => {
    if (requestLog.length>=LIMITS.requests) throw new ImportFailure('request_budget_exhausted',label);
    if (requestLog.length) await wait(LIMITS.interval_ms);
    const begun=now(), entry={request_number:requestLog.length+1,phase:label,endpoint:ENDPOINTS[label],started_at:begun.toISOString(),status:'pending',http_status:null,payload_bytes:null,record_count:null};
    requestLog.push(entry);
    let response;
    try { response=await transport(ENDPOINTS[label],headers,body); } catch { response={kind:'network_error'}; }
    entry.finished_at=now().toISOString(); entry.latency_ms=Math.max(0,now()-begun);
    entry.http_status=Number.isInteger(response?.httpStatus) ? response.httpStatus : null;
    if (response?.kind!=='json') {
      const code=['network_error','http_error','response_too_large','invalid_response'].includes(response?.kind) ? response.kind : 'invalid_response';
      entry.status=code;
      throw new ImportFailure(code,label,entry.http_status,label==='token' ? (['invalid_client_secret','invalid_client_id','unsupported_grant_type','invalid_grant','access_denied'].includes(response?.reason) ? response.reason : 'unknown') : undefined);
    }
    entry.status='success'; entry.payload_bytes=Number.isInteger(response.bytes) && response.bytes>=0 ? response.bytes : null;
    entry.record_count=label==='token' ? null : Array.isArray(response.data) ? response.data.length : null;
    return {data:response.data,fetchedAt:entry.finished_at};
  };
  const query = async (label, body) => {
    phase=label;
    const result=await request(label,body,{'Client-ID':credentials.clientId,Authorization:`Bearer ${token}`,'Content-Type':'text/plain'});
    if (!Array.isArray(result.data) || result.data.length>LIMITS.page_size || result.data.some(x=>!x || typeof x!=='object' || Array.isArray(x) || !id(x.id))) throw new ImportFailure('invalid_response',label);
    // Refuse any reflected credential/token before handling catalog strings.
    const serialized=JSON.stringify(result.data);
    if ([credentials.clientId,credentials.clientSecret,token].some(secret=>serialized.includes(JSON.stringify(secret).slice(1,-1)))) throw new ImportFailure('credential_reflection_rejected',label);
    return result;
  };
  try {
    if (!safeCredential(credentials?.clientId) || !safeCredential(credentials?.clientSecret)) throw new ImportFailure('missing_config','config');
    phase='token';
    const auth=await request('token',new URLSearchParams({client_id:credentials.clientId,client_secret:credentials.clientSecret,grant_type:'client_credentials'}).toString(),{'Content-Type':'application/x-www-form-urlencoded'});
    if (!auth.data || Array.isArray(auth.data) || !safeCredential(auth.data.access_token) || auth.data.token_type?.toLowerCase()!=='bearer' || !Number.isSafeInteger(auth.data.expires_in) || auth.data.expires_in<=0) throw new ImportFailure('token_invalid_response','token');
    token=auth.data.access_token;
    const sources=[]; let sourcesComplete=false;
    for(let page=0;page<LIMITS.source_pages;page++) {
      const {data}=await query('sources',`fields id,name; sort id asc; limit ${LIMITS.page_size}; offset ${page*LIMITS.page_size};`);
      sources.push(...data); if(data.length<LIMITS.page_size) {sourcesComplete=true;break;}
    }
    if(!sourcesComplete) throw new ImportFailure('source_page_budget_exhausted','sources');
    const steam=sources.filter(x=>str(x.name)?.trim().toLowerCase()==='steam');
    if(steam.length!==1) throw new ImportFailure('steam_source_not_unique','sources');
    source=named(steam[0]);
    for (const batch of chunks(records)) {
      let complete=false;
      for(let page=0;page<LIMITS.mapping_pages_per_batch;page++) {
        const {data,fetchedAt}=await query('crosswalk',`fields ${CROSSWALK_FIELDS}; where external_game_source = ${source.id} & uid = (${batch.map(x=>`"${x.steam_appid}"`).join(',')}); sort id asc; limit ${LIMITS.page_size}; offset ${page*LIMITS.page_size};`);
        if(data.some(x=>!batch.some(r=>String(r.steam_appid)===x.uid) || refId(x.external_game_source)!==source.id)) throw new ImportFailure('crosswalk_scope_mismatch','crosswalk');
        for(const value of data) {
          const row=batch.find(x=>String(x.steam_appid)===value.uid);
          if(row.crosswalk.some(x=>x.id===value.id)) throw new ImportFailure('duplicate_mapping_page','crosswalk');
          row.crosswalk.push(normalizeCrosswalk(value,fetchedAt));
        }
        if(data.length<LIMITS.page_size) {complete=true;break;}
      }
      if(!complete) throw new ImportFailure('mapping_page_budget_exhausted','crosswalk');
      for(const row of batch) completed.add(row.steam_appid);
    }
    const gameIds=sortedUnique(records.flatMap(x=>x.crosswalk.map(y=>y.game_id)).filter(Boolean));
    if(gameIds.length>LIMITS.candidate_games) throw new ImportFailure('candidate_budget_exhausted','games');
    for(const batch of chunks(gameIds)) {
      const {data,fetchedAt}=await query('games',`fields ${GAME_FIELDS}; where id = (${batch.join(',')}); sort id asc; limit ${LIMITS.page_size};`);
      if(data.some(x=>!batch.includes(x.id)) || new Set(data.map(x=>x.id)).size!==data.length) throw new ImportFailure('game_scope_mismatch','games');
      for(const value of data) evidenceById.set(value.id,makeEvidence(value,fetchedAt));
    }
  } catch(error) { failure=error instanceof ImportFailure ? error.detail : {code:'internal_error',phase}; }
  finally {token=undefined;}
  const reconciled=records.map(r=>reconcileRecord(r,source,completed.has(r.steam_appid),evidenceById));
  const users=new Map();
  for(const row of reconciled) for(const gameId of sortedUnique(row.crosswalk.map(x=>x.game_id).filter(Boolean))) users.set(gameId,[...(users.get(gameId)??[]),row.steam_appid]);
  for(const row of reconciled) if(row.match_status==='matched' && users.get(row.igdb_game_id).length>1) {row.match_status='quarantined';row.match_reason='igdb_game_shared_by_multiple_steam_apps';row.catalog=null;row.igdb_game_id=null;row.igdb_url=null;row.provenance=null;row.field_provenance={};}
  return {schema_version:1,artifact_type:'igdb_catalog_import',run_id:runId,started_at:startedAt,fetched_at:now().toISOString(),status:failure ? (evidenceById.size ? 'partial' : 'failed') : 'complete',cohort_size:cohort.length,source_contract:{catalog:'IGDB',steam_metrics:'Steam',mechanic_theme_trends:'Steam tags only'},rights:{use:'private_validation_pilot',production_approved:false,public_display_approved:false,retention_rule:'pending_rights_review'},limits:LIMITS,steam_source:source,records:reconciled,summary:summarize(reconciled,requestLog,failure),request_log:requestLog};
}

export async function saveImport(root, result) {
  if(result.artifact_type!=='igdb_catalog_import' || result.schema_version!==1 || !/^[A-Za-z0-9-]{1,80}$/.test(result.run_id)) throw new Error('Invalid artifact');
  // A new immutable directory avoids silently overwriting previous observations.
  const relative=`research/milestone-1/igdb-catalog-imports/${result.started_at.replace(/[:.]/g,'-')}-${result.run_id}`;
  let current=root;
  for(const component of relative.split('/')) {
    current=path.join(current,component);
    try {await mkdir(current,{mode:0o700});} catch(error) {if(error?.code!=='EEXIST') throw error;}
    const info=await lstat(current); if(!info.isDirectory() || info.isSymbolicLink()) throw new Error('Unsafe output directory');
  }
  for(const [name,data] of [['catalog.json',result],['summary.json',{schema_version:1,artifact_type:'igdb_catalog_import_summary',run_id:result.run_id,started_at:result.started_at,fetched_at:result.fetched_at,status:result.status,steam_source:result.steam_source,summary:result.summary}]]) {
    const file=await open(path.join(current,name),'wx',0o600);
    try {await file.writeFile(JSON.stringify(data,null,2)+'\n');} finally {await file.close();}
  }
  return `${relative}/catalog.json`;
}
export async function runManualImport({root=ROOT,transport,now,wait,output=line=>console.log(line)}={}) {
  // Validate the fixed public input before reading any private configuration.
  const cohort=await readCohort(root);
  const credentials=await readLocalConfig(root);
  const result=await importCatalog({cohort,credentials,transport,now,wait});
  const saved=await saveImport(root,result);
  output(`IGDB catalog import: ${result.status}; matched=${result.summary.matched}/${result.cohort_size}; unmatched=${result.summary.unmatched}; ambiguous=${result.summary.ambiguous}; quarantined=${result.summary.quarantined}; unattempted=${result.summary.unattempted}; requests=${result.summary.requests_attempted}`);
  if(result.summary.errors.length) {const e=result.summary.errors[0];output(`Stopped: ${e.code}; phase=${e.phase}${e.http_status ? `; http_status=${e.http_status}` : ''}${e.reason ? `; reason=${e.reason}` : ''}`);}
  output(`Private non-secret catalog: ${saved}`);
  output(`Private non-secret summary: ${path.posix.dirname(saved)}/summary.json`);
  output('Steam tags and metrics remain unchanged. Production and public-display rights are still pending.');
  return result.status==='complete' ? 0 : 1;
}
if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  if(process.argv.length!==3 || process.argv[2]!=='--run') {console.log('Manual import only. Read README.md, then personally invoke the import launcher with --run.');process.exitCode=2;}
  else if(['NODE_OPTIONS','NODE_DEBUG','NODE_DEBUG_NATIVE','SSLKEYLOGFILE'].some(x=>process.env[x]) || process.env.NODE_TLS_REJECT_UNAUTHORIZED==='0' || process.execArgv.length) {console.log('Unsafe runtime options. Use the clean import launcher.');process.exitCode=2;}
  else {try {process.exitCode=await runManualImport();} catch {console.log('Catalog import could not complete or save. No credential or response details were logged.');process.exitCode=2;}}
}
