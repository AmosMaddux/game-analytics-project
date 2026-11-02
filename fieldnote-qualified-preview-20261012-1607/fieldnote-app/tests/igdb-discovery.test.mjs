import test from 'node:test';
import assert from 'node:assert/strict';
import { DISCOVERY_LIMITS, IGDB_ENDPOINTS, buildCatalogRefreshQuery, buildDiscoveryQuery, discoverIgdb, exactSteamAppUrl, normalizeDiscoveryCandidate, refreshIgdb } from '../collectors/igdb.mjs';
import { DISCOVERY_ROUTES, GENRES, TAXONOMY_STATUS, TAXONOMY_VERSION, UNRESOLVED_GENRE, genreCoverage, mapEditorialGenre, routeFilter } from '../collectors/taxonomy.mjs';
import { readFile } from 'node:fs/promises';

// Synthetic source-shaped fixtures are never included in the application seed.
const fetchedAt = '2026-10-10T18:00:00.000Z';
const now = () => new Date(fetchedAt);
const copy = value => JSON.parse(JSON.stringify(value));
const label = (id, name) => ({ id, name });
const labels = {
  colony: { keywords: [label(101, 'city building')] },
  cozy: { themes: [label(23, 'Sandbox')], keywords: [label(102, 'cozy')] },
  farming: { genres: [label(13, 'Simulator')], keywords: [label(103, 'farming')] },
  horror: { themes: [label(19, 'Horror')] },
  platformer: { genres: [label(8, 'Platform')] },
  puzzle: { genres: [label(9, 'Puzzle')] },
  deckbuilder: { keywords: [label(104, 'deckbuilder'), label(105, 'roguelike')] },
  role_playing: { genres: [label(12, 'Role-playing (RPG)')] },
  shooter: { genres: [label(5, 'Shooter')] },
  strategy: { genres: [label(15, 'Strategy')] },
  survival: { themes: [label(21, 'Survival')] },
  racing_sports: { genres: [label(10, 'Racing')] },
};
function fixture({ igdbId = 100, appid = 123456, routeId = 'puzzle', rating = 12 } = {}) {
  return {
    id: igdbId, name: `Synthetic game ${igdbId}`, summary: 'Explicit test fixture.', url: `https://www.igdb.com/games/synthetic-${igdbId}`,
    game_type: { id: 0, type: 'Main Game' }, platforms: [{ id: 6, name: 'PC (Microsoft Windows)', abbreviation: 'PC' }],
    genres: [], themes: [], keywords: [], ...copy(labels[routeId]), rating_count: rating,
    updated_at: 1728000000, first_release_date: 864000000,
    external_games: [{ id: igdbId + 200000, uid: String(appid), game: igdbId, external_game_source: { id: 1, name: 'Steam' }, url: `https://store.steampowered.com/app/${appid}/`, platform: 6, updated_at: 1728000000 }],
    involved_companies: [{ id: 401, company: { id: 402, name: 'Synthetic Studio' }, developer: true, publisher: true, supporting: false, porting: false, updated_at: 1728000000 }],
    websites: [{ id: 501, url: 'https://example.org/', type: { id: 1, type: 'Official Website' }, trusted: false }],
    release_dates: [{ id: 601, date: 864000000, human: '1997', y: 1997, m: 12, platform: { id: 6, name: 'PC (Microsoft Windows)' }, date_format: { id: 2, format: 'YYYY' }, release_region: { id: 8, region: 'worldwide' }, status: { id: 6, name: 'Full Release' } }],
  };
}
function routeOf(body) { return DISCOVERY_ROUTES.find(item => body.includes(`(${routeFilter(item.id)})`))?.id; }
function stratumOf(body) { return body.includes('rating_count >= 10') ? 'high' : 'low'; }
function fakeTransport({ rowsPerStream = 15, transform = row => row } = {}) {
  const calls = [];
  return { calls, async request(endpoint, body) {
    calls.push({ endpoint, body });
    if (endpoint === IGDB_ENDPOINTS.sources) return [{ id: 1, name: 'Steam' }];
    if (endpoint === IGDB_ENDPOINTS.gameTypes) return [{ id: 0, type: 'Main Game' }];
    assert.equal(endpoint, IGDB_ENDPOINTS.games);
    const routeId = routeOf(body); assert.ok(routeId);
    const stratum = stratumOf(body); const routeIndex = DISCOVERY_ROUTES.findIndex(item => item.id === routeId);
    const afterId = Number(/id > (\d+)/.exec(body)[1]); const pageSize = Number(/limit (\d+);$/.exec(body)[1]);
    return Array.from({ length: rowsPerStream }, (_, index) => {
      const igdbId = 1000 + routeIndex * 1000 + (stratum === 'low' ? 500 : 0) + index;
      return transform(fixture({ igdbId, appid: 1000000 + igdbId, routeId, rating: stratum === 'high' ? 100 : index % 2 ? 0 : null }), { routeId, stratum, index });
    }).filter(Boolean).filter(row => row.id > afterId).slice(0, pageSize);
  } };
}

