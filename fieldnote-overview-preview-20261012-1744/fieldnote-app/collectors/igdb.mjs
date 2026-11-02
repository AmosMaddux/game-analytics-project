import { DISCOVERY_ROUTES, GENRES, TAXONOMY_STATUS, TAXONOMY_VERSION, UNRESOLVED_GENRE, discoveryRoute, genreCoverage, mapEditorialGenre, routeFilter } from './taxonomy.mjs';

// Pure adapter: no environment, filesystem, authentication, fetch, or timers.
// The caller's transport owns authentication, pacing, retries, and total caps.
export const IGDB_ENDPOINTS = Object.freeze({
  games: 'https://api.igdb.com/v4/games',
  sources: 'https://api.igdb.com/v4/external_game_sources',
  gameTypes: 'https://api.igdb.com/v4/game_types',
});
export const DISCOVERY_LIMITS = Object.freeze({ target: 450, pages: 60, pageSize: 100, defaultTarget: 360, defaultPageSize: 50, highRatingCount: 10 });
export const IGDB_FIELDS = [
  'id', 'name', 'summary', 'url', 'updated_at', 'first_release_date', 'rating_count', 'parent_game', 'version_parent', 'version_title', 'game_type.id', 'game_type.type',
  'platforms.id', 'platforms.name', 'platforms.abbreviation',
  'release_dates.id', 'release_dates.date', 'release_dates.human', 'release_dates.y', 'release_dates.m', 'release_dates.d', 'release_dates.updated_at',
  'release_dates.platform.id', 'release_dates.platform.name', 'release_dates.platform.abbreviation', 'release_dates.date_format.id', 'release_dates.date_format.format',
  'release_dates.release_region.id', 'release_dates.release_region.region', 'release_dates.status.id', 'release_dates.status.name',
  'involved_companies.id', 'involved_companies.developer', 'involved_companies.publisher', 'involved_companies.porting', 'involved_companies.supporting',
  'involved_companies.updated_at', 'involved_companies.company.id', 'involved_companies.company.name', 'involved_companies.company.url',
  'involved_companies.company.websites.id', 'involved_companies.company.websites.url', 'involved_companies.company.websites.type.id',
  'involved_companies.company.websites.type.type', 'involved_companies.company.websites.trusted',
  'genres.id', 'genres.name', 'themes.id', 'themes.name', 'keywords.id', 'keywords.name',
  'websites.id', 'websites.url', 'websites.type.id', 'websites.type.type', 'websites.trusted',
  'external_games.id', 'external_games.uid', 'external_games.game', 'external_games.external_game_source.id', 'external_games.external_game_source.name',
  'external_games.url', 'external_games.platform', 'external_games.updated_at',
].join(',');

const FIELD_PATHS = Object.freeze({
  name: 'name', summary: 'summary', platforms: 'platforms', releaseDates: 'release_dates',
  developers: 'involved_companies.company (developer=true)', publishers: 'involved_companies.company (publisher=true)', companies: 'involved_companies',
  genres: 'genres', themes: 'themes', keywords: 'keywords', websites: 'websites', officialWebsites: 'websites (type=Official Website)',
  firstReleaseDate: 'first_release_date', gameType: 'game_type', identity: 'external_games', ratingCount: 'rating_count',
});
export const IGDB_RIGHTS = Object.freeze({
  purpose: 'private_noncommercial_catalog_validation',
  retention: 'active_refreshable_local_cache_documentation_supported',
  enduringArchiveOrRedistribution: 'unresolved', publicDisplayApproved: false, productionApproved: false,
  documentation: 'https://api-docs.igdb.com/#business-related-faq',
});

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const id = value => Number.isSafeInteger(value) && value > 0 && value <= 4294967295 ? value : null;
const refId = value => id(value?.id) ?? id(value);
const array = value => Array.isArray(value) ? value : [];
const string = (value, max = 512) => typeof value === 'string' && value.trim() && value.length <= max && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value) ? value : null;
const boolean = value => typeof value === 'boolean' ? value : null;
const unix = value => Number.isSafeInteger(value) && value >= 0 && value <= 253402300799 ? value : null;
const iso = value => unix(value) === null ? null : new Date(value * 1000).toISOString();
const named = value => object(value) && id(value.id) && string(value.name) ? { id: value.id, name: value.name } : null;
const typed = (value, key) => object(value) && Number.isSafeInteger(value.id) && value.id >= 0 && string(value[key]) ? { id: value.id, [key]: value[key] } : null;
const platform = value => named(value) ? { ...named(value), abbreviation: string(value.abbreviation) } : null;
const clone = value => JSON.parse(JSON.stringify(value));
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const titleKey = value => (string(value) ?? '').normalize('NFKC').toLowerCase().replace(/[ _-]/g, '');
const validTimestamp = value => typeof value === 'string' && value.length <= 64 && Number.isFinite(Date.parse(value));

export function safeSourceUrl(value, host = null) {
  if (!string(value, 2048)) return null;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || (host && ![host, `www.${host}`].includes(url.hostname))) return null;
    return url.href;
  } catch { return null; }
}

function normalizeWebsites(values) {
  return array(values).flatMap(item => id(item?.id) && safeSourceUrl(item.url) ? [{
    id: item.id, url: safeSourceUrl(item.url), type: typed(item.type, 'type'), trusted: boolean(item.trusted),
  }] : []);
}

