import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('..', import.meta.url));
const directory = await mkdtemp(resolve(tmpdir(), 'fieldnote-overview-panel-'));
const bundle = resolve(directory, 'render.cjs');
await build({ absWorkingDir: root, stdin: { contents: `import {createElement} from 'react'; import {renderToStaticMarkup} from 'react-dom/server'; import {Overview,readOverviewPanelSummary} from './src/Browse'; export {readOverviewPanelSummary}; export const render=(props)=>renderToStaticMarkup(createElement(Overview,props));`, resolveDir: root, loader: 'tsx' }, bundle: true, platform: 'node', format: 'cjs', outfile: bundle, logLevel: 'silent' });
const { render, readOverviewPanelSummary } = createRequire(import.meta.url)(bundle);
await rm(directory, { recursive: true, force: true });
const summary = { selectedCount: 294, igdbGenreCount: 21, legacyEditorialCount: 28, asOf: '2026-10-12T17:30:00.000Z' };
const rank = { genre: 'Fixture editorial', popularityScore: 25, signal: 10, average: 12, median: 8, total: 36, observedCount: 3, gameCount: 3, observedStart: '2026-10-12T17:00:00.000Z', observedEnd: '2026-10-12T17:01:00.000Z' };
const fixture = panel => ({ data: { meta: panel === undefined ? {} : { researchPanelSummary: panel }, genres: ['Fixture editorial'], games: [] }, ranks: [rank], params: {}, setFilter() {} });

test('Overview links the whole saved panel through raw IGDB genres and makes the legacy editorial denominator explicit', () => {
  const props = fixture(summary); const before = structuredClone({ data: props.data, ranks: props.ranks });
  const html = render(props);
  for (const text of ['294-game research panel', '21 raw IGDB genres', 'overlapping source labels', 'IGDB-reported PC release evidence', 'Legacy editorial coverage: 28 of 294 panel games.', 'remaining 266 have unresolved editorial genres', 'excluded from legacy genre rankings', 'does not represent the full panel', 'LEGACY EDITORIAL LEADERBOARD']) assert.ok(html.includes(text), text);
  const href = html.match(/href="([^"]+)"[^>]*>Explore 21 raw IGDB genres/)[1].replaceAll('&amp;', '&');
  assert.ok(href.startsWith('#/releases?'));
  assert.deepEqual(Object.fromEntries(new URLSearchParams(href.split('?')[1])), { population: 'panel', preset: 'all', basis: 'igdb_pc', taxonomy: 'igdb_genre', metric: 'players', asOf: summary.asOf });
  assert.match(html, /Legacy Popularity Score 25\.0 out of 100, 3 observed games/);
  assert.deepEqual({ data: props.data, ranks: props.ranks }, before);
});

test('Overview counts are supplied by saved panel metadata rather than hardcoded or inferred from all tracked inventory', () => {
  const changed = { selectedCount: 123, igdbGenreCount: 17, legacyEditorialCount: 10, asOf: summary.asOf };
  const html = render(fixture(changed));
  assert.match(html, /123-game research panel/); assert.match(html, /Explore 17 raw IGDB genres/);
  assert.match(html, /Legacy editorial coverage: 10 of 123 panel games/); assert.match(html, /remaining 113/);
  assert.doesNotMatch(html, /294|21 raw IGDB|28 of/);
});

test('legacy snapshots without a panel summary remain usable without inventing panel counts or classifications', () => {
  const html = render(fixture(undefined));
  assert.match(html, /Top 5 genres/); assert.match(html, /Legacy Popularity Score/);
  assert.doesNotMatch(html, /research panel|raw IGDB genres|Legacy editorial coverage|294|266/);
  const missingLabels = render(fixture({ ...summary, igdbGenreCount: 0, legacyEditorialCount: 0 }));
  assert.match(missingLabels, /0 raw IGDB genres/); assert.match(missingLabels, /Legacy editorial coverage: 0 of 294/);
});

test('invalid panel summaries fail closed without promoting unverified source counts', () => {
  assert.deepEqual(readOverviewPanelSummary(summary), summary);
  for (const invalid of [null, [], 'panel', {}, { ...summary, selectedCount: -1 }, { ...summary, selectedCount: 0 }, { ...summary, igdbGenreCount: 1.5 }, { ...summary, legacyEditorialCount: 295 }, { ...summary, selectedCount: '294' }, { ...summary, igdbGenreCount: Infinity }, { ...summary, asOf: '2026-10-12T17:30:00' }, { ...summary, asOf: '2026-02-30T00:00:00Z' }]) {
    assert.equal(readOverviewPanelSummary(invalid), null);
    assert.doesNotMatch(render(fixture(invalid)), /research panel|raw IGDB genres|Legacy editorial coverage/);
  }
});
