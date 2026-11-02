import { request as httpsRequest } from 'node:https';
import { setTimeout as sleep } from 'node:timers/promises';
import { routeAgent } from './steam-catalog-probe.mjs';

export const ENDPOINTS = Object.freeze({token:'https://id.twitch.tv/oauth2/token',igdb:'https://api.igdb.com/v4/games',sources:'https://api.igdb.com/v4/external_game_sources',gameTypes:'https://api.igdb.com/v4/game_types',steamCatalog:'https://api.steampowered.com/IStoreService/GetAppList/v1/',players:'https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/',reviews:'https://api.steampowered.com/IUserReviewsService/GetAppReviews/v1/'});
export const IGDB_LIMITS = Object.freeze({maxRequests:180,maxPages:60,maxBytes:67108864,maxResponseBytes:2097152,maxRuntimeMs:720000,requestTimeoutMs:20000,maxRetries:2,minIntervalMs:1000,maxGames:450});
export const STEAM_LIMITS = Object.freeze({maxRequests:1200,maxPages:1000,maxBytes:16777216,maxResponseBytes:131072,maxRuntimeMs:1500000,requestTimeoutMs:15000,maxRetries:2,minIntervalMs:1000,maxGames:500});
export const STEAM_CATALOG_LIMITS = Object.freeze({maxRequests:36,maxPages:12,maxBytes:67108864,maxResponseBytes:16777216,maxRuntimeMs:720000,requestTimeoutMs:30000,maxRetries:2,minIntervalMs:1000,maxGames:500});
export class CollectionError extends Error { constructor(code) { super(code); this.code = code; } }
const credential = value => typeof value === 'string' && /^[\x21-\x7e]{1,4096}$/.test(value);
const allowed = url => {
  const base = `${url.origin}${url.pathname}`;
  return Object.values(ENDPOINTS).includes(base) && !url.username && !url.password && !url.hash;
};
export function validateRequestUrl(url,body) {
  if(!allowed(url)||url.search.length>16384)throw new CollectionError('endpoint_blocked');
  const base=`${url.origin}${url.pathname}`;
  if([ENDPOINTS.token,ENDPOINTS.igdb,ENDPOINTS.sources,ENDPOINTS.gameTypes].includes(base)) {
    if(url.search||!body)throw new CollectionError('request_parameters_blocked');
  } else if(base===ENDPOINTS.steamCatalog) {
    if(body||[...url.searchParams.keys()].join(',')!=='key,input_json'||! /^[a-fA-F0-9]{32}$/.test(url.searchParams.get('key')??''))throw new CollectionError('request_parameters_blocked');
    let input;try{input=JSON.parse(url.searchParams.get('input_json'));}catch{throw new CollectionError('request_parameters_blocked');}
    validateCatalogInput(input);
  } else {
    if(body)throw new CollectionError('request_parameters_blocked');
    if(base===ENDPOINTS.players) {
      if([...url.searchParams.keys()].join(',')!=='appid'||!/^\d+$/.test(url.searchParams.get('appid')??''))throw new CollectionError('request_parameters_blocked');
      const id=Number(url.searchParams.get('appid'));if(!Number.isSafeInteger(id)||id<1||id>4294967295)throw new CollectionError('invalid_appid');
    } else {
      if([...url.searchParams.keys()].join(',')!=='input_json')throw new CollectionError('request_parameters_blocked');
      let input;try{input=JSON.parse(url.searchParams.get('input_json'));}catch{throw new CollectionError('request_parameters_blocked');}
      if(!Number.isSafeInteger(input?.appid)||input.appid<1||input.appid>4294967295)throw new CollectionError('invalid_appid');
      const expected={appid:input.appid,filter:1,languages:['all'],review_type:0,purchase_type:0,filter_offtopic_activity:true,display_language:'english',num_per_page:1,cursor:'*'};
      if(JSON.stringify(input)!==JSON.stringify(expected))throw new CollectionError('request_parameters_blocked');
    }
  }
}
export function validateCatalogInput(input) {
  if(!Number.isSafeInteger(input?.last_appid)||input.last_appid<0||input.last_appid>4294967295)throw new CollectionError('invalid_catalog_cursor');
  const expected={include_games:true,include_dlc:false,include_software:false,include_videos:false,include_hardware:false,last_appid:input.last_appid,max_results:50000};
  if(JSON.stringify(input)!==JSON.stringify(expected))throw new CollectionError('request_parameters_blocked');
}
/** Reads bounded JSON over verified TLS; does not follow redirects or log bodies. */
export function wireRequest({endpoint,headers={},body='',timeoutMs,maxBytes,request=httpsRequest,agentFactory=routeAgent}) {
  return new Promise(resolve => {
    let req, response, agent, settled=false, bytes=0;
    const finish = result => { if (settled) return; settled=true; clearTimeout(timer); response?.destroy(); req?.destroy(); agent?.destroy(); resolve({...result,bytes}); };
    const timer=setTimeout(() => finish({errorCode:'request_timeout'}),timeoutMs);
    try {
      const url=new URL(endpoint);
      validateRequestUrl(url,body);
      if (Buffer.byteLength(body)>16384) { finish({errorCode:'endpoint_or_payload_blocked'}); return; }
      agent=agentFactory();
      req=request(url,{method:body ? 'POST':'GET',headers:{...headers,accept:'application/json','accept-encoding':'identity',...(body?{'content-length':Buffer.byteLength(body)}:{})},agent,rejectUnauthorized:true,maxHeaderSize:8192},res=>{
        response=res; const status=res.statusCode;
        if (status<200 || status>=300) {
          const retryHeader=res.headers['retry-after'];
          const retryAfter=retryHeader===undefined?0:/^\d+$/.test(retryHeader)?Number(retryHeader):Math.max(0,(Date.parse(retryHeader)-Date.now())/1000)||0;
          finish({httpStatus:status,errorCode:status===401 || status===403?'access_denied':status>=300&&status<400?'redirect_blocked':status===429?'throttled':'http_failure',retryAfter}); return;
        }
        if (!/^application\/json(?:\s*;|$)/i.test(res.headers['content-type']??'')) { finish({errorCode:'invalid_content_type'}); return; }
        if(res.headers['content-encoding']&&res.headers['content-encoding']!=='identity'){finish({errorCode:'unexpected_content_encoding'});return;}
        const chunks=[];
        res.on('data',chunk=>{bytes+=chunk.length;if(bytes>maxBytes)finish({errorCode:'byte_limit'});else chunks.push(chunk);});
        res.on('end',()=>{if(settled)return;try{finish({data:JSON.parse(Buffer.concat(chunks).toString('utf8'))});}catch{finish({errorCode:'invalid_json'});}});
        res.on('error',()=>finish({errorCode:'network_error'}));res.on('aborted',()=>finish({errorCode:'network_error'}));res.on('close',()=>{if(!res.complete)finish({errorCode:'network_error'});});
      });
      req.on('error',()=>finish({errorCode:'network_error'}));req.end(body);
    } catch { finish({errorCode:'network_error'}); }
  });
}
/** A run owns immutable limits and cumulative counters, including failed attempts. */
export function createTransport({source,credentials,limits=source==='igdb'?IGDB_LIMITS:source==='steam_catalog'?STEAM_CATALOG_LIMITS:STEAM_LIMITS,wire=wireRequest,now=Date.now,wait=sleep,counters:initial={},onBudget=async()=>{}}={}) {
  if (!['igdb','steam_api','steam_catalog'].includes(source)) throw new CollectionError('invalid_source');
  const caps=Object.freeze({...limits});
  const ceiling=source==='igdb'?IGDB_LIMITS:source==='steam_catalog'?STEAM_CATALOG_LIMITS:STEAM_LIMITS;
  for(const [key,max] of Object.entries(ceiling)) if(!Number.isSafeInteger(caps[key])||caps[key]<0||(key==='minIntervalMs'?caps[key]<max:caps[key]>max)) throw new CollectionError('invalid_limits');
  const counters={requests:0,pages:0,bytes:0,retries:0,elapsedMs:0,...initial};
  for(const key of ['requests','pages','bytes','retries','elapsedMs']) if(!Number.isSafeInteger(counters[key])||counters[key]<0) throw new CollectionError('invalid_counters');
  const started=now(),priorElapsed=counters.elapsedMs;let last=0,token=null,blocked=null;
  const elapsed=()=>{counters.elapsedMs=priorElapsed+Math.max(0,now()-started);return counters.elapsedMs;};
  async function request(endpoint,body='') {
    if(blocked)throw new CollectionError(blocked);
    if(source==='steam_catalog') {
      if(endpoint!==ENDPOINTS.steamCatalog||!/^[a-fA-F0-9]{32}$/.test(credentials?.steamKey??''))throw new CollectionError('steam_credentials_required');
      let input;try{input=JSON.parse(body);}catch{throw new CollectionError('request_parameters_blocked');}validateCatalogInput(input);
      endpoint=`${ENDPOINTS.steamCatalog}?${new URLSearchParams({key:credentials.steamKey,input_json:JSON.stringify(input)})}`;body='';
    }
    let url;try{url=new URL(endpoint);}catch{throw new CollectionError('endpoint_blocked');}
    const base=`${url.origin}${url.pathname}`;
    validateRequestUrl(url,body);
    if(source==='igdb'?![ENDPOINTS.token,ENDPOINTS.igdb,ENDPOINTS.sources,ENDPOINTS.gameTypes].includes(base):source==='steam_catalog'?base!==ENDPOINTS.steamCatalog:![ENDPOINTS.players,ENDPOINTS.reviews].includes(base))throw new CollectionError('endpoint_blocked');
    if(source==='igdb'&&base!==ENDPOINTS.token&&!token)throw new CollectionError('authentication_required');
    for(let attempt=0;attempt<=caps.maxRetries;attempt++) {
      if(counters.requests>=caps.maxRequests)throw new CollectionError('request_limit');
      if(counters.bytes>=caps.maxBytes)throw new CollectionError('byte_limit');
      const delay=Math.max(0,caps.minIntervalMs-(now()-last));
      if(elapsed()+delay>=caps.maxRuntimeMs)throw new CollectionError('runtime_limit');
      if(delay)await wait(delay);
      const remaining=caps.maxRuntimeMs-elapsed();if(remaining<=0)throw new CollectionError('runtime_limit');
      counters.requests++;
      const headers=source==='igdb'?(base===ENDPOINTS.token?{'content-type':'application/x-www-form-urlencoded'}:{'client-id':credentials.clientId,authorization:`Bearer ${token}`,'content-type':'text/plain'}):{};
      const timeoutMs=Math.min(caps.requestTimeoutMs,remaining),maxBytes=Math.min(base===ENDPOINTS.token?16384:caps.maxResponseBytes,caps.maxBytes-counters.bytes);
      // Persist pessimistic reservations before network dispatch. A killed
      // process cannot regain its attempt/byte/time allowance on resume.
      await onBudget({...counters,bytes:counters.bytes+maxBytes,elapsedMs:elapsed()+timeoutMs,pendingReservation:1});
      // Durable storage may be slow. Limits/spacing apply at actual dispatch,
      // not at the earlier checkpoint reservation timestamp.
      const dispatchDelay=Math.max(0,caps.minIntervalMs-(now()-last));
      if(elapsed()+dispatchDelay>=caps.maxRuntimeMs)throw new CollectionError('runtime_limit');
      if(dispatchDelay)await wait(dispatchDelay);
      const dispatchTimeout=Math.min(timeoutMs,caps.maxRuntimeMs-elapsed());
      if(dispatchTimeout<=0)throw new CollectionError('runtime_limit');
      last=now();
      let result;try{result=await wire({endpoint,headers,body,timeoutMs:dispatchTimeout,maxBytes});}catch{result={errorCode:'network_error',bytes:0};}
      counters.bytes+=result.bytes??0;
      elapsed();
      await onBudget({...counters,pendingReservation:0});
      if(result.data!==undefined){
        if(source!=='steam_api'&&base!==ENDPOINTS.token){const encoded=JSON.stringify(result.data);if([credentials?.clientId,credentials?.clientSecret,credentials?.steamKey,token].some(secret=>secret&&(encoded.includes(secret)||encoded.includes(JSON.stringify(secret).slice(1,-1)))))throw new CollectionError('credential_reflection_blocked');}
        return result.data;
      }
      const code=result.errorCode??'network_error';
      if(code==='access_denied'||code==='redirect_blocked'){blocked=code;throw new CollectionError(code);}
      const retryable=base!==ENDPOINTS.token&&(code==='request_timeout'||code==='network_error'||code==='throttled'||[500,502,503,504].includes(result.httpStatus));
      if(!retryable||attempt===caps.maxRetries)throw new CollectionError(code);
      const retryDelay=Math.max(caps.minIntervalMs,(result.retryAfter??0)*1000,1000*2**attempt);
      if(elapsed()+retryDelay>=caps.maxRuntimeMs)throw new CollectionError('runtime_limit');
      counters.retries++;await wait(retryDelay);
    }
    throw new CollectionError('request_failed');
  }
  return {request,counters,limits:caps,async authenticate(){
    if(source!=='igdb'||!credential(credentials?.clientId)||!credential(credentials?.clientSecret))throw new CollectionError('credentials_required');
    if(token)throw new CollectionError('already_authenticated');
    const body=new URLSearchParams({client_id:credentials.clientId,client_secret:credentials.clientSecret,grant_type:'client_credentials'}).toString();
    const data=await request(ENDPOINTS.token,body);
    if(!credential(data?.access_token)||data.token_type?.toLowerCase()!=='bearer')throw new CollectionError('invalid_authentication_response');
    token=data.access_token;
  }};
}
