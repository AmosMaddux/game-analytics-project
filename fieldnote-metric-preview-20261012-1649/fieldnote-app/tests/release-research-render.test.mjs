import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { summarizeValues } from '../backend/cohort-foundation/statistics.mjs';
import { resolveReleaseWindow, resolveReviewWindows } from '../backend/cohort-foundation/windows.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const directory = await mkdtemp(resolve(tmpdir(), 'fieldnote-release-render-'));
const bundle = resolve(directory, 'render.cjs');
await build({ absWorkingDir: root, stdin: { contents: `import {createElement} from 'react'; import {renderToStaticMarkup} from 'react-dom/server'; import {ReleaseResearch,ReleaseResearchView,ResearchCategoryPicker} from './src/ReleaseResearch'; export * from './src/ReleaseResearch'; const components={ReleaseResearch,ReleaseResearchView,ResearchCategoryPicker}; export const render=(page,props)=>renderToStaticMarkup(createElement(components[page],props));`, resolveDir: root, loader: 'tsx' }, bundle: true, platform: 'node', format: 'cjs', outfile: bundle, logLevel: 'silent' });
const { render, assertReleaseResearch, assertResearchSelection, buildReleaseResearchQuery, releaseResearchSelection, changeResearchFilter, fetchReleaseResearch, visibleResearchState, isUtcDay, isUtcInstant, parseResearchCategories, clearResearchCategories, sortResearchCategories, sortResearchGames, researchRowCategories } = createRequire(import.meta.url)(bundle);
await rm(directory, { recursive: true, force: true });
const asOf = '2026-10-11T16:00:00.000Z';
const selection = { population: 'tracked', preset: '1m', basis: 'first_playable', metric: 'players', asOf };
const snapshot = { id: '["players","fixture-run","fixture-method","concurrent","players"]', metric: 'players', runId: 'test-only-run', methodVersion: 'test-only-v1', scope: 'Concurrent Steam players', collectedStart: '2026-10-10T12:00:00.000Z', collectedEnd: '2026-10-10T12:02:00.000Z', rowCount: 24 };
function genre(name, rows) {
  const values = rows.filter(row => row.value !== null).map(row => ({ appId: row.appId, value: row.value }));
  const missing = rows.filter(row => row.value === null).map(row => ({ appId: row.appId, reason: 'source_unavailable' }));
  const { n: _, ...statistics } = summarizeValues(values.map(row => row.value));
  return { genre: name, eligibleCount: rows.length, observedCount: values.length, missingCount: missing.length, coveragePercent: rows.length ? values.length / rows.length * 100 : null, ...statistics, values, missing, missingReasonCounts: missing.length ? { source_unavailable: missing.length } : {} };
}
function populated() {
  const groups = [genre('Test-only simulation', Array.from({ length: 20 }, (_, i) => ({ appId: String(100 + i), value: i === 19 ? 1000 : i }))), genre('Test-only puzzle', [200, 201, 202].map(appId => ({ appId: String(appId), value: 0 }))), genre('Test-only missing genre', [{ appId: '300', value: null }])];
  const audit = groups.flatMap(group => [...group.values, ...group.missing.map(row => ({ ...row, value: null }))].map(row => ({ appid: Number(row.appId), name: `Test-only game ${row.appId}`, genre: group.genre, savedCohort: 'fixture_only', appType: 'game', eligible: true, reasons: [], releaseDate: '2026-10-01', legacyDisplayDate: 'Oct 1, 2026', igdbFirstReleaseDate: '2026-09-15', evidence: [{ basis: 'first_playable', date: '2026-10-01', precision: 'day', verified: true, status: 'released', phase: 'early_access', source: `https://store.steampowered.com/app/${row.appId}/`, retrievedAt: '2026-10-10T12:00:00.000Z', note: 'Test-only verified Steam source' }], observation: { value: row.value, missingReason: row.value === null ? 'source_unavailable' : null, collectedAt: row.value === null ? null : snapshot.collectedStart, measuredAt: null, sourceUrl: 'https://api.steampowered.com/' } })));
  return { version: 'release-research-v1', mode: 'read_only_saved_evidence', selection: { ...selection }, releaseWindow: resolveReleaseWindow(selection), reviewWindows: resolveReviewWindows(selection), population: { id: 'tracked', label: 'All tracked games', inventoryCount: 24, selectedCount: 24, typeEligibleCount: 24, typeExcludedCount: 0, unresolvedGenreCount: 0, missingReleaseEvidenceCount: 0, taxonomyVersions: ['test-only-taxonomy'], note: 'Test-only fixture, never release data.' }, observations: { selected: snapshot, available: [snapshot], status: 'available', note: 'One comparable saved observation set.' }, cohort: { eligibleCount: 24, excludedCount: 0, exclusionCounts: {}, unclassifiedAppIds: [] }, statisticVersion: 'r7-trim10-floor-v1', releasePolicyVersion: 'strict-steam-day-v1', genres: groups, audit, notes: ['Current saved taxonomy is used; historical population membership is not reconstructed.'] };
}
function missingEvidence() {
  const fixture = populated();
  fixture.population.typeEligibleCount = 0; fixture.population.typeExcludedCount = 24; fixture.population.missingReleaseEvidenceCount = 24;
  fixture.cohort = { eligibleCount: 0, excludedCount: 24, exclusionCounts: { unknown_application_type: 24 }, unclassifiedAppIds: [] };
  fixture.genres = fixture.genres.map(group => genre(group.genre, []));
  fixture.audit = fixture.audit.map(row => ({ ...row, appType: 'unknown', eligible: false, reasons: ['unknown_application_type', 'missing_release_evidence'], releaseDate: null, evidence: [] }));
  return fixture;
}