test('twelve approved editorial routes preserve original seven names and do not consume Steam tags', () => {
  assert.equal(TAXONOMY_VERSION, 'editorial-expanded-1.1');
  assert.equal(TAXONOMY_STATUS, 'user_approved_2026-10-10');
  assert.equal(GENRES.length, 12); assert.equal(DISCOVERY_ROUTES.length, 12);
  assert.deepEqual(GENRES.slice(0, 7), ['Colony / settlement simulation', 'Cozy building toy', 'Farming / life simulation', 'Horror / exploration', 'Platformer / metroidvania', 'Puzzle', 'Roguelike deckbuilder']);
  assert.equal(mapEditorialGenre({ tags: ['Puzzle', 'Farming Sim'], keywords: [] }).genre, null);
  for (const route of DISCOVERY_ROUTES) assert.equal(mapEditorialGenre(labels[route.id], { preferredRouteId: route.id }).genre, route.genre);
});

test('composite categories require both source concepts and caller preservation wins', () => {
  assert.equal(mapEditorialGenre({ keywords: [label(1, 'cozy')] }).genre, null);
  assert.equal(mapEditorialGenre({ keywords: [label(1, 'deckbuilder')] }).genre, null);
  assert.equal(mapEditorialGenre({ keywords: [label(1, 'roguelike')] }).genre, null);
  const preserved = mapEditorialGenre(labels.puzzle, { preservedGenre: 'Cozy building toy' });
  assert.equal(preserved.genre, 'Cozy building toy'); assert.equal(preserved.method, 'preserved_editorial_mapping');
  assert.equal(preserved.matches[0].genre, 'Puzzle');
  assert.throws(() => mapEditorialGenre({}, { preservedGenre: 'Invented' }), /Unknown/);
});

test('v1.1 evidence tiers correct incidental farming and cozy labels under explicit Survival without name rules', () => {
  const previousMapping = { version: 'editorial-expanded-1.0', genre: GENRES[2], routeId: 'farming', method: 'explicit_igdb_label_rule' };
  for (const raw of [
    { genres: [label(5, 'Shooter'), label(12, 'Role-playing (RPG)')], themes: [label(21, 'Survival')], keywords: [label(1, 'farming'), label(2, 'crafting')] },
    { genres: [label(13, 'Simulator'), label(12, 'Role-playing (RPG)')], themes: [label(21, 'Survival'), label(23, 'Sandbox')], keywords: [label(1, 'farming simulator'), label(2, 'cozy'), label(3, 'exploration')] },
  ]) {
    const mapped = mapEditorialGenre(raw, { previousMapping, preferredRouteId: 'farming' });
    assert.equal(mapped.genre, 'Survival / crafting'); assert.equal(mapped.ambiguity.status, 'multiple_supported_labels');
    assert.deepEqual(mapped.previousMapping, previousMapping); assert.equal(mapped.discoveryRouteId, 'farming');
    for (const route of ['farming', 'cozy', 'survival', 'role_playing', 'shooter']) assert.equal(mapEditorialGenre(raw, { preferredRouteId: route }).genre, 'Survival / crafting');
    assert.equal(mapEditorialGenre(raw, { preservedGenre: 'Farming / life simulation' }).genre, 'Farming / life simulation');
  }
  const incidental = { genres: [label(5, 'Shooter')], keywords: [label(1, 'farming'), label(2, 'agriculture')] };
  assert.equal(mapEditorialGenre(incidental, { preferredRouteId: 'farming' }).genre, 'Shooter');
});

