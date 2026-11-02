import type { Env } from './db.ts';
import { readGames, readSnapshot, searchGames } from './repository.ts';
import { readSettings, updateSettings, validateSettingsPatch } from './settings.ts';
import { readSources } from './source-health.ts';
import { parseResearchSelection, readReleaseResearch, ResearchInputError } from './release-research.ts';

const headers = {'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'same-origin'};
const reply = (body: unknown, status = 200, extra: Record<string,string> = {}) => new Response(JSON.stringify(body),{status,headers:{...headers,...extra}});
const error = (code: string, message: string, status: number) => reply({error:{code,message}},status);
const methodError = (allowed: string) => reply({error:{code:'method_not_allowed',message:`Use ${allowed}.`}},405,{allow:allowed});
class BodyError extends Error { status: number; constructor(message: string, status = 400) { super(message); this.status = status; } }
async function readJson(request: Request): Promise<unknown> {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')) throw new BodyError('Use application/json.',415);
  if (Number(request.headers.get('content-length')) > 4096) throw new BodyError('Settings payload exceeds 4096 bytes.',413);
  const reader = request.body?.getReader(); if (!reader) throw new BodyError('A JSON object is required.');
  const decoder = new TextDecoder(); let body = ''; let size = 0;
  try {
    while (true) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.byteLength; if (size > 4096) { await reader.cancel(); throw new BodyError('Settings payload exceeds 4096 bytes.',413); } body += decoder.decode(chunk.value,{stream:true}); }
    body += decoder.decode();
    try { return JSON.parse(body); } catch { throw new BodyError('Invalid JSON.'); }
  } finally { reader.releaseLock(); }
}

/** Fetch-standard entry point. No Node APIs, credentials, source fetches or model calls. */
export async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url); const path = url.pathname.replace(/\/$/,'');
  try {
    if (path === '/api/health') {
      if (request.method !== 'GET') return methodError('GET');
      const [version, count, jobs] = await Promise.all([env.DB.prepare('SELECT MAX(version) AS version FROM foundation_schema').first<{version:number}>(),env.DB.prepare('SELECT COUNT(*) AS count FROM games').first<{count:number}>(),env.DB.prepare("SELECT COUNT(*) AS count FROM collection_jobs WHERE source IN ('igdb','steam_api','steam_catalog')").first<{count:number}>()]);
      return reply({status:count?.count ? 'ok' : 'unseeded',schemaVersion:version?.version ?? null,gameCount:count?.count ?? 0,mode:jobs?.count?'private_bounded_collection_cache':'offline_preserved_evidence',liveCollectionEnabled:false,boundedLocalCollectionAvailable:true,backgroundCollectionEnabled:false},count?.count ? 200 : 503);
    }
    if (path === '/api/research/releases') {
      if (request.method !== 'GET') return methodError('GET');
      try { return reply(await readReleaseResearch(env.DB, parseResearchSelection(url.searchParams))); }
      catch (failure) { if (failure instanceof ResearchInputError) return error('invalid_research_query',failure.message,400); throw failure; }
    }
    if (path === '/api/sources') {
      if (request.method !== 'GET') return methodError('GET');
      return reply(await readSources(env.DB));
    }
    if (path === '/api/snapshot') {
      if (request.method !== 'GET') return methodError('GET');
      return reply(await readSnapshot(env.DB));
    }
    if (path === '/api/games') {
      if (request.method !== 'GET') return methodError('GET');
      const query = url.searchParams.get('query')?.trim() ?? ''; const genre = url.searchParams.get('genre') ?? '';
      if (query.length > 200 || genre.length > 200) return error('invalid_query','Search inputs must be at most 200 characters.',400);
      const limitString = url.searchParams.get('limit') ?? '100'; const limit = Number(limitString);
      if (!/^\d+$/.test(limitString) || !Number.isInteger(limit) || limit < 1 || limit > 100) return error('invalid_limit','Limit must be an integer from 1 to 100.',400);
      const games = await searchGames(env.DB,query,genre,limit);
      return reply({games,count:games.length,query,genre,limit});
    }
    if (path.startsWith('/api/games/')) {
      if (request.method !== 'GET') return methodError('GET');
      const id = path.slice('/api/games/'.length);
      if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id)) || Number(id) > 4294967295) return error('invalid_appid','Use an exact positive numeric Steam AppID.',400);
      const games = await readGames(env.DB,{appids:[Number(id)]});
      return games.length ? reply(games[0]) : error('game_not_found','This Steam AppID is outside the saved research catalog.',404);
    }
    if (path === '/api/settings') {
      if (request.method === 'GET') return reply(await readSettings(env.DB));
      if (request.method !== 'PATCH') return methodError('GET, PATCH');
      const origin = request.headers.get('origin');
      if ((origin && origin !== url.origin) || request.headers.get('sec-fetch-site') === 'cross-site') return error('cross_origin_write_blocked','Settings changes must originate in this app.',403);
      let patch;
      try { patch = validateSettingsPatch(await readJson(request)); } catch (failure) {
        if (failure instanceof BodyError) return error('invalid_settings',failure.message,failure.status);
        return error('invalid_settings',failure instanceof Error ? failure.message : 'Invalid settings.',400);
      }
      return reply(await updateSettings(env.DB,patch));
    }
    if (path === '/api/chat') {
      if (request.method !== 'POST') return methodError('POST');
      return error('source_not_connected','Research chat is unavailable. No model or live evidence source is connected; no question was sent to a provider.',503);
    }
    return error('not_found','API route not found.',404);
  } catch {
    // Never disclose SQL details, filesystem paths, credentials or provider bodies.
    return error('database_unavailable','The saved research database is unavailable or needs migration. Check its configured path and the existing-installation upgrade instructions. Do not reseed an existing database.',503);
  }
}
export default {fetch:handleRequest};
