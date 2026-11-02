import { randomUUID } from 'node:crypto';
import { admissionStatements, readGames } from '../build/collection.mjs';
import { GENRES, TAXONOMY_VERSION } from './taxonomy.mjs';
import { CollectionError, ENDPOINTS } from './transport.mjs';
import { normalizeAppList, ENDPOINT as LEGACY_CATALOG_ENDPOINT } from './steam-catalog-probe.mjs';

const iso=()=>new Date().toISOString();
const json=value=>JSON.stringify(value);
const title=value=>String(value??'').replace(/[™®]/g,'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
export function beginJob(db,{source,kind,limits,jobId=`${kind}-${randomUUID()}`,resume=false}) {
  const old=db.raw.prepare('SELECT * FROM collection_jobs WHERE job_id=?').get(jobId);
  if(old){if(!resume||old.source!==source||old.kind!==kind||old.status==='complete')throw new CollectionError('invalid_resume');db.raw.prepare("UPDATE collection_jobs SET status='running',finished_at=NULL,error_code=NULL WHERE job_id=?").run(jobId);return {...old,limits:JSON.parse(old.limits_json),counters:JSON.parse(old.counters_json),checkpoint:JSON.parse(old.checkpoint_json)};}
  if(resume)throw new CollectionError('resume_job_missing');
  db.raw.prepare('INSERT INTO collection_jobs(job_id,source,kind,status,started_at,limits_json) VALUES(?,?,?,?,?,?)').run(jobId,source,kind,'running',iso(),json(limits));
  db.raw.prepare('UPDATE source_health SET status=?,last_attempt_at=? WHERE source=?').run('running',iso(),source);
  return {job_id:jobId,limits,counters:{},checkpoint:{}};
}
export function updateJob(db,jobId,{status='running',counters={},checkpoint={},errorCode=null}={}) {
  db.raw.prepare('UPDATE collection_jobs SET status=?,finished_at=?,counters_json=?,checkpoint_json=?,error_code=? WHERE job_id=?').run(status,status==='running'?null:iso(),json(counters),json(checkpoint),errorCode,jobId);
  const {source}=db.raw.prepare('SELECT source FROM collection_jobs WHERE job_id=?').get(jobId);
  db.raw.prepare('UPDATE source_health SET status=?,last_attempt_at=?,last_success_at=CASE WHEN ? THEN ? ELSE last_success_at END,last_error_code=? WHERE source=?').run(status,iso(),status==='complete'?1:0,iso(),errorCode,source);
}
export function saveAttempt(db,jobId,attempt) {
  db.raw.prepare('INSERT INTO collection_attempts(job_id,item_key,source,appid,metric,status,attempted_at,error_code) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(job_id,item_key) DO UPDATE SET status=excluded.status,attempted_at=excluded.attempted_at,error_code=excluded.error_code').run(jobId,attempt.itemKey,'steam_api',attempt.appid,attempt.metric,attempt.status,attempt.attemptedAt,attempt.errorCode);
}
export function saveObservation(db,jobId,value) {
  const detail={error:null,scoreEligible:true,refresh:{runId:jobId,attemptedAt:value.collectedAt,status:'accepted',reason:null},...(value.filters?{filters:value.filters,totalPositive:value.totalPositive,totalNegative:value.totalNegative}:{})};
  const originalKeys=['value','observedAt','sourceTimestamp','sourceUrl','sourceLabel','scope','status','freshness',...Object.keys(detail)];
  db.raw.prepare(`INSERT OR IGNORE INTO metric_observations(observation_id,appid,metric,value,evidence_status,freshness,freshness_as_of,measured_at,collected_at,source_url,source_label,source_scope,unit,method_version,source_status,source_freshness,run_id,original_keys_json,detail_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(`${jobId}:${value.appid}:${value.metric}`,value.appid,value.metric,value.value,'observed','fresh',value.collectedAt,null,value.collectedAt,value.sourceUrl,value.sourceLabel,value.scope,value.unit,value.methodVersion,'observed','accepted_run',jobId,json(originalKeys),json(detail));
}
export function verifySteamEvidence(evidence) {
  if(evidence?.version!=='steam-catalog-evidence-1.0'||evidence.source!=='Steam'||evidence.status!=='complete'||![LEGACY_CATALOG_ENDPOINT,ENDPOINTS.steamCatalog].includes(evidence.sourceUrl)||!Number.isFinite(Date.parse(evidence.collectedAt)))throw new CollectionError('steam_identity_evidence_required');
  return new Map(normalizeAppList({applist:{apps:evidence.apps}}).map(item=>[item.appid,item.name]));
}
function missingMetric(scope) {return {value:null,status:'unknown',observedAt:null,sourceTimestamp:null,sourceUrl:null,scope,freshness:'unknown',scoreEligible:false};}
function makeGame(candidate,steamName,evidence,existing) {
  const catalog=structuredClone(candidate.catalog);
  catalog.status='matched';catalog.identity={...catalog.identity,status:'exact_steam_appid_verified',steamAppid:candidate.appid,steamName,steamUrl:candidate.storeUrl,steamFetchedAt:evidence.collectedAt,steamNameSource:evidence.sourceUrl};
  if(existing?.catalog) {
    const retained=[];
    for(const key of ['summary','platforms','developers','publishers','companies','genres','themes','keywords','websites','officialWebsites','releaseDates','firstReleaseDate']) {
      if(catalog[key]==null||(Array.isArray(catalog[key])&&!catalog[key].length)) {
        catalog[key]=existing.catalog[key];
        if(existing.catalog.provenance?.[key])catalog.provenance[key]=existing.catalog.provenance[key];
        retained.push({field:key,lastObservedAt:existing.catalog.provenance?.[key]?.fetchedAt??existing.catalog.fetchedAt,reason:'omitted_or_empty_in_refresh',status:'prior_cached_evidence_requires_review'});
      }
    }
    if(retained.length){catalog.retainedFields=retained;catalog.lastRefreshAttemptAt=catalog.fetchedAt;catalog.fetchedAt=existing.catalog.fetchedAt;catalog.conflicts.push(...retained.map(item=>({field:item.field,status:'cached_prior_value',reason:'Latest catalog refresh omitted this field or returned an empty collection; prior evidence retained with its original date until correction/deletion review.',priorObservedAt:item.lastObservedAt})));}
  }
  if(existing)return {...existing,catalog};
  return {id:String(candidate.appid),appid:candidate.appid,name:steamName,steamName,genre:candidate.genre,cohort:'m3_discovery',tags:[],releaseDate:null,storeUrl:candidate.storeUrl,observedAt:evidence.collectedAt,
    provenance:{sourceFile:'bounded-collection',sourceUrl:evidence.sourceUrl,sourceType:'Official Steam AppID/name API catalog',identityVerified:true,tagNote:'Steam tags missing; IGDB labels never substitute.',cohortNote:`Versioned editorial mapping ${TAXONOMY_VERSION}; tracked discovery sample, not all Steam games.`},
    players:missingMetric('Steam concurrent players; not collected yet.'),reviews:missingMetric('Steam review query summary; not collected yet.'),storeReviews:missingMetric('New Steam store HTML collection not permitted.'),
    marketing:{status:'not_researched',events:[],caveats:['No marketing research performed for this admission.'],deepProof:false,exhaustive:false},unknowns:['Historical comparable trends, sales, revenue, marketing spend and team size remain unknown.'],catalog};
}
/** Each admission is atomic. No names-only joins and no mass replacement of seed. */
export async function importCandidates(db,{jobId,candidates,steamEvidence,maxGames=360}) {
  if(!Array.isArray(candidates)||candidates.length>450||!Number.isSafeInteger(maxGames)||maxGames<1||maxGames>500)throw new CollectionError('invalid_candidates');
  const names=verifySteamEvidence(steamEvidence),existing=new Map((await readGames(db,{includeEvidence:false})).map(game=>[game.appid,game]));
  const result={admitted:0,updated:0,rejected:0,limitSkipped:0};
  for(const [index,candidate] of candidates.entries()) {
    const reject=reason=>{db.raw.prepare('INSERT OR REPLACE INTO collection_rejections(job_id,item_key,appid,igdb_id,reason) VALUES(?,?,?,?,?)').run(jobId,`candidate:${index}`,Number.isSafeInteger(candidate?.appid)?candidate.appid:null,Number.isSafeInteger(candidate?.catalog?.sourceId)?candidate.catalog.sourceId:null,reason);result.rejected++;};
    const steamName=names.get(candidate?.appid);
    if(!steamName){reject('steam_identity_missing');continue;}
    if(!title(steamName)||title(steamName)!==title(candidate.name)){reject('title_conflict_requires_review');continue;}
    if(!GENRES.includes(candidate.genre)){reject('unapproved_genre');continue;}
    const old=existing.get(candidate.appid);
    if(!old&&existing.size>=maxGames){result.limitSkipped++;continue;}
    if(old&&old.catalog?.sourceId!==candidate.catalog?.sourceId){reject('identity_conflict');continue;}
    const collision=db.raw.prepare('SELECT appid FROM catalog_games WHERE igdb_id=? AND appid<>?').get(candidate.catalog?.sourceId??null,candidate.appid);
    if(collision){reject('igdb_identity_already_assigned');continue;}
    const game=makeGame(candidate,steamName,steamEvidence,old);
    let statements;try{statements=admissionStatements(game,old?db.raw.prepare('SELECT position FROM games WHERE appid=?').get(game.appid).position:(db.raw.prepare('SELECT COALESCE(MAX(position),-1)+1 AS n FROM games').get().n));}catch{reject('identity_or_record_validation_failed');continue;}
    db.raw.exec('BEGIN IMMEDIATE');
    try {
      if(!old){
        for(const genre of GENRES)db.raw.prepare('INSERT OR IGNORE INTO genres(name,position,taxonomy_version) VALUES(?,(SELECT COALESCE(MAX(position),-1)+1 FROM genres),?)').run(genre,TAXONOMY_VERSION);
        db.raw.prepare("INSERT OR IGNORE INTO cohorts(id,label,declared_count,position,detail_json) VALUES('m3_discovery','M3 bounded discovery sample',0,2,?)").run(json({taxonomyVersion:TAXONOMY_VERSION,selection:'IGDB high/low rating-count strata, editorial genre mapping, independently verified Steam IDs'}));
      } else db.raw.prepare('DELETE FROM catalog_games WHERE appid=?').run(game.appid);
      for(const statement of statements)if(!old||/^INSERT INTO (?:catalog_\w+|identity_crosswalks) /.test(statement.sql))db.raw.prepare(statement.sql).run(...statement.values);
      if(!old)db.raw.prepare('INSERT OR IGNORE INTO catalog_admissions(appid,admitted_at,job_id,taxonomy_version,mapping_json,steam_verified_at,steam_name_source,catalog_stratum) VALUES(?,?,?,?,?,?,?,?)').run(game.appid,iso(),jobId,TAXONOMY_VERSION,json(candidate.taxonomy??{}),steamEvidence.collectedAt,steamEvidence.sourceUrl,candidate.tractionProxy?.stratum??'unknown');
      db.raw.prepare("UPDATE cohorts SET declared_count=(SELECT COUNT(*) FROM games WHERE cohort_id='m3_discovery') WHERE id='m3_discovery'").run();
      db.raw.exec('COMMIT');existing.set(game.appid,game);result[old?'updated':'admitted']++;
    }catch{db.raw.exec('ROLLBACK');reject('database_identity_conflict');}
  }
  db.raw.prepare("UPDATE source_health SET status=?,last_attempt_at=?,last_success_at=?,last_error_code=NULL WHERE source='steam_catalog'").run(steamEvidence.sourceUrl===LEGACY_CATALOG_ENDPOINT?'verified_one_run_deprecated_source':'verified_current_official_source',iso(),steamEvidence.collectedAt);
  return {...result,totalGames:existing.size};
}
