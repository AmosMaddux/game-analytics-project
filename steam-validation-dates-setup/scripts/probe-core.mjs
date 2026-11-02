import {request as httpsRequest, Agent as HttpsAgent} from 'node:https';
import {setTimeout as sleep} from 'node:timers/promises';

// Importing this module makes no requests and reads no files or environment.
export const ENDPOINTS = Object.freeze({
  current_players: 'https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/',
  reviews_all_time: 'https://api.steampowered.com/IUserReviewsService/GetAppReviews/v1/',
});
export const LIMITS = Object.freeze({pilot_requests:6, cohort_requests:120, dates_requests:42, interval_ms:1100,
  timeout_ms:20000, run_timeout_ms:600000, body_bytes:1048576, header_bytes:8192,
  review_page_size:100, window_page_cap:4, concurrency:1, retries:0});
export const FILTERS = Object.freeze({filter:1, languages:['all'], review_type:0, purchase_type:0,
  filter_offtopic_activity:true, display_language:'english'});
export const PERIOD = Object.freeze({start:1788220800, split:1789516800, end:1790812799});
const uint = n => Number.isSafeInteger(n) && n >= 0;
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const iso = n => new Date(n).toISOString();
export class ProbeError extends Error { constructor(code) { super(code); this.code=code; } }
const fail = code => { throw new ProbeError(code); };

export function createRouteAgent({env={}, version=process.versions.node, Agent=HttpsAgent}={}) {
  const [major,minor]=version.split('.').map(Number);
  if (major!==24 || minor<5) fail('node_24_5_or_later_required');
  const keys=['HTTP_PROXY','http_proxy','HTTPS_PROXY','https_proxy','NO_PROXY','no_proxy'];
  const proxyEnv=Object.fromEntries(keys.filter(k=>typeof env[k]==='string').map(k=>[k,env[k]]));
  const httpsProxy=proxyEnv.https_proxy || proxyEnv.HTTPS_PROXY;
  const otherProxy=proxyEnv.http_proxy || proxyEnv.HTTP_PROXY || env.ALL_PROXY || env.all_proxy;
  if (otherProxy && !httpsProxy) fail('unsupported_proxy_route_stop');
  for (const k of keys.filter(k=>!k.toLowerCase().includes('no_proxy'))) {
    if (!proxyEnv[k]) continue;
    let u; try { u=new URL(proxyEnv[k]); } catch { fail('unsupported_proxy_route_stop'); }
    if (u.username || u.password) fail('proxy_credentials_require_handoff');
    if (!['http:','https:'].includes(u.protocol)) fail('unsupported_proxy_route_stop');
  }
  return new Agent({keepAlive:false,maxCachedSessions:0,rejectUnauthorized:true,proxyEnv});
}

export function requestSpec(appid, method, {window, cursor='*', pageSize=1}={}) {
  if (!Number.isSafeInteger(appid) || appid<=0 || appid>4294967295) fail('invalid_appid');
  if (!Object.hasOwn(ENDPOINTS,method)) fail('endpoint_not_allowed');
  const endpoint=ENDPOINTS[method];
  if (method==='current_players') return {endpoint,url:`${endpoint}?appid=${appid}`,filters:{appid}};
  if (![1,LIMITS.review_page_size].includes(pageSize)) fail('invalid_page_size');
  if (typeof cursor!=='string' || !cursor || cursor.length>4096) fail('invalid_cursor');
  const input={appid,...FILTERS,languages:[...FILTERS.languages],num_per_page:pageSize,cursor};
  if (window) {
    if (!uint(window.start) || !uint(window.end) || window.start>window.end || window.end>4294967295) fail('invalid_window');
    input.date_range_start=window.start; input.date_range_end=window.end; input.date_range_exclude=false;
  }
  const filters={...input,cursor:cursor==='*'?'*':'continuation_omitted'};
  return {endpoint,url:`${endpoint}?${new URLSearchParams({input_json:JSON.stringify(input)})}`,filters};
}

