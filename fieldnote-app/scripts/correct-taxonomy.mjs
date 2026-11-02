/** Offline-only correction of new M3 admissions. No source requests or credentials. */
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { defaultDatabasePath } from './database.mjs';
import { mapEditorialGenre, TAXONOMY_VERSION, GENRES } from '../collectors/taxonomy.mjs';

export const UNRESOLVED_GENRE = 'Unresolved / needs review';
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const hash = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const fail = code => { throw new Error(code); };

export function buildCorrectionPlan(rows) {
  if (!Array.isArray(rows) || rows.length > 500) fail('invalid_admission_rows');
  const seen = new Set();
  const entries = rows.map(row => {
    if (!Number.isSafeInteger(row.appid) || row.appid < 1 || seen.has(row.appid) || !Array.isArray(row.labels)) fail('invalid_admission_rows');
    seen.add(row.appid);
    const previous = JSON.parse(row.mapping_json);
    if (!['editorial-expanded-1.0', TAXONOMY_VERSION].includes(previous.version)) fail('unexpected_mapping_version');
    if (previous.genre !== row.genre && !(previous.genre === null && row.genre === UNRESOLVED_GENRE)) fail('mapping_row_conflict');
    const raw = { genres: [], themes: [], keywords: [] };
    for (const label of row.labels.filter(label=>label?.name!=null).sort((a,b) => String(a.collection).localeCompare(String(b.collection)) || a.id-b.id || String(a.name).localeCompare(String(b.name)))) {
      if (!Object.hasOwn(raw,label.collection) || !Number.isSafeInteger(label.id) || label.id < 1 || typeof label.name !== 'string') fail('invalid_saved_label');
      raw[label.collection].push({id:label.id,name:label.name});
    }
    const mapping = mapEditorialGenre(raw, {preferredRouteId:previous.discoveryRouteId ?? previous.routeId ?? null,previousMapping:previous});
    const toGenre = mapping.genre ?? UNRESOLVED_GENRE;
    if (mapping.genre !== null && !GENRES.includes(mapping.genre)) fail('invalid_corrected_genre');
    return {appid:row.appid,name:row.name,fromGenre:row.genre,toGenre,fromVersion:previous.version,previousMappingHash:hash(previous),mapping,
      update:previous.version !== TAXONOMY_VERSION || row.genre !== toGenre};
  }).sort((a,b)=>a.appid-b.appid);
  const updated=entries.filter(row=>row.update),changes=updated.filter(row=>row.fromGenre!==row.toGenre);
  const count=key=>Object.fromEntries([...new Set(entries.map(row=>row[key]))].sort().map(genre=>[genre,entries.filter(row=>row[key]===genre).length]));
  return {method:'saved-label-taxonomy-correction-1.0',taxonomyVersion:TAXONOMY_VERSION,sourceRequests:0,admissions:entries.length,
    mappingsToUpdate:updated.length,changedGenres:changes.length,unresolved:entries.filter(row=>row.toGenre===UNRESOLVED_GENRE).length,
    beforeAdmissionCounts:count('fromGenre'),afterAdmissionCounts:count('toGenre'),planHash:hash(entries),entries,
    note:'Provisional editorial classification from saved IGDB labels. The discovery route does not establish primary genre. Original non-admission games and every raw source label/metric remain unchanged; taxonomy changes reset the comparison baseline and are not market trends.'};
}

export function readAdmissionRows(db) {
  const rows=db.prepare("SELECT g.appid,g.name,g.genre,a.mapping_json FROM games g JOIN catalog_admissions a USING(appid) WHERE g.cohort_id='m3_discovery' ORDER BY g.appid").all();
  if (rows.length !== db.prepare('SELECT COUNT(*) AS n FROM catalog_admissions').get().n) fail('admission_scope_conflict');
  const labels=db.prepare('SELECT collection,source_id AS id,name FROM catalog_labels WHERE appid=? ORDER BY collection,source_id,name');
  return rows.map(row=>({...row,labels:labels.all(row.appid)}));
}

export function applyCorrection(db, expectedHash) {
  if (!/^[a-f0-9]{64}$/.test(expectedHash??'')) fail('reviewed_plan_hash_required');
  db.exec('BEGIN IMMEDIATE');
  try {
    if (db.prepare("SELECT COUNT(*) AS n FROM collection_jobs WHERE status='running' AND source IN ('igdb','steam_api','steam_catalog','collector_control')").get().n) fail('collector_still_running');
    const rows=readAdmissionRows(db),plan=buildCorrectionPlan(rows);
    if (plan.planHash!==expectedHash) fail('reviewed_plan_changed');
    const byId=new Map(rows.map(row=>[row.appid,row])),at=new Date().toISOString();
    if(plan.unresolved)db.prepare('INSERT OR IGNORE INTO genres(name,position,taxonomy_version) VALUES(?,(SELECT COALESCE(MAX(position),-1)+1 FROM genres),?)').run(UNRESOLVED_GENRE,TAXONOMY_VERSION);
    for(const row of plan.entries.filter(row=>row.update)) {
      const previous=JSON.parse(byId.get(row.appid).mapping_json);
      const saved={...row.mapping,correction:{at,method:plan.method,reason:'Stronger source genre/theme evidence replaces discovery-route and incidental-keyword priority.',previousMapping:previous,previousGenre:row.fromGenre}};
      const changed=db.prepare("UPDATE games SET genre=? WHERE appid=? AND genre=? AND cohort_id='m3_discovery'").run(row.toGenre,row.appid,row.fromGenre);
      if(Number(changed.changes)!==1)fail('admission_changed_during_apply');
      db.prepare('UPDATE catalog_admissions SET taxonomy_version=?,mapping_json=? WHERE appid=?').run(TAXONOMY_VERSION,JSON.stringify(saved),row.appid);
    }
    if(db.prepare('PRAGMA foreign_key_check').all().length)fail('foreign_key_violation');
    db.exec('COMMIT');
    return {applied:true,at,planHash:plan.planHash,taxonomyVersion:TAXONOMY_VERSION,mappingsUpdated:plan.mappingsToUpdate,changedGenres:plan.changedGenres,unresolved:plan.unresolved,sourceRequests:0};
  } catch(error) {db.exec('ROLLBACK');throw error;}
}

if(process.argv[1] && resolve(process.argv[1])===resolve(new URL(import.meta.url).pathname)) {
  let db;
  try {
    const args=process.argv.slice(2),apply=args[0]==='apply';
    if(!(args.length===1&&args[0]==='plan')&&!(args.length===3&&apply&&args[1]==='--expect'))fail('use_plan_or_apply_with_reviewed_hash');
    db=new DatabaseSync(process.env.FIELDNOTE_DB??defaultDatabasePath,{readOnly:!apply});
    db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    const result=apply?applyCorrection(db,args[2]):buildCorrectionPlan(readAdmissionRows(db));
    console.log(JSON.stringify(result,null,2));
  } catch(error) {console.error(JSON.stringify({error:/^[a-z_]+$/.test(error?.message??'')?error.message:'taxonomy_correction_failed'}));process.exitCode=1;}
  finally {db?.close();}
}
