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
const root=fileURLToPath(new URL('..',import.meta.url)),directory=await mkdtemp(resolve(tmpdir(),'independent-category-render-')),bundle=resolve(directory,'render.cjs');
await build({absWorkingDir:root,stdin:{contents:`import{createElement}from'react';import{renderToStaticMarkup}from'react-dom/server';import{ReleaseResearch,ReleaseResearchView,ResearchCategoryPicker}from'./src/ReleaseResearch';export * from'./src/ReleaseResearch';const components={ReleaseResearch,ReleaseResearchView,ResearchCategoryPicker};export const render=(name,props)=>renderToStaticMarkup(createElement(components[name],props));`,resolveDir:root,loader:'tsx'},bundle:true,platform:'node',format:'cjs',outfile:bundle,logLevel:'silent'});
const ui=createRequire(import.meta.url)(bundle);await rm(directory,{recursive:true,force:true});
const asOf='2026-10-11T12:00:00.000Z';
async function report(){const db=openDatabase(':memory:');migrate(db);try{return await readReleaseResearch(db,parseResearchSelection(new URLSearchParams({asOf,taxonomy:'igdb_genre'})));}finally{db.close();}}

test('category reset stays rendered with invalid selected labels and no successful report',()=>{
 const html=ui.render('ReleaseResearch',{params:{asOf,taxonomy:'igdb_genre',categories:'not-json'},setFilter:()=>{},now:Date.parse(asOf)});
 assert.match(html,/Clear categories/);assert.match(html,/Release research unavailable/);
});

test('category picker renders every label and source-empty row never falls back to editorial category',()=>{
 const available=Array.from({length:22},(_,i)=>({name:`Independent category ${i+1}`,populationCount:i}));
 const html=ui.render('ResearchCategoryPicker',{available,selected:[],onToggle:()=>{}});
 for(const row of available)assert.ok(html.includes(row.name));
 assert.equal((html.match(/type="checkbox"/g)||[]).length,22);
 assert.deepEqual(ui.researchRowCategories({genre:'Editorial only',categories:[]},'igdb_genre'),[]);
 assert.deepEqual(ui.researchRowCategories({genre:'Editorial only'},'igdb_genre'),[]);
});

test('query change hides stale successful report and old fetch error; taxonomy change clears selected categories',async()=>{
 const saved=await report();assert.doesNotThrow(()=>ui.assertReleaseResearch(saved));
 assert.deepEqual(ui.visibleResearchState({key:'old',report:saved,error:'Old failure',loading:false},'new'),{key:'new',report:null,error:null,loading:true});
 const updates=[];ui.changeResearchFilter((...x)=>updates.push(x),'taxonomy','steam_tag');assert.deepEqual(updates,[['categories',''],['taxonomy','steam_tag']]);
 await assert.rejects(()=>ui.fetchReleaseResearch('taxonomy=steam_tag',new AbortController().signal,async()=>new Response(JSON.stringify(saved))),/does not match/);
 await assert.rejects(()=>ui.fetchReleaseResearch('',new AbortController().signal,async()=>new Response('',{status:500})),/could not be read/);
});

test('nested review anchors reject invalid types and endpoints later than evidence cutoff',async()=>{
 const saved=await report();
 for(const anchors of [[42],['2026-10-12T00:00:00.000Z']]){
  const changed=structuredClone(saved);changed.reviewActivity.savedAnchors=anchors;assert.throws(()=>ui.assertReleaseResearch(changed));
 }
 const mismatch=structuredClone(saved);mismatch.taxonomy.source='steam_tag';assert.throws(()=>ui.assertReleaseResearch(mismatch));
});