// Only HTTPS GET to fixed public endpoints. No key, cookie, caller headers,
// redirect handling, automatic retry, alternate host or route fallback.
export function createTransport({request=httpsRequest, agentFactory, timeoutMs=LIMITS.timeout_ms}={}) {
  return async spec => {
    if(typeof agentFactory!=='function')fail('explicit_route_required');
    const u=new URL(spec.url);
    if (!Object.values(ENDPOINTS).includes(`${u.origin}${u.pathname}`) || u.username || u.password || u.hash) fail('endpoint_not_allowed');
    if (u.search.length>16384) fail('request_too_large');
    // Reject auth/unknown parameters even if a caller constructs its own spec.
    let canonical;
    if(u.pathname===new URL(ENDPOINTS.current_players).pathname){
      if([...u.searchParams.keys()].join(',')!=='appid')fail('request_parameters_not_allowed');
      canonical=requestSpec(Number(u.searchParams.get('appid')),'current_players');
    }else{
      if([...u.searchParams.keys()].join(',')!=='input_json')fail('request_parameters_not_allowed');
      let input;try{input=JSON.parse(u.searchParams.get('input_json'));}catch{fail('request_parameters_not_allowed');}
      if(!object(input))fail('request_parameters_not_allowed');
      canonical=requestSpec(input.appid,'reviews_all_time',{cursor:input.cursor,pageSize:input.num_per_page,
        window:Object.hasOwn(input,'date_range_start')?{start:input.date_range_start,end:input.date_range_end}:undefined});
    }
    if(canonical.url!==spec.url)fail('request_parameters_not_allowed');
    return new Promise(resolve=>{
      let settled=false, req, res, agent, bytes=0, httpStatus=null;
      const finish=value=>{ if(settled)return; settled=true; clearTimeout(timer); agent?.destroy(); resolve({http_status:httpStatus,bytes,...value}); };
      const stop=value=>{finish(value);res?.destroy();req?.destroy();};
      const timer=setTimeout(()=>stop({kind:'timeout'}),timeoutMs);
      try {
        agent=agentFactory();
        req=request(spec.url,{method:'GET',agent,rejectUnauthorized:true,maxHeaderSize:LIMITS.header_bytes,
          headers:{Accept:'application/json','Accept-Encoding':'identity','User-Agent':'GameMarketResearch-M1-Feasibility/1.0'}},response=>{
          res=response; httpStatus=Number.isInteger(res.statusCode)?res.statusCode:null;
          if(httpStatus!==200){stop({kind:httpStatus===429?'rate_limited':httpStatus===401||httpStatus===403?'access_denied':httpStatus>=300&&httpStatus<400?'redirect_refused':'http_error'});return;}
          if(!/^application\/json(?:\s*;|$)/i.test(res.headers['content-type']||'')){stop({kind:'invalid_content_type'});return;}
          if(res.headers['content-encoding'] && res.headers['content-encoding']!=='identity'){stop({kind:'unexpected_content_encoding'});return;}
          const announced=Number(res.headers['content-length']);
          if(Number.isFinite(announced)&&announced>LIMITS.body_bytes){stop({kind:'body_limit'});return;}
          const chunks=[];
          res.on('data',chunk=>{bytes+=chunk.length;if(bytes>LIMITS.body_bytes)stop({kind:'body_limit'});else chunks.push(chunk);});
          res.on('end',()=>{if(settled)return;try{finish({kind:'json',data:JSON.parse(Buffer.concat(chunks).toString('utf8'))});}catch{finish({kind:'invalid_json'});}});
          res.on('error',()=>stop({kind:'network_error'}));
          res.on('aborted',()=>stop({kind:'network_error'}));
          res.on('close',()=>{if(!res.complete)stop({kind:'network_error'});});
        });
        req.on('error',()=>stop({kind:'network_error'})); req.end();
      } catch(e) {stop({kind:e instanceof ProbeError?e.code:'network_error'});}
    });
  };
}

