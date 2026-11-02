import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase,migrate} from '../scripts/database.mjs';
import {latestResearchCatalog} from '../backend/research-catalog.ts';
import {readCategoryEvidence,readPcEvidence,resolvePcDate} from '../backend/research-categories.ts';
const asOf='2026-10-11T12:00:00.000Z';
function setup(){
 const db=openDatabase(':memory:');migrate(db);
 db.raw.exec("INSERT INTO genres VALUES('Legacy label',0,'fixture'); INSERT INTO cohorts VALUES('original_30','Fixture',1,0,'{}'); INSERT INTO games(appid,source_id,name,steam_name,genre,cohort_id,store_url,collected_at,position) VALUES(1,'1','Original name','Original name','Legacy label','original_30','https://store.steampowered.com/app/1/','2026-10-01T00:00:00Z',0)");
 db.raw.prepare("INSERT INTO catalog_games(appid,igdb_id,match_status,source,source_url,name,collected_at,identity_json) VALUES(1,1,'matched','IGDB','https://www.igdb.com/games/original','Original name',?,'{}')").run('2026-10-10T00:00:00.000Z');
 db.raw.exec("INSERT INTO catalog_labels(appid,collection,position,source_id,name) VALUES(1,'genres',0,1,'Baseline genre'),(1,'themes',0,2,'Baseline theme'); INSERT INTO steam_tags(appid,position,tag,source_url,collected_at) VALUES(1,0,'Steam-only tag','https://store.steampowered.com/app/1/','2026-10-10T00:00:00Z')");
 db.raw.prepare("INSERT INTO catalog_releases(appid,position,source_id,release_at,platform_id,date_format_json,status_json,detail_json) VALUES(1,0,1,'2020-01-01T00:00:00.000Z',6,?,?,?)").run(JSON.stringify({id:0,format:'YYYYMMDD'}),JSON.stringify({id:6,name:'Full Release'}),'{}');return db;
}
function snapshot(time,name='Overlay genre',id='version-a'){
 return {appid:1,igdbId:1,name:'Versioned name',sourceUrl:'https://www.igdb.com/games/original',fetchedAt:time,sourceUpdatedAt:null,firstReleaseDate:null,gameType:{id:0,type:'Main Game'},genres:[{id:3,name}],themes:[{id:4,name:'Overlay theme'}],keywords:[],gameModes:[],playerPerspectives:[],releaseDates:[{id:3,date:'2021-01-01T00:00:00.000Z',platform:{id:6},dateFormat:{id:0,format:'YYYYMMDD'},status:{id:6,name:'Full Release'},fetchedAt:time}],identity:{steamFetchedAt:time,steamName:'Original name',status:'verified',typeBasis:'derived_game_only_query'},id};
}
function append(db,row){
 db.raw.prepare('INSERT INTO research_catalog_imports VALUES(?,?,?,?,?,?,?,?,?)').run(row.id,row.id.padEnd(64,'0'),row.fetchedAt,row.fetchedAt,'complete',1,0,1,'{}');
 db.raw.prepare('INSERT INTO research_catalog_records VALUES(?,?,?,?,?)').run(row.id,1,1,row.fetchedAt,JSON.stringify(row));
}
async function using(fn){const db=setup();try{await fn(db);}finally{db.close();}}

test('newer visible baseline beats older overlay across raw labels and PC dates',async()=>using(async db=>{
 append(db,snapshot('2026-10-09T00:00:00.000Z'));
 assert.deepEqual((await readCategoryEvidence(db,'igdb_genre',asOf)).map(x=>x.name),['Baseline genre']);
 assert.equal(resolvePcDate(await readPcEvidence(db,asOf),asOf).date,'2020-01-01');
}));

test('future baseline cannot suppress a historical overlay; future overlay stays invisible',async()=>using(async db=>{
 db.raw.prepare('UPDATE catalog_games SET collected_at=? WHERE appid=1').run('2026-10-12T00:00:00.000Z');
 append(db,snapshot('2026-10-09T00:00:00.000Z','Visible old overlay','old'));
 append(db,snapshot('2026-10-12T00:00:00.000Z','Future overlay','future'));
 assert.deepEqual((await readCategoryEvidence(db,'igdb_genre',asOf)).map(x=>x.name),['Visible old overlay']);
 assert.equal(resolvePcDate(await readPcEvidence(db,asOf),asOf).date,'2021-01-01');
 assert.equal((await latestResearchCatalog(db,asOf)).get(1).name,'Versioned name');
}));

test('latest retrieval time, not insertion order or textual ISO formatting, controls overlay selection',async()=>using(async db=>{
 append(db,snapshot('2026-10-11T10:00:00.001Z','Newer','a'));
 append(db,snapshot('2026-10-11T10:00:00Z','Older inserted later','z'));
 assert.deepEqual((await readCategoryEvidence(db,'igdb_genre',asOf)).map(x=>x.name),['Newer']);
 assert.deepEqual((await readCategoryEvidence(db,'igdb_genre','2026-10-11T10:00:00.000Z')).map(x=>x.name),['Older inserted later']);
}));

test('raw IGDB labels have no 12-label cap and empty sources never fall back to other taxonomies',async()=>using(async db=>{
 const row=snapshot('2026-10-11T00:00:00.000Z');row.genres=Array.from({length:22},(_,i)=>({id:i+10,name:`Genre ${i+1}`}));append(db,row);
 assert.equal((await readCategoryEvidence(db,'igdb_genre',asOf)).length,22);
 assert.deepEqual((await readCategoryEvidence(db,'igdb_theme',asOf)).map(x=>x.name),['Overlay theme']);
 assert.deepEqual((await readCategoryEvidence(db,'steam_tag',asOf)).map(x=>x.name),['Steam-only tag']);
 const empty=snapshot('2026-10-11T01:00:00.000Z','unused','empty');empty.genres=[];append(db,empty);
 assert.deepEqual(await readCategoryEvidence(db,'igdb_genre',asOf),[]);
}));

test('PC evidence preserves actual coarse format and year/month rather than manufacturing an exact date',async()=>using(async db=>{
 const row=snapshot('2026-10-11T00:00:00.000Z');row.releaseDates.push({id:4,date:'2021-12-31T00:00:00.000Z',year:2021,month:12,platform:{id:6},dateFormat:{id:2,format:'YYYY'},status:null,fetchedAt:row.fetchedAt});append(db,row);
 const evidence=await readPcEvidence(db,asOf);assert.equal(evidence.length,2);assert.equal(evidence[1].dateFormat.id,2);assert.equal(evidence[1].year,2021);assert.equal(resolvePcDate(evidence,asOf).date,null);
}));