test('exploration and crafting alone never assert Horror or Survival; direct Shooter/RPG evidence remains equal', () => {
  assert.equal(mapEditorialGenre({ keywords: [label(1, 'exploration')] }).genre, null);
  assert.equal(mapEditorialGenre({ keywords: [label(1, 'crafting')] }).genre, null);
  const shooter = { genres: [label(5, 'Shooter'), label(12, 'Role-playing (RPG)')], keywords: [label(1, 'crafting'), label(2, 'exploration')] };
  assert.equal(mapEditorialGenre(shooter, { preferredRouteId: 'role_playing', previousMapping: { version: 'editorial-expanded-1.0', genre: 'Role-playing', routeId: 'role_playing' } }).genre, 'Role-playing');
  assert.equal(mapEditorialGenre(shooter, {preferredRouteId:'shooter'}).genre,null);
  const mixed = { genres: [label(9, 'Puzzle'), label(12, 'Role-playing (RPG)')], keywords: [label(1, 'crafting')] };
  for (const route of ['puzzle', 'role_playing', 'survival']) {
    const result = mapEditorialGenre(mixed, { preferredRouteId: route });
    assert.equal(result.genre, null); assert.equal(result.method, 'unresolved_source_label_ambiguity'); assert.equal(result.ambiguity.status, 'unresolved_primary');
  }
  const previousMapping = { version: 'editorial-expanded-1.0', genre: 'Puzzle', routeId: 'puzzle' };
  assert.equal(mapEditorialGenre(mixed, { previousMapping }).genre, 'Puzzle');
  assert.equal(mapEditorialGenre(mixed, { previousMapping }).selectionRule, 'retained_supported_previous_mapping');
});

test('all original 36 editorial mappings remain unchanged under the new source-evidence rules', async () => {
  const seed = JSON.parse(await readFile(new URL('../seed/snapshot.json', import.meta.url), 'utf8'));
  assert.equal(seed.games.length, 36);
  for (const game of seed.games) {
    const raw = { genres: game.catalog.genres, themes: game.catalog.themes, keywords: game.catalog.keywords };
    assert.equal(mapEditorialGenre(raw, { preservedGenre: game.genre }).genre, game.genre);
  }
});

test('queries use expanded current fields and stable validated keyset cursors', () => {
  const query = buildDiscoveryQuery({ routeId: 'puzzle', stratum: 'low', afterId: 45, pageSize: 50 });
  assert.match(query, /game_type\.type/); assert.match(query, /external_games\.external_game_source\.name/);
  assert.match(query, /rating_count < 10 \| rating_count = null/); assert.match(query, /id > 45; sort id asc; limit 50;/);
  assert.doesNotMatch(query, /\btags\b|\bcategory\b|\boffset\b/);
  for (const options of [{ routeId: 'puzzle; drop table games' }, { routeId: 'puzzle', afterId: -1 }, { routeId: 'puzzle', afterId: '1' }, { routeId: 'puzzle', pageSize: 101 }, { routeId: 'puzzle', stratum: 'trending' }]) assert.throws(() => buildDiscoveryQuery(options), TypeError);
});

test('normalization keeps raw labels, releases, companies, provenance and unknown Steam identity separate', () => {
  const raw = fixture({ rating: 0 }); raw.arbitraryRawSecret = 'SHOULD_NOT_PERSIST'; raw.tags = ['Not a Steam tag'];
  raw.websites.push({ id: 999, url: 'javascript:alert(1)', type: { id: 1, type: 'Official Website' } });
  const result = normalizeDiscoveryCandidate(raw, { fetchedAt }); assert.equal(result.accepted, true);
  const candidate = result.candidate; const catalog = candidate.catalog;
  assert.equal(candidate.genre, 'Puzzle'); assert.equal(candidate.tractionProxy.value, 0); assert.equal(candidate.tractionProxy.stratum, 'low');
  assert.equal(catalog.status, 'candidate_pending_steam_validation'); assert.equal(catalog.identity.status, 'exact_igdb_crosswalk_pending_steam_validation');
  assert.equal(catalog.identity.steamName, null); assert.equal(catalog.identity.steamFetchedAt, null);
  assert.deepEqual(catalog.genres, [label(9, 'Puzzle')]); assert.deepEqual(catalog.themes, []); assert.deepEqual(catalog.keywords, []);
  assert.equal(catalog.developers[0].name, 'Synthetic Studio'); assert.equal(catalog.publishers[0].name, 'Synthetic Studio');
  assert.equal(catalog.officialWebsites.length, 1); assert.equal(catalog.websites.length, 1);
  assert.equal(catalog.releaseDates[0].dateFormat.format, 'YYYY'); assert.match(catalog.releaseDates[0].scope, /not a Steam-specific/);
  assert.equal(catalog.provenance.ratingCount.unit, 'IGDB user ratings'); assert.equal(catalog.provenance.name.eventOrObservationTime, null);
  assert.equal(catalog.provenance.name.fetchedAt, fetchedAt); assert.notEqual(catalog.sourceUpdatedAt, fetchedAt);
  assert.equal('tags' in candidate, false); assert.equal('steamName' in candidate, false);
  assert.doesNotMatch(JSON.stringify(result), /SHOULD_NOT_PERSIST|javascript:/);
});

