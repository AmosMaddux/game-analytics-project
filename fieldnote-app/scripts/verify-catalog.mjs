import { appRoot,openDatabase,migrate } from './database.mjs';
import { resolve } from 'node:path';
import { dataDirectory,saveCheckpoint } from '../collectors/io.mjs';
export function verifyCatalog(db) {
  const scalar=sql=>db.raw.prepare(sql).get().n;
  const total=scalar('SELECT COUNT(*) AS n FROM games');
  const unresolved=scalar("SELECT COUNT(*) AS n FROM games WHERE genre='Unresolved / needs review'");
  const verified=scalar("SELECT COUNT(*) AS n FROM catalog_games c WHERE c.match_status='matched' AND json_extract(c.identity_json,'$.status')='exact_steam_appid_verified' AND EXISTS (SELECT 1 FROM identity_crosswalks x WHERE x.appid=c.appid AND x.igdb_id=c.igdb_id AND x.steam_uid=CAST(c.appid AS TEXT) AND x.external_source_id=1 AND x.source_name='Steam')");
  const genres=db.raw.prepare("SELECT ge.name,COUNT(g.appid) AS games FROM genres ge LEFT JOIN games g ON ge.name=g.genre WHERE ge.name<>'Unresolved / needs review' GROUP BY ge.name ORDER BY ge.position").all().map(row=>({...row,under15:row.games<15}));
  const metrics=db.raw.prepare(`SELECT metric,COUNT(*) AS observations,COUNT(DISTINCT appid) AS games,MIN(collected_at) AS firstCollectedAt,MAX(collected_at) AS lastCollectedAt FROM metric_observations WHERE evidence_status IN ('observed','reported') AND value IS NOT NULL GROUP BY metric`).all();
  const players=db.raw.prepare("SELECT value FROM (SELECT value,evidence_status,ROW_NUMBER() OVER(PARTITION BY appid ORDER BY julianday(collected_at) DESC,observation_id DESC) AS n FROM metric_observations WHERE metric='players') WHERE n=1 AND evidence_status='observed' AND value IS NOT NULL").all().map(row=>row.value);
  return {verifiedAt:new Date().toISOString(),totalGames:total,verifiedGames:verified,uniqueSteamIds:scalar('SELECT COUNT(DISTINCT appid) AS n FROM games'),uniqueIgdbIds:scalar('SELECT COUNT(DISTINCT igdb_id) AS n FROM catalog_games'),populatedGenres:genres.filter(row=>row.games>0).length,genreCount:genres.length,genres,
    unresolvedGenreGames:unresolved,classifiedGames:total-unresolved,catalogSizeGate:total-unresolved>=300&&total<=500&&verified===total,genreGate:genres.filter(row=>row.games>0).length>=10&&genres.filter(row=>row.games>0).length<=15,metrics,
    traction:{observedGames:players.length,zero:players.filter(value=>value===0).length,oneToTen:players.filter(value=>value>0&&value<=10).length,elevenTo999:players.filter(value=>value>10&&value<1000).length,atLeast1000:players.filter(value=>value>=1000).length,note:'Editorial descriptive CCU bands; sample-only, not sales or market completeness.'},
    officialGameLinks:scalar("SELECT COUNT(DISTINCT appid) AS n FROM catalog_links WHERE collection='officialWebsites'"),taggedGames:scalar('SELECT COUNT(DISTINCT appid) AS n FROM steam_tags'),newTagCollectionEnabled:false,
    enabledSchedules:scalar('SELECT COUNT(*) AS n FROM collection_schedules WHERE enabled=1'),foreignKeyViolations:db.raw.prepare('PRAGMA foreign_key_check').all().length,
    duplicateObservationKeys:scalar('SELECT COUNT(*) AS n FROM (SELECT appid,metric,run_id,COUNT(*) AS amount FROM metric_observations GROUP BY appid,metric,run_id HAVING amount>1)'),
    latestJobs:db.raw.prepare('SELECT job_id,source,kind,status,started_at,finished_at,error_code FROM collection_jobs ORDER BY started_at DESC LIMIT 10').all(),
    limitations:['Only completed live source runs establish current coverage.','Under-15 groups remain thin.','No sufficient multi-day trend history, sales/revenue, marketing spend or studio headcount is implied.','Steam tags are preserved saved evidence only; newly admitted games have missing tags.']};
}
if(process.argv[1]&&resolve(process.argv[1])===resolve(appRoot,'scripts/verify-catalog.mjs')){
  const db=openDatabase(process.env.FIELDNOTE_DB);try{migrate(db);const result=verifyCatalog(db);await saveCheckpoint(await dataDirectory(appRoot),'m3-verification.json',result);console.log(JSON.stringify(result,null,2));}finally{db.close();}
}