export function unpack(data) {
  if(!object(data))fail('invalid_response_shape');
  const d=Object.hasOwn(data,'response')?data.response:data;
  if(!object(d))fail('invalid_response_shape'); return d;
}
export function responseDiagnostic(data) {
  // Only fixed schema names and type labels, never provider-supplied key names/values.
  const root=object(data)?data:{};
  const d=object(root.response)?root.response:root;
  const kind=x=>x===undefined?'absent':x===null?'null':Array.isArray(x)?'array':typeof x;
  const fields=['player_count','result','query_summary','reviews','cursor','total_matching'];
  const shapes=Object.fromEntries(fields.map(k=>[k,kind(d[k])]));
  for(const k of ['num_reviews','total_reviews','total_positive','total_negative'])shapes[`query_summary.${k}`]=kind(d.query_summary?.[k]);
  return {wrapped_response:object(root.response),known_field_shapes:shapes,known_numeric_counts:{num_reviews:uint(d.query_summary?.num_reviews)?d.query_summary.num_reviews:null,total_matching:uint(d.total_matching)?d.total_matching:null}};
}
export function parsePlayers(data) {
  const d=unpack(data);
  if(d.result!==1 || !uint(d.player_count))fail('invalid_players_schema');
  return {player_count:d.player_count,result:1,unit:'Steam-connected concurrent players',source_timestamp:null};
}
export function parseReviews(data,{firstPage=true,window,pageSize=1}={}) {
  const d=unpack(data), s=d.query_summary;
  if(!object(s)||!uint(s.num_reviews)||!uint(d.total_matching))fail('invalid_reviews_schema');
  // A protobuf JSON zero-length array may be omitted. Never infer a zero from
  // absence alone, a null value, or an explicitly nonzero first-page count.
  const omittedEmpty=!Object.hasOwn(d,'reviews')&&s.num_reviews===0&&(!firstPage||d.total_matching===0);
  const reviews=omittedEmpty?[]:d.reviews;
  if(!Array.isArray(reviews))fail('invalid_reviews_schema');
  if(s.num_reviews!==reviews.length || reviews.length>pageSize)fail('invalid_review_page_count');
  let totals=null;
  if(firstPage){
    if(!uint(s.total_reviews)||!uint(s.total_positive)||!uint(s.total_negative))fail('invalid_review_totals');
    if(s.total_positive+s.total_negative!==s.total_reviews)fail('inconsistent_review_totals');
    totals={total_reviews:s.total_reviews,total_positive:s.total_positive,total_negative:s.total_negative};
  }
  const timestamps=[],ids=[];
  for(const r of reviews){
    if(!object(r)||!uint(r.timestamp_created)||r.timestamp_created>4294967295)fail('invalid_review_timestamp');
    let id=r.recommendationid;
    if(Number.isSafeInteger(id)&&id>=0)id=String(id);
    if(typeof id!=='string'||!/^\d{1,20}$/.test(id))fail('invalid_review_id');
    timestamps.push(r.timestamp_created);ids.push(id);
  }
  const badRange=window?timestamps.filter(t=>t<window.start||t>window.end).length:0;
  const descending=timestamps.every((t,i)=>i===0||t<=timestamps[i-1]);
  if(badRange)fail('date_filter_out_of_range');
  if(!descending)fail('recent_sort_out_of_order');
  const cursor=typeof d.cursor==='string'&&d.cursor.length<=4096?d.cursor:null;
  if(reviews.length && !cursor)fail('missing_review_cursor');
  return {aggregate:{returned_count:reviews.length,empty_array_omitted:omittedEmpty,total_matching:d.total_matching,query_summary_score_totals:totals,
    created_min_utc:timestamps.length?iso(Math.min(...timestamps)*1000):null,
    created_max_utc:timestamps.length?iso(Math.max(...timestamps)*1000):null,
    out_of_range_count:badRange,recent_sort_descending:descending,cursor_present:Boolean(cursor),
    query_summary_is_not_used_as_window_count:true,source_timestamp:null},cursor,ids,timestamps};
}

export function baselineCategory(row,method){
  const old=row.baseline_status[method];
  if(old==='network_proxy_refusal')return 'previous_failed_target';
  if(old==='not_attempted')return row.cohort==='original_30'?'original_unattempted_target':'supplement_unattempted_target';
  return 'baseline_success_recheck';
}
function coverage(rows,observations){
  const groups=new Map();
  for(const row of rows)for(const [axis,value] of [['all','all'],['cohort',row.cohort],['editorial_group',row.editorial_group],['selection_review_band',row.selection_review_band]]){
    const key=`${axis}:${value}`;if(!groups.has(key))groups.set(key,{axis,value,total_games:0,current_players_success:0,reviews_all_time_success:0});
    const g=groups.get(key);g.total_games++;
    for(const method of ['current_players','reviews_all_time']) if(observations.some(o=>o.appid===row.appid&&o.method===method&&o.purpose==='current_snapshot'&&o.status==='success'))g[`${method}_success`]++;
  }
  return [...groups.values()].map(x=>({...x,current_players_percent:100*x.current_players_success/x.total_games,reviews_all_time_percent:100*x.reviews_all_time_success/x.total_games}));
}

