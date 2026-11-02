import { createHash } from 'node:crypto';
export const VERSION = 'fieldnote-population-discovery-1.0';
export const ENDPOINTS = Object.freeze({ token: 'https://id.twitch.tv/oauth2/token', games: 'https://api.igdb.com/v4/games', releases: 'https://api.igdb.com/v4/release_dates', sources: 'https://api.igdb.com/v4/external_game_sources', types: 'https://api.igdb.com/v4/game_types', steam: 'https://api.steampowered.com/IStoreService/GetAppList/v1/' });
export const LIMITS = Object.freeze({ candidates: 1000, discoveryPages: 40, igdbPages: 60, steamPages: 12, pageSize: 100, requests: 180, retries: 2, igdbBytes: 64 * 1024 * 1024, steamBytes: 64 * 1024 * 1024, igdbResponseBytes: 2 * 1024 * 1024, steamResponseBytes: 16 * 1024 * 1024, tokenResponseBytes: 16384, runtimeMs: 12 * 60 * 1000, requestTimeoutMs: 20000, steamTimeoutMs: 30000, minIntervalMs: 1000, concurrency: 1 });
export class SafeError extends Error { constructor(code) { super(code); this.code = code; } }
export const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const uint = value => Number.isSafeInteger(value) && value > 0 && value <= 4294967295;
export const nonnegative = value => Number.isSafeInteger(value) && value >= 0;
export const ref = value => uint(value?.id) ? value.id : uint(value) ? value : null;
export const textValue = (value, max = 512) => typeof value === 'string' && value.trim() && value.length <= max && !/[\x00-\x1f\x7f]/.test(value) ? value : null;
export const key = value => (textValue(value) ?? '').normalize('NFKC').toLowerCase().replace(/[ _-]/g, '');
export const clone = value => JSON.parse(JSON.stringify(value));
export const hash = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
export const iso = value => nonnegative(value) && value <= 253402300799 ? new Date(value * 1000).toISOString() : null;
export function validTime(value) { return typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value; }
export function makePlan(asOf = new Date().toISOString()) {
  if (!validTime(asOf)) throw new SafeError('invalid_as_of');
  const date = new Date(asOf), end = Math.floor(date.getTime() / 1000), year = date.getUTCFullYear();
  if (year < 1976 || year > 9998) throw new SafeError('invalid_as_of');
  return { version: VERSION, asOf, limits: LIMITS, selection: 'population_first_id_ascending_bounded_not_representative', streams: [
    { id: 'recent_pc_90_days', kind: 'releases', start: end - 90 * 86400, end, target: 400, maxPages: 16 },
    ...Array.from({ length: 5 }, (_, index) => { const y = year - 5 + index; return { id: `older_pc_${y}`, kind: 'releases', start: Date.UTC(y, 0, 1) / 1000, end: Date.UTC(y + 1, 0, 1) / 1000, target: 100, maxPages: 4 }; }),
    { id: 'broad_desktop', kind: 'games', start: null, end: null, target: 100, maxPages: 4 },
  ] };
}
const NAMED_FIELDS = ['genres', 'themes', 'keywords', 'game_modes', 'player_perspectives'].flatMap(field => [`${field}.id`, `${field}.name`]);
export const GAME_FIELDS = ['id', 'name', 'url', 'updated_at', 'first_release_date', 'parent_game', 'version_parent', 'version_title', 'game_type.id', 'game_type.type', 'platforms.id', 'platforms.name', 'platforms.abbreviation', ...NAMED_FIELDS, ...['id','date','human','y','m','d','updated_at','platform.id','platform.name','date_format.id','date_format.format','release_region.id','release_region.region','status.id','status.name'].map(field => `release_dates.${field}`), ...['id','uid','game','external_game_source.id','external_game_source.name','url','platform','updated_at'].map(field => `external_games.${field}`)].join(',');
export function buildQuery(stream, afterId = 0, limit = LIMITS.pageSize) {
  if (!nonnegative(afterId) || afterId > 4294967295 || !uint(limit) || limit > LIMITS.pageSize) throw new SafeError('invalid_query_cursor');
  if (stream.kind === 'games') return `fields id; where game_type = 0 & parent_game = null & version_parent = null & platforms = (3,6,14) & external_games.external_game_source = 1 & id > ${afterId}; sort id asc; limit ${limit};`;
  if (stream.kind !== 'releases' || !nonnegative(stream.start) || !nonnegative(stream.end) || stream.start >= stream.end) throw new SafeError('invalid_release_interval');
  return `fields id,game,platform,date; where platform = 6 & date >= ${stream.start} & date < ${stream.end} & game.game_type = 0 & game.parent_game = null & game.version_parent = null & game.external_games.external_game_source = 1 & id > ${afterId}; sort id asc; limit ${limit};`;
}
export function metadataQuery(ids) {
  if (!Array.isArray(ids) || !ids.length || ids.length > LIMITS.pageSize || ids.some(id => !uint(id)) || new Set(ids).size !== ids.length) throw new SafeError('invalid_metadata_ids');
  return `fields ${GAME_FIELDS}; where id = (${[...ids].sort((a,b) => a-b).join(',')}); sort id asc; limit ${ids.length};`;
}
function named(item, field = 'name', zero = false) { const id = ref(item) ?? (zero && item?.id === 0 ? 0 : null); return id === null ? null : { id, [field]: textValue(item?.[field]) }; }
function safeUrl(value, host) { if (!textValue(value, 2048)) return null; try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.search && !url.hash && (!host || [host,`www.${host}`].includes(url.hostname)) ? url.href : null; } catch { return null; } }
export function exactSteamUrl(value, appid) { const clean = safeUrl(value, 'store.steampowered.com'); return Boolean(clean && new URL(clean).hostname === 'store.steampowered.com' && /^\/app\/([1-9]\d*)\/?$/.exec(new URL(clean).pathname)?.[1] === String(appid)); }
function labels(raw, field) { return (raw[field] ?? []).map(item => named(item)).filter(Boolean); }
function releases(raw, fetchedAt) { return (raw.release_dates ?? []).map(item => ({ id: ref(item), date: iso(item?.date), rawDate: nonnegative(item?.date) ? item.date : null, human: textValue(item?.human), year: nonnegative(item?.y) ? item.y : null, month: nonnegative(item?.m) ? item.m : null, day: nonnegative(item?.d) ? item.d : null, platform: named(item?.platform), dateFormat: named(item?.date_format, 'format', true), region: named(item?.release_region, 'region', true), status: named(item?.status, 'name', true), sourceUpdatedAt: iso(item?.updated_at), source: 'IGDB', fetchedAt, scope: 'IGDB platform/region release, not Steam first-playable evidence' })).filter(item => item.id); }
export function selectPcDate(releaseDates, asOf) {
  const pc = releaseDates.filter(item => item.platform?.id === 6);
  const playable = item => item.status === null || ['fullrelease','earlyaccess'].includes(key(item.status?.name));
  const exact = item => item.dateFormat?.id === 0 && ['yyyymmdd','yyyymmmmdd'].includes(key(item.dateFormat.format)) && item.date && item.date <= asOf && playable(item);
  const exactRows = pc.filter(exact).sort((a,b) => a.date.localeCompare(b.date) || a.id-b.id);
  if (!exactRows.length) return { date: null, precision: 'unknown', evidenceId: null, reason: 'no_exact_past_playable_pc_date' };
  const first = exactRows[0];
  const earliestPossible = item => {
    if (!item.date) return null;
    const year = item.year ?? Number(item.date.slice(0,4));
    const month = item.month ?? Number(item.date.slice(5,7));
    if (item.dateFormat?.id === 0) return item.date;
    if (item.dateFormat?.id === 1 && year >= 1 && year <= 9999 && month >= 1 && month <= 12) return `${String(year).padStart(4,'0')}-${String(month).padStart(2,'0')}-01T00:00:00.000Z`;
    if (item.dateFormat?.id === 2 && year >= 1 && year <= 9999) return `${String(year).padStart(4,'0')}-01-01T00:00:00.000Z`;
    if ([3,4,5,6].includes(item.dateFormat?.id) && year >= 1 && year <= 9999) return `${String(year).padStart(4,'0')}-${String((item.dateFormat.id-3)*3+1).padStart(2,'0')}-01T00:00:00.000Z`;
    return null;
  };
  // An earlier coarse or unknown-status release can invalidate an exact earliest-date claim.
  if (pc.some(item => !exact(item) && (!earliestPossible(item) || earliestPossible(item) <= first.date) && !['alpha','beta','cancelled','canceled','prerelease','prereleased'].includes(key(item.status?.name)))) return { date: null, precision: 'unknown', evidenceId: null, reason: 'earlier_or_undated_pc_release_unresolved' };
  return { date: first.date.slice(0,10), precision: 'day', evidenceId: first.id, sourceStatus: first.status?.name ?? 'not_reported', reason: 'earliest_known_exact_igdb_pc_date_not_steam_first_playable' };
}
/** Allowlisted, source-shaped fields only. Unknown/multi-label genres never reject a game. */
export function normalizeGame(raw, fetchedAt, asOf) {
  if (!validTime(fetchedAt) || !validTime(asOf)) throw new SafeError('invalid_timestamp');
  const base = { igdbId: ref(raw), appid: null, rejection: null };
  const reject = code => ({ ...base, rejection: code });
  if (!object(raw) || !uint(raw.id) || !textValue(raw.name)) return reject('invalid_igdb_identity');
  const fields = ['platforms','genres','themes','keywords','game_modes','player_perspectives','release_dates','external_games'];
  if (fields.some(field => raw[field] != null && (!Array.isArray(raw[field]) || raw[field].length > 1000))) return reject('malformed_catalog_array');
  const sourceUrl = safeUrl(raw.url, 'igdb.com');
  if (!sourceUrl) return reject('invalid_igdb_source_url');
  if (raw.game_type?.id !== 0 || key(raw.game_type.type) !== 'maingame' || ['parent_game','version_parent','version_title'].some(field => raw[field] != null && raw[field] !== '')) return reject('not_main_game');
  const platforms = (raw.platforms ?? []).map(item => ({ ...named(item), abbreviation: textValue(item?.abbreviation) })).filter(item => item.id);
  const desktop = platforms.filter(item => ({3:['linux'],6:['pc(microsoftwindows)','windows','pc'],14:['mac','macos']})[item.id]?.includes(key(item.name)));
  if (!desktop.length) return reject('desktop_platform_unverified');
  const crosswalk = (raw.external_games ?? []).filter(item => ref(item?.external_game_source) === 1 || key(item?.external_game_source?.name) === 'steam').map(item => ({ id: ref(item), uid: textValue(item?.uid,32), gameId: ref(item?.game), sourceId: ref(item?.external_game_source), sourceName: textValue(item?.external_game_source?.name), url: safeUrl(item?.url,'store.steampowered.com'), platformId: ref(item?.platform), sourceUpdatedAt: iso(item?.updated_at) }));
  const ids = [...new Set(crosswalk.filter(item => /^[1-9]\d*$/.test(item.uid ?? '') && uint(Number(item.uid))).map(item => Number(item.uid)))];
  const appid = ids.length === 1 ? ids[0] : null;
  const badCrosswalk = !appid || !crosswalk.length || crosswalk.some(item => !item.id || item.uid !== String(appid) || item.gameId !== raw.id || item.sourceId !== 1 || key(item.sourceName) !== 'steam' || !exactSteamUrl(item.url,appid) || (item.platformId !== null && !desktop.some(p => p.id === item.platformId)));
  const releaseDates = releases(raw,fetchedAt), release = selectPcDate(releaseDates,asOf);
  return { igdbId: raw.id, appid, name: raw.name, source: 'IGDB', sourceUrl, fetchedAt, sourceUpdatedAt: iso(raw.updated_at), gameType: {id:0,type:'Main Game'}, platforms, genres: labels(raw,'genres'), themes: labels(raw,'themes'), keywords: labels(raw,'keywords'), gameModes: labels(raw,'game_modes'), playerPerspectives: labels(raw,'player_perspectives'), releaseDates, firstReleaseDate: iso(raw.first_release_date), release, crosswalk, identity: { status: badCrosswalk ? 'quarantined' : 'pending_steam_verification', reason: badCrosswalk ? 'ambiguous_or_invalid_steam_crosswalk' : 'independent_steam_identity_required', steamName: null, steamFetchedAt: null, typeBasis: null }, rejection: badCrosswalk ? 'ambiguous_or_invalid_steam_crosswalk' : null, rawLabelProvenance: {source:'IGDB',genreField:'genres',themeField:'themes',modeField:'game_modes',keywordField:'keywords',steamTags:false}, collection: {population:'discovery_candidates',allocationGroup:null,selectionMethod:'bounded_source_id_order',representativeSample:false} };
}
export function verifyIdentity(candidate, steamItem, fetchedAt, completed) {
  if (candidate.rejection) return candidate;
  const status = !steamItem ? (completed ? 'quarantined' : 'pending_steam_verification') : (!textValue(steamItem.name) || !key(steamItem.name) || !key(candidate.name) || steamItem.appid !== candidate.appid || key(steamItem.name) !== key(candidate.name)) ? 'quarantined' : 'verified';
  const reason = !steamItem ? (completed ? 'not_in_bounded_official_game_catalog' : 'steam_identity_not_observed') : status === 'quarantined' ? (!textValue(steamItem.name) ? 'steam_title_unavailable' : 'steam_title_mismatch') : 'exact_appid_normalized_title_and_game_only_query';
  return { ...candidate, identity:{status,reason,steamName:steamItem?.name ?? null,steamFetchedAt:steamItem ? fetchedAt : null,typeBasis:steamItem ? 'derived_game_only_query' : null,sourceUrl:ENDPOINTS.steam}, rejection:status==='quarantined'?reason:null };
}
export function panelCandidate(candidate) {
  if (candidate.identity?.status !== 'verified' || candidate.rejection) return null;
  return { appid:candidate.appid,name:candidate.name,source:'IGDB + Steam IStoreService',sourceUrl:candidate.sourceUrl,retrievedAt:candidate.fetchedAt,appType:'game',typeBasis:'derived_game_only_query',releaseDate:candidate.release.date,releaseBasis:'igdb_pc',releasePrecision:candidate.release.precision,lifetimeReviews:null,referenceEligible:false,referenceReason:null,genres:candidate.genres.map(item=>item.name).filter(Boolean) };
}
