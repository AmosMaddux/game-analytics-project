import { VERSION, ENDPOINTS, LIMITS, SafeError, clone, hash, makePlan, buildQuery, metadataQuery, uint, nonnegative, ref, key, textValue, validTime, object, normalizeGame, verifyIdentity, panelCandidate } from './domain.mjs';
import { emptyBudget, validateBudget } from './transport.mjs';
export function initialState(plan) {
  return {version:VERSION,plan:clone(plan),planHash:hash(plan),status:'pending',stopReason:null,budget:emptyBudget(),referencesVerified:false,streams:plan.streams.map(stream=>({id:stream.id,afterId:0,pages:0,selected:[],exhausted:false})),discoveryPages:0,gameIds:[],provenance:{},metadataDone:[],candidates:[],steam:{cursor:0,pages:0,complete:false,matches:[],status:'pending',parserVersion:STEAM_PARSER_VERSION,parserHistory:[]},createdAt:plan.asOf,finishedAt:null};
}
export function validateState(state) {
  if(state?.version!==VERSION||!validTime(state?.plan?.asOf)||JSON.stringify(state.plan)!==JSON.stringify(makePlan(state.plan.asOf))||state.planHash!==hash(state.plan))throw new SafeError('incompatible_checkpoint');
  validateBudget(state.budget);
  for(const field of ['gameIds','metadataDone'])if(!Array.isArray(state[field])||state[field].length>LIMITS.candidates||state[field].some(id=>!uint(id))||new Set(state[field]).size!==state[field].length)throw new SafeError('invalid_checkpoint_ids');
  if(state.metadataDone.some(id=>!state.gameIds.includes(id))||!Array.isArray(state.candidates)||state.candidates.length>LIMITS.candidates||state.candidates.some(item=>!state.metadataDone.includes(item.igdbId))||new Set(state.candidates.map(item=>item.igdbId)).size!==state.candidates.length)throw new SafeError('invalid_checkpoint_candidates');
  if(!nonnegative(state.discoveryPages)||state.discoveryPages>LIMITS.discoveryPages||state.streams?.length!==state.plan.streams.length)throw new SafeError('invalid_checkpoint_streams');
  for(let i=0;i<state.streams.length;i++){const stream=state.streams[i];if(stream.id!==state.plan.streams[i].id||!nonnegative(stream.afterId)||!nonnegative(stream.pages)||!Array.isArray(stream.selected)||stream.selected.length>state.plan.streams[i].target||stream.selected.some(id=>!state.gameIds.includes(id))||new Set(stream.selected).size!==stream.selected.length)throw new SafeError('invalid_checkpoint_streams');}
  if(!nonnegative(state.steam?.cursor)||!nonnegative(state.steam?.pages)||state.steam.pages>LIMITS.steamPages||!Array.isArray(state.steam?.matches)||state.steam.matches.length>LIMITS.candidates||state.steam.matches.some(item=>!uint(item.appid)||typeof item.name!=='string'||item.name.length>512||/[\x00-\x1f\x7f]/.test(item.name)||!validTime(item.fetchedAt)))throw new SafeError('invalid_checkpoint_steam');
}
function validatePage(rows,cursor,limit) {
  if(!Array.isArray(rows)||rows.length>limit||rows.some((row,index)=>!uint(row?.id)||row.id<=cursor||(index&&row.id<=rows[index-1].id)))throw new SafeError('invalid_discovery_page');
}
export async function discover({state,transport,save,now=()=>new Date().toISOString()}) {
  validateState(state);
  if(state.status==='complete')return state;
  upgradeSteamParser(state);
  state.status='running';state.stopReason=null;await save(state);
  if(!state.referencesVerified){
    const sources=await transport.request(ENDPOINTS.sources,'fields id,name; where id = 1; limit 2;');
    if(!Array.isArray(sources)||sources.length!==1||sources[0]?.id!==1||key(sources[0]?.name)!=='steam')throw new SafeError('steam_source_unverified');
    const types=await transport.request(ENDPOINTS.types,'fields id,type; where id = 0; limit 2;');
    if(!Array.isArray(types)||types.length!==1||types[0]?.id!==0||key(types[0]?.type)!=='maingame')throw new SafeError('main_game_type_unverified');
    state.referencesVerified=true;await save(state);
  }
  const seen=new Set(state.gameIds);
  for(let index=0;index<state.streams.length;index++){
    const stream=state.streams[index],config=state.plan.streams[index];
    while(!stream.exhausted&&stream.selected.length<config.target&&seen.size<LIMITS.candidates&&state.discoveryPages<LIMITS.discoveryPages&&stream.pages<config.maxPages){
      const limit=Math.min(LIMITS.pageSize,config.target-stream.selected.length,LIMITS.candidates-seen.size);
      const rows=await transport.request(config.kind==='releases'?ENDPOINTS.releases:ENDPOINTS.games,buildQuery(config,stream.afterId,limit));
      validatePage(rows,stream.afterId,limit);
      for(const row of rows){
        const gameId=config.kind==='releases'?ref(row.game):row.id;
        if(!gameId)throw new SafeError('invalid_release_game_id');
        if(config.kind==='releases'&&(ref(row.platform)!==6||!nonnegative(row.date)||row.date<config.start||row.date>=config.end))throw new SafeError('release_row_outside_requested_scope');
        if(!state.provenance[gameId])state.provenance[gameId]=[];
        if(!state.provenance[gameId].includes(config.id))state.provenance[gameId].push(config.id);
        if(!seen.has(gameId)){seen.add(gameId);state.gameIds.push(gameId);stream.selected.push(gameId);}
      }
      if(rows.length)stream.afterId=rows.at(-1).id;
      stream.exhausted=rows.length<limit;stream.pages++;state.discoveryPages++;
      await save(state);
    }
  }
  const done=new Set(state.metadataDone), remaining=state.gameIds.filter(id=>!done.has(id)).sort((a,b)=>a-b);
  for(let i=0;i<remaining.length;i+=LIMITS.pageSize){
    const ids=remaining.slice(i,i+LIMITS.pageSize), rows=await transport.request(ENDPOINTS.games,metadataQuery(ids));
    if(!Array.isArray(rows)||rows.length>ids.length||rows.some(row=>!ids.includes(row?.id))||new Set(rows.map(row=>row.id)).size!==rows.length)throw new SafeError('invalid_metadata_page');
    const fetchedAt=now();
    for(const id of ids){const raw=rows.find(row=>row.id===id);const item=raw?normalizeGame(raw,fetchedAt,state.plan.asOf):{igdbId:id,appid:null,rejection:'igdb_record_unavailable'};item.discoveryStreams=state.provenance[id]??[];state.candidates.push(item);state.metadataDone.push(id);}
    await save(state);
  }
  const claims=new Map();
  for(const item of state.candidates)if(item.appid){const prior=claims.get(item.appid)??[];prior.push(item);claims.set(item.appid,prior);}
  for(const items of claims.values())if(items.length>1)for(const item of items){item.rejection='duplicate_steam_appid_claim';item.identity={...item.identity,status:'quarantined',reason:item.rejection};}
  await save(state);return state;
}
export const STEAM_PARSER_VERSION = 'steam-catalog-parser-1.0.1';
const fieldType = value => value === undefined ? 'absent' : value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
function steamNameStatus(value) {
  if (value === undefined) return 'missing';
  if (typeof value !== 'string') return 'invalid_type';
  if (value.length > 512) return 'too_long';
  if (/[\x00-\x1f\x7f]/.test(value)) return 'unsafe_control_characters';
  return textValue(value) ? 'observed' : 'blank';
}
/** Only fixed field types, counts and public numeric cursors, never raw names or auth. */
export function inspectSteamPage(data, cursor) {
  const response = data?.response, rows = response?.apps;
  const inspected = Array.isArray(rows) ? rows.slice(0,50000) : [];
  const nameStatuses = {observed:0,missing:0,invalid_type:0,too_long:0,unsafe_control_characters:0,blank:0};
  let invalidIds=0, nonIncreasingIds=0;
  for (let i=0;i<inspected.length;i++) {
    const row=inspected[i];
    if (!uint(row?.appid) || row.appid <= cursor) invalidIds++;
    if (i && uint(row?.appid) && uint(inspected[i-1]?.appid) && row.appid <= inspected[i-1].appid) nonIncreasingIds++;
    nameStatuses[steamNameStatus(row?.name)]++;
  }
  return {parserVersion:STEAM_PARSER_VERSION,responseType:fieldType(response),appsType:fieldType(rows),rowCount:Array.isArray(rows)?rows.length:null,inspectedRows:inspected.length,haveMoreType:fieldType(response?.have_more_results),haveMore:typeof response?.have_more_results==='boolean'?response.have_more_results:null,cursorType:fieldType(response?.last_appid),responseCursor:uint(response?.last_appid)?response.last_appid:response?.last_appid===0?0:null,firstAppid:uint(inspected[0]?.appid)?inspected[0].appid:null,lastAppid:uint(inspected.at(-1)?.appid)?inspected.at(-1).appid:null,invalidIds,nonIncreasingIds,nameStatuses};
}
/** Missing optional continuation flags never imply completion of a nonempty page. */
export function parseSteamPage(data,cursor) {
  const response=data?.response,rows=response?.apps;
  if (!object(response) || !Array.isArray(rows) || rows.length>50000) throw new SafeError('invalid_steam_catalog_page');
  if (response.have_more_results !== undefined && typeof response.have_more_results !== 'boolean') throw new SafeError('invalid_steam_continuation_flag');
  if (rows.some((row,index)=>!object(row)||!uint(row.appid)||row.appid<=cursor||(index&&row.appid<=rows[index-1].appid))) throw new SafeError('invalid_steam_catalog_identity_order');
  if (!rows.length && response.have_more_results===true) throw new SafeError('steam_pagination_stalled');
  const terminalDefaultCursor = rows.length===0 && response.have_more_results===false && response.last_appid===0;
  if (response.last_appid!==undefined && response.last_appid!==(rows.at(-1)?.appid??cursor) && !terminalDefaultCursor) throw new SafeError('conflicting_steam_cursor');
  return {rows:rows.map(row=>{const nameStatus=steamNameStatus(row.name);return{appid:row.appid,name:nameStatus==='observed'?row.name:'',nameStatus};}),complete:response.have_more_results===false,stopReason:rows.length===0 && response.have_more_results===undefined ? 'steam_completion_unconfirmed' : null};
}
export function applyCachedIdentities(state) {
  const matches=new Map(state.steam.matches.map(item=>[item.appid,item]));
  state.candidates=state.candidates.map(item=>{const match=matches.get(item.appid);return verifyIdentity(item,match,match?.fetchedAt??state.finishedAt??state.plan.asOf,state.steam.complete||item.appid<=state.steam.cursor);});
}
export function upgradeSteamParser(state) {
  if (state.steam.parserVersion !== STEAM_PARSER_VERSION) {
    state.steam.parserHistory = [...(state.steam.parserHistory ?? []), {version:state.steam.parserVersion ?? 'steam-catalog-parser-1.0',priorStopReason:state.stopReason,priorFinishedAt:state.finishedAt,acceptedPages:state.steam.pages,chargedSteamPages:state.budget.steamPages}];
    state.steam.parserVersion = STEAM_PARSER_VERSION;
  }
}
export async function collectIdentities({state,transport,save,hasSteamKey,now=()=>new Date().toISOString()}) {
  upgradeSteamParser(state);
  applyCachedIdentities(state);
  await save(state);
  const targets=new Set(state.candidates.filter(item=>!item.rejection&&item.appid).map(item=>item.appid));
  if(!targets.size){state.steam.status='no_verifiable_candidates';await save(state);return;}
  if(!hasSteamKey){state.steam.status='missing_user_steam_key';await save(state);return;}
  const matches=new Map(state.steam.matches.map(item=>[item.appid,item]));
  const covered=()=>[...targets].every(appid=>appid<=state.steam.cursor||matches.has(appid));
  while(!state.steam.complete&&!covered()&&state.steam.pages<LIMITS.steamPages){
    const input={include_games:true,include_dlc:false,include_software:false,include_videos:false,include_hardware:false,last_appid:state.steam.cursor,max_results:50000};
    const data=await transport.request(ENDPOINTS.steam,JSON.stringify(input));
    state.steam.lastShape = inspectSteamPage(data,state.steam.cursor);
    const {rows,complete,stopReason} = parseSteamPage(data,state.steam.cursor);
    const fetchedAt=now();
    for(const row of rows)if(targets.has(row.appid))matches.set(row.appid,{appid:row.appid,name:row.name,nameStatus:row.nameStatus,fetchedAt});
    if(rows.length)state.steam.cursor=rows.at(-1).appid;
    state.steam.pages++;state.steam.complete=complete;state.steam.matches=[...matches.values()].sort((a,b)=>a.appid-b.appid);state.steam.status=stopReason??(state.steam.complete||covered()?'candidate_range_checked':'partial');
    applyCachedIdentities(state);
    await save(state);
    if(stopReason)break;
  }
  applyCachedIdentities(state);
  await save(state);
}
export function finishState(state, finishedAt = new Date().toISOString()) {
  const pending = state.candidates.some(item => !item.rejection && item.identity?.status === 'pending_steam_verification');
  state.status = pending ? 'partial' : 'complete';
  state.stopReason = pending ? ['missing_user_steam_key','steam_completion_unconfirmed'].includes(state.steam.status) ? state.steam.status : 'steam_identity_incomplete' : null;
  state.finishedAt = finishedAt;
}
export function canResume(state) {
  if (state.status !== 'partial' || state.steam.status === 'steam_completion_unconfirmed' || state.budget.blocked || state.budget.requests >= LIMITS.requests || state.budget.elapsedMs >= LIMITS.runtimeMs) return false;
  const needsMetadata = state.metadataDone.length < state.gameIds.length || !state.referencesVerified || state.streams.some((stream,index) => !stream.exhausted && stream.selected.length < state.plan.streams[index].target && stream.pages < state.plan.streams[index].maxPages);
  if (needsMetadata && (state.budget.igdbPages >= LIMITS.igdbPages || state.budget.igdbBytes >= LIMITS.igdbBytes)) return false;
  if (!needsMetadata && (state.budget.steamPages >= LIMITS.steamPages || state.budget.steamBytes >= LIMITS.steamBytes || state.steam.pages >= LIMITS.steamPages)) return false;
  return true;
}
export function resultOf(state) {
  const candidates=[...state.candidates].sort((a,b)=>a.igdbId-b.igdbId), panelCandidates=candidates.map(panelCandidate).filter(Boolean).sort((a,b)=>a.appid-b.appid);
  return {schemaVersion:VERSION,planHash:state.planHash,asOf:state.plan.asOf,finishedAt:state.finishedAt,status:state.status,stopReason:state.stopReason,steamIdentity:{parserVersion:state.steam.parserVersion??'steam-catalog-parser-1.0',lastShape:state.steam.lastShape??null,status:state.steam.status,pages:state.steam.pages,checkedThroughAppid:state.steam.cursor,fullCatalogComplete:state.steam.complete},sourceContract:{purpose:'private_noncommercial_current_metadata_candidate_cache',documentation:['https://api-docs.igdb.com/','https://partner.steamgames.com/doc/webapi/IStoreService'],noSteamReleaseClaim:true,noMetricCollection:true,noDatabaseWrites:true,allRawGenresRetained:true,representativeSample:false},limits:LIMITS,counters:state.budget,discoveryStreams:state.streams.map((item,index)=>({...state.plan.streams[index],selected:item.selected.length,pages:item.pages,exhausted:item.exhausted,shortfall:Math.max(0,state.plan.streams[index].target-item.selected.length)})),summary:{discovered:state.gameIds.length,metadataProcessed:state.metadataDone.length,identityVerified:panelCandidates.length,identityPending:candidates.filter(item=>item.identity?.status==='pending_steam_verification').length,quarantined:candidates.filter(item=>item.rejection).length,pcExactDate:panelCandidates.filter(item=>item.releasePrecision==='day').length,panelAllocated:0},candidates,panelCandidates,notes:['Discovery quotas (400 recent PC, 100 per previous five years, 100 broad) are bounded over-recruitment, not the 300-game active allocation.','IGDB PC dates can be used only in an explicitly named IGDB PC-date research mode. They do not prove a Steam first-playable date.','Identity-only output has unknown review counts and no approved popular-reference designations. Join compatible saved evidence before allocation.','Source ID order, source coverage, window quotas, caps and conservative identity checks bias this candidate sample. Unfilled slots remain unfilled.']};
}