test('official studio links live on company role details and reject unsafe or nonofficial sources', () => {
  const raw = fixture();
  raw.involved_companies[0].company.url = 'https://www.igdb.com/companies/synthetic-studio';
  raw.involved_companies[0].company.websites = [
    { id: 701, url: 'https://studio.example.org/', type: { id: 1, type: 'Official Website' }, trusted: false },
    { id: 702, url: 'https://studio.example.org/news', type: { id: 1, type: 'Official' }, trusted: true },
    { id: 703, url: 'https://social.example.org/studio', type: { id: 4, type: 'Twitter' }, trusted: true },
    { id: 704, url: 'javascript:alert(1)', type: { id: 1, type: 'Official Website' }, trusted: true },
    { id: 705, url: 'https://name:password@studio.example.org/', type: { id: 1, type: 'Official Website' } },
    { id: 706, url: 'https://studio.example.org/untyped' },
  ];
  const catalog = normalizeDiscoveryCandidate(raw, { fetchedAt }).candidate.catalog; const role = catalog.companies[0];
  assert.deepEqual(role.company, { id: 402, name: 'Synthetic Studio' });
  assert.equal(role.companySourceUrl, 'https://www.igdb.com/companies/synthetic-studio');
  assert.deepEqual(role.officialWebsites.map(item => item.id), [701, 702]);
  assert.equal(role.officialWebsites[0].trusted, false);
  assert.deepEqual(catalog.developers[0], { id: 402, name: 'Synthetic Studio' });
  assert.equal(catalog.provenance.companies.fieldPath, 'involved_companies');
  const query = buildDiscoveryQuery({ routeId: 'puzzle' });
  assert.match(query, /involved_companies\.company\.url/); assert.match(query, /involved_companies\.company\.websites\.type\.type/);
  raw.involved_companies[0].company.url = 'https://untrusted.example.org/company';
  assert.equal(normalizeDiscoveryCandidate(raw, { fetchedAt }).candidate.catalog.companies[0].companySourceUrl, null);
  raw.involved_companies[0].company.websites = 'malformed';
  assert.equal(normalizeDiscoveryCandidate(raw, { fetchedAt }).rejection.code, 'invalid_catalog_collection');
});

test('all unsafe, ambiguous and non-exact Steam crosswalk variants are rejected', () => {
  const edits = [
    raw => { raw.external_games = []; }, raw => { raw.external_games[0].uid = 123456; }, raw => { raw.external_games[0].uid = '0123456'; },
    raw => { raw.external_games[0].uid = '4294967296'; }, raw => { raw.external_games[0].game = 101; },
    raw => { raw.external_games[0].external_game_source = { id: 2, name: 'Steam' }; }, raw => { raw.external_games[0].external_game_source = { id: 1, name: 'Other' }; },
    raw => { raw.external_games[0].url = 'https://store.steampowered.com/app/999/'; }, raw => { raw.external_games[0].url = 'https://evil.example/app/123456/'; },
    raw => { raw.external_games[0].url = 'https://store.steampowered.com/app/123456/name'; }, raw => { raw.external_games[0].url = 'http://store.steampowered.com/app/123456/'; },
    raw => { raw.external_games[0].url = 'https://store.steampowered.com/app/123456/?x=1'; }, raw => { raw.external_games[0].url = 'https://user:pass@store.steampowered.com/app/123456/'; },
    raw => { raw.external_games[0].url = null; }, raw => { raw.external_games[0].platform = 48; },
    raw => { raw.external_games.push({ ...copy(raw.external_games[0]), id: 999, uid: '777', url: 'https://store.steampowered.com/app/777/' }); },
  ];
  for (const edit of edits) { const raw = fixture(); edit(raw); assert.equal(normalizeDiscoveryCandidate(raw, { fetchedAt }).accepted, false, JSON.stringify(raw.external_games)); }
  assert.equal(exactSteamAppUrl('https://store.steampowered.com/app/123456', 123456), true);
  assert.equal(exactSteamAppUrl('https://store.steampowered.com/app/123456/#x', 123456), false);
});

test('base game and desktop eligibility are independently mandatory', () => {
  for (const edit of [raw => { raw.game_type = { id: 1, type: 'DLC' }; }, raw => { delete raw.game_type; raw.category = 0; },
    raw => { raw.game_type = { id: 0, type: 'Expansion' }; }, raw => { raw.parent_game = 100; }, raw => { raw.version_parent = 100; },
    raw => { raw.version_title = 'Deluxe'; }, raw => { raw.platforms = [{ id: 48, name: 'PlayStation 4' }]; },
    raw => { raw.platforms = [{ id: 6, name: 'PlayStation 4' }]; }, raw => { raw.url = 'file:///tmp/game'; }]) {
    const raw = fixture(); edit(raw); assert.equal(normalizeDiscoveryCandidate(raw, { fetchedAt }).accepted, false);
  }
});

