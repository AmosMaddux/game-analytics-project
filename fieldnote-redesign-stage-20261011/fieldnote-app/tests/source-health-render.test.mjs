import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { openDatabase, migrate } from '../scripts/database.mjs';
import { buildSeedStatements } from '../backend/seed.ts';
import { readSources } from '../backend/source-health.ts';
import { readSettings } from '../backend/settings.ts';
import { rankGenres } from '../src/model.ts';

const root = fileURLToPath(new URL('..',import.meta.url));
const directory = await mkdtemp(resolve(tmpdir(),'fieldnote-source-health-render-'));
const bundle = resolve(directory,'render.cjs');
await build({absWorkingDir:root,stdin:{contents:`import {createElement} from 'react'; import {renderToStaticMarkup} from 'react-dom/server'; import {SourceHealth,SourceHealthView,assertSources} from './src/SourceHealth'; import {Shell,AppContent,parseRoute} from './src/App'; import {Methods} from './src/Methods'; import {GameDetail} from './src/GameDetail'; import {SettingsPage} from './src/Settings'; const components={SourceHealth,SourceHealthView,Shell,AppContent,Methods,GameDetail,SettingsPage}; export const render=(page,props)=>renderToStaticMarkup(createElement(components[page],props)); export {parseRoute,assertSources};`,resolveDir:root,loader:'tsx'},bundle:true,platform:'node',format:'cjs',outfile:bundle,logLevel:'silent'});
const {render,parseRoute,assertSources} = createRequire(import.meta.url)(bundle);
await rm(directory,{recursive:true,force:true});
const data = JSON.parse(await readFile(new URL('../seed/snapshot.json',import.meta.url),'utf8'));
const db = openDatabase(':memory:'); migrate(db);
await db.batch(buildSeedStatements(data).map(row => db.prepare(row.sql).bind(...row.values)));
const report = await readSources(db,Date.parse('2026-10-10T20:00:00Z'));
const settings = await readSettings(db);
db.close();

test('source health renders truthful coverage, cache dates, gates and disabled schedules', () => {
  const html = render('SourceHealthView',{report});
  for (const text of ['Current saved catalog','Verified Steam crosswalks','Genres under 15 games','Freshness unknown','Source time unknown','Original cache dates','bounded','No bounded collection jobs','DISABLED','no web scheduler','17:55:23','19:00:31','Report time is not a source refresh time']) assert.ok(html.includes(text),text);
  assert.equal((html.match(/Under target/g) || []).length,7);
  assert.match(html,/href="https:\/\/api-docs\.igdb\.com\/"/);
  assert.match(html,/href="https:\/\/steamcommunity\.com\/dev\/apiterms"/);
  assert.doesNotMatch(html,/<form|<input|<textarea|Start collection|Enable schedule/);
});

test('source navigation is accessible and routes to an independent read-only loading state', () => {
  const shell = render('Shell',{page:'sources',children:'Test-only content'});
  assert.match(shell,/href="#\/sources"[^>]*aria-current="page"/); assert.match(shell,/Source health/);
  const view = render('AppContent',{data,ranks:rankGenres(data.games,data.genres),location:parseRoute('#/sources'),settings:null,now:Date.now()});
  assert.match(view,/Source health/); assert.match(view,/Reading source health/); assert.match(view,/disabled/);
  assert.doesNotMatch(view,/NOT FOUND/);
});

test('job bounds and counters render without treating saved running status as a heartbeat', () => {
  const fixture = structuredClone(report);
  fixture.jobs = {total:1,limit:20,items:[{jobId:'test-only-job',source:'steam_api',kind:'metrics',status:'running',startedAt:'2026-10-10T19:00:00Z',finishedAt:null,errorCode:'http_429',nextRunAt:null,limits:{maxRequests:10},counters:{requests:2,rejected:1},checkpoint:{targetCount:36,streamIndex:1},hasSavedCursor:true}]};
  fixture.attempts = {total:1,limit:50,items:[{jobId:'test-only-job',source:'steam_api',appid:413150,metric:'players',status:'failed',attemptedAt:'2026-10-10T19:01:00Z',errorCode:'http_429'}]};
  const html = render('SourceHealthView',{report:fixture});
  for (const text of ['not a process heartbeat','maxRequests: 10','requests: 2','targetCount: 36','Resume cursor saved','http 429']) assert.ok(html.includes(text),text);
  assert.match(html,/href="#\/game\/413150"/);
});

