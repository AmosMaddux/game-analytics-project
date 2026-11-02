import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { rankGenres } from '../src/model.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const directory = await mkdtemp(resolve(tmpdir(), 'fieldnote-render-'));
const bundle = resolve(directory, 'render.cjs');
await build({ absWorkingDir: root, stdin: { contents: `import {createElement} from 'react'; import {renderToStaticMarkup} from 'react-dom/server'; import {Overview, Browse, GenreSummary} from './src/Browse'; import {GameDetail, MarketingPage} from './src/GameDetail'; import {Methods} from './src/Methods'; import {MetricCard, ExternalLink} from './src/ui'; import {AppContent, parseRoute, assertSnapshot} from './src/App'; const components={Overview,Browse,GenreSummary,GameDetail,MarketingPage,Methods,MetricCard,ExternalLink,AppContent}; export const render=(page,props)=>renderToStaticMarkup(createElement(components[page],props)); export {parseRoute,assertSnapshot};`, resolveDir: root, loader: 'tsx' }, bundle: true, platform: 'node', format: 'cjs', outfile: bundle, logLevel: 'silent' });
const { render, parseRoute, assertSnapshot } = createRequire(import.meta.url)(bundle);
await rm(directory, { recursive: true, force: true });
const data = JSON.parse(await readFile(new URL('../seed/snapshot.json', import.meta.url), 'utf8'));
const ranks = rankGenres(data.games, data.genres);
const props = { data, ranks, params: {}, setFilter() {}, resetFilters() {}, now: Date.parse('2026-10-10T20:00:00Z') };

