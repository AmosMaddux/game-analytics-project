import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase,migrate} from '../scripts/database.mjs';
import {parseResearchSelection,readReleaseResearch} from '../backend/release-research.ts';
import {candidatesFromDatabase} from '../scripts/prepare-panel.mjs';
const asOf='2026-10-11T12:00:00.000Z',at='2026-10-10T00:00:00.000Z';
function setup(){const db=openDatabase(':memory:');migrate(db);db.raw.exec("INSERT INTO genres VALUES('Editorial only',0,'fixture');INSERT INTO cohorts VALUES('original_30','Fixture',0,0,'{}')");return db;}
function game(db,id,{labels=['A','B'],release='2026-10-01',strict=true,value=0}={}){
 db.raw.prepare("INSERT INTO games(appid,source_id,name,steam_name,genre,cohort_id,store_url,collected_at,position) VALUES(?,?,?,?,?,'original_30',?,?,?)").run(id,String(id),`Game ${id}`,`Game ${id}`,'Editorial only',`https://store.steampowered.com/app/${id}/`,at,id);
 db.raw.prepare("INSERT INTO catalog_games(appid,igdb_id,match_status,source,source_url,name,collected_at,identity_json,detail_json) VALUES(?,?,'matched','IGDB',?,?,?,'{}',?)").run(id,id,`https://www.igdb.com/games/game-${id}`,`Game ${id}`,at,JSON.stringify({gameType:{id:0,type:'Main Game'}}));
 labels.forEach((label,i)=>db.raw.prepare("INSERT INTO catalog_labels(appid,collection,position,source_id,name) VALUES(?,'genres',?,?,?)").run(id,i,i+1,label));
 db.raw.prepare('INSERT INTO catalog_releases(appid,position,source_id,release_at,platform_id,date_format_json,status_json) VALUES(?,0,?,?,6,?,?)').run(id,id,release+'T00:00:00.000Z',JSON.stringify({id:0,format:'YYYYMMDD'}),JSON.stringify({id:6,name:'Full Release'}));
 if(strict){db.raw.prepare('INSERT INTO research_application_evidence VALUES(?,?,?,?,?,?,?)').run(`type-${id}`,id,'game',1,`https://store.steampowered.com/app/${id}/`,at,'Fixture');db.raw.prepare('INSERT INTO research_release_evidence VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(`release-${id}`,id,'first_playable',release,'day',1,'released',null,`https://store.steampowered.com/app/${id}/`,at,'Fixture');}
 db.raw.prepare("INSERT INTO metric_observations(observation_id,appid,metric,value,evidence_status,freshness,collected_at,source_scope,unit,method_version,run_id,original_keys_json) VALUES(?,?,'players',?,'observed','fresh',?,'Fixture concurrent scope','concurrent_players','fixture-v1','same-snapshot','[]')").run(`metric-${id}`,id,value,at);
}
const select=(extra={})=>parseResearchSelection(new URLSearchParams({asOf,preset:'1m',taxonomy:'igdb_genre',...extra}));
async function using(fn){const db=setup();try{await fn(db);}finally{db.close();}}
function version(db,{time=at,identityTime=at,id='version',label='A'}={}){
 const raw={appid:1,igdbId:1,name:'IGDB name',sourceUrl:'https://www.igdb.com/games/game-1',fetchedAt:time,firstReleaseDate:null,gameType:{id:0,type:'Main Game'},genres:[{id:1,name:label}],themes:[],releaseDates:[{id:1,date:'2026-10-01T00:00:00.000Z',platform:{id:6},dateFormat:{id:0,format:'YYYYMMDD'},status:null,fetchedAt:time}],identity:{status:'verified',steamFetchedAt:identityTime,steamName:'Steam verified name',typeBasis:'derived_game_only_query'}};
 db.raw.prepare('INSERT INTO research_catalog_imports VALUES(?,?,?,?,?,?,?,?,?)').run(id,id.padEnd(64,'0'),identityTime,identityTime,'complete',1,0,1,'{}');db.raw.prepare('INSERT INTO research_catalog_records VALUES(?,?,?,?,?)').run(id,1,1,time,JSON.stringify(raw));
}

test('selected raw categories never inherit editorial labels when saved source labels are empty',async()=>using(async db=>{
 game(db,1,{labels:[]});const report=await readReleaseResearch(db,select());
 assert.deepEqual(report.audit[0].categories,[]);assert.deepEqual(report.genres,[]);assert.equal(report.taxonomy.coveredCount,0);assert.deepEqual(report.cohort.unclassifiedAppIds,['1']);
 await assert.rejects(()=>readReleaseResearch(db,select({categories:JSON.stringify(['Editorial only'])})),/unavailable/);
}));

test('multi-label any/all filtering precedes statistics and respects release-cohort exclusion',async()=>using(async db=>{
 game(db,1,{value:0});game(db,2,{labels:['B'],value:10});game(db,3,{labels:['A'],release:'2020-01-01',value:1000});
 const report=await readReleaseResearch(db,select({categories:JSON.stringify(['A'])}));
 assert.equal(report.cohort.eligibleCount,1);assert.equal(report.genres.find(x=>x.genre==='A').mean,0);assert.equal(report.genres.find(x=>x.genre==='B').mean,0);assert.equal(report.genres.find(x=>x.genre==='B').observedCount,1);
 const all=await readReleaseResearch(db,select({categories:JSON.stringify(['A','B']),categoryMatch:'all'}));assert.equal(all.cohort.eligibleCount,1);
 const any=await readReleaseResearch(db,select({categories:JSON.stringify(['A','B']),categoryMatch:'any'}));assert.equal(any.cohort.eligibleCount,2);assert.equal(any.genres.find(x=>x.genre==='B').mean,5);
}));

test('PC opt-in remains a separate provenance and never supplies strict Steam dates or verified Steam type',async()=>using(async db=>{
 game(db,1,{strict:false});
 const pc=await readReleaseResearch(db,select({basis:'igdb_pc'})),strict=await readReleaseResearch(db,select());
 assert.equal(pc.cohort.eligibleCount,1);assert.equal(pc.audit[0].appType,'igdb_reported_main_game');assert.equal(pc.releasePolicyVersion,'igdb-pc-earliest-unambiguous-v2');
 assert.equal(strict.cohort.eligibleCount,0);assert.equal(strict.audit[0].appType,'unknown');assert.deepEqual(strict.audit[0].evidence,[]);
}));

test('broad first-ever identity is invisible before its own timestamp despite older IGDB retrieval',async()=>using(async db=>{
 game(db,1,{strict:false});version(db,{identityTime:'2026-10-12T15:27:05.020Z'});
 assert.equal((await readReleaseResearch(db,select({population:'broad',basis:'igdb_pc'}))).population.selectedCount,0);
 const after=await readReleaseResearch(db,select({population:'broad',basis:'igdb_pc',asOf:'2026-10-12T15:27:05.020Z'}));assert.equal(after.population.selectedCount,1);assert.equal(after.audit[0].name,'Steam verified name');
}));

test('a future identity recheck never removes previously known broad membership',async()=>using(async db=>{
 game(db,1,{strict:false});version(db,{time:'2026-10-09T00:00:00.000Z',id:'old'});version(db,{time:'2026-10-11T00:00:00.000Z',identityTime:'2026-10-12T00:00:00.000Z',id:'future-recheck',label:'New visible IGDB label'});
 const report=await readReleaseResearch(db,select({population:'broad',basis:'igdb_pc'}));assert.equal(report.population.selectedCount,1);assert.deepEqual(report.audit[0].categories,['New visible IGDB label']);
}));

function panel(db){db.raw.prepare('INSERT INTO research_panels VALUES(?,?,?,?,?,?,?)').run('frozen','Fixture frozen','policy-fixture',asOf,'2026-10-11T12:00:00Z','0'.repeat(64),JSON.stringify({groups:[]}));db.raw.prepare('INSERT INTO research_panel_memberships VALUES(?,?,?,?,?)').run('frozen',1,'recent_releases','Fixture','{}');}
function activity(db){db.raw.prepare('INSERT INTO research_review_contracts VALUES(?,?,?,?,?,?,?)').run('contract','fixture-source-v1','0'.repeat(64),at,'passed','{}','{}');for(const [metric,start,value] of [['reviews7d','2026-10-04T12:00:00.000Z',0],['reviews30d','2026-09-11T12:00:00.000Z',5]])db.raw.prepare('INSERT INTO research_activity_observations VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(metric,1,'activity-run',metric,start,asOf,value,asOf,'https://api.steampowered.com/IUserReviewsService/GetAppReviews/v1/','Fixture Steam review scope','surviving_matching_review_count','contract');}

test('equivalent precise panel times are visible and frozen membership stays identical for7d/30d windows',async()=>using(async db=>{
 game(db,1);game(db,2);panel(db);activity(db);
 const seven=await readReleaseResearch(db,select({population:'panel',metric:'reviews7d'})),thirty=await readReleaseResearch(db,select({population:'panel',metric:'reviews30d'}));
 assert.equal(seven.panel.id,'frozen');assert.equal(seven.population.selectedCount,1);assert.deepEqual(seven.audit.map(x=>x.appid),thirty.audit.map(x=>x.appid));assert.equal(seven.audit[0].observation.value,0);assert.equal(thirty.audit[0].observation.value,5);
}));

test('unsupported custom review interval remains unavailable without using lifetime or neighboring saved windows',async()=>using(async db=>{
 game(db,1);panel(db);activity(db);
 const report=await readReleaseResearch(db,select({population:'panel',metric:'reviewsCustom',reviewStartDate:'2026-10-01',reviewEndDate:'2026-10-02'}));
 assert.equal(report.reviewActivity.status,'unavailable');assert.equal(report.observations.selected,null);assert.equal(report.audit[0].observation.value,null);assert.equal(report.genres.find(x=>x.genre==='A').mean,null);
}));

test('database panel adapter retains conflicting strict chronology instead of selecting one convenient date',async()=>using(async db=>{
 game(db,1);db.raw.prepare('INSERT INTO research_release_evidence VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('earlier-full',1,'full_release','2026-09-01','day',1,'released',null,'https://store.steampowered.com/app/1/',at,'Fixture conflicting chronology');
 const candidate=candidatesFromDatabase(db.raw,{asOf,releaseBasis:'first_playable'}).find(x=>x.appid===1);assert.equal(candidate.releaseDate,null);assert.equal((await readReleaseResearch(db,select())).cohort.eligibleCount,0);
}));

test('database panel adapter ignores future catalog labels and unsafe type evidence',async()=>using(async db=>{
 game(db,1);db.raw.prepare('UPDATE catalog_games SET collected_at=?').run('2026-10-12T00:00:00.000Z');db.raw.prepare('UPDATE research_application_evidence SET source_url=?').run('javascript:alert(1)');
 const candidate=candidatesFromDatabase(db.raw,{asOf,releaseBasis:'first_playable'}).find(x=>x.appid===1);assert.deepEqual(candidate.genres,[]);assert.equal(candidate.appType,'unknown');
}));

test('database candidate adapter remains compatible with an immutable pre-versioned-catalog database',async()=>using(async db=>{
 game(db,1);db.raw.exec('DROP TABLE research_catalog_records; DROP TABLE research_catalog_imports;');
 const candidate=candidatesFromDatabase(db.raw,{asOf,releaseBasis:'igdb_pc'}).find(x=>x.appid===1);assert.equal(candidate.releaseDate,'2026-10-01');assert.deepEqual(candidate.genres,['A','B']);
}));

test('database full-release adapter uses the full-release basis independently from first playable',async()=>using(async db=>{
 game(db,1);db.raw.prepare('INSERT INTO research_release_evidence VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('later-full',1,'full_release','2026-10-02','day',1,'released',null,'https://store.steampowered.com/app/1/',at,'Fixture1.0 evidence');
 const first=candidatesFromDatabase(db.raw,{asOf,releaseBasis:'first_playable'}).find(x=>x.appid===1),full=candidatesFromDatabase(db.raw,{asOf,releaseBasis:'full_release'}).find(x=>x.appid===1);assert.equal(first.releaseDate,'2026-10-01');assert.equal(full.releaseDate,'2026-10-02');assert.equal((await readReleaseResearch(db,select({basis:'full_release'}))).audit[0].releaseDate,full.releaseDate);
}));
