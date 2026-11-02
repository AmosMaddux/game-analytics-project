import { request as httpsRequest, Agent } from 'node:https';
import { writeFile, mkdir, lstat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

export const ENDPOINT = 'https://api.steampowered.com/ISteamApps/GetAppList/v2/';
export const LIMITS = Object.freeze({ maxRequests: 1, maxRetries: 0, requestTimeoutMs: 30000, maxBytes: 33554432 });
export function normalizeAppList(data) {
  const rows = data?.applist?.apps;
  if (!Array.isArray(rows) || !rows.length || rows.length > 1000000) throw new Error('invalid_catalog_response');
  const seen = new Map();
  for (const item of rows) {
    if (!Number.isSafeInteger(item?.appid) || item.appid < 1 || item.appid > 4294967295 || typeof item.name !== 'string' || item.name.length > 512 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(item.name)) throw new Error('invalid_catalog_record');
    if (seen.has(item.appid) && seen.get(item.appid) !== item.name) throw new Error('conflicting_catalog_identity');
    seen.set(item.appid, item.name);
  }
  return [...seen].map(([appid,name]) => ({appid,name})).sort((a,b) => a.appid-b.appid);
}
export function routeAgent(env = process.env) {
  const proxyEnv = Object.fromEntries(['HTTP_PROXY','http_proxy','HTTPS_PROXY','https_proxy','NO_PROXY','no_proxy'].filter(key => typeof env[key] === 'string').map(key => [key,env[key]]));
  if ((env.ALL_PROXY || env.all_proxy || env.HTTP_PROXY || env.http_proxy) && !(env.HTTPS_PROXY || env.https_proxy)) throw new Error('unsupported_proxy_configuration');
  for (const key of ['HTTP_PROXY','http_proxy','HTTPS_PROXY','https_proxy']) {
    if (!proxyEnv[key]) continue;
    let url; try { url = new URL(proxyEnv[key]); } catch { throw new Error('unsupported_proxy_configuration'); }
    if (url.username || url.password) throw new Error('proxy_credentials_require_handoff');
    if (!['http:','https:'].includes(url.protocol)) throw new Error('unsupported_proxy_configuration');
  }
  return new Agent({keepAlive:false,maxCachedSessions:0,rejectUnauthorized:true,proxyEnv});
}
/** One keyless request to the documented deprecated endpoint. No fallback/retry. */
export async function probeSteamCatalog({request = httpsRequest, agentFactory = routeAgent, now = () => new Date()} = {}) {
  const startedAt = now().toISOString();
  const result = await new Promise(resolveResult => {
    let req, response, agent, settled = false, bytes = 0;
    const finish = value => { if (settled) return; settled = true; clearTimeout(timer); response?.destroy(); req?.destroy(); agent?.destroy(); resolveResult({...value,bytes}); };
    const timer = setTimeout(() => finish({status:'failed',errorCode:'request_timeout'}),LIMITS.requestTimeoutMs);
    try {
      agent = agentFactory();
      req = request(ENDPOINT,{method:'GET',headers:{accept:'application/json','accept-encoding':'identity'},agent,rejectUnauthorized:true,maxHeaderSize:8192},res => {
        response = res;
        if (res.statusCode !== 200) { finish({status:'failed',errorCode:res.statusCode === 401 || res.statusCode === 403 ? 'access_denied' : res.statusCode >= 300 && res.statusCode < 400 ? 'redirect_blocked' : 'http_failure',httpStatus:res.statusCode}); return; }
        if (!/^application\/json(?:\s*;|$)/i.test(res.headers['content-type'] ?? '')) { finish({status:'failed',errorCode:'invalid_content_type'}); return; }
        if (res.headers['content-encoding'] && res.headers['content-encoding'] !== 'identity') { finish({status:'failed',errorCode:'unexpected_content_encoding'}); return; }
        const chunks = [];
        res.on('data',chunk => { bytes += chunk.length; if (bytes > LIMITS.maxBytes) finish({status:'failed',errorCode:'byte_limit'}); else chunks.push(chunk); });
        res.on('end',() => { if (settled) return; try { const apps = normalizeAppList(JSON.parse(Buffer.concat(chunks).toString('utf8'))); finish({status:'complete',apps}); } catch { finish({status:'failed',errorCode:'invalid_catalog_response'}); } });
        res.on('error',() => finish({status:'failed',errorCode:'network_error'}));
        res.on('aborted',() => finish({status:'failed',errorCode:'network_error'}));
        res.on('close',() => { if (!res.complete) finish({status:'failed',errorCode:'network_error'}); });
      });
      req.on('error',() => finish({status:'failed',errorCode:'network_error'}));
      req.end();
    } catch { finish({status:'failed',errorCode:'network_error'}); }
  });
  return {version:'steam-catalog-evidence-1.0',source:'Steam',sourceUrl:ENDPOINT,sourceStatus:'deprecated_endpoint_single_run_only',startedAt,collectedAt:now().toISOString(),limits:LIMITS,...result};
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length !== 3 || process.argv[2] !== '--run') { console.error('Run personally: node collectors/steam-catalog-probe.mjs --run'); process.exitCode = 2; }
  else {
    const result = await probeSteamCatalog();
    const output = resolve(import.meta.dirname,`../.data/steam-catalog-${randomUUID()}.json`);
    await mkdir(dirname(output),{recursive:true});
    if ((await lstat(dirname(output))).isSymbolicLink()) throw new Error('output_symlink_blocked');
    await writeFile(output,JSON.stringify(result)+'\n',{mode:0o600,flag:'wx'});
    console.log(JSON.stringify({status:result.status,errorCode:result.errorCode ?? null,appCount:result.apps?.length ?? 0,bytes:result.bytes,output,deprecated:true}));
    if (result.status !== 'complete') process.exitCode = 1;
  }
}