test('missing/malformed labels or rating counts cannot fabricate a grouping or zero', () => {
  const raw = fixture(); raw.genres = []; raw.tags = ['Puzzle'];
  assert.equal(normalizeDiscoveryCandidate(raw, { fetchedAt }).rejection.code, 'unmapped_editorial_genre');
  assert.equal(normalizeDiscoveryCandidate(raw, { fetchedAt, preservedGenres: { 123456: 'Puzzle' } }).candidate.taxonomy.method, 'preserved_editorial_mapping');
  for (const rating of [-1, '0', NaN]) { const value = fixture({ rating }); assert.equal(normalizeDiscoveryCandidate(value, { fetchedAt }).rejection.code, 'invalid_rating_count'); }
  const missing = fixture(); delete missing.rating_count;
  assert.equal(normalizeDiscoveryCandidate(missing, { fetchedAt }).candidate.tractionProxy.value, null);
  assert.throws(() => normalizeDiscoveryCandidate(fixture(), { fetchedAt: 'bad time' }), /timestamp/);
});

test('default bounded discovery can admit 360 candidates across all twelve high/low routes', async () => {
  const transport = fakeTransport(); const checkpoints = [];
  const result = await discoverIgdb({ transport, now, onCheckpoint: checkpoint => { checkpoints.push(checkpoint); checkpoint.candidates.length = 0; } });
  assert.equal(result.status, 'complete'); assert.equal(result.candidates.length, 360); assert.equal(result.metadata.stopReason, 'target_reached');
  assert.equal(result.metadata.pagesCompleted, 24); assert.equal(transport.calls.length, 26);
  assert.equal(checkpoints.length, 25); assert.equal(result.metadata.underMinimumGenres.length, 0);
  assert.equal(new Set(result.candidates.map(item => item.appid)).size, 360);
  assert.equal(new Set(result.candidates.map(item => item.catalog.sourceId)).size, 360);
  assert.ok(result.metadata.coverage.every(item => item.count === 30));
  for (const genre of GENRES) assert.equal(result.candidates.filter(item => item.genre === genre && item.tractionProxy.stratum === 'high').length, 15);
  assert.equal(result.metadata.steamTags.startsWith('Unknown'), true);
  assert.ok(result.metadata.maximumDiscoveryRows >= 300);
});

test('checkpoint resume is exact, skips completed reference reads and retains bounded identity state', async () => {
  const transport = fakeTransport();
  const first = await discoverIgdb({ transport, pageSize: 10, maxPages: 7, now });
  assert.equal(first.status, 'partial'); assert.equal(first.candidates.length, 70); assert.equal(first.checkpoint.pagesCompleted, 7);
  const lastCheckpoint = copy(first.checkpoint); const callsBefore = transport.calls.length;
  const resumed = await discoverIgdb({ transport, pageSize: 10, checkpoint: lastCheckpoint, now });
  assert.equal(resumed.status, 'complete'); assert.equal(resumed.candidates.length, 360); assert.equal(resumed.metadata.pagesCompleted, 48);
  assert.equal(transport.calls.length - callsBefore, 41); assert.deepEqual(first.checkpoint, lastCheckpoint);
  assert.equal(new Set(resumed.candidates.map(item => item.appid)).size, 360);
  await assert.rejects(discoverIgdb({ transport, pageSize: 10, target: 350, checkpoint: lastCheckpoint, now }), /Incompatible/);
  const unsafe = copy(lastCheckpoint); unsafe.candidates[0].catalog.websites[0].url = 'javascript:alert(1)';
  await assert.rejects(discoverIgdb({ transport, pageSize: 10, checkpoint: unsafe, now }), /Invalid checkpoint candidate/);
  const missingClaims = copy(lastCheckpoint); missingClaims.claims = [];
  await assert.rejects(discoverIgdb({ transport, pageSize: 10, checkpoint: missingClaims, now }), /Invalid checkpoint identity claims/);
});

test('all configured caps reject excessive values before any request', async () => {
  let requests = 0; const transport = { async request() { requests += 1; return []; } };
  for (const options of [{ target: 451 }, { maxPages: 61 }, { pageSize: 101 }, { target: 0 }, { maxPages: 0 }]) await assert.rejects(discoverIgdb({ transport, ...options, now }), TypeError);
  assert.equal(requests, 0); assert.equal(DISCOVERY_LIMITS.target, 450); assert.equal(DISCOVERY_LIMITS.pages, 60);
});

