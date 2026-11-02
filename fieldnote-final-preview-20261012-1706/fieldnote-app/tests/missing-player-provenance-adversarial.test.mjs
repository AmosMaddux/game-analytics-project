import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {openDatabase,migrate} from '../scripts/database.mjs';
import {readReleaseResearch,parseResearchSelection} from '../backend/release-research.ts';

const root=fileURLToPath(new URL('..',import.meta.url)),dir=await mkdtemp(resolve(tmpdir(),'reviewer-missing-provenance-')),bundle=resolve(dir,'render.cjs');
await build({absWorkingDir:root,stdin:{contents:`import{createElement}from'react';import{renderToStaticMarkup}from'react-dom/server';import{ReleaseResearchView}from'./src/ReleaseResearch';export{assertReleaseResearch}from'./src/ReleaseResearch';export const render=report=>renderToStaticMarkup(createElement(ReleaseResearchView,{report}));`,resolveDir:root,loader:'tsx'},bundle:true,platform:'node',format:'cjs',outfile:bundle,logLevel:'silent'});
const ui=createRequire(import.meta.url)(bundle);await rm(dir,{recursive:true,force:true});
const source='https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/',at='2026-10-12T16:44:51.297Z',older='2026-10-11T10:00:00.000Z',asOf='2026-10-12T17:00:00.000Z';
function metric(db,id,value,{status=value===null?'unavailable':'observed',time=at,run='same-current-run',kind='players',reason=value===null?'source_http_404':null,suffix='',detail}={}){
 db.raw.prepare('INSERT INTO metric_observations(observation_id,appid,metric,value,evidence_status,freshness,collected_at,source_url,source_scope,unit,method_version,run_id,original_keys_json,detail_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(`obs-${id}-${kind}-${run}${suffix}`,id,kind,value,status,value===null?'unknown':'fresh',time,source,'Fixture matching scope',kind==='players'?'concurrent_players':'reviews','fixture-v1',run,'[]',detail??JSON.stringify({missingReason:reason}));
}
function setup(){
 const db=openDatabase(':memory:');migrate(db);db.raw.exec("INSERT INTO genres VALUES('Action',0,'fixture');INSERT INTO cohorts VALUES('original_30','Fixture',4,0,'{}')");
 for(const id of [917640,2,3,4]){
  db.raw.prepare("INSERT INTO games(appid,source_id,name,steam_name,genre,cohort_id,store_url,collected_at,position) VALUES(?,?,?,?, 'Action','original_30',?,?,?)").run(id,String(id),`Fixture ${id}`,`Fixture ${id}`,`https://store.steampowered.com/app/${id}/`,older,id);
  db.raw.prepare('INSERT INTO research_application_evidence VALUES(?,?,?,?,?,?,?)').run(`type-${id}`,id,'game',1,`https://store.steampowered.com/app/${id}/`,older,'Fixture');
  db.raw.prepare('INSERT INTO research_release_evidence VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(`release-${id}`,id,'first_playable','2026-10-01','day',1,'released',null,`https://store.steampowered.com/app/${id}/`,older,'Fixture');
 }
 metric(db,917640,null);metric(db,2,0);metric(db,3,10);metric(db,4,99,{run:'older-run',time:older});return db;
}
const selection=extra=>parseResearchSelection(new URLSearchParams({asOf,preset:'all',metric:'players',...extra}));
async function using(fn){const db=setup();try{await fn(db);}finally{db.close();}}

test('a single explicit unavailable player404 retains exact reason, source and response time',async()=>using(async db=>{
 const raw=JSON.stringify(db.raw.prepare('SELECT * FROM metric_observations ORDER BY observation_id').all());
 const report=await readReleaseResearch(db,selection()),row=report.audit.find(x=>x.appid===917640);ui.assertReleaseResearch(report);
 assert.deepEqual(row.observation,{value:null,missingReason:'source_http_404',collectedAt:at,measuredAt:null,sourceUrl:source});assert.equal(row.eligible,true);
 const html=ui.render(report);assert.ok(html.includes('Current players unavailable (HTTP 404 · source_http_404)'));assert.ok(html.includes(`Saved observation time: <time dateTime="${at}">${at}</time>`));assert.ok(html.includes(`href="${source}" target="_blank" rel="noopener noreferrer">Observation source`));
 assert.equal(JSON.stringify(db.raw.prepare('SELECT * FROM metric_observations ORDER BY observation_id').all()),raw);
}));

test('observed zero, explicit null404 and missing-in-selected-set remain three distinct states',async()=>using(async db=>{
 const report=await readReleaseResearch(db,selection()),get=id=>report.audit.find(x=>x.appid===id).observation;
 assert.equal(get(2).value,0);assert.equal(get(2).missingReason,null);assert.equal(get(2).collectedAt,at);
 assert.equal(get(917640).value,null);assert.equal(get(917640).missingReason,'source_http_404');
 assert.deepEqual(get(4),{value:null,missingReason:'missing_in_selected_observation_set',collectedAt:null,measuredAt:null,sourceUrl:null});
 const html=ui.render(report);assert.match(html,/research-observed">0<\/strong>/);assert.ok(html.includes('missing in selected observation set'));
 assert.equal((html.match(/Saved observation time:/g)||[]).length,1);
}));

test('unavailability remains excluded from numeric statistics but included in missing coverage',async()=>using(async db=>{
 const report=await readReleaseResearch(db,selection()),genre=report.genres.find(x=>x.genre==='Action');
 assert.equal(genre.eligibleCount,4);assert.equal(genre.observedCount,2);assert.equal(genre.missingCount,2);assert.equal(genre.coveragePercent,50);assert.equal(genre.mean,5);assert.equal(genre.median,5);
 assert.deepEqual(genre.values.map(x=>x.value).sort((a,b)=>a-b),[0,10]);assert.deepEqual(genre.missingReasonCounts,{source_http_404:1,missing_in_selected_observation_set:1});
}));

test('future404 evidence stays hidden before its actual source time and becomes visible exactly at cutoff',async()=>using(async db=>{
 const before=await readReleaseResearch(db,selection({asOf:'2026-10-12T16:44:51.296Z'})),row=before.audit.find(x=>x.appid===917640);
 assert.deepEqual(row.observation,{value:null,missingReason:'missing_in_selected_observation_set',collectedAt:null,measuredAt:null,sourceUrl:null});assert.ok(!ui.render(before).includes('source_http_404'));
 const exact=await readReleaseResearch(db,selection({asOf:at}));assert.equal(exact.audit.find(x=>x.appid===917640).observation.collectedAt,at);
}));

test('a newer unavailable player snapshot never borrows the older observed value or provenance',async()=>using(async db=>{
 metric(db,917640,777,{run:'older-run',time:older});const current=await readReleaseResearch(db,selection());assert.equal(current.audit.find(x=>x.appid===917640).observation.value,null);
 const oldSet=current.observations.available.find(x=>x.runId==='older-run');assert.ok(oldSet);const explicit=await readReleaseResearch(db,selection({snapshot:oldSet.id}));const row=explicit.audit.find(x=>x.appid===917640);
 assert.equal(row.observation.value,777);assert.equal(row.observation.collectedAt,older);assert.equal(row.observation.missingReason,null);assert.ok(!ui.render(explicit).includes('source_http_404'));
}));

test('404 detail cannot label review metrics, estimated statuses or malformed metadata as player404',async()=>using(async db=>{
 for(const [kind,status,detail]of [['reviews','unavailable',JSON.stringify({missingReason:'source_http_404'})],['players','estimated',JSON.stringify({missingReason:'source_http_404'})],['players','unavailable','["source_http_404"]']]){
  db.raw.exec('DELETE FROM metric_observations');metric(db,917640,null,{kind,status,detail});const report=await readReleaseResearch(db,selection({metric:kind}));assert.equal(report.audit.find(x=>x.appid===917640).observation.missingReason,'unsupported_evidence_status');assert.ok(!ui.render(report).includes('Current players unavailable (HTTP 404'));
 }
}));

test('multiple unavailable candidates never invent a single definitive provenance timestamp',async()=>using(async db=>{
 metric(db,917640,null,{suffix:'-duplicate',time:'2026-10-12T16:44:52.297Z'});const report=await readReleaseResearch(db,selection()),row=report.audit.find(x=>x.appid===917640);
 assert.equal(row.observation.value,null);assert.equal(row.observation.collectedAt,null);assert.equal(row.observation.sourceUrl,null);assert.equal(report.genres.find(x=>x.genre==='Action').observedCount,2);
}));