export async function runProbe({mode,cohort,transport,now=Date.now,wait=sleep,onCheckpoint=async()=>{},runId='test-run',kind='mock',bundleFingerprint=null}) {
  if(!['pilot','cohort','dates'].includes(mode))fail('invalid_mode');
  if(!object(cohort)||cohort.targets?.length!==36||new Set(cohort.targets.map(x=>x.appid)).size!==36)fail('invalid_frozen_cohort');
  const rows=mode==='dates'?[]:mode==='pilot'?cohort.pilot_appids.map(id=>cohort.targets.find(x=>x.appid===id)):cohort.targets;
  if(rows.some(x=>!x)||mode==='pilot'&&rows.length!==3)fail('invalid_pilot_cohort');
  const start=now(),requestCap=mode==='pilot'?LIMITS.pilot_requests:mode==='dates'?LIMITS.dates_requests:LIMITS.cohort_requests;
  const report={schema_version:'1.0',run_id:runId,kind,mode,bundle_fingerprint:bundleFingerprint,started_at:iso(start),finished_at:null,
    status:'running',healthy:false,current_metrics_scope:mode==='dates'?'not_requested_in_this_run_see_prior_proof':'this_run',scope:'bounded_M1_technical_feasibility',baseline_date:cohort.baseline_date,baseline_source_sha256:cohort.baseline_source_sha256,
    pilot_rationale:mode==='pilot'?cohort.pilot_rationale:null,pilot_appids:cohort.pilot_appids,
    limits:{...LIMITS,request_cap:requestCap},source_documents:[
      'https://partner.steamgames.com/doc/webapi/IUserReviewsService','https://partner.steamgames.com/doc/webapi/ISteamUserStats','https://partner.steamgames.com/doc/webapi_overview'],
    notes:['The existing 19 saved review observations already use the same GetAppReviews API.',
      'Current player counts are instantaneous, not DAU, historical peaks or sales.',
      'Anonymous review responses may be cached by Valve for up to 10 minutes.',
      'Dated review counts describe surviving matching reviews observed now, not an immutable historical snapshot.',
      'Two fresh manual runs are not a validated collection schedule or time series.',
      'Tag collection is disabled; no HTML/store/SteamDB requests are included.',
      'No production use, reuse/retention rights or other M1 gates are approved by this technical test.'],
    request_counts:{attempted:0,successful:0,failed:0},response_bytes:0,observations:[],date_probes:[],targets:[],coverage:[],stop_reason:null};
  let lastStart=null;
  async function query(row,method,purpose,options={}){
    // Checkpoint the previous state before timing this dispatch. Disk latency
    // cannot consume the spacing reserved between actual network starts.
    await onCheckpoint(report);
    if(report.request_counts.attempted>=requestCap)fail('request_cap_reached');
    const delay=lastStart===null?0:Math.max(0,LIMITS.interval_ms-(now()-lastStart));
    if(now()-start+delay+LIMITS.timeout_ms>LIMITS.run_timeout_ms)fail('run_time_cap_reached');
    if(delay)await wait(delay);
    while(lastStart!==null&&now()-lastStart<LIMITS.interval_ms)await wait(LIMITS.interval_ms-(now()-lastStart));
    if(now()-start+LIMITS.timeout_ms>LIMITS.run_timeout_ms)fail('run_time_cap_reached');
    lastStart=now();
    const spec=requestSpec(row.appid,method,options);
    const record={sequence:++report.request_counts.attempted,appid:row.appid,method,purpose,
      baseline_category:purpose==='current_snapshot'?baselineCategory(row,method):'original_unattempted_date_probe',
      requested_at:iso(lastStart),completed_at:null,latency_ms:null,endpoint:spec.endpoint,filters:spec.filters,
      status:'attempting',http_status:null,response_bytes:0,source_timestamp:null,aggregate:null};
    report.observations.push(record);
    let result;
    try {result=await transport(spec);}catch{result={kind:'network_error',http_status:null,bytes:0};}
    record.completed_at=iso(now());record.latency_ms=Math.max(0,now()-lastStart);
    record.http_status=Number.isInteger(result.http_status)?result.http_status:null;
    record.response_bytes=uint(result.bytes)?result.bytes:0;report.response_bytes+=record.response_bytes;
    try{
      if(result.kind!=='json')fail(['timeout','network_error','rate_limited','access_denied','redirect_refused','http_error','invalid_content_type','unexpected_content_encoding','body_limit','invalid_json','unsupported_proxy_route_stop','proxy_credentials_require_handoff','node_24_5_or_later_required'].includes(result.kind)?result.kind:'transport_failure');
      const parsed=method==='current_players'?{aggregate:parsePlayers(result.data)}:parseReviews(result.data,{firstPage:!options.cursor||options.cursor==='*',window:options.window,pageSize:options.pageSize??1});
      record.aggregate=parsed.aggregate;record.status='success';report.request_counts.successful++;await onCheckpoint(report);return parsed;
    }catch(e){record.status='failed';record.error_code=e instanceof ProbeError?e.code:'response_validation_failed';if(result.kind==='json')record.response_diagnostic=responseDiagnostic(result.data);report.request_counts.failed++;await onCheckpoint(report);throw new ProbeError(record.error_code);}
  }
  async function dateProbe(row){
    const monthly={start:PERIOD.start,end:PERIOD.end};
    const item={appid:row.appid,baseline_status:'not_attempted',status:'running',period_utc:{start:iso(monthly.start*1000),end_inclusive:iso(monthly.end*1000)},
      pages_attempted:0,returned_reviews:0,unique_reviews:0,duplicate_reviews:0,total_matching_first:null,total_matching_stable:true,
      terminal_empty_page_seen:false,complete:false,pagination_stop:null,partition:null,inclusive_boundary:null};
    report.date_probes.push(item);
    const ids=new Set();let cursor='*',lastTimestamp=null,boundary=null;
    for(let page=0;page<LIMITS.window_page_cap;page++){
      item.pages_attempted++;
      const p=await query(row,'reviews_all_time','date_month_pagination',{window:monthly,cursor,pageSize:LIMITS.review_page_size});
      if(page===0){item.total_matching_first=p.aggregate.total_matching;boundary=p.timestamps[0]??null;}
      else if(item.total_matching_first!==p.aggregate.total_matching)item.total_matching_stable=false;
      if(lastTimestamp!==null&&p.timestamps.length&&p.timestamps[0]>lastTimestamp)fail('pagination_sort_out_of_order');
      if(p.timestamps.length)lastTimestamp=p.timestamps.at(-1);
      for(const id of p.ids){if(ids.has(id))item.duplicate_reviews++;ids.add(id);}
      item.returned_reviews+=p.ids.length;item.unique_reviews=ids.size;
      if(p.ids.length===0){item.terminal_empty_page_seen=true;item.pagination_stop='terminal_empty_page';break;}
      if(p.cursor===cursor) {item.pagination_stop='cursor_did_not_advance';fail('cursor_did_not_advance');}
      cursor=p.cursor;
      if(page===LIMITS.window_page_cap-1)item.pagination_stop='bounded_page_cap';
    }
    item.complete=item.terminal_empty_page_seen&&item.total_matching_stable&&item.duplicate_reviews===0&&item.unique_reviews===item.total_matching_first;
    const left=await query(row,'reviews_all_time','date_left_partition',{window:{start:PERIOD.start,end:PERIOD.split-1},pageSize:1});
    const right=await query(row,'reviews_all_time','date_right_partition',{window:{start:PERIOD.split,end:PERIOD.end},pageSize:1});
    item.partition={left:{start_utc:iso(PERIOD.start*1000),end_inclusive_utc:iso((PERIOD.split-1)*1000),total_matching:left.aggregate.total_matching},
      right:{start_utc:iso(PERIOD.split*1000),end_inclusive_utc:iso(PERIOD.end*1000),total_matching:right.aggregate.total_matching},
      disjoint_no_gap:true,sum_matches_month:left.aggregate.total_matching+right.aggregate.total_matching===item.total_matching_first,
      interpretation:'Query consistency check across surviving records; not immutable historical truth.'};
    if(boundary!==null){
      const point=await query(row,'reviews_all_time','date_inclusive_boundary',{window:{start:boundary,end:boundary},pageSize:LIMITS.review_page_size});
      item.inclusive_boundary={timestamp_utc:iso(boundary*1000),total_matching:point.aggregate.total_matching,
        returned_count:point.aggregate.returned_count,all_returned_equal_boundary:point.timestamps.every(t=>t===boundary),
        exercised:point.aggregate.returned_count>0};
    }else item.inclusive_boundary={exercised:false,reason:'month_had_no_reviews'};
    item.status=item.complete&&item.partition.sum_matches_month&&item.inclusive_boundary.exercised?'checks_passed':'inconclusive';
    await onCheckpoint(report);
  }
  try{
    for(const row of rows)for(const method of ['current_players','reviews_all_time'])await query(row,method,'current_snapshot');
    if(mode==='cohort'||mode==='dates')for(const appid of cohort.original_date_probe_appids)await dateProbe(cohort.targets.find(x=>x.appid===appid));
    report.status='completed';
  }catch(e){report.status='stopped';report.stop_reason=e instanceof ProbeError?e.code:'internal_error';}
  for(const probe of report.date_probes){
    const pages=report.observations.filter(o=>o.appid===probe.appid&&o.purpose==='date_month_pagination');
    probe.pages_attempted=pages.length;
    probe.pages_successful=pages.filter(o=>o.status==='success').length;
    if(probe.status==='running'){probe.status='incomplete';probe.stop_reason=report.stop_reason;}
  }
  for(const row of cohort.targets)for(const method of ['current_players','reviews_all_time']){
    const o=report.observations.find(o=>o.appid===row.appid&&o.method===method&&o.purpose==='current_snapshot');
    report.targets.push({appid:row.appid,name:row.name,cohort:row.cohort,editorial_group:row.editorial_group,selection_review_band:row.selection_review_band,method,
      baseline_status:row.baseline_status[method],baseline_category:baselineCategory(row,method),status:o?.status??'not_attempted',sequence:o?.sequence??null});
  }
  report.date_probe_targets=cohort.original_date_probe_appids.map(appid=>({appid,baseline_status:'not_attempted',status:report.date_probes.find(x=>x.appid===appid)?.status??'not_attempted'}));
  report.coverage=coverage(cohort.targets,report.observations);
  report.baseline_category_counts=['previous_failed_target','original_unattempted_target','supplement_unattempted_target','baseline_success_recheck'].map(category=>{
    const targets=report.targets.filter(t=>t.baseline_category===category);return {category,total:targets.length,success:targets.filter(t=>t.status==='success').length,failed:targets.filter(t=>t.status==='failed').length,not_attempted:targets.filter(t=>t.status==='not_attempted').length};});
  report.healthy=report.status==='completed'&&report.request_counts.failed===0&&report.request_counts.successful===(mode==='pilot'?6:report.request_counts.attempted);
  report.review_window_verdict=mode==='pilot'?'not_attempted':report.date_probes.length===6&&report.date_probes.every(x=>x.status==='checks_passed')?'bounded_six_window_checks_passed':'inconclusive_or_incomplete';
  report.finished_at=iso(now());report.wall_time_ms=Math.max(0,now()-start);
  await onCheckpoint(report);return report;
}