const officialWebsiteType = item => ['official', 'officialwebsite'].includes(titleKey(item.type?.type));

export function exactSteamAppUrl(value, appid) {
  if (!id(appid) || !string(value, 2048)) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.search && !url.hash
      && url.hostname === 'store.steampowered.com' && /^\/app\/([1-9]\d*)\/?$/.exec(url.pathname)?.[1] === String(appid);
  } catch { return false; }
}

function integer(value, minimum, maximum, label) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new TypeError(`Invalid ${label}`);
  return value;
}

/** Keyset pagination remains stable when earlier source records are inserted. */
export function buildDiscoveryQuery({ routeId, stratum = 'high', afterId = 0, pageSize = DISCOVERY_LIMITS.defaultPageSize } = {}) {
  discoveryRoute(routeId);
  if (!['high', 'low'].includes(stratum)) throw new TypeError('Invalid discovery stratum');
  integer(afterId, 0, 4294967295, 'IGDB cursor');
  integer(pageSize, 1, DISCOVERY_LIMITS.pageSize, 'page size');
  const rating = stratum === 'high' ? `rating_count >= ${DISCOVERY_LIMITS.highRatingCount}` : `(rating_count < ${DISCOVERY_LIMITS.highRatingCount} | rating_count = null)`;
  return `fields ${IGDB_FIELDS}; where game_type = 0 & parent_game = null & version_parent = null & platforms = (3,6,14) & external_games.external_game_source = 1 & (${routeFilter(routeId)}) & ${rating} & id > ${afterId}; sort id asc; limit ${pageSize};`;
}

function isDesktop(value) {
  const names = { 3: /^(Linux)$/i, 6: /^(PC \(Microsoft Windows\)|Windows|PC)$/i, 14: /^(Mac|macOS)$/i };
  const abbreviations = { 3: /^(Linux)$/i, 6: /^(PC|Win)$/i, 14: /^(Mac)$/i };
  return Boolean(names[value?.id] && (names[value.id].test(value.name ?? '') || abbreviations[value.id].test(value.abbreviation ?? '')));
}

function preservedGenreFor(preservedGenres, appid) {
  const value = preservedGenres instanceof Map ? preservedGenres.get(appid) ?? preservedGenres.get(String(appid)) ?? null
    : object(preservedGenres) && Object.hasOwn(preservedGenres, String(appid)) ? preservedGenres[String(appid)] : null;
  return value === UNRESOLVED_GENRE ? null : value;
}

/**
 * Return {accepted,candidate} or {accepted:false,rejection}; never return a raw
 * provider response. This verifies only IGDB's crosswalk. Steam title/AppID
 * verification is an independent required stage and must not be inferred here.
 */