test('populated release report shows denominators, robust statistics and raw audit evidence without ranking', () => {
  const fixture = populated(); assert.doesNotThrow(() => assertReleaseResearch(fixture));
  const html = render('ReleaseResearchView', { report: fixture });
  for (const text of ['SELECTED POPULATION', 'VERIFIED GAME TYPE', 'RELEASE COHORT', '24<small> / 24', 'Median', 'Mean', 'Q1 / Q3', 'IQR', '10% trimmed mean', '2 removed per tail · 16 retained', 'Largest-game share', 'Outlier concentration', 'Insufficient sample', 'Requires 20+ observed games', '100% coverage', '0% coverage · 1 missing', 'Per-app evidence audit', 'Raw saved metric', 'Release-date provenance', 'Steam AppID 100', 'test-only-run', 'r7-trim10-floor-v1', 'historical population membership is not reconstructed']) assert.ok(html.includes(text), text);
  assert.match(html, /href="#\/game\/100"/);
  assert.match(html, /href="https:\/\/store\.steampowered\.com\/app\/100\/" target="_blank" rel="noopener noreferrer"/);
  assert.doesNotMatch(html, /class="ranking-card|Popularity Score|Top genres|Market rank/);
});

test('release inclusion and 7/30-day review measurement intervals remain independent', () => {
  const html = render('ReleaseResearchView', { report: populated() });
  for (const value of ['2026-09-11T16:00:00.000Z', '2026-10-04T16:00:00.000Z', '2026-09-11T16:00:00.000Z']) assert.ok(html.includes(`dateTime="${value}"`));
  for (const text of ['Start, included', 'End, excluded', '00:00:00 UTC', 'Rolling windows preserve the as-of time', 'Custom dates include both selected days', 'Separate from release dates', 'full source validation and comparable saved observations', 'cumulative reviews are not a substitute', 'Includes a verified Early Access launch']) assert.ok(html.includes(text), text);
  const full = populated(); full.selection.basis = 'full_release';
  assert.match(render('ReleaseResearchView', { report: full }), /Early Access launch alone does not qualify/);
});

test('missing verified types and dates yield an honest empty state while preserving reference-only dates and raw values', () => {
  const fixture = missingEvidence(); assert.doesNotThrow(() => assertReleaseResearch(fixture));
  const html = render('ReleaseResearchView', { report: fixture });
  for (const text of ['No verified Steam release dates', 'Cohort aggregates are unavailable', '0<small> / 24', '24 unknown or excluded application types', 'IGDB first-release date', 'Legacy store display date', 'reference only, not verified Steam release evidence', 'Oct 1, 2026', '2026-09-15', 'unknown application type', 'No release evidence records', '1,000']) assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /Within-cohort genre statistics|<th scope="col">Median/);
});

test('all-missing metrics are unavailable, observed zero remains zero and zero-total concentration is undefined', () => {
  const fixture = populated();
  const html = render('ReleaseResearchView', { report: fixture });
  assert.match(html, /class="research-observed">0<\/strong>/);
  assert.match(html, /class="research-missing">Missing<\/strong>/);
  assert.match(html, /zero total/); assert.match(html, /source unavailable/);
  const allMissing = populated();
  allMissing.genres = allMissing.genres.map(group => genre(group.genre, [...group.values, ...group.missing].map(row => ({ appId: row.appId, value: null }))));
  allMissing.audit = allMissing.audit.map(row => ({ ...row, observation: { value: null, missingReason: 'source_unavailable', collectedAt: null, measuredAt: null, sourceUrl: null } }));
  allMissing.observations = { selected: null, available: [], status: 'unavailable', note: 'No comparable observations.' };
  assert.doesNotThrow(() => assertReleaseResearch(allMissing));
  const emptyHtml = render('ReleaseResearchView', { report: allMissing });
  assert.match(emptyHtml, /No comparable saved observation set/); assert.match(emptyHtml, /0% coverage · 20 missing/);
  assert.doesNotMatch(emptyHtml, /class="research-observed"/);
});