test('sparse categories remain truthfully below fifteen with no synthetic production padding', async () => {
  const result = await discoverIgdb({ transport: fakeTransport({ rowsPerStream: 2 }), now });
  assert.equal(result.status, 'complete'); assert.equal(result.candidates.length, 48);
  assert.equal(result.metadata.underMinimumGenres.length, 12); assert.ok(result.metadata.coverage.every(item => item.count === 4 && item.status === 'under_minimum'));
  assert.equal(genreCoverage([]).every(item => item.count === 0), true);
});

test('second pass reallocates sparse-route capacity without hiding missing genres or abandoning high/low balance', async () => {
  const result = await discoverIgdb({ transport: fakeTransport({ rowsPerStream: 100, transform(raw, { routeId }) { return ['cozy', 'deckbuilder'].includes(routeId) ? null : raw; } }), now });
  assert.equal(result.status, 'complete'); assert.equal(result.candidates.length, 360); assert.equal(result.metadata.allocationPhase, 'reallocation');
  assert.equal(result.candidates.filter(item => item.tractionProxy.stratum === 'high').length, 180);
  assert.deepEqual(result.metadata.underMinimumGenres, ['Cozy building toy', 'Roguelike deckbuilder']);
  assert.ok(result.metadata.coverage.find(item => item.genre === 'Colony / settlement simulation').count > 30);
  assert.ok(result.metadata.pagesCompleted <= 60);
});

test('a second IGDB identity for one Steam AppID quarantines both candidates', async () => {
  const result = await discoverIgdb({ transport: fakeTransport({ rowsPerStream: 1, transform(raw, context) {
    if (context.routeId !== 'colony') return null;
    raw.external_games[0].uid = '777'; raw.external_games[0].url = 'https://store.steampowered.com/app/777/'; return raw;
  } }), now });
  assert.equal(result.candidates.length, 0); assert.ok(result.checkpoint.blockedAppids.includes(777));
  assert.equal(result.rejections.filter(item => item.code === 'ambiguous_cross_record_identity').length, 2);
});

test('one IGDB identity claimed by two Steam AppIDs is quarantined even across discovery routes', async () => {
  const result = await discoverIgdb({ transport: fakeTransport({ rowsPerStream: 1, transform(raw, context) {
    if (!['puzzle', 'strategy'].includes(context.routeId) || context.stratum === 'low') return null;
    raw.id = 987; raw.external_games[0].game = 987; return raw;
  } }), now });
  assert.equal(result.candidates.length, 0); assert.ok(result.checkpoint.blockedIgdbIds.includes(987));
});

test('original games are preserved by caller identity and never reassigned from discovered labels', async () => {
  const existingGames = [{ appid: 1001000, genre: 'Cozy building toy', catalog: { sourceId: 1000 } }];
  const result = await discoverIgdb({ transport: fakeTransport({ rowsPerStream: 1 }), existingGames, now });
  assert.equal(result.candidates.some(item => item.appid === existingGames[0].appid), false);
  assert.ok(result.rejections.some(item => item.code === 'already_preserved'));
  assert.equal(existingGames[0].genre, 'Cozy building toy');
});

test('a subsequent discovery pass skips preserved and previously quarantined AppIDs while filling a new target of 84', async () => {
  const initial = await discoverIgdb({ transport: fakeTransport({ rowsPerStream: 12 }), target: 48, now });
  assert.equal(initial.candidates.length, 48);
  const existingGames = initial.candidates.filter((_, index) => index % 2 === 0);
  const excludedAppids = initial.candidates.filter((_, index) => index % 2 === 1).map(item => item.appid);
  const firstAppids = new Set(initial.candidates.map(item => item.appid));
  const result = await discoverIgdb({ transport: fakeTransport({ rowsPerStream: 12 }), target: 84, existingGames, excludedAppids, now });
  assert.equal(result.status, 'complete'); assert.equal(result.candidates.length, 84);
  assert.equal(result.candidates.some(item => firstAppids.has(item.appid)), false);
  assert.equal(result.rejections.filter(item => item.code === 'already_preserved').length, 24);
  assert.equal(result.rejections.filter(item => item.code === 'previously_quarantined').length, 24);
  assert.equal(result.checkpoint.claims.some(item => excludedAppids.includes(item.appid)), false);
  assert.deepEqual(result.checkpoint.config.excludedAppids, [...excludedAppids].sort((a, b) => a - b));
});