export function normalizeDiscoveryCandidate(raw, { fetchedAt, preservedGenres = null, routeId = null } = {}) {
  if (!validTimestamp(fetchedAt)) throw new TypeError('Valid collection timestamp required');
  if (routeId !== null) discoveryRoute(routeId);
  const reject = (code, extra = {}) => ({ accepted: false, rejection: { igdbId: id(raw?.id), code, ...extra } });
  if (!object(raw) || !id(raw.id)) return reject('invalid_igdb_id');
  if (!string(raw.name)) return reject('missing_catalog_title');
  const sourceUrl = safeSourceUrl(raw.url, 'igdb.com');
  if (!sourceUrl) return reject('invalid_igdb_source_url');
  const gameType = typed(raw.game_type, 'type');
  if (gameType?.id !== 0 || titleKey(gameType.type) !== 'maingame') return reject('not_main_game');
  if (['parent_game', 'version_parent', 'version_title'].some(key => raw[key] != null && raw[key] !== '')) return reject('parent_or_edition');
  const collections = ['platforms', 'release_dates', 'involved_companies', 'genres', 'themes', 'keywords', 'websites', 'external_games'];
  if (collections.some(key => raw[key] != null && (!Array.isArray(raw[key]) || raw[key].length > 1000))) return reject('invalid_catalog_collection');
  if (array(raw.involved_companies).some(item => item?.company?.websites != null
    && (!Array.isArray(item.company.websites) || item.company.websites.length > 1000))) return reject('invalid_catalog_collection');
  const platforms = array(raw.platforms).map(platform).filter(Boolean);
  const desktop = platforms.filter(isDesktop);
  if (!desktop.length) return reject('desktop_platform_unverified');
  const mappings = array(raw.external_games).filter(item => refId(item?.external_game_source) === 1 || titleKey(item?.external_game_source?.name) === 'steam');
  if (!mappings.length) return reject('missing_exact_steam_crosswalk');
  const appids = [...new Set(mappings.flatMap(item => typeof item.uid === 'string' && /^[1-9]\d*$/.test(item.uid) && id(Number(item.uid)) ? [Number(item.uid)] : []))];
  if (appids.length > 1) return reject('ambiguous_steam_crosswalk', { appids });
  const appid = appids[0];
  if (!appid || mappings.some(item => !id(item.id) || item.uid !== String(appid) || refId(item.game) !== raw.id
    || refId(item.external_game_source) !== 1 || titleKey(item.external_game_source?.name) !== 'steam'
    || !exactSteamAppUrl(item.url, appid))) return reject('invalid_steam_crosswalk', appid ? { appid } : {});
  if (mappings.some(item => item.platform != null && (!refId(item.platform) || !desktop.some(value => value.id === refId(item.platform))))) return reject('crosswalk_platform_conflict', { appid });
  if (raw.rating_count != null && count(raw.rating_count) === null) return reject('invalid_rating_count', { appid });
  const taxonomy = mapEditorialGenre(raw, { preservedGenre: preservedGenreFor(preservedGenres, appid), preferredRouteId: routeId });
  if (!taxonomy.genre) return reject(taxonomy.ambiguity?.status === 'unresolved_primary' ? 'ambiguous_editorial_genre' : 'unmapped_editorial_genre', { appid });
  if (routeId && !taxonomy.matches.some(item => item.routeId === routeId)) return reject('discovery_route_mismatch', { appid });
  if (routeId && taxonomy.routeId !== routeId) return reject('primary_editorial_route_mismatch', { appid });
  const sourceUpdatedAt = iso(raw.updated_at);
  const companies = array(raw.involved_companies).flatMap(item => id(item?.id) && named(item.company) ? [{
    id: item.id, company: named(item.company), developer: boolean(item.developer), publisher: boolean(item.publisher),
    porting: boolean(item.porting), supporting: boolean(item.supporting), sourceUpdatedAt: iso(item.updated_at),
    companySourceUrl: safeSourceUrl(item.company.url, 'igdb.com'),
    officialWebsites: normalizeWebsites(item.company.websites).filter(officialWebsiteType),
  }] : []);
  const websites = normalizeWebsites(raw.websites);
  const ratingCount = count(raw.rating_count);
  const catalog = {
    status: 'candidate_pending_steam_validation', reason: 'exact_igdb_crosswalk_requires_independent_steam_validation',
    source: 'IGDB', sourceId: raw.id, sourceUrl, fetchedAt, sourceUpdatedAt,
    name: raw.name, summary: string(raw.summary, 100_000), platforms,
    developers: companies.filter(item => item.developer === true).map(item => item.company),
    publishers: companies.filter(item => item.publisher === true).map(item => item.company), companies,
    genres: array(raw.genres).map(named).filter(Boolean), themes: array(raw.themes).map(named).filter(Boolean), keywords: array(raw.keywords).map(named).filter(Boolean),
    websites, officialWebsites: websites.filter(item => item.type?.id === 1 && officialWebsiteType(item)),
    firstReleaseDate: iso(raw.first_release_date), gameType,
    parentGameId: null, versionParentId: null, versionTitle: null,
    releaseDates: array(raw.release_dates).flatMap(item => id(item?.id) ? [{
      id: item.id, date: iso(item.date), rawDate: unix(item.date), displayDate: string(item.human),
      year: Number.isInteger(item.y) && item.y >= 1 && item.y <= 9999 ? item.y : null,
      month: Number.isInteger(item.m) && item.m >= 1 && item.m <= 12 ? item.m : null,
      day: Number.isInteger(item.d) && item.d >= 1 && item.d <= 31 ? item.d : null,
      platform: platform(item.platform), dateFormat: typed(item.date_format, 'format'), region: typed(item.release_region, 'region'),
      status: named(item.status), sourceUpdatedAt: iso(item.updated_at),
      scope: 'IGDB platform/region release; not a Steam-specific release date',
    }] : []),
    ratingCount,
    identity: {
      status: 'exact_igdb_crosswalk_pending_steam_validation', ruleVersion: 'igdb-discovery-1.0',
      steamAppid: appid, steamName: null, steamUrl: `https://store.steampowered.com/app/${appid}/`, steamFetchedAt: null,
      crosswalk: mappings.map(item => ({ id: item.id, uid: item.uid, gameId: raw.id, sourceId: 1, sourceName: 'Steam',
        urlValidation: 'valid', url: safeSourceUrl(item.url), platformId: refId(item.platform), sourceUpdatedAt: iso(item.updated_at) })),
    },
    conflicts: [], provenance: {},
  };
  catalog.provenance = Object.fromEntries(Object.entries(FIELD_PATHS).map(([field, fieldPath]) => [field, {
    sourceProvider: 'IGDB', sourceEntityId: raw.id, fieldPath, sourceUrl, fetchedAt, sourceUpdatedAt,
    sourceUpdatedAtScope: 'Parent game updated_at; nested record update times are separately retained when supplied',
    eventOrObservationTime: null, unit: field === 'ratingCount' ? 'IGDB user ratings' : 'provider catalog metadata',
    status: catalog[field] == null || (Array.isArray(catalog[field]) && !catalog[field].length) ? 'unknown' : 'observed',
    retentionRule: IGDB_RIGHTS.retention,
  }]));
  return { accepted: true, candidate: {
    id: String(appid), appid, name: raw.name, genre: taxonomy.genre, storeUrl: `https://store.steampowered.com/app/${appid}/`,
    catalog, taxonomy,
    tractionProxy: { source: 'IGDB', metric: 'rating_count', value: ratingCount, stratum: ratingCount === null ? 'unknown_in_low_stratum' : ratingCount >= DISCOVERY_LIMITS.highRatingCount ? 'high' : 'low',
      scope: 'IGDB user rating count only; not Steam popularity, players, owners, sales, revenue, or Steam review volume.' },
  } };
}

function configuration({ target, pageSize, maxPages }) {
  integer(target, 1, DISCOVERY_LIMITS.target, 'candidate target');
  integer(pageSize, 1, DISCOVERY_LIMITS.pageSize, 'page size');
  integer(maxPages, 1, DISCOVERY_LIMITS.pages, 'page budget');
  return { target, pageSize };
}

