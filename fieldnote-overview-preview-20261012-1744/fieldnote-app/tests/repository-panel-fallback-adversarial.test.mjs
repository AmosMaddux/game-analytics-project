import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase,migrate} from '../scripts/database.mjs';
import {readGames,readSnapshot} from '../backend/repository.ts';
import {rankGenres,metricFreshness} from '../src/model.ts';
const at='2026-10-12T17:00:00.000Z',time=Date.parse(at),method='steam-dated-counts-1.0',source='https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/';
function setup(){const db=openDatabase(':memory:');migrate(db);db.raw.exec("INSERT INTO genres VALUES('Action',0,'fixture'),('Unresolved / needs review',1,'fixture'); INSERT INTO cohorts VALUES('original_30','Fixture',0,0,'{}');INSERT INTO snapshot_metadata VALUES('builtAt','\"2026-10-12T17:00:00.000Z\"')");return db;}
function add(db,id,{value=10,status='observed',sourceStatus=null,sourceFreshness=null,version=method,genre='Action',kind='players',detail={scoreEligible:true},originalKeys=['value','observedAt','sourceUrl','status','freshness','scoreEligible']}={}){
 db.raw.prepare("INSERT OR IGNORE INTO games(appid,source_id,name,steam_name,genre,cohort_id,store_url,collected_at,position) VALUES(?,?,?,?,?,'original_30',?,?,?)").run(id,String(id),`Fixture ${id}`,`Fixture ${id}`,genre,`https://store.steampowered.com/app/${id}/`,at,id);
 db.raw.prepare('INSERT INTO metric_observations(observation_id,appid,metric,value,evidence_status,freshness,collected_at,source_url,source_scope,unit,method_version,run_id,original_keys_json,detail_json,source_status,source_freshness) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(`${id}-${kind}`,id,kind,value,status,value===null?'unknown':'fresh',at,source,'Fixture scope',kind==='players'?'concurrent_players':'reviews',version,'fixture-import',JSON.stringify(originalKeys),JSON.stringify(detail),sourceStatus,sourceFreshness);
}
async function using(fn){const db=setup();try{await fn(db);}finally{db.close();}}
function operational(db){db.raw.prepare("INSERT INTO collection_jobs(job_id,source,kind,status,started_at,limits_json) VALUES('fixture-job','steam_api','metrics','completed',?,'{}')").run(at);}

test('reviewed method restores normalized observed zero and null unavailable without changing any raw row',async()=>using(async db=>{
 add(db,1,{value:0});add(db,2,{value:null,status:'unavailable',detail:{scoreEligible:false,missingReason:'source_http_404'}});add(db,3,{value:10});
 const before=JSON.stringify(db.raw.prepare('SELECT * FROM metric_observations ORDER BY observation_id').all()),games=await readGames(db,{now:time});
 assert.equal(games[0].players.status,'observed');assert.equal(games[0].players.value,0);assert.equal(games[1].players.status,'unavailable');assert.equal(games[1].players.value,null);assert.equal(games[1].players.freshness,'unknown');assert.equal(games[1].players.missingReason,'source_http_404');
 const ranked=rankGenres(games,['Action'])[0];assert.equal(ranked.observedCount,2);assert.equal(ranked.average,5);assert.equal(ranked.gameCount,3);
 assert.equal(JSON.stringify(db.raw.prepare('SELECT * FROM metric_observations ORDER BY observation_id').all()),before);
}));

test('legacy, unrecognized and near-match methods keep their original null status fields',async()=>using(async db=>{
 for(const [i,version] of ['legacy-method','steam-dated-counts-1.1','steam-dated-counts-1.0-extra',''].entries())add(db,i+1,{version});
 const games=await readGames(db,{now:time});assert.ok(games.every(x=>x.players.status===null&&x.players.freshness===null));assert.equal(rankGenres(games,['Action'])[0].observedCount,0);
}));

test('explicit historical source fields are never overridden by normalized fallback',async()=>using(async db=>{
 add(db,1,{sourceStatus:'estimated',sourceFreshness:'stale_cache'});add(db,2,{sourceStatus:'unknown',sourceFreshness:'unknown'});
 const games=await readGames(db,{now:time});assert.equal(games[0].players.status,'estimated');assert.equal(games[0].players.freshness,'stale_cache');assert.equal(games[1].players.status,'unknown');assert.equal(games[1].players.freshness,'unknown');assert.equal(rankGenres(games,['Action'])[0].observedCount,0);
}));

test('dynamic24h and future-time eligibility gates survive fallback with or without evidence payload',async()=>using(async db=>{
 add(db,1);operational(db);
 for(const includeEvidence of [true,false]){
  const fresh=(await readGames(db,{now:time+86400000-1,includeEvidence}))[0].players;assert.equal(metricFreshness(fresh,time+86400000-1).status,'fresh');assert.equal(fresh.scoreEligible,true);
  for(const now of [time+86400000,time-1]){const games=await readGames(db,{now,includeEvidence}),metric=games[0].players;assert.equal(metric.scoreEligible,false);assert.equal(metric.scoreEligibilityReason,'outside_operational_freshness_window');assert.equal(metricFreshness(metric,now).status,now<time?'unknown':'stale');assert.equal(rankGenres(games,['Action'])[0].observedCount,0);}
 }
}));

test('unresolved editorial categories remain unscored and reviews cannot become player values',async()=>using(async db=>{
 add(db,1,{genre:'Unresolved / needs review',value:1000});add(db,2,{kind:'reviews',value:100000});
 const games=await readGames(db,{now:time});assert.equal(games[0].players.scoreEligible,false);assert.equal(games[0].players.scoreEligibilityReason,'unresolved_genre_mapping');assert.equal(games[1].reviews.status,'observed');assert.equal(games[1].players,undefined);assert.equal(rankGenres(games,['Action','Unresolved / needs review']).length,1);assert.equal(rankGenres(games,['Action'])[0].observedCount,0);
}));

test('panel summary counts saved distinct source labels and resolved editorial members without admitting future panels',async()=>using(async db=>{
 add(db,1);add(db,2,{genre:'Unresolved / needs review'});
 for(const id of [1,2]){db.raw.prepare("INSERT INTO catalog_games(appid,igdb_id,match_status,source,collected_at,identity_json) VALUES(?,?,'matched','IGDB',?,'{}')").run(id,id,at);for(const [position,name]of ['Adventure','Puzzle'].entries())db.raw.prepare("INSERT INTO catalog_labels(appid,collection,position,source_id,name) VALUES(?,'genres',?,?,?)").run(id,position,position+1,name);}
 db.raw.prepare('INSERT INTO research_panels VALUES(?,?,?,?,?,?,?)').run('fixture-panel','Fixture','fixture-v1',at,at,'0'.repeat(64),'{}');for(const id of [1,2])db.raw.prepare('INSERT INTO research_panel_memberships VALUES(?,?,?,?,?)').run('fixture-panel',id,'fixture','Fixture','{}');
 const before=await readSnapshot(db,{now:time-1});assert.equal(before.meta.researchPanelSummary,undefined);
 const current=await readSnapshot(db,{now:time});assert.deepEqual(current.meta.researchPanelSummary,{selectedCount:2,igdbGenreCount:2,legacyEditorialCount:1,asOf:at});assert.equal(current.games.find(x=>x.appid===2).genre,'Unresolved / needs review');
}));
