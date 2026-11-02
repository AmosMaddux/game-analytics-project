import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { hasValue, number, selectGames, safeUrl, rankGenres, scoreGenreRows, summarizeGenreTags, classifyGenreTag, metricFreshness, ageLabel } from '../src/model.ts';
const snapshot = JSON.parse(readFileSync(new URL('../seed/snapshot.json', import.meta.url), 'utf8'));
const saved = JSON.stringify(snapshot);
const observation = (value, overrides = {}) => ({ value, status: 'observed', sourceUrl: 'https://example.com/players', observedAt: '2026-10-10T10:00:00Z', ...overrides });
const fixture = (id, value, overrides = {}) => ({ id: String(id), appid: id, name: `Fixture ${id}`, genre: 'Fixture genre', cohort: 'TEST ONLY', tags: ['Logic'], players: observation(value), reviews: observation(null), ...overrides });

test('saved 36-game rankings preserve all seven prototype scores and denominators', () => {
  const rows = rankGenres(snapshot.games, snapshot.genres);
  assert.deepEqual(rows.map(row => row.popularityScore.toFixed(1)), ['100.0', '92.7', '83.5', '77.0', '75.6', '60.1', '58.7']);
  assert.deepEqual(rows.map(row => row.observedCount), [5, 1, 6, 6, 6, 6, 6]);
  assert.deepEqual(rows.map(row => row.total), [35291, 581, 15881, 1679, 67915, 1857, 2859]);
  assert.equal(rows[0].median, 407);
  assert.equal(rows[4].average, 67915 / 6);
});
test('game filtering never mutates the full-data score baseline or source', () => {
  const expected = rankGenres(snapshot.games, snapshot.genres);
  for (const filters of [{ query: 'stardew' }, { genre: 'Puzzle' }, { cohort: 'recent_6' }, { tag: 'Fishing', sort: 'reviews', direction: 'asc' }]) {
    selectGames(snapshot.games, filters);
    assert.deepEqual(rankGenres(snapshot.games, snapshot.genres), expected);
  }
  assert.equal(JSON.stringify(snapshot), saved);
});
test('observed zero is included while unsupported and null values stay outside denominator', () => {
  const games = [fixture(1, 0), fixture(2, null), fixture(3, 50, { players: observation(50, { status: 'estimated' }) })];
  const [row] = rankGenres(games, ['Fixture genre']);
  assert.equal(row.observedCount, 1); assert.equal(row.average, 0); assert.equal(row.median, 0); assert.equal(row.popularityScore, 0);
  assert.equal(number({ value: 0 }), '0'); assert.equal(number({ value: null }), 'Not captured'); assert.equal(hasValue(undefined), false);
});
test('source, valid timestamp, nonnegative numeric evidence and run eligibility are required for scores', () => {
  for (const overrides of [{ sourceUrl: 'javascript:alert(1)' }, { observedAt: 'unknown' }, { value: -1 }, { value: Infinity }, { value: '10' }, { scoreEligible: false }, { status: 'unknown' }]) {
    const [row] = rankGenres([fixture(1, 10, { players: observation(10, overrides) })], ['Fixture genre']);
    assert.equal(row.popularityScore, null); assert.equal(row.observedCount, 0);
  }
});
test('all supported zero groups rank 0 while unknown groups remain unranked', () => {
  const rows = scoreGenreRows([{ genre: 'A', average: 0, median: 0, total: 0, observedCount: 1, gameCount: 1 }, { genre: 'B', average: null, median: null, total: null, observedCount: 0, gameCount: 1 }]);
  assert.deepEqual(rows.map(row => row.popularityScore), [0, null]);
});
test('unresolved taxonomy is never ranked as a research genre even with observed players',()=>{
  const games=[fixture(1,100000,{genre:'Unresolved / needs review'}),fixture(2,10)];
  const rows=rankGenres(games,['Fixture genre','Unresolved / needs review']);
  assert.deepEqual(rows.map(row=>row.genre),['Fixture genre']);assert.equal(rows[0].total,10);
});
test('sort keeps null last in either direction and preserves zero', () => {
  const games = [fixture(1, null), fixture(2, 0), fixture(3, 10)];
  assert.deepEqual(selectGames(games).map(game => game.appid), [3, 2, 1]);
  assert.deepEqual(selectGames(games, { direction: 'asc' }).map(game => game.appid), [2, 3, 1]);
});
test('Steam tag recurrence uses whole tagged-game denominator and exact source labels', () => {
  const summary = summarizeGenreTags(snapshot.games, 'Farming / life simulation');
  assert.deepEqual(summary.tags.map(row => [row.tag, row.count]), [['Building', 6], ['Agriculture', 5], ['Crafting', 5], ['Fishing', 5], ['LGBTQ+', 3]]);
  assert.equal(summary.taggedGameCount, 6);
  assert.equal(summary.tags[1].percentage, 500 / 6);
  assert.equal(summarizeGenreTags(snapshot.games, 'Cozy building toy').tags.length, 0);
});
test('duplicate game identities and tags never increase recurrence', () => {
  const games = [fixture(1, 0, { tags: ['Logic', 'Logic'] }), fixture(1, 0, { tags: ['Logic'] }), fixture(2, 0, { tags: ['Logic', 'Indie'] }), fixture(3, 0, { tags: ['Indie'] })];
  const summary = summarizeGenreTags(games, 'Fixture genre');
  assert.equal(summary.gameCount, 3); assert.equal(summary.taggedGameCount, 3); assert.equal(summary.tags[0].count, 2); assert.equal(summary.tags[0].percentage, 200 / 3);
  for (const tag of ['Indie', 'RPG', 'Multiplayer', 'Casual', 'Pixel Graphics']) assert.equal(classifyGenreTag(tag), null);
});
test('safe source links accept only absolute HTTP(S)', () => {
  for (const url of ['javascript:alert(1)', 'data:text/html,test', 'file:///etc/passwd', '/api/snapshot', null, undefined]) assert.equal(safeUrl(url), null);
  assert.equal(safeUrl('https://example.com'), 'https://example.com/');
});
test('freshness ages independently of observed evidence and never changes rank inputs', () => {
  const now = Date.parse('2026-10-11T10:00:00Z');
  assert.equal(metricFreshness(observation(10), now).status, 'stale');
  assert.equal(metricFreshness(observation(10), now - 1).status, 'fresh');
  assert.equal(metricFreshness(observation(10, { observedAt: null }), now).status, 'unknown');
  assert.equal(metricFreshness(observation(10, { observedAt: '2030-01-01' }), now).status, 'unknown');
  assert.equal(metricFreshness(observation(10, { freshness: 'stale_cache' }), now - 60_000).status, 'stale');
  assert.equal(JSON.stringify(snapshot), saved);
});
test('age labels disclose unknown and elapsed collection time', () => {
  assert.equal(ageLabel(null), 'Age unknown'); assert.match(ageLabel(0), /less than a minute/); assert.equal(ageLabel(60_000), 'Collected 1 minute ago'); assert.equal(ageLabel(86_400_000), 'Collected 1 day ago');
});