function initialCheckpoint(config, preserved) {
  return { version: 1, taxonomyVersion: TAXONOMY_VERSION, config, phase: 'balanced', referencesVerified: false, pagesCompleted: 0, nextStream: 0,
    streams: DISCOVERY_ROUTES.flatMap(item => ['high', 'low'].map(stratum => ({ routeId: item.id, stratum, afterId: 0, exhausted: false, pages: 0 }))),
    candidates: [], rejections: [], claims: [], blockedAppids: [], blockedIgdbIds: [], preserved,
  };
}

function validateCheckpoint(input, config, preserved) {
  if (!object(input) || JSON.stringify(input).length > 32 * 1024 * 1024 || input.version !== 1 || input.taxonomyVersion !== TAXONOMY_VERSION
    || JSON.stringify(input.config) !== JSON.stringify(config) || JSON.stringify(input.preserved) !== JSON.stringify(preserved)) throw new TypeError('Incompatible discovery checkpoint');
  integer(input.pagesCompleted, 0, DISCOVERY_LIMITS.pages, 'checkpoint pages');
  integer(input.nextStream, 0, DISCOVERY_ROUTES.length * 2 - 1, 'checkpoint stream');
  if (!['balanced', 'reallocation'].includes(input.phase ?? 'balanced') || typeof input.referencesVerified !== 'boolean' || !Array.isArray(input.streams) || input.streams.length !== DISCOVERY_ROUTES.length * 2) throw new TypeError('Invalid discovery checkpoint');
  const expected = initialCheckpoint(config, preserved).streams;
  input.streams.forEach((item, index) => {
    if (!object(item) || item.routeId !== expected[index].routeId || item.stratum !== expected[index].stratum || typeof item.exhausted !== 'boolean') throw new TypeError('Invalid checkpoint stream');
    integer(item.afterId, 0, 4294967295, 'checkpoint cursor'); integer(item.pages, 0, DISCOVERY_LIMITS.pages, 'checkpoint stream pages');
  });
  if (input.streams.reduce((sum, item) => sum + item.pages, 0) !== input.pagesCompleted) throw new TypeError('Inconsistent checkpoint page counts');
  for (const key of ['candidates', 'rejections', 'claims', 'blockedAppids', 'blockedIgdbIds']) if (!Array.isArray(input[key]) || input[key].length > DISCOVERY_LIMITS.pages * DISCOVERY_LIMITS.pageSize * 2) throw new TypeError('Invalid checkpoint collection');
  if (input.candidates.length > config.target || input.candidates.some(item => !validCheckpointCandidate(item))
    || new Set(input.candidates.map(item => item.appid)).size !== input.candidates.length
    || new Set(input.candidates.map(item => item.catalog.sourceId)).size !== input.candidates.length) throw new TypeError('Invalid checkpoint candidate');
  if (input.claims.some(item => !object(item) || !id(item.appid) || !id(item.igdbId))
    || input.blockedAppids.some(item => !id(item)) || input.blockedIgdbIds.some(item => !id(item))
    || input.claims.some(item => (config.excludedAppids ?? []).includes(item.appid))
    || new Set(input.claims.map(item => item.appid)).size !== input.claims.length || new Set(input.claims.map(item => item.igdbId)).size !== input.claims.length
    || input.candidates.some(item => !input.claims.some(claim => claim.appid === item.appid && claim.igdbId === item.catalog.sourceId)
      || input.blockedAppids.includes(item.appid) || input.blockedIgdbIds.includes(item.catalog.sourceId)
      || preserved.some(row => row.appid === item.appid || row.igdbId === item.catalog.sourceId))) throw new TypeError('Invalid checkpoint identity claims');
  if (input.rejections.some(item => !object(item) || !string(item.code, 80) || !/^[a-z_]+$/.test(item.code))) throw new TypeError('Invalid checkpoint rejection');
  return { ...clone(input), phase: input.phase ?? 'balanced' };
}

function validCheckpointCandidate(item) {
  const c = item?.catalog;
  return object(item) && id(item.appid) && item.id === String(item.appid) && string(item.name) && GENRES.includes(item.genre)
    && exactSteamAppUrl(item.storeUrl, item.appid) && object(c) && c.status === 'candidate_pending_steam_validation' && c.source === 'IGDB' && id(c.sourceId)
    && safeSourceUrl(c.sourceUrl, 'igdb.com') && validTimestamp(c.fetchedAt) && c.name === item.name
    && c.gameType?.id === 0 && titleKey(c.gameType.type) === 'maingame' && c.parentGameId === null && c.versionParentId === null && c.versionTitle === null
    && Array.isArray(c.platforms) && c.platforms.some(isDesktop) && c.identity?.status === 'exact_igdb_crosswalk_pending_steam_validation'
    && c.identity.steamAppid === item.appid && Array.isArray(c.identity.crosswalk) && c.identity.crosswalk.length > 0
    && c.identity.crosswalk.every(row => id(row.id) && row.uid === String(item.appid) && row.gameId === c.sourceId && row.sourceId === 1 && row.sourceName === 'Steam' && exactSteamAppUrl(row.url, item.appid))
    && ['genres', 'themes', 'keywords', 'companies', 'developers', 'publishers', 'websites', 'officialWebsites', 'releaseDates', 'conflicts'].every(key => Array.isArray(c[key]))
    && [...c.websites, ...c.officialWebsites].every(row => safeSourceUrl(row.url))
    && c.companies.every(row => object(row) && (row.companySourceUrl == null || safeSourceUrl(row.companySourceUrl, 'igdb.com'))
      && (row.officialWebsites === undefined || (Array.isArray(row.officialWebsites) && row.officialWebsites.every(website => safeSourceUrl(website.url) && officialWebsiteType(website)))))
    && item.taxonomy?.version === TAXONOMY_VERSION && item.taxonomy.genre === item.genre && DISCOVERY_ROUTES.some(route => route.id === item.taxonomy.routeId)
    && (item.tractionProxy?.value === null || count(item.tractionProxy?.value) !== null);
}