export function validatePilot(report,{fingerprint,now=Date.now(),pilotAppids=[1472660,916350,2379780]}={}){
  if(!object(report)||report.schema_version!=='1.0'||report.kind!=='live'||report.mode!=='pilot'||report.status!=='completed'||report.healthy!==true||report.bundle_fingerprint!==fingerprint)fail('healthy_matching_live_pilot_required');
  if(report.request_counts?.attempted!==6||report.request_counts?.successful!==6||report.request_counts?.failed!==0||report.observations?.length!==6)fail('invalid_pilot_evidence');
  if(!report.observations.every(o=>o.status==='success'&&o.http_status===200))fail('invalid_pilot_evidence');
  const expected=new Set(pilotAppids.flatMap(appid=>['current_players','reviews_all_time'].map(method=>`${appid}:${method}`)));
  for(const o of report.observations){
    if(o.purpose!=='current_snapshot'||!expected.delete(`${o.appid}:${o.method}`))fail('invalid_pilot_targets');
    const spec=requestSpec(o.appid,o.method);
    if(o.endpoint!==spec.endpoint||JSON.stringify(o.filters)!==JSON.stringify(spec.filters))fail('invalid_pilot_filters');
  }
  if(expected.size)fail('invalid_pilot_targets');
  const time=Date.parse(report.finished_at);if(!Number.isFinite(time)||time>now+300000||now-time>86400000)fail('pilot_must_be_within_24_hours');
  return true;
}


