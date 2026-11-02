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
await build({ absWorkingDir: root, stdin: { contents: `import {createElement} from 'react'; import {renderToStaticMarkup} from 'react-dom/server'; import {ReleaseResearch,ReleaseResearchView} from './src/ReleaseResearch'; export * from './src/ReleaseResearch'; const components={ReleaseResearch,ReleaseResearchView}; export const render=(page,props)=>renderToStaticMarkup(createElement(components[page],props));`, resolveDir: root, loader: 'tsx' }, bundle: true, platform: 'node', format: 'cjs', outfile: bundle, logLevel: 'silent' });
const { render, assertReleaseResearch, assertResearchSelection, buildReleaseResearchQuery, releaseResearchSelection, changeResearchFilter, fetchReleaseResearch, visibleResearchState, isUtcDay, isUtcInstant } = createRequire(import.meta.url)(bundle);
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