function streamQuota(state, index) {
  const stream = state.streams[index]; const routeIndex = Math.floor(index / 2);
  if (state.phase === 'reallocation') {
    const sameStratum = item => (item.tractionProxy.stratum === 'high' ? 'high' : 'low') === stream.stratum;
    const quota = stream.stratum === 'high' ? Math.ceil(state.config.target / 2) : Math.floor(state.config.target / 2);
    return Math.max(0, quota - state.candidates.filter(sameStratum).length);
  }
  const routeQuota = Math.floor(state.config.target / DISCOVERY_ROUTES.length) + (routeIndex < state.config.target % DISCOVERY_ROUTES.length ? 1 : 0);
  const routeRows = state.candidates.filter(item => item.taxonomy.routeId === stream.routeId);
  const streamRows = routeRows.filter(item => (item.tractionProxy.stratum === 'high' ? 'high' : 'low') === stream.stratum);
  const sibling = state.streams[index % 2 === 0 ? index + 1 : index - 1];
  const quota = sibling.exhausted ? routeQuota - (routeRows.length - streamRows.length)
    : stream.stratum === 'high' ? Math.ceil(routeQuota / 2) : Math.floor(routeQuota / 2);
  return Math.max(0, quota - streamRows.length);
}

function nextEligibleStream(state) {
  for (let offset = 0; offset < state.streams.length; offset += 1) {
    const index = (state.nextStream + offset) % state.streams.length;
    if (!state.streams[index].exhausted && streamQuota(state, index) > 0) return index;
  }
  return -1;
}

function safeFailure(error) {
  const known = ['request_budget_exhausted', 'response_too_large', 'byte_budget_exhausted', 'time_budget_exhausted', 'authentication_failed', 'rate_limited', 'aborted',
    'access_denied', 'redirect_blocked', 'runtime_limit', 'request_limit', 'byte_limit', 'throttled', 'credential_reflection_blocked'];
  return known.includes(error?.code) ? error.code : 'request_failed';
}

/**
 * @param {object} options
 * @param {{request:(endpoint:string, body:string)=>Promise<unknown>}} options.transport
 * @param {number[]} [options.excludedAppids] Previously quarantined Steam IDs; skipped without consuming candidate quotas.
 * @returns {Promise<{status:string,candidates:object[],rejections:object[],checkpoint:object,metadata:object,errors:object[]}>}
 * References use at most two requests in addition to maxPages discovery pages.
 * onCheckpoint receives a detached normalized checkpoint after every accepted
 * page. Pass it back unchanged plus the same existingGames/config to resume.
 */