test('empty population is distinct from missing evidence or all-missing metrics', () => {
  const fixture = missingEvidence();
  Object.assign(fixture.population, { id: 'discovery', label: 'Saved discovery additions', selectedCount: 0, typeExcludedCount: 0, missingReleaseEvidenceCount: 0 });
  fixture.selection.population = 'discovery'; fixture.audit = []; fixture.genres = [];
  fixture.cohort = { eligibleCount: 0, excludedCount: 0, exclusionCounts: {}, unclassifiedAppIds: [] };
  assert.doesNotThrow(() => assertReleaseResearch(fixture));
  const html = render('ReleaseResearchView', { report: fixture });
  assert.match(html, /No saved applications in this population/); assert.match(html, /no saved applications to audit/);
  assert.doesNotMatch(html, /No verified Steam release dates/);
});

test('React escapes untrusted labels, reasons and provenance and rejects executable source URLs', () => {
  const fixture = populated();
  fixture.audit[0].name = '<script>alert(1)</script>';
  fixture.audit[0].observation.sourceUrl = 'javascript:alert(1)';
  fixture.audit[0].evidence[0].source = 'data:text/html,<script>alert(2)</script>';
  fixture.audit[0].evidence[0].note = '<img src=x onerror=alert(3)>';
  fixture.notes = ['<iframe src="evil">'];
  const html = render('ReleaseResearchView', { report: fixture });
  assert.match(html, /&lt;script&gt;/); assert.match(html, /&lt;img/); assert.match(html, /&lt;iframe/);
  assert.doesNotMatch(html, /<script|<img|<iframe|href="(?:javascript|data):/);
});

test('nested report validation rejects corrupt, nonfinite, mismatched, duplicate or incomplete evidence', () => {
  const fixture = populated();
  for (const mutate of [value => value.mode = 'live', value => value.selection.asOf = '2026-10-11', value => value.selection.population = 'market', value => value.population.selectedCount = 23, value => value.population.typeExcludedCount = 1, value => value.reviewWindows.reviews7d.kind = 'release_cohort', value => value.reviewWindows.reviews7d.asOf = '2026-10-10T00:00:00Z', value => value.releaseWindow.endExclusive = value.releaseWindow.startInclusive, value => value.observations.selected.collectedEnd = 'bad', value => value.genres[0].mean = NaN, value => value.genres[0].largestGameShare = 2, value => value.genres[0].values[0].value = Infinity, value => value.genres[0].missing.push({ appId: '999', reason: 'unknown' }), value => value.audit[0].observation.value = '0', value => value.audit[0].evidence[0].verified = 'true', value => value.audit[1].appid = value.audit[0].appid, value => value.audit.pop(), value => value.notes = {}]) {
    const invalid = structuredClone(fixture); mutate(invalid); assert.throws(() => assertReleaseResearch(invalid), /unsupported or inconsistent/);
  }
  for (const invalid of [null, {}, [], 'report']) assert.throws(() => assertReleaseResearch(invalid));
});

test('query builder freezes UTC cutoff, serializes all supported filters and excludes unrelated route state', () => {
  const defaults = new URLSearchParams(buildReleaseResearchQuery({}, asOf));
  assert.deepEqual(Object.fromEntries(defaults), selection);
  const custom = releaseResearchSelection({ population: 'legacy36', preset: 'custom', basis: 'full_release', metric: 'reviews30d', asOf: '2026-10-11T16:00:00Z', startDate: '2026-09-01', endDate: '2026-09-30', snapshot: snapshot.id, query: 'ignored' }, '2027-01-01T00:00:00Z');
  assert.equal(custom.asOf, asOf); assert.equal(custom.snapshot, snapshot.id); assert.equal(custom.startDate, '2026-09-01');
  assert.equal(custom.query, undefined);
  assert.equal(new URLSearchParams(buildReleaseResearchQuery(custom, asOf)).get('snapshot'), snapshot.id);
  const rolling = releaseResearchSelection({ preset: '7d', startDate: 'invalid ignored', endDate: 'invalid ignored' }, asOf);
  assert.equal(rolling.startDate, undefined); assert.equal(rolling.endDate, undefined);
  for (const preset of ['7d', '14d', '21d', '1m', '2m', '3m', '1y']) assert.equal(releaseResearchSelection({ preset }, asOf).preset, preset);
});

test('query dates reject Gregorian normalization, local/offset timestamps, inverted ranges and invalid filter values', () => {
  assert.equal(isUtcDay('2024-02-29'), true); assert.equal(isUtcDay('2025-02-29'), false); assert.equal(isUtcDay('0000-01-01'), false);
  assert.equal(isUtcInstant('2026-10-11T16:00:00.1Z'), true); assert.equal(isUtcInstant('2026-10-11T24:00:00Z'), false);
  for (const params of [{ population: 'all' }, { preset: '30d' }, { basis: 'igdb' }, { metric: 'popularity' }, { asOf: '2026-10-11T16:00:00' }, { asOf: '2026-10-11T16:00:00+00:00' }, { asOf: '2026-02-30T00:00:00Z' }, { preset: 'custom' }, { preset: 'custom', startDate: '2026-02-30', endDate: '2026-03-01' }, { preset: 'custom', startDate: '2026-10-02', endDate: '2026-10-01' }]) assert.throws(() => buildReleaseResearchQuery(params, asOf));
});

test('filter interactions clear incompatible snapshots, retain other filters, and URL-backed controls render recoverably', () => {
  const calls = []; const setter = (...args) => calls.push(args);
  changeResearchFilter(setter, 'metric', 'reviews');
  changeResearchFilter(setter, 'asOf', asOf);
  changeResearchFilter(setter, 'population', 'legacy36');
  assert.deepEqual(calls, [['snapshot', ''], ['metric', 'reviews'], ['snapshot', ''], ['asOf', asOf], ['population', 'legacy36']]);
  const html = render('ReleaseResearch', { params: { ...selection, preset: 'custom', startDate: '2026-09-01', endDate: '2026-09-30', snapshot: snapshot.id }, setFilter() {}, now: Date.parse('2027-01-01T00:00:00Z') });
  for (const text of ['Release research', 'Release basis', 'First playable, including Early Access', 'Full release only', 'As-of cutoff (UTC)', '2026-10-11T16:00:00.000', 'Release start date, included', 'Release end date, included', 'Selected snapshot (awaiting validation)', 'Reading the selected release cohort', 'Filters are stored in the page URL']) assert.ok(html.includes(text), text);
  const invalid = render('ReleaseResearch', { params: { asOf: 'invalid' }, setFilter() {}, now: Date.parse(asOf) });
  assert.match(invalid, /role="alert"/); assert.match(invalid, /valid explicit UTC timestamp/); assert.doesNotMatch(invalid, /Reading the selected release cohort/);
});

test('same-origin request passes abort signal, rejects HTTP/JSON/selection errors and never starts provider requests', async () => {
  const query = buildReleaseResearchQuery({}, asOf); const controller = new AbortController(); const calls = [];
  const result = await fetchReleaseResearch(query, controller.signal, async (...args) => { calls.push(args); return Response.json(populated()); });
  assert.equal(result.version, 'release-research-v1'); assert.equal(calls.length, 1);
  assert.equal(calls[0][0], `/api/research/releases?${query}`); assert.equal(calls[0][1].signal, controller.signal); assert.deepEqual(calls[0][1].headers, { Accept: 'application/json' });
  for (const status of [400, 500, 503]) await assert.rejects(fetchReleaseResearch(query, controller.signal, async () => new Response('private upstream secret', { status })), error => !error.message.includes('secret') && /unavailable|could not be read/.test(error.message));
  await assert.rejects(fetchReleaseResearch(query, controller.signal, async () => Response.json({})), /unsupported/);
  await assert.rejects(fetchReleaseResearch(query, controller.signal, async () => new Response('invalid json')), SyntaxError);
  const different = populated(); different.selection.basis = 'full_release';
  await assert.rejects(fetchReleaseResearch(query, controller.signal, async () => Response.json(different)), /does not match/);
  assert.throws(() => assertResearchSelection(populated(), buildReleaseResearchQuery({ snapshot: 'different saved set' }, asOf)), /does not match/);
});

test('newer filters or reload attempts synchronously hide stale results and errors before request effects run', async () => {
  const old = { key: 'queryA:0', report: populated(), loading: false, error: null };
  assert.equal(visibleResearchState(old, 'queryA:0').report, old.report);
  assert.deepEqual(visibleResearchState(old, 'queryB:0'), { key: 'queryB:0', report: null, loading: true, error: null });
  assert.equal(visibleResearchState(old, 'queryA:1').report, null);
  assert.equal(visibleResearchState({ ...old, report: null, error: 'old error' }, 'queryB:0').error, null);
  const source = await readFile(new URL('../src/ReleaseResearch.tsx', import.meta.url), 'utf8');
  assert.match(source, /new AbortController\(\)/); assert.match(source, /generation\.current === current/g); assert.match(source, /return \(\) => \{ controller\.abort\(\); \}/);
  assert.match(source, /report: null, loading: false, error:/);
  assert.doesNotMatch(source, /fetch\(['"]https?:|setInterval|setTimeout|localStorage|sessionStorage/);
});

function extended() {
  const fixture = populated();
  fixture.observations = structuredClone(fixture.observations);
  fixture.selection.taxonomy = 'igdb_genre';
  fixture.selection.categoryMatch = 'any';
  fixture.selection.reviewAsOf = '2026-10-10T00:00:00.000Z';
  fixture.reviewWindows = resolveReviewWindows({ asOf: fixture.selection.reviewAsOf });
  fixture.taxonomy = { source: 'igdb_genre', label: 'IGDB genres', version: 'test-source-labels-v1', note: 'Raw provider labels; no editorial fallback.', selected: [], match: 'any', coveredCount: 24, missingCount: 0, available: fixture.genres.map(group => ({ name: group.genre, populationCount: group.eligibleCount, cohortCount: group.eligibleCount })) };
  fixture.panel = { id: 'test-panel', label: 'Test-only saved panel', policyVersion: 'test-panel-v1', createdAt: '2026-10-10T12:00:00.000Z', targetCount: 300, selectedCount: 24, shortfallCount: 276, groups: [{ id: 'test_group', target: 300, selected: 24, shortfall: 276 }], note: 'Fixture membership only.' };
  fixture.reviewActivity = { window: null, status: 'not_selected', savedAnchors: ['2026-10-10T00:00:00.000Z'], note: 'Only exact saved intervals are comparable.' };
  fixture.audit = fixture.audit.map(row => ({ ...row, categories: [row.genre], categoryEvidence: [{ name: row.genre, sourceId: 42, sourceUrl: 'https://www.igdb.com/games/test-fixture', collectedAt: '2026-10-10T12:00:00.000Z', method: 'test-raw-v1' }], pcReleaseEvidence: [{ sourceId: 900, date: '2026-10-01', precision: 'day', dateFormat: { id: 0, format: 'YYYYMMDD' }, year: 2026, month: 10, region: 'worldwide', status: 'released', sourceUrl: 'https://www.igdb.com/games/test-fixture', collectedAt: '2026-10-10T12:00:00.000Z' }] }));
  return fixture;
}

test('category selection restores all populations, all dates, distinct IGDB PC basis and more than twelve exact labels', () => {
  const labels = Array.from({ length: 20 }, (_, i) => `Source label ${String(i).padStart(2, '0')}`);
  for (const population of ['panel', 'broad', 'tracked', 'legacy36', 'discovery']) assert.equal(releaseResearchSelection({ population }, asOf).population, population);
  const result = releaseResearchSelection({ population: 'panel', preset: 'all', basis: 'igdb_pc', taxonomy: 'igdb_theme', categories: JSON.stringify([...labels].reverse()), categoryMatch: 'all' }, asOf);
  assert.equal(result.preset, 'all'); assert.equal(result.basis, 'igdb_pc'); assert.equal(result.categoryMatch, 'all'); assert.deepEqual(JSON.parse(result.categories), labels);
  assert.deepEqual(parseResearchCategories('[" Exact source label ","A"]'), [' Exact source label ', 'A']);
  for (const categories of ['{', '{}', '["A","A"]', '[null]', '[3]', '[""]', '[" "]']) assert.throws(() => releaseResearchSelection({ categories }, asOf));
  for (const params of [{ taxonomy: 'made_up' }, { categoryMatch: 'some' }]) assert.throws(() => releaseResearchSelection(params, asOf));
  const html = render('ResearchCategoryPicker', { available: labels.map(name => ({ name, populationCount: 3 })), selected: labels, onToggle() {} });
  assert.equal((html.match(/type="checkbox"/g) || []).length, 20);
  assert.equal((html.match(/checked=""/g) || []).length, 20);
  for (const label of labels) assert.ok(html.includes(label));
});

test('category controls remain recoverable without successful API data and clear only selected categories', () => {
  const calls = [];
  clearResearchCategories((...args) => calls.push(args));
  changeResearchFilter((...args) => calls.push(args), 'taxonomy', 'steam_tag');
  assert.deepEqual(calls, [['categories', ''], ['categories', ''], ['taxonomy', 'steam_tag']]);
  for (const categories of ['["Missing saved source label"]', 'malformed']) {
    const html = render('ReleaseResearch', { params: { categories }, setFilter() {}, now: Date.parse(asOf) });
    assert.match(html, /<button[^>]*>Clear categories<\/button>/);
    assert.doesNotMatch(html, /<button[^>]*disabled[^>]*>Clear categories/);
    assert.match(html, /value="igdb_genre" selected=""/);
    assert.match(html, /ANY selected label/); assert.match(html, /ALL selected labels/);
    for (const label of ['Saved research panel', 'Broad saved inventory', 'All release dates', 'IGDB-reported PC release (separate source)', 'Saved Steam tags', 'Legacy editorial genres']) assert.ok(html.includes(label), label);
  }
});

test('review filters keep release windows independent, enforce cutoff and never reuse incompatible snapshots', () => {
  const result = releaseResearchSelection({ preset: 'custom', startDate: '2026-09-01', endDate: '2026-09-30', metric: 'reviewsCustom', reviewStartDate: '2026-10-01', reviewEndDate: '2026-10-07', reviewAsOf: '2026-10-10T00:00:00Z' }, asOf);
  assert.equal(result.startDate, '2026-09-01'); assert.equal(result.reviewStartDate, '2026-10-01'); assert.equal(result.reviewAsOf, '2026-10-10T00:00:00.000Z');
  const calls = [];
  for (const key of ['reviewAsOf', 'reviewStartDate', 'reviewEndDate']) changeResearchFilter((...args) => calls.push(args), key, 'test-value');
  assert.equal(calls.filter(([key, value]) => key === 'snapshot' && value === '').length, 3);
  assert.equal(calls.some(([key]) => ['preset', 'startDate', 'endDate', 'basis'].includes(key)), false);
  for (const params of [{ reviewAsOf: '2026-10-12T00:00:00Z' }, { reviewAsOf: '2026-10-10' }, { metric: 'reviewsCustom' }, { metric: 'reviewsCustom', reviewStartDate: '2026-10-04', reviewEndDate: '2026-10-03' }, { metric: 'reviewsCustom', reviewStartDate: '2026-10-01', reviewEndDate: '2026-10-11' }]) assert.throws(() => releaseResearchSelection(params, asOf));
  const html = render('ReleaseResearch', { params: result, setFilter() {}, now: Date.parse(asOf) });
  for (const text of ['Exact 7 elapsed days', 'Exact 30 elapsed days', 'Custom review dates', 'Rolling review as-of (UTC)', 'Saved review anchor', 'Review start date, included', 'Review end date, included', 'unavailable intervals remain unavailable', 'Cumulative review totals are never substituted']) assert.ok(html.includes(text), text);
});

test('extended report displays frozen membership, separate source metadata and sortable category/game lists', () => {
  const fixture = extended(); assert.doesNotThrow(() => assertReleaseResearch(fixture));
  const html = render('ReleaseResearchView', { report: fixture });
  for (const text of ['Test-only saved panel', '24 / 300 SAVED', '276 slots unfilled', 'Sort categories', 'Sort games', 'Included games only', 'Raw category &amp; PC metadata', 'IGDB-reported PC release records', 'Source record ID', 'test-raw-v1', 'worldwide', 'Source date format', 'YYYYMMDD', 'Source year / month', 'Multi-label categories overlap', '20 included games']) assert.ok(html.includes(text), text);
  const missing = { ...fixture.audit[0], genre: 'Editorial-only label', categories: [], categoryEvidence: [] };
  assert.deepEqual(researchRowCategories(missing, 'igdb_genre'), []);
  assert.deepEqual(researchRowCategories({ ...missing, categories: undefined }, 'steam_tag'), []);
  assert.deepEqual(researchRowCategories({ ...missing, categories: undefined }, 'editorial'), ['Editorial-only label']);
  fixture.audit[0] = missing;
  const missingHtml = render('ReleaseResearchView', { report: fixture });
  const summary = missingHtml.slice(missingHtml.indexOf('research-audit-row')).split('</summary>')[0];
  assert.match(summary, /No saved IGDB genres labels/); assert.doesNotMatch(summary, /Editorial-only label/);
  assert.match(missingHtml, /Missing source labels are never replaced with editorial genres/);
  fixture.selection.basis = 'igdb_pc';
  const pc = render('ReleaseResearchView', { report: fixture });
  assert.match(pc, /SOURCE-REPORTED GAME TYPE/); assert.match(pc, /Reported PC date for selected basis/);
  assert.match(pc, /does not establish first Steam playability or Steam 1.0/);
  assert.doesNotMatch(pc, /Only verified, released, day-precision Steam dates qualify/);
});

test('sorting is stable, immutable, includes observed zero and keeps unavailable values last both ways', () => {
  const fixture = populated(); const before = structuredClone(fixture);
  const ascending = sortResearchCategories(fixture.genres, 'median', 'asc');
  const descending = sortResearchCategories(fixture.genres, 'median', 'desc');
  assert.equal(ascending[0].median, 0); assert.equal(ascending.at(-1).median, null); assert.equal(descending.at(-1).median, null);
  assert.equal(descending[0].genre, 'Test-only simulation');
  assert.equal(sortResearchGames(fixture.audit, 'value', 'asc')[0].observation.value, 0);
  assert.equal(sortResearchGames(fixture.audit, 'value', 'desc')[0].observation.value, 1000);
  for (const direction of ['asc', 'desc']) assert.equal(sortResearchGames(fixture.audit, 'value', direction).at(-1).observation.value, null);
  const rows = [{ ...fixture.audit[0], eligible: false }, ...fixture.audit.slice(1)];
  assert.equal(sortResearchGames(rows, 'name', 'asc', true).length, 23);
  assert.equal(sortResearchGames(rows, 'name', 'asc', true).some(row => !row.eligible), false);
  assert.deepEqual(fixture, before);
});

test('new nested source/category/panel/review metadata is strictly validated', () => {
  for (const mutate of [
    value => value.selection.categories = [], value => value.selection.categoryMatch = 'some',
    value => value.taxonomy.source = 'editorial', value => value.taxonomy.match = 'all', value => value.taxonomy.coveredCount = 23,
    value => value.taxonomy.available.push(value.taxonomy.available[0]), value => value.taxonomy.available[0].cohortCount = 99,
    value => value.taxonomy.selected = ['Unknown label'], value => value.audit[0].categories = ['A', 'A'],
    value => value.audit[0].categoryEvidence[0].sourceId = '42', value => value.audit[0].categoryEvidence[0].collectedAt = 'invalid',
    value => value.audit[0].pcReleaseEvidence[0].sourceId = null, value => value.audit[0].pcReleaseEvidence[0].dateFormat.id = '0', value => value.audit[0].pcReleaseEvidence[0].month = 13, value => value.audit[0].pcReleaseEvidence[0].sourceUrl = {},
    value => value.panel.shortfallCount = 275, value => value.panel.groups[0].selected = 25,
    value => value.reviewActivity.savedAnchors = ['not UTC'], value => value.reviewActivity.savedAnchors = ['2026-10-12T00:00:00.000Z'], value => value.reviewActivity.window = value.releaseWindow,
    value => value.observations.selected.windowStart = '2026-10-01T00:00:00Z',
  ]) { const fixture = extended(); mutate(fixture); assert.throws(() => assertReleaseResearch(fixture), /unsupported or inconsistent/); }
  const custom = extended(); custom.selection.metric = 'reviewsCustom'; custom.selection.reviewStartDate = '2026-10-01'; custom.selection.reviewEndDate = '2026-10-07';
  custom.reviewActivity.window = { ...resolveReleaseWindow({ preset: 'custom', asOf, startDate: custom.selection.reviewStartDate, endDate: custom.selection.reviewEndDate }), kind: 'review_activity' };
  Object.assign(custom.observations.selected, { metric: 'reviewsCustom', windowStart: custom.reviewActivity.window.startInclusive, windowEndExclusive: custom.reviewActivity.window.endExclusive });
  assert.doesNotThrow(() => assertReleaseResearch(custom));
  const selected = extended(); selected.selection.categories = '["Test-only puzzle"]'; selected.taxonomy.selected = ['Test-only puzzle'];
  const query = buildReleaseResearchQuery(selected.selection, asOf); assert.doesNotThrow(() => assertResearchSelection(selected, query));
  selected.selection.categoryMatch = 'all'; assert.throws(() => assertResearchSelection(selected, query), /does not match/);
});

test('actual saved API responses pass the UI contract for raw taxonomy, PC basis and independent fixed/custom review intervals', async () => {
  const { openDatabase, migrate } = await import('../scripts/database.mjs');
  const { readReleaseResearch, parseResearchSelection } = await import('../backend/release-research.ts');
  const db = openDatabase(':memory:'); migrate(db);
  try {
    db.raw.exec(`
      INSERT INTO genres VALUES('Fixture editorial',0,'test-only');
      INSERT INTO cohorts VALUES('original_30','Fixture cohort',0,0,'{}');
      INSERT INTO games(appid,source_id,name,steam_name,genre,cohort_id,store_url,collected_at,position) VALUES(1,'1','Fixture source game','Fixture source game','Fixture editorial','original_30','https://store.steampowered.com/app/1/','2026-10-09T12:00:00Z',1);
      INSERT INTO research_application_evidence VALUES('type-1',1,'game',1,'https://store.steampowered.com/app/1/','2026-10-09T12:00:00Z','Fixture only');
      INSERT INTO research_release_evidence VALUES('release-1',1,'first_playable','2026-10-01','day',1,'released',NULL,'https://store.steampowered.com/app/1/','2026-10-09T12:00:00Z','Fixture only');
      INSERT INTO catalog_games(appid,igdb_id,match_status,source,source_url,collected_at,identity_json,detail_json) VALUES(1,1,'matched','IGDB','https://www.igdb.com/games/fixture','2026-10-09T12:00:00Z','{}','{"gameType":{"id":0}}');
      INSERT INTO catalog_labels VALUES(1,'genres',0,1,'Fixture source genre','{}');
      INSERT INTO catalog_releases(appid,position,source_id,release_at,platform_id,date_format_json) VALUES(1,0,1,'2026-10-01T00:00:00.000Z',6,'{"id":0,"format":"YYYYMMDD"}');
      INSERT INTO research_review_contracts VALUES('fixture-contract','fixture-method','fixture-sha','2026-10-10T12:00:00Z','passed','{}','{}');
      INSERT INTO research_activity_observations VALUES('fixture-reviews',1,'fixture-run','reviews7d','2026-10-03T00:00:00.000Z','2026-10-10T00:00:00.000Z',0,'2026-10-10T12:00:00Z','https://store.steampowered.com/appreviews/1','fixture exact interval','surviving_matching_review_count','fixture-contract');
    `);
    for (const extra of [
      { basis: 'first_playable', metric: 'players' },
      { basis: 'igdb_pc', metric: 'reviews7d', reviewAsOf: '2026-10-10T00:00:00.000Z' },
      { basis: 'igdb_pc', metric: 'reviewsCustom', reviewAsOf: '2026-10-10T00:00:00.000Z', reviewStartDate: '2026-10-03', reviewEndDate: '2026-10-09' },
      { population: 'panel', metric: 'reviews30d', reviewAsOf: '2026-10-10T00:00:00.000Z' },
    ]) {
      const query = buildReleaseResearchQuery({ preset: 'all', taxonomy: 'igdb_genre', ...extra }, asOf);
      const value = await readReleaseResearch(db, parseResearchSelection(new URLSearchParams(query)));
      assert.doesNotThrow(() => assertReleaseResearch(value));
      assert.doesNotThrow(() => assertResearchSelection(value, query));
      const loaded = await fetchReleaseResearch(query, new AbortController().signal, async () => Response.json(value));
      assert.match(render('ReleaseResearchView', { report: loaded }), /Per-app evidence audit/);
      if (extra.metric === 'reviews7d' || extra.metric === 'reviewsCustom') {
        assert.equal(loaded.audit[0].observation.value, 0);
        assert.equal(loaded.reviewActivity.status, 'available');
        assert.match(render('ReleaseResearchView', { report: loaded }), /Saved interval, exact/);
      }
    }
  } finally { db.close(); }
});

test('panel temporal provenance preserves distinct cohort and evidence cutoffs and explains multi-batch qualification', () => {
  const fixture = extended();
  fixture.selection.asOf = '2026-10-12T17:00:00.000Z';
  fixture.releaseWindow = resolveReleaseWindow(fixture.selection);
  Object.assign(fixture.panel, {
    cohortCutoff: '2026-10-11T18:49:27.594Z',
    evidenceAsOf: '2026-10-12T16:02:24.274Z',
    qualificationTemporalScope: 'multi_batch_observations_not_instantaneous_snapshot',
  });
  assert.doesNotThrow(() => assertReleaseResearch(fixture));
  const html = render('ReleaseResearchView', { report: fixture });
  for (const text of ['Release / cohort cutoff', 'Evidence cutoff', '2026-10-11T18:49:27.594Z', '2026-10-12T16:02:24.274Z', 'Qualification observations span multiple collection batches; original times are retained.']) assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /multi_batch_observations_not_instantaneous_snapshot/);
  assert.doesNotThrow(() => assertReleaseResearch(extended()));
  const unknown = structuredClone(fixture);
  Object.assign(unknown.panel, { cohortCutoff: null, evidenceAsOf: null, qualificationTemporalScope: null });
  assert.doesNotThrow(() => assertReleaseResearch(unknown));
  assert.match(render('ReleaseResearchView', { report: unknown }), /Qualification temporal scope: Not recorded/);
  for (const mutate of [
    panel => panel.cohortCutoff = '2026-10-11T18:49:27',
    panel => panel.evidenceAsOf = '2026-02-30T00:00:00Z',
    panel => panel.cohortCutoff = 123,
    panel => panel.evidenceAsOf = {},
    panel => panel.qualificationTemporalScope = [],
    panel => panel.cohortCutoff = '2026-10-12T16:02:24.275Z',
    panel => panel.evidenceAsOf = '2026-10-12T17:00:00.001Z',
    panel => { panel.evidenceAsOf = null; panel.cohortCutoff = '2026-10-12T17:00:00.001Z'; },
  ]) {
    const invalid = structuredClone(fixture); mutate(invalid.panel);
    assert.throws(() => assertReleaseResearch(invalid), /unsupported or inconsistent/);
  }
  const equal = structuredClone(fixture);
  equal.panel.cohortCutoff = equal.panel.evidenceAsOf = equal.selection.asOf;
  assert.doesNotThrow(() => assertReleaseResearch(equal));
});