test('empty collection state and escaped source text remain recoverable', () => {
  const fixture = structuredClone(report); fixture.sources = []; fixture.schedules = {total:0,limit:100,items:[]};
  assert.match(render('SourceHealthView',{report:fixture}),/No source-health records/);
  assert.match(render('SourceHealthView',{report:fixture}),/No schedules are configured/);
  const malicious = structuredClone(report); malicious.sources[0].details.label = '<script>alert(1)</script>'; malicious.sources[0].details.officialLinks = [{label:'bad',url:'javascript:alert(1)'}];
  const html = render('SourceHealthView',{report:malicious});
  assert.match(html,/&lt;script&gt;/); assert.doesNotMatch(html,/<script|href="javascript:/);
});

test('source-health response validation rejects missing and wrong-mode data', () => {
  assert.doesNotThrow(() => assertSources(report));
  for (const value of [null,{}, {...report,mode:'live'}, {...report,collectionControlsAvailable:true}, {...report,asOf:'bad date'}, {...report,jobs:{}}]) assert.throws(() => assertSources(value),/Unsupported source-health/);
});


test('expanded catalog views use current rows while preserving historical run counts and dates', () => {
  const expanded = structuredClone(data);
  const admitted = structuredClone(data.games[0]);
  Object.assign(admitted,{id:'90000001',appid:90000001,name:'Test-only admitted game',cohort:'m3_catalog',tags:[],players:{value:null,status:'unknown'},reviews:{value:null,status:'unknown'},storeReviews:{value:null,status:'unknown'},marketing:{status:'unknown',events:[],caveats:[],deepProof:false,exhaustive:false}});
  admitted.catalog.fetchedAt = '2026-10-11T12:00:00Z';
  expanded.games.push(admitted);
  expanded.meta.cohorts.push({id:'m3_catalog',label:'Bounded catalog additions',count:1});
  const html = render('Methods',{data:expanded,ranks:rankGenres(expanded.games,expanded.genres)});
  assert.match(html,/current 37-game tracked catalog/); assert.match(html,/37 \/ 37 games enriched/);
  assert.match(html,/36 \/ 37/); assert.match(html,/Original imported current-metric run/);
  assert.match(html,/17:55:23/); assert.match(html,/12:00:00/);
  assert.match(html,/Newly admitted games remain untagged/);
  assert.doesNotMatch(html,/Milestone 2 application foundation|No live source requests/);
  const detail = render('GameDetail',{data:expanded,id:admitted.id,now:Date.parse('2026-10-11T12:01:00Z')});
  assert.match(detail,/Bounded catalog additions/); assert.doesNotMatch(detail,/Original pilot cohort/);
  assert.match(detail,/Steam tags not captured/); assert.match(detail,/unknown · reviews/);
  assert.doesNotMatch(detail,/Observed · reviews/);
});

test('settings separates read-only web access from bounded local collectors', () => {
  const html = render('SettingsPage',{settings,loading:false,error:null,retry() {},async save() {}});
  assert.match(html,/Web-app provider access/); assert.match(html,/Bounded local metric commands are separate/);
  assert.match(html,/No web refresh/); assert.match(html,/href="#\/sources"/);
  assert.doesNotMatch(html,/No live integrations|Live collectors and automated tag collection are not enabled|collection, private production access and deployment require their own implementation/);
});

test('source health visibly separates unresolved mappings from agreed genre coverage', () => {
  const fixture = structuredClone(report);
  fixture.catalog.totalGames = 38; fixture.catalog.unresolvedGames = 2;
  fixture.catalog.taxonomyVersions = ['editorial-expanded-1.1'];
  const html = render('SourceHealthView',{report:fixture});
  assert.match(html,/Unresolved genre mappings/);
  assert.match(html,/2 \/ 38 · excluded from genre rankings/);
  assert.match(html,/editorial-expanded-1.1/);
  assert.match(html,/provisional inferences/);
  assert.match(html,/all-game search and details/);
  assert.match(html,/not evidence of a trend/);
  assert.equal((html.match(/Under target/g) || []).length,7);
});