export async function discoverIgdb({ transport, target = DISCOVERY_LIMITS.defaultTarget, maxPages = DISCOVERY_LIMITS.pages, pageSize = DISCOVERY_LIMITS.defaultPageSize,
  checkpoint = null, onCheckpoint = null, existingGames = [], excludedAppids = [], now = () => new Date() } = {}) {
  const config = configuration({ target, pageSize, maxPages });
  if (!Array.isArray(excludedAppids) || excludedAppids.length > 5000 || Array.from(excludedAppids).some(value => !id(value))
    || new Set(excludedAppids).size !== excludedAppids.length) throw new TypeError('Invalid excluded Steam AppIDs');
  const excluded = new Set(excludedAppids);
  // Keep the original empty-exclusion checkpoint shape for RC2 resume support.
  if (excluded.size) config.excludedAppids = [...excluded].sort((a, b) => a - b);
  if (!transport || typeof transport.request !== 'function') throw new TypeError('Injected IGDB transport required');
  if (onCheckpoint !== null && typeof onCheckpoint !== 'function') throw new TypeError('Invalid checkpoint callback');
  if (!Array.isArray(existingGames) || existingGames.some(item => !id(item?.appid) || (!GENRES.includes(item.genre) && item.genre !== UNRESOLVED_GENRE))) throw new TypeError('Invalid preserved games');
  const preserved = existingGames.map(item => ({ appid: item.appid, igdbId: id(item.catalog?.sourceId), genre: item.genre })).sort((a, b) => a.appid - b.appid);
  if (new Set(preserved.map(item => item.appid)).size !== preserved.length) throw new TypeError('Duplicate preserved AppIDs');
  const state = checkpoint === null ? initialCheckpoint(config, preserved) : validateCheckpoint(checkpoint, config, preserved);
  if (state.pagesCompleted > maxPages) throw new TypeError('Checkpoint exceeds page budget');
  const timestamp = () => { const value = now(); const result = value instanceof Date ? value.toISOString() : value; if (!validTimestamp(result)) throw new TypeError('Invalid clock'); return result; };
  const startedAt = timestamp(); const errors = []; let stopReason = null; let requestsThisInvocation = 0; let callbackFailed = false;
  const request = async (endpoint, body) => { requestsThisInvocation += 1; return transport.request(endpoint, body); };
  const persist = async () => { if (onCheckpoint) { try { await onCheckpoint(clone(state)); } catch { callbackFailed = true; throw new Error('checkpoint_callback_failed'); } } };
  const reject = (row, code, extra = {}) => state.rejections.push({ igdbId: id(row?.id) ?? id(row?.catalog?.sourceId), ...(id(row?.appid) ? { appid: row.appid } : {}), code, ...extra });
  const quarantine = (appids, igdbIds, code) => {
    state.blockedAppids = [...new Set([...state.blockedAppids, ...appids])]; state.blockedIgdbIds = [...new Set([...state.blockedIgdbIds, ...igdbIds])];
    state.candidates = state.candidates.filter(item => {
      if (!appids.includes(item.appid) && !igdbIds.includes(item.catalog.sourceId)) return true;
      reject(item, code); return false;
    });
  };
  try {
    if (!state.referencesVerified) {
      const sources = await request(IGDB_ENDPOINTS.sources, 'fields id,name; where id = 1; limit 2;');
      if (!Array.isArray(sources) || sources.length !== 1 || sources[0]?.id !== 1 || titleKey(sources[0]?.name) !== 'steam') {
        stopReason = 'steam_source_reference_unverified';
      } else {
        const types = await request(IGDB_ENDPOINTS.gameTypes, 'fields id,type; where id = 0; limit 2;');
        if (!Array.isArray(types) || types.length !== 1 || types[0]?.id !== 0 || titleKey(types[0]?.type) !== 'maingame') stopReason = 'main_game_reference_unverified';
        else { state.referencesVerified = true; await persist(); }
      }
    }
    while (!stopReason && state.candidates.length < target && state.pagesCompleted < maxPages) {
      let index = nextEligibleStream(state);
      if (index < 0 && state.phase === 'balanced') {
        state.phase = 'reallocation'; index = nextEligibleStream(state);
      }
      if (index < 0) { stopReason = 'routes_exhausted_or_quotas_met'; break; }
      const stream = state.streams[index];
      const response = await request(IGDB_ENDPOINTS.games, buildDiscoveryQuery({ ...stream, pageSize }));
      if (!Array.isArray(response) || response.length > pageSize || response.some((row, position) => !object(row) || !id(row.id) || row.id <= (position === 0 ? stream.afterId : response[position - 1].id))) {
        stopReason = 'invalid_or_nonmonotonic_page'; break;
      }
      const fetchedAt = timestamp();
      for (const raw of response) {
        const normalized = normalizeDiscoveryCandidate(raw, { fetchedAt, routeId: stream.routeId });
        if (!normalized.accepted) {
          state.rejections.push({ ...normalized.rejection, routeId: stream.routeId, stratum: stream.stratum });
          if (['ambiguous_steam_crosswalk', 'invalid_steam_crosswalk'].includes(normalized.rejection.code)) {
            quarantine(normalized.rejection.appids ?? (normalized.rejection.appid ? [normalized.rejection.appid] : []), [raw.id], 'ambiguous_steam_crosswalk');
          }
          continue;
        }
        const candidate = normalized.candidate; const appid = candidate.appid; const igdbId = raw.id;
        const actualStratum = candidate.tractionProxy.stratum === 'high' ? 'high' : 'low';
        if (actualStratum !== stream.stratum) { reject(candidate, 'rating_stratum_mismatch'); continue; }
        const preservedApp = preserved.find(item => item.appid === appid); const preservedId = preserved.find(item => item.igdbId === igdbId);
        if (preservedApp || preservedId) {
          reject(candidate, preservedApp?.igdbId === igdbId ? 'already_preserved' : 'crosswalk_conflicts_with_preserved_game'); continue;
        }
        if (excluded.has(appid)) { reject(candidate, 'previously_quarantined'); continue; }
        const prior = state.claims.filter(item => item.appid === appid || item.igdbId === igdbId);
        if (prior.some(item => item.appid !== appid || item.igdbId !== igdbId)) {
          quarantine([...new Set([appid, ...prior.map(item => item.appid)])], [...new Set([igdbId, ...prior.map(item => item.igdbId)])], 'ambiguous_cross_record_identity');
          reject(candidate, 'ambiguous_cross_record_identity'); continue;
        }
        if (!prior.length) state.claims.push({ appid, igdbId });
        if (state.blockedAppids.includes(appid) || state.blockedIgdbIds.includes(igdbId)) { reject(candidate, 'quarantined_identity'); continue; }
        if (state.candidates.some(item => item.appid === appid)) { reject(candidate, 'duplicate_candidate'); continue; }
        if (streamQuota(state, index) <= 0 || state.candidates.length >= target) { reject(candidate, 'editorial_stratum_quota_reached'); continue; }
        state.candidates.push(candidate);
      }
      stream.pages += 1; state.pagesCompleted += 1; if (response.length) stream.afterId = response.at(-1).id;
      stream.exhausted = response.length < pageSize; state.nextStream = (index + 1) % state.streams.length;
      await persist();
    }
  } catch (error) {
    stopReason = callbackFailed ? 'checkpoint_callback_failed' : safeFailure(error);
  }
  stopReason ??= state.candidates.length >= target ? 'target_reached' : state.pagesCompleted >= maxPages ? 'page_budget_exhausted' : 'routes_exhausted_or_quotas_met';
  const normalStop = ['target_reached', 'routes_exhausted_or_quotas_met'].includes(stopReason);
  if (!normalStop) errors.push({ code: stopReason });
  const coverage = genreCoverage(state.candidates);
  return {
    status: normalStop ? 'complete' : state.candidates.length || state.pagesCompleted ? 'partial' : 'failed',
    candidates: clone(state.candidates), rejections: clone(state.rejections), checkpoint: clone(state), errors,
    metadata: { adapterVersion: 'igdb-discovery-1.0', taxonomyVersion: TAXONOMY_VERSION, taxonomyStatus: TAXONOMY_STATUS,
      startedAt, finishedAt: timestamp(), stopReason, target, accepted: state.candidates.length, pagesCompleted: state.pagesCompleted, maxPages,
      requestsThisInvocation, pageSize, maximumDiscoveryRows: maxPages * pageSize, sourceReferencesVerified: state.referencesVerified, allocationPhase: state.phase,
      rights: IGDB_RIGHTS, coverage, underMinimumGenres: coverage.filter(item => item.status === 'under_minimum').map(item => item.genre),
      rejectionCounts: state.rejections.reduce((result, item) => { result[item.code] = (result[item.code] ?? 0) + 1; return result; }, {}),
      identity: 'IGDB crosswalk candidates only; independent official Steam AppID/title validation required before admission.',
      coverageNote: 'Bounded editorial sample with actual denominators. Sparse categories are not padded; source exhaustion and quotas do not establish catalog completeness.',
      selectionNote: 'First pass balances editorial routes and high (at least 10) versus low/missing IGDB rating counts by ascending ID. A bounded second pass reallocates sparse-route capacity to nonexhausted routes while retaining the overall high/low quotas. This is a traction proxy, not Steam popularity or a representative market sample.',
      steamTags: 'Unknown for new candidates; no IGDB label is converted into a Steam tag.',
    },
  };
}