test('excluded AppIDs are strictly validated and bound to checkpoints without changing legacy empty-exclusion resumes', async () => {
  const transport = fakeTransport({ rowsPerStream: 2 });
  for (const excludedAppids of [[1, 1], ['1'], [0], [-1], [4294967296], Array(1), Array.from({ length: 5001 }, (_, index) => index + 1)]) {
    await assert.rejects(discoverIgdb({ transport, excludedAppids, now }), /Invalid excluded Steam AppIDs/);
  }
  assert.equal(transport.calls.length, 0);
  const old = await discoverIgdb({ transport, maxPages: 1, now });
  assert.deepEqual(old.checkpoint.config, { target: 360, pageSize: 50 });
  const resumed = await discoverIgdb({ transport, checkpoint: old.checkpoint, excludedAppids: [], now });
  assert.equal(resumed.status, 'complete');
  await assert.rejects(discoverIgdb({ transport, checkpoint: old.checkpoint, excludedAppids: [1], now }), /Incompatible discovery checkpoint/);
  const excluded = await discoverIgdb({ transport, maxPages: 1, excludedAppids: [9, 8], now });
  const sortedResume = await discoverIgdb({ transport, checkpoint: excluded.checkpoint, excludedAppids: [8, 9], now });
  assert.equal(sortedResume.status, 'complete');
  await assert.rejects(discoverIgdb({ transport, checkpoint: excluded.checkpoint, excludedAppids: [8], now }), /Incompatible discovery checkpoint/);
  const tampered = copy(excluded.checkpoint); const inconsistent = [8, 9, tampered.candidates[0].appid];
  tampered.config.excludedAppids = inconsistent;
  await assert.rejects(discoverIgdb({ transport, checkpoint: tampered, excludedAppids: inconsistent, now }), /Invalid checkpoint identity claims/);
});

test('reference mismatch and provider errors fail closed without persisting provider error bodies', async () => {
  const mismatch = await discoverIgdb({ transport: { async request() { return [{ id: 1, name: 'Other' }]; } }, now });
  assert.equal(mismatch.status, 'failed'); assert.equal(mismatch.metadata.stopReason, 'steam_source_reference_unverified');
  const failed = await discoverIgdb({ transport: { async request() { throw new Error('SECRET_TOKEN_PROVIDER_BODY'); } }, now });
  assert.equal(failed.status, 'failed'); assert.equal(failed.errors[0].code, 'request_failed'); assert.doesNotMatch(JSON.stringify(failed), /SECRET_TOKEN_PROVIDER_BODY/);
  for (const code of ['access_denied', 'redirect_blocked', 'runtime_limit', 'request_limit', 'byte_limit', 'throttled', 'credential_reflection_blocked']) {
    const result = await discoverIgdb({ transport: { async request() { throw Object.assign(new Error('PRIVATE_RESPONSE'), { code }); } }, now });
    assert.equal(result.errors[0].code, code); assert.doesNotMatch(JSON.stringify(result), /PRIVATE_RESPONSE/);
  }
});

test('nonmonotonic pages cannot move checkpoint cursor, while checkpoint storage failure keeps useful normalized result', async () => {
  const base = fakeTransport({ rowsPerStream: 2 }); const transport = { async request(endpoint, body) { const rows = await base.request(endpoint, body); return endpoint === IGDB_ENDPOINTS.games ? rows.reverse() : rows; } };
  const result = await discoverIgdb({ transport, now });
  assert.equal(result.metadata.stopReason, 'invalid_or_nonmonotonic_page'); assert.equal(result.checkpoint.pagesCompleted, 0); assert.equal(result.checkpoint.streams[0].afterId, 0);
  const storage = await discoverIgdb({ transport: fakeTransport({ rowsPerStream: 2 }), now, onCheckpoint(checkpoint) { if (checkpoint.pagesCompleted) throw new Error('secret filesystem path'); } });
  assert.equal(storage.status, 'partial'); assert.equal(storage.checkpoint.pagesCompleted, 1); assert.equal(storage.candidates.length, 2);
  assert.equal(storage.errors[0].code, 'checkpoint_callback_failed'); assert.doesNotMatch(JSON.stringify(storage), /secret filesystem path/);
});

function refreshFixtures(size = 65) {
  const rows = Array.from({ length: size }, (_, index) => fixture({ igdbId: 100 + index, appid: 500000 + index }));
  const existingGames = rows.map(row => ({ appid: Number(row.external_games[0].uid), genre: 'Cozy building toy', catalog: { sourceId: row.id } }));
  const calls = [];
  const transport = { async request(endpoint, body) {
    calls.push({ endpoint, body });
    if (endpoint === IGDB_ENDPOINTS.sources) return [{ id: 1, name: 'Steam' }];
    if (endpoint === IGDB_ENDPOINTS.gameTypes) return [{ id: 0, type: 'Main Game' }];
    const ids = /where id = \(([\d,]+)\)/.exec(body)[1].split(',').map(Number);
    return copy(rows.filter(row => ids.includes(row.id)));
  } };
  return { rows, existingGames, calls, transport };
}

