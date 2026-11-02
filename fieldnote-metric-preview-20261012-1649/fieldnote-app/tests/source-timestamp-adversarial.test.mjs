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

const root=fileURLToPath(new URL('..',import.meta.url)),directory=await mkdtemp(resolve(tmpdir(),'independent-source-time-')),bundle=resolve(directory,'render.cjs');
await build({absWorkingDir:root,stdin:{contents:`import{createElement}from'react';import{renderToStaticMarkup}from'react-dom/server';import{ReleaseResearchView}from'./src/ReleaseResearch';export * from'./src/ReleaseResearch';export const render=report=>renderToStaticMarkup(createElement(ReleaseResearchView,{report}));`,resolveDir:root,loader:'tsx'},bundle:true,platform:'node',format:'cjs',outfile:bundle,logLevel:'silent'});
const ui=createRequire(import.meta.url)(bundle);await rm(directory,{recursive:true,force:true});
const asOf='2026-10-12T16:02:24.274Z',sourceAt='2026-10-09T19:00:17.483092+00:00';
// Public saved source evidence copied from actual approved panel member 2142790.
const actualTags=['Farming Sim','Dating Sim','RPG','Pixel Graphics','Life Sim','Romance','Simulation','Cute','Farming','Relaxing','Agriculture','Anime','2D','Sandbox','Crafting','Open World','LGBTQ+','Building','Cooking','Mining'];
async function report(){
 const db=openDatabase(':memory:');migrate(db);
 try{
  db.raw.exec("INSERT INTO genres VALUES('Farming / life simulation',0,'fixture');INSERT INTO cohorts VALUES('recent_6','Fixture',1,0,'{}')");
  db.raw.prepare("INSERT INTO games(appid,source_id,name,steam_name,genre,cohort_id,store_url,collected_at,position) VALUES(2142790,'2142790','Fields of Mistria','Fields of Mistria','Farming / life simulation','recent_6','https://store.steampowered.com/app/2142790/',?,0)").run(sourceAt);
  actualTags.forEach((tag,position)=>db.raw.prepare('INSERT INTO steam_tags(appid,position,tag,source_url,collected_at) VALUES(2142790,?,?,?,?)').run(position,tag,'https://store.steampowered.com/app/2142790/?l=english',sourceAt));
  return await readReleaseResearch(db,parseResearchSelection(new URLSearchParams({asOf,preset:'all',taxonomy:'steam_tag'})));
 }finally{db.close();}
}

test('actual Steam source microsecond offset survives API validation and static rendering with all20 tags',async()=>{
 const saved=await report(),before=JSON.stringify(saved),row=saved.audit[0];
 assert.equal(row.appid,2142790);assert.equal(row.categories.length,20);assert.deepEqual(new Set(row.categories),new Set(actualTags));
 assert.equal(row.categoryEvidence.length,20);assert.ok(row.categoryEvidence.every(x=>x.collectedAt===sourceAt));
 assert.equal(ui.isUtcInstant(sourceAt),false);assert.doesNotThrow(()=>ui.assertReleaseResearch(saved));
 const html=ui.render(saved);assert.ok(html.includes('Fields of Mistria'));for(const tag of actualTags)assert.ok(html.includes(tag),tag);
 assert.equal(JSON.stringify(saved),before,'Validation/rendering must preserve original source timestamp bytes');
});

test('source grammar accepts only explicit UTC with0–9 fractional digits including Gregorian leap dates',()=>{
 for(const date of ['0001-01-01','1900-02-28','2000-02-29','2024-02-29','9999-12-31'])for(const zone of ['Z','+00:00'])for(let digits=0;digits<=9;digits++){
  const value=`${date}T23:59:59${digits?'.'+'123456789'.slice(0,digits):''}${zone}`;
  assert.equal(ui.isSourceInstant(value),true,value);
 }
});

const invalid=[null,undefined,42,{},'', '0000-01-01T00:00:00Z','1900-02-29T00:00:00Z','2026-02-29T00:00:00Z','2026-02-30T00:00:00Z','2026-04-31T00:00:00Z','2026-00-01T00:00:00Z','2026-13-01T00:00:00Z','2026-01-00T00:00:00Z','2026-01-32T00:00:00Z','2026-10-09T24:00:00Z','2026-10-09T19:60:00Z','2026-10-09T19:00:60Z','2026-10-09T19:00:17.1234567890Z','2026-10-09T19:00:17.Z','2026-10-09T19:00:17+01:00','2026-10-09T19:00:17-00:00','2026-10-09T19:00:17-05:00','2026-10-09T19:00:17+0000','2026-10-09T19:00:17','2026-10-09 19:00:17Z','2026-10-09T19:00:17z','2026-10-09T19:00:17Z\n',' 2026-10-09T19:00:17Z'];
test('source grammar rejects Gregorian rollover, invalid clock values and ambiguous/nonUTC offsets',()=>{
 for(const value of invalid)assert.equal(ui.isSourceInstant(value),false,String(value));
});

test('category and PC evidence accept precise source instants without mutating provenance',async()=>{
 const saved=await report();
 for(const time of [sourceAt,'2026-10-09T19:00:17.123456789Z','2026-10-09T19:00:17+00:00',null]){
  const changed=structuredClone(saved);changed.audit[0].categoryEvidence[0].collectedAt=time;
  changed.audit[0].pcReleaseEvidence=[{sourceId:1,date:'2026-10-01',precision:'day',region:null,status:null,sourceUrl:'https://www.igdb.com/games/fields-of-mistria',collectedAt:time}];
  const before=JSON.stringify(changed);assert.doesNotThrow(()=>ui.assertReleaseResearch(changed));assert.equal(JSON.stringify(changed),before);
 }
});

test('nested source evidence still rejects malformed instants for both category and PC records',async()=>{
 const saved=await report();
 for(const time of invalid.filter(x=>x!==null))for(const key of ['categoryEvidence','pcReleaseEvidence']){
  const changed=structuredClone(saved);
  if(key==='pcReleaseEvidence')changed.audit[0][key]=[{sourceId:1,date:null,precision:'unknown',region:null,status:null,sourceUrl:null,collectedAt:time}];
  else changed.audit[0][key][0].collectedAt=time;
  assert.throws(()=>ui.assertReleaseResearch(changed),/unsupported or inconsistent/,`${key}: ${String(time)}`);
 }
});

test('query timestamps, window anchors and panel cutoffs retain strict canonicalZ grammar',async()=>{
 const saved=await report();
 for(const time of [sourceAt,'2026-10-09T19:00:17.123456789Z','2026-10-09T19:00:17+00:00']){
  assert.equal(ui.isUtcInstant(time),false);
  for(const key of ['asOf','reviewAsOf'])assert.throws(()=>ui.releaseResearchSelection({asOf,[key]:time},asOf));
  for(const path of [['selection','asOf'],['releaseWindow','asOf'],['panel','createdAt'],['panel','cohortCutoff'],['panel','evidenceAsOf']]){
   const changed=structuredClone(saved);changed[path[0]][path[1]]=time;assert.throws(()=>ui.assertReleaseResearch(changed));
  }
  const changed=structuredClone(saved);changed.reviewActivity.savedAnchors=[time];assert.throws(()=>ui.assertReleaseResearch(changed));
 }
});