/** Existing-identity refresh has a separate query and never discovers new IDs. */
export function buildCatalogRefreshQuery(gameIds) {
  if (!Array.isArray(gameIds) || !gameIds.length || gameIds.length > 30 || gameIds.some(value => !id(value)) || new Set(gameIds).size !== gameIds.length) throw new TypeError('Invalid catalog refresh IDs');
  return `fields ${IGDB_FIELDS}; where id = (${[...gameIds].sort((a, b) => a - b).join(',')}); sort id asc; limit ${gameIds.length};`;
}

/**
 * Refresh only caller-owned identities, at most 500 records in batches of 30.
 * Every record again needs an exact unique crosswalk, main-game type and desktop
 * platform. The caller alone may reuse its independent Steam proof under its
 * separately approved freshness policy; this function never asserts that proof.
 */
export async function refreshIgdb({ transport, existingGames, batchSize = 30, maxPages = 17, checkpoint = null,
  onCheckpoint = null, now = () => new Date() } = {}) {
  if (!transport || typeof transport.request !== 'function') throw new TypeError('Injected IGDB transport required');
  integer(batchSize, 1, 30, 'refresh batch size'); integer(maxPages, 1, DISCOVERY_LIMITS.pages, 'refresh page budget');
  if (!Array.isArray(existingGames) || !existingGames.length || existingGames.length > 500
    || existingGames.some(item => !id(item?.appid) || !id(item.catalog?.sourceId) || (!GENRES.includes(item.genre) && item.genre !== UNRESOLVED_GENRE))) throw new TypeError('Invalid existing catalog games');
  if (onCheckpoint !== null && typeof onCheckpoint !== 'function') throw new TypeError('Invalid checkpoint callback');
  const existing = existingGames.map(item => ({ appid: item.appid, igdbId: item.catalog.sourceId, genre: item.genre })).sort((a, b) => a.igdbId - b.igdbId);
  if (new Set(existing.map(item => item.appid)).size !== existing.length || new Set(existing.map(item => item.igdbId)).size !== existing.length) throw new TypeError('Ambiguous existing catalog identities');
  const config = { batchSize };
  const initial = { version: 1, kind: 'igdb_catalog_refresh', taxonomyVersion: TAXONOMY_VERSION, config, existing,
    referencesVerified: false, nextIndex: 0, pagesCompleted: 0, candidates: [], rejections: [] };
  let state = initial;
  if (checkpoint !== null) {
    if (!object(checkpoint) || JSON.stringify(checkpoint).length > 32 * 1024 * 1024 || checkpoint.version !== 1 || checkpoint.kind !== initial.kind
      || checkpoint.taxonomyVersion !== TAXONOMY_VERSION || JSON.stringify(checkpoint.config) !== JSON.stringify(config)
      || JSON.stringify(checkpoint.existing) !== JSON.stringify(existing) || typeof checkpoint.referencesVerified !== 'boolean') throw new TypeError('Incompatible refresh checkpoint');
    integer(checkpoint.nextIndex, 0, existing.length, 'refresh checkpoint index'); integer(checkpoint.pagesCompleted, 0, maxPages, 'refresh checkpoint pages');
    if (checkpoint.pagesCompleted !== Math.ceil(checkpoint.nextIndex / batchSize)
      || (checkpoint.nextIndex !== existing.length && checkpoint.nextIndex % batchSize !== 0)
      || !Array.isArray(checkpoint.candidates) || !Array.isArray(checkpoint.rejections)
      || checkpoint.candidates.length > existing.length || checkpoint.rejections.length > existing.length
      || checkpoint.candidates.length + checkpoint.rejections.length !== checkpoint.nextIndex
      || checkpoint.candidates.some(item => !validCheckpointCandidate(item) || !existing.slice(0, checkpoint.nextIndex).some(row => row.appid === item.appid && row.igdbId === item.catalog.sourceId && (row.genre === item.genre || row.genre === UNRESOLVED_GENRE)))
      || new Set(checkpoint.candidates.map(item => item.appid)).size !== checkpoint.candidates.length
      || checkpoint.rejections.some(item => !object(item) || !id(item.igdbId) || !string(item.code, 80) || !/^[a-z_]+$/.test(item.code)
        || !existing.slice(0, checkpoint.nextIndex).some(row => row.appid === item.appid && row.igdbId === item.igdbId))) throw new TypeError('Invalid refresh checkpoint');
    state = clone(checkpoint);
  }
  const timestamp = () => { const value = now(); const result = value instanceof Date ? value.toISOString() : value; if (!validTimestamp(result)) throw new TypeError('Invalid clock'); return result; };
  const startedAt = timestamp(); let stopReason = null; let requestsThisInvocation = 0; let callbackFailed = false;
  const request = async (endpoint, body) => { requestsThisInvocation += 1; return transport.request(endpoint, body); };
  const persist = async () => { if (onCheckpoint) { try { await onCheckpoint(clone(state)); } catch { callbackFailed = true; throw new Error('checkpoint_callback_failed'); } } };
  try {
    if (!state.referencesVerified) {
      const sources = await request(IGDB_ENDPOINTS.sources, 'fields id,name; where id = 1; limit 2;');
      if (!Array.isArray(sources) || sources.length !== 1 || sources[0]?.id !== 1 || titleKey(sources[0]?.name) !== 'steam') stopReason = 'steam_source_reference_unverified';
      else {
        const types = await request(IGDB_ENDPOINTS.gameTypes, 'fields id,type; where id = 0; limit 2;');
        if (!Array.isArray(types) || types.length !== 1 || types[0]?.id !== 0 || titleKey(types[0]?.type) !== 'maingame') stopReason = 'main_game_reference_unverified';
        else { state.referencesVerified = true; await persist(); }
      }
    }
    while (!stopReason && state.nextIndex < existing.length && state.pagesCompleted < maxPages) {
      const batch = existing.slice(state.nextIndex, state.nextIndex + batchSize); const ids = batch.map(item => item.igdbId);
      const response = await request(IGDB_ENDPOINTS.games, buildCatalogRefreshQuery(ids));
      if (!Array.isArray(response) || response.length > ids.length || response.some(row => !object(row) || !ids.includes(row.id)) || new Set(response.map(row => row.id)).size !== response.length) {
        stopReason = 'invalid_refresh_page'; break;
      }
      const fetchedAt = timestamp();
      for (const expected of batch) {
        const raw = response.find(row => row.id === expected.igdbId);
        if (!raw) { state.rejections.push({ igdbId: expected.igdbId, appid: expected.appid, code: 'catalog_record_unavailable' }); continue; }
        const result = normalizeDiscoveryCandidate(raw, { fetchedAt, preservedGenres: { [expected.appid]: expected.genre } });
        if (!result.accepted) { state.rejections.push({ ...result.rejection, appid: expected.appid }); continue; }
        if (result.candidate.appid !== expected.appid) { state.rejections.push({ igdbId: expected.igdbId, appid: expected.appid, code: 'refresh_crosswalk_conflict' }); continue; }
        state.candidates.push(result.candidate);
      }
      state.nextIndex += batch.length; state.pagesCompleted += 1; await persist();
    }
  } catch (error) { stopReason = callbackFailed ? 'checkpoint_callback_failed' : safeFailure(error); }
  stopReason ??= state.nextIndex >= existing.length ? 'existing_catalog_refreshed' : 'page_budget_exhausted';
  const complete = stopReason === 'existing_catalog_refreshed'; const coverage = genreCoverage(state.candidates);
  return {
    status: complete ? 'complete' : state.pagesCompleted || state.candidates.length ? 'partial' : 'failed',
    candidates: clone(state.candidates), rejections: clone(state.rejections), checkpoint: clone(state), errors: complete ? [] : [{ code: stopReason }],
    metadata: { adapterVersion: 'igdb-refresh-1.0', taxonomyVersion: TAXONOMY_VERSION, taxonomyStatus: TAXONOMY_STATUS, startedAt, finishedAt: timestamp(),
      stopReason, target: existing.length, accepted: state.candidates.length, rejected: state.rejections.length, attempted: state.nextIndex,
      pagesCompleted: state.pagesCompleted, maxPages, batchSize, requestsThisInvocation, sourceReferencesVerified: state.referencesVerified,
      rights: IGDB_RIGHTS, coverage, underMinimumGenres: coverage.filter(item => item.status === 'under_minimum').map(item => item.genre),
      identity: 'IGDB crosswalk revalidated; independent Steam evidence remains a separate caller-owned freshness and title-validation gate.',
      scope: 'Refresh existing IDs only. No candidate discovery, Steam metrics collection, or Steam tag collection.',
    },
  };
}