test('known-ID refresh batches thirty and preserves editorial grouping while requiring separate Steam proof', async () => {
  const data = refreshFixtures(); const result = await refreshIgdb({ ...data, now });
  assert.equal(result.status, 'complete'); assert.equal(result.candidates.length, 65); assert.equal(data.calls.length, 5); assert.equal(result.metadata.pagesCompleted, 3);
  assert.equal(result.candidates.every(item => item.genre === 'Cozy building toy' && item.taxonomy.method === 'preserved_editorial_mapping'), true);
  assert.equal(result.candidates[0].catalog.genres[0].name, 'Puzzle');
  assert.equal(result.candidates[0].catalog.identity.steamName, null);
  assert.equal(data.calls.filter(item => item.endpoint === IGDB_ENDPOINTS.games).every(item => !item.body.includes('rating_count >=') && !item.body.includes('id >')), true);
  assert.match(buildCatalogRefreshQuery([9, 3]), /where id = \(3,9\); sort id asc; limit 2;/);
  assert.throws(() => buildCatalogRefreshQuery([1, 1]), /Invalid/);
  assert.throws(() => buildCatalogRefreshQuery(Array.from({ length: 31 }, (_, index) => index + 1)), /Invalid/);
});

test('refresh resume skips prior batches, detects changed crosswalks and reports missing records', async () => {
  const data = refreshFixtures(); const first = await refreshIgdb({ ...data, maxPages: 1, now });
  assert.equal(first.status, 'partial'); assert.equal(first.candidates.length, 30); assert.equal(first.checkpoint.nextIndex, 30);
  data.rows[30].external_games[0].uid = '999999'; data.rows[30].external_games[0].url = 'https://store.steampowered.com/app/999999/';
  data.rows[31].game_type = { id: 1, type: 'DLC' }; data.rows.splice(32, 1);
  const resumed = await refreshIgdb({ ...data, checkpoint: first.checkpoint, now });
  assert.equal(resumed.status, 'complete'); assert.equal(resumed.candidates.length, 62); assert.equal(resumed.metadata.attempted, 65);
  assert.deepEqual(resumed.rejections.map(item => item.code).sort(), ['catalog_record_unavailable', 'not_main_game', 'refresh_crosswalk_conflict']);
  assert.equal(data.calls.length, 5);
  assert.equal(resumed.candidates.filter(item => item.genre !== 'Cozy building toy').length, 0);
});

test('refresh refuses new/out-of-scope identities and oversized or ambiguous caller catalogs', async () => {
  const data = refreshFixtures(1); const original = data.transport.request;
  data.transport.request = async (endpoint, body) => endpoint === IGDB_ENDPOINTS.games ? [fixture({ igdbId: 999, appid: 999999 })] : original(endpoint, body);
  const result = await refreshIgdb({ ...data, now });
  assert.equal(result.status, 'failed'); assert.equal(result.metadata.stopReason, 'invalid_refresh_page'); assert.equal(result.checkpoint.nextIndex, 0);
  await assert.rejects(refreshIgdb({ ...data, existingGames: Array(501).fill(data.existingGames[0]), now }), /Invalid existing/);
  await assert.rejects(refreshIgdb({ ...data, existingGames: [data.existingGames[0], data.existingGames[0]], now }), /Ambiguous existing/);
});

test('existing unresolved holding rows do not abort discovery or refresh, including resumed refresh', async () => {
  const data = refreshFixtures(2); data.existingGames.forEach(item => { item.genre = UNRESOLVED_GENRE; });
  data.rows[1].genres = [];
  const first = await refreshIgdb({ ...data, batchSize: 1, maxPages: 1, now });
  assert.equal(first.candidates[0].genre, 'Puzzle'); assert.equal(first.status, 'partial');
  const resumed = await refreshIgdb({ ...data, batchSize: 1, checkpoint: first.checkpoint, now });
  assert.equal(resumed.status, 'complete'); assert.equal(resumed.candidates.length, 1); assert.equal(resumed.rejections[0].code, 'unmapped_editorial_genre');
  assert.equal(data.existingGames.every(item => item.genre === UNRESOLVED_GENRE), true);
  const discovery = await discoverIgdb({ transport: fakeTransport({ rowsPerStream: 1 }), existingGames: [{ appid: 1001000, genre: UNRESOLVED_GENRE, catalog: { sourceId: 1000 } }], now });
  assert.equal(discovery.status, 'complete'); assert.equal(discovery.candidates.some(item => item.appid === 1001000), false);
  assert.equal(GENRES.includes(UNRESOLVED_GENRE), false);
});