test('real React overview renders five saved scores with mean/median and denominator', () => {
  const html = render('Overview', props);
  assert.equal((html.match(/class="ranking-card rank-/g) || []).length, 5);
  for (const score of ['100.0', '92.7', '83.5', '77.0', '75.6']) assert.match(html, new RegExp(score.replace('.', '\\.')));
  assert.match(html, /Popularity Score/); assert.match(html, /Average/); assert.match(html, /Median/); assert.match(html, /observed game/);
  assert.match(html, /Calculated/); assert.match(html, /Not live or market-wide/);
});
test('React genre summaries retain global metrics while only game lists filter', () => {
  const direct = render('GenreSummary', { ...props, genre: 'Farming / life simulation' });
  const filtered = render('GenreSummary', { ...props, genre: 'Farming / life simulation', params: { query: 'stardew', tag: 'Fishing', cohort: 'recent_6' } });
  const values = html => [...html.matchAll(/data-metric="([^"]+)">([^<]*)/g)].map(match => [match[1], match[2]]);
  assert.deepEqual(values(filtered), values(direct));
  assert.match(direct, /75\.6/); assert.match(direct, /Thin coverage/); assert.match(direct, /Agriculture/); assert.match(direct, /6 \/ 6/);
  const search = render('Browse', { ...props, params: { query: 'stardew' } });
  assert.match(search, /Stardew Valley/); assert.doesNotMatch(search, />RimWorld</);
});
test('React full game detail retains source provenance, IDs, scoped releases and marketing', () => {
  const html = render('GameDetail', { ...props, id: '413150' });
  for (const text of ['Stardew Valley', '413150', '17000', '60,388', '898,414', 'Marketing evidence', 'Source measurement time', 'not supplied by source', 'IGDB', 'Source update']) assert.ok(html.includes(text), text);
  assert.match(html, /target="_blank" rel="noopener noreferrer"/);
  assert.match(html, /Different scope|different scope|different_scope/i);
});
test('unknown game and empty searches render recoverable views', () => {
  assert.match(render('GameDetail', { ...props, id: '999999999' }), /not found|not in|unavailable/i);
  assert.match(render('Browse', { ...props, params: { query: 'no-such-fixture-title' } }), /No games|No matches/i);
});
test('marketing keeps six deep profiles and 13 non-exhaustive evidence records', () => {
  const html = render('MarketingPage', { data, category: '', setCategory() {} });
  assert.equal((html.match(/class="evidence-card"/g) || []).length, 6);
  assert.match(html, /13/); assert.match(html, /not a complete campaign history/); assert.match(html, /not assumed to be paid/);
});
test('methods shows observed/calculated/estimated/stale/unknown and saved-date provenance', () => {
  const html = render('Methods', props);
  for (const text of ['Observed', 'Calculated', 'Estimated', 'Stale', 'Unknown']) assert.ok(html.toLowerCase().includes(text.toLowerCase()), text);
  assert.match(html, /0\.30/); assert.match(html, /0\.70/); assert.match(html, /17:55:23/); assert.match(html, /18:03:31/);
  assert.match(html, /href="\/api\/snapshot"/); assert.match(html, /href="\/docs\/roadmap.docx"/);
});
test('React escapes source names and rejects dangerous source link protocols', () => {
  const malicious = structuredClone(data); malicious.games[0].name = '<script>alert(1)</script>'; malicious.games[0].players.sourceUrl = 'javascript:alert(1)';
  const html = render('GameDetail', { ...props, data: malicious, id: '413150' });
  assert.match(html, /&lt;script&gt;/); assert.doesNotMatch(html, /<script|href="javascript:/);
  assert.equal(render('ExternalLink', { url: 'data:text/html,<script>', children: 'unsafe' }), '');
});
test('evidence cards distinguish estimated value, observed zero, stale and missing', () => {
  const base = { label: 'Test-only fixture', unit: 'players', now: Date.parse('2026-10-12T00:00:00Z') };
  const zero = render('MetricCard', { ...base, metric: { value: 0, status: 'observed', observedAt: '2026-10-10T00:00:00Z' } });
  assert.match(zero, /<strong>0<\/strong>/); assert.match(zero, /Stale/); assert.match(zero, /observed/);
  const estimated = render('MetricCard', { ...base, metric: { value: 5, status: 'estimated' } });
  assert.match(estimated, /estimated/); assert.doesNotMatch(estimated, /<span class="pill green">observed/);
  assert.match(render('MetricCard', { ...base, metric: { value: null, status: 'unknown' } }), /Not captured/);
  assert.match(render('MetricCard', { ...base, metric: { value: null, status: 'unavailable' } }), /unavailable/);
});
test('React route content covers honest chat, settings failures and unknown routes', () => {
  const common = { ...props, settings: null };
  const chat = render('AppContent', { ...common, location: parseRoute('#/chat') });
  assert.match(chat, /OpenAI not connected/); assert.match(chat, /<textarea[^>]*disabled/); assert.match(chat, /Milestone 8/);
  const settings = render('AppContent', { ...common, settingsError: 'Test-only unreachable database', location: parseRoute('#/settings') });
  assert.match(settings, /Settings unavailable/); assert.match(settings, /Try again/);
  assert.match(render('AppContent', { ...common, location: parseRoute('#/unknown-route') }), /NOT FOUND/);
});
test('hash routes preserve encoded genre slashes, filters and legacy links', () => {
  assert.deepEqual(parseRoute('#/genre/Farming%20%2F%20life%20simulation?tag=Fishing'), { path: ['genre', 'Farming / life simulation'], params: { tag: 'Fishing' } });
  assert.equal(parseRoute('#/games').path[0], 'search'); assert.equal(parseRoute('#/coverage').path[0], 'methods');
  assert.equal(parseRoute('#/genre/%ZZ').path[0], 'not-found');
});
test('frontend bootstrap rejects malformed or duplicate Steam identities before rendering', () => {
  assert.doesNotThrow(() => assertSnapshot(data));
  const duplicate = structuredClone(data); duplicate.games.push(duplicate.games[0]);
  assert.throws(() => assertSnapshot(duplicate), /duplicate Steam identity/);
  assert.throws(() => assertSnapshot({ games: [] }), /Invalid saved snapshot/);
});
