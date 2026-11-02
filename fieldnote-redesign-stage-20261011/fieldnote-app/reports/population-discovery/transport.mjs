import { request as httpsRequest, Agent } from 'node:https';
import { setTimeout as sleep } from 'node:timers/promises';
import { ENDPOINTS, LIMITS, SafeError, nonnegative, object } from './domain.mjs';
const credential = value => typeof value === 'string' && /^[\x21-\x7e]{8,4096}$/.test(value);
const safeCredential = value => credential(value) && !/[\r\n]/.test(value);
export const emptyBudget = () => ({requests:0,retries:0,igdbPages:0,steamPages:0,igdbBytes:0,steamBytes:0,elapsedMs:0,pendingReservation:false,blocked:null});
export function validateBudget(budget) {
  for (const name of ['requests','retries','igdbPages','steamPages','igdbBytes','steamBytes','elapsedMs']) if (!nonnegative(budget?.[name])) throw new SafeError('invalid_budget_checkpoint');
  if (typeof budget.pendingReservation !== 'boolean' || (budget.blocked !== null && !/^[a-z_]+$/.test(budget.blocked))) throw new SafeError('invalid_budget_checkpoint');
}
export function proxyAgent(env = process.env) {
  const names = ['HTTP_PROXY','http_proxy','HTTPS_PROXY','https_proxy','NO_PROXY','no_proxy'];
  const proxyEnv = Object.fromEntries(names.filter(name=>typeof env[name]==='string').map(name=>[name,env[name]]));
  if ((env.ALL_PROXY || env.all_proxy || env.HTTP_PROXY || env.http_proxy) && !(env.HTTPS_PROXY || env.https_proxy)) throw new SafeError('unsupported_proxy_configuration');
  for (const name of ['HTTP_PROXY','http_proxy','HTTPS_PROXY','https_proxy']) if (proxyEnv[name]) { let url; try {url=new URL(proxyEnv[name]);} catch {throw new SafeError('unsupported_proxy_configuration');} if(!['https:','http:'].includes(url.protocol)||url.username||url.password)throw new SafeError('unsupported_proxy_configuration'); }
  return new Agent({keepAlive:false,maxCachedSessions:0,rejectUnauthorized:true,proxyEnv});
}
/** No redirects, credential logs, response-error bodies, or endpoint fallback. */
export function wireRequest({endpoint,headers={},body='',timeoutMs,maxBytes,request=httpsRequest,agentFactory=proxyAgent}) {
  return new Promise(resolve=>{
    let req,res,agent,settled=false,bytes=0;
    const finish=result=>{if(settled)return;settled=true;clearTimeout(timer);res?.destroy();req?.destroy();agent?.destroy();resolve({...result,bytes});};
    const timer=setTimeout(()=>finish({code:'request_timeout'}),timeoutMs);
    try {
      const url=new URL(endpoint), base=`${url.origin}${url.pathname}`;
      if(!Object.values(ENDPOINTS).includes(base)||url.username||url.password||url.hash||Buffer.byteLength(body)>16384)throw new SafeError('endpoint_blocked');
      if(base!==ENDPOINTS.steam && url.search)throw new SafeError('endpoint_blocked');
      if(base===ENDPOINTS.steam && [...url.searchParams.keys()].join(',')!=='key,input_json')throw new SafeError('endpoint_blocked');
      agent=agentFactory();
      req=request(url,{method:body?'POST':'GET',agent,rejectUnauthorized:true,maxHeaderSize:8192,headers:{...headers,accept:'application/json','accept-encoding':'identity',...(body?{'content-length':Buffer.byteLength(body)}:{})}},response=>{
        res=response; const status=res.statusCode;
        if(status!==200){finish({status,code:status===401||status===403?'access_denied':status===429?'throttled':status>=300&&status<400?'redirect_blocked':'http_failure'});return;}
        if(!/^application\/json(?:\s*;|$)/i.test(res.headers['content-type']??'')){finish({code:'invalid_content_type'});return;}
        if(res.headers['content-encoding']&&res.headers['content-encoding']!=='identity'){finish({code:'unexpected_content_encoding'});return;}
        const chunks=[];
        res.on('data',chunk=>{bytes+=chunk.length;if(bytes>maxBytes)finish({code:'response_byte_limit'});else chunks.push(chunk);});
        res.on('end',()=>{if(settled)return;try{finish({data:JSON.parse(Buffer.concat(chunks).toString('utf8'))});}catch{finish({code:'invalid_json'});}});
        res.on('error',()=>finish({code:'network_error'}));res.on('aborted',()=>finish({code:'network_error'}));res.on('close',()=>{if(!res.complete)finish({code:'network_error'});});
      });
      req.on('error',()=>finish({code:'network_error'}));req.end(body);
    } catch(error){finish({code:error instanceof SafeError?error.code:'network_error'});}
  });
}
/** Pre-dispatch pessimistic reservations are durable; restart never grants a new budget. */
export function createTransport({credentials,initial=emptyBudget(),saveBudget=async()=>{},wire=wireRequest,now=Date.now,wait=sleep}={}) {
  validateBudget(initial);
  const budget={...initial}, start=now(), prior=budget.elapsedMs;
  let last=now(), token=credentials?.accessToken??null, inFlight=false;
  const elapsed=()=>prior+Math.max(0,now()-start);
  const persist=async()=>saveBudget({...budget});
  async function request(endpoint,body='') {
    if(inFlight)throw new SafeError('concurrent_request_blocked');
    if(budget.blocked)throw new SafeError(budget.blocked);
    if(!Object.values(ENDPOINTS).includes(endpoint))throw new SafeError('endpoint_blocked');
    const auth=endpoint===ENDPOINTS.token, steam=endpoint===ENDPOINTS.steam;
    if(!steam && !auth && (!safeCredential(credentials?.clientId)||!safeCredential(token)))throw new SafeError('authentication_required');
    if(steam&&!/^[a-fA-F0-9]{32}$/.test(credentials?.steamKey??''))throw new SafeError('steam_key_required');
    if(!auth && !steam && (!body || body.length>16384 || !/^fields /.test(body)))throw new SafeError('invalid_query');
    let requestUrl=endpoint;
    if(steam){let input;try{input=JSON.parse(body);}catch{throw new SafeError('invalid_steam_input');}const expected={include_games:true,include_dlc:false,include_software:false,include_videos:false,include_hardware:false,last_appid:input?.last_appid,max_results:50000};if(!nonnegative(input?.last_appid)||input.last_appid>4294967295||JSON.stringify(input)!==JSON.stringify(expected))throw new SafeError('invalid_steam_input');requestUrl=`${endpoint}?${new URLSearchParams({key:credentials.steamKey,input_json:body})}`;body='';}
    const pageField=steam?'steamPages':'igdbPages', byteField=steam?'steamBytes':'igdbBytes';
    if(!auth && budget[pageField]>=(steam?LIMITS.steamPages:LIMITS.igdbPages))throw new SafeError('page_limit');
    inFlight=true;
    try {
      if(!auth)budget[pageField]++;
      for(let attempt=0;attempt<=LIMITS.retries;attempt++){
        if(budget.requests>=LIMITS.requests)throw new SafeError('request_limit');
        const remainingBytes=(steam?LIMITS.steamBytes:LIMITS.igdbBytes)-budget[byteField];
        if(remainingBytes<=0)throw new SafeError('byte_limit');
        const delay=Math.max(0,LIMITS.minIntervalMs-(now()-last));
        if(elapsed()+delay>=LIMITS.runtimeMs)throw new SafeError('runtime_limit');
        if(delay)await wait(delay);
        const timeoutMs=Math.min(steam?LIMITS.steamTimeoutMs:LIMITS.requestTimeoutMs,LIMITS.runtimeMs-elapsed());
        if(timeoutMs<=0)throw new SafeError('runtime_limit');
        const maxBytes=Math.min(auth?LIMITS.tokenResponseBytes:steam?LIMITS.steamResponseBytes:LIMITS.igdbResponseBytes,remainingBytes);
        budget.requests++;if(attempt)budget.retries++;
        budget.elapsedMs=elapsed();
        const reservation={...budget,[byteField]:budget[byteField]+maxBytes,elapsedMs:Math.min(LIMITS.runtimeMs,elapsed()+timeoutMs),pendingReservation:true};
        await saveBudget(reservation);
        if(elapsed()>=LIMITS.runtimeMs)throw new SafeError('runtime_limit');
        last=now();
        const headers=steam?{}:auth?{'content-type':'application/x-www-form-urlencoded'}:{'client-id':credentials.clientId,authorization:`Bearer ${token}`,'content-type':'text/plain'};
        let result;try{result=await wire({endpoint:requestUrl,headers,body,timeoutMs:Math.min(timeoutMs,LIMITS.runtimeMs-elapsed()),maxBytes});}catch{result={code:'network_error',bytes:0};}
        if(!nonnegative(result?.bytes))throw new SafeError('invalid_wire_result');
        budget[byteField]+=result.bytes;budget.elapsedMs=elapsed();budget.pendingReservation=false;
        const code=result.code??'network_error';
        if(['access_denied','throttled','redirect_blocked','invalid_content_type','unexpected_content_encoding'].includes(code))budget.blocked=code;
        await persist();
        if(result.bytes>maxBytes)throw new SafeError('response_byte_limit');
        if(Object.hasOwn(result,'data')){
          if(!auth){const json=JSON.stringify(result.data);if([credentials?.clientId,credentials?.clientSecret,credentials?.accessToken,credentials?.steamKey,token].filter(Boolean).some(secret=>json.includes(secret)||json.includes(JSON.stringify(secret).slice(1,-1)))){budget.blocked='credential_reflection_blocked';await persist();throw new SafeError(budget.blocked);}}
          return result.data;
        }
        if(budget.blocked)throw new SafeError(budget.blocked);
        const retryable=!auth && (['network_error','request_timeout'].includes(code)||[500,502,503,504].includes(result.status));
        if(!retryable||attempt===LIMITS.retries)throw new SafeError(code);
        const retryDelay=1000*2**attempt;
        if(elapsed()+retryDelay>=LIMITS.runtimeMs)throw new SafeError('runtime_limit');
        await wait(retryDelay);
      }
    } finally {inFlight=false;}
  }
  return {request,budget,async authenticate(){
    if(token){if(!safeCredential(token)||!safeCredential(credentials?.clientId))throw new SafeError('invalid_provided_token');return 'user_provided_token';}
    if(!safeCredential(credentials?.clientId)||!safeCredential(credentials?.clientSecret))throw new SafeError('igdb_credentials_required');
    const result=await request(ENDPOINTS.token,new URLSearchParams({client_id:credentials.clientId,client_secret:credentials.clientSecret,grant_type:'client_credentials'}).toString());
    if(!object(result)||!safeCredential(result.access_token)||result.token_type?.toLowerCase()!=='bearer')throw new SafeError('invalid_auth_response');
    token=result.access_token;return 'user_executed_client_credentials';
  }};
}