export function validateCurrentProof(report,{appids,now=Date.now(),fingerprint='d586666a47bc008cd243a3cf436503de9f48291cbf4bda8e0c22976f55943388'}={}) {
  if(!object(report)||report.schema_version!=='1.0'||report.kind!=='live'||report.mode!=='cohort'||report.bundle_fingerprint!==fingerprint)fail('matching_live_cohort_proof_required');
  const current=report.observations?.filter(o=>o.purpose==='current_snapshot');
  if(!Array.isArray(appids)||appids.length!==36||new Set(appids).size!==36||current?.length!==72)fail('invalid_cohort_proof');
  const expected=new Set(appids.flatMap(appid=>['current_players','reviews_all_time'].map(method=>`${appid}:${method}`)));
  const start=Date.parse(report.started_at),end=Date.parse(report.finished_at);
  if(!Number.isFinite(start)||!Number.isFinite(end)||end<start||end-start>LIMITS.run_timeout_ms||end>now+300000||now-end>86400000)fail('cohort_proof_must_be_recent_and_bounded');
  for(const o of current){
    if(!expected.delete(`${o.appid}:${o.method}`)||o.status!=='success'||o.http_status!==200)fail('invalid_cohort_proof');
    const spec=requestSpec(o.appid,o.method);
    if(o.endpoint!==spec.endpoint||JSON.stringify(o.filters)!==JSON.stringify(spec.filters))fail('invalid_cohort_proof_filters');
    const a=Date.parse(o.requested_at),b=Date.parse(o.completed_at);
    if(!Number.isFinite(a)||!Number.isFinite(b)||a<start||b<a||b>end)fail('invalid_cohort_proof_timestamps');
    if(o.method==='current_players'){if(!uint(o.aggregate?.player_count))fail('invalid_cohort_proof_aggregate');}
    else {const t=o.aggregate?.query_summary_score_totals;if(!object(t)||!uint(t.total_reviews)||!uint(t.total_positive)||!uint(t.total_negative)||t.total_positive+t.total_negative!==t.total_reviews||o.aggregate.total_matching!==t.total_reviews)fail('invalid_cohort_proof_aggregate');}
  }
  if(expected.size)fail('invalid_cohort_proof');
  // This recovery gate is deliberately limited to the observed HTTP-200 schema
  // anomaly. A denial, network failure, different error or current-metric failure
  // is not admitted as authority to rerun anything.
  const tail=report.observations.filter(o=>o.purpose!=='current_snapshot');
  if(report.status!=='stopped'||report.stop_reason!=='invalid_reviews_schema'||tail.length!==1||tail[0].purpose!=='date_month_pagination'||tail[0].appid!==730050||tail[0].http_status!==200||tail[0].status!=='failed'||tail[0].error_code!=='invalid_reviews_schema'||report.request_counts?.attempted!==73||report.request_counts?.successful!==72||report.request_counts?.failed!==1)fail('only_observed_http200_schema_recovery_allowed');
  return {run_id:report.run_id,started_at:report.started_at,finished_at:report.finished_at,accepted_current_player_games:36,accepted_review_games:36,prior_failure_reclassified:false,prior_stop_reason:report.stop_reason};
}
