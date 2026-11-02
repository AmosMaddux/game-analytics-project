import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { buildCorrectionPlan,readAdmissionRows,applyCorrection,UNRESOLVED_GENRE } from '../scripts/correct-taxonomy.mjs';
import { TAXONOMY_VERSION } from '../collectors/taxonomy.mjs';

const originalMapping={version:'editorial-expanded-1.0',genre:'Farming / life simulation',routeId:'farming',method:'explicit_igdb_label_rule',matches:[]};
const row=()=>({appid:100,name:'Synthetic survival',genre:originalMapping.genre,mapping_json:JSON.stringify(originalMapping),labels:[{collection:'genres',id:5,name:'Shooter'},{collection:'genres',id:12,name:'Role-playing (RPG)'},{collection:'themes',id:21,name:'Survival'},{collection:'keywords',id:1103,name:'farming'}]});
function database() {
  const db=new DatabaseSync(':memory:');
  db.exec("PRAGMA foreign_keys=ON; CREATE TABLE genres(name TEXT PRIMARY KEY,position INTEGER,taxonomy_version TEXT); CREATE TABLE games(appid INTEGER PRIMARY KEY,name TEXT,genre TEXT REFERENCES genres(name),cohort_id TEXT); CREATE TABLE catalog_admissions(appid INTEGER PRIMARY KEY REFERENCES games(appid),taxonomy_version TEXT,mapping_json TEXT); CREATE TABLE catalog_labels(appid INTEGER,collection TEXT,source_id INTEGER,name TEXT); CREATE TABLE collection_jobs(source TEXT,status TEXT); CREATE TABLE metric_observations(appid INTEGER,value INTEGER);");
  for(const [i,name]of ['Farming / life simulation','Survival / crafting','Puzzle'].entries())db.prepare('INSERT INTO genres VALUES(?,?,?)').run(name,i,'original-version');
  db.exec("INSERT INTO games VALUES(1,'Original game','Puzzle','original'),(100,'Synthetic survival','Farming / life simulation','m3_discovery'); INSERT INTO metric_observations VALUES(1,10),(100,12345);");
  db.prepare('INSERT INTO catalog_admissions VALUES(?,?,?)').run(100,originalMapping.version,JSON.stringify(originalMapping));
  for(const label of row().labels)db.prepare('INSERT INTO catalog_labels VALUES(?,?,?,?)').run(100,label.collection,label.id,label.name);
  return db;
}
test('offline correction plan is label-order stable and maps survival without game-name rules',()=>{
  const first=buildCorrectionPlan([row()]),changed=row();changed.labels.reverse();
  assert.equal(first.planHash,buildCorrectionPlan([changed]).planHash);
  assert.equal(first.entries[0].toGenre,'Survival / crafting');assert.equal(first.sourceRequests,0);
  const renamed=row();renamed.name='An unrelated title';assert.equal(buildCorrectionPlan([renamed]).entries[0].toGenre,'Survival / crafting');
});
test('reviewed correction preserves original games, labels and metrics and retains old mapping',()=>{
  const db=database();try{
    const before={game:db.prepare('SELECT * FROM games WHERE appid=1').get(),labels:db.prepare('SELECT * FROM catalog_labels').all(),metrics:db.prepare('SELECT * FROM metric_observations').all()};
    const plan=buildCorrectionPlan(readAdmissionRows(db));assert.throws(()=>applyCorrection(db,'0'.repeat(64)),/reviewed_plan_changed/);
    const result=applyCorrection(db,plan.planHash);assert.equal(result.changedGenres,1);assert.equal(result.taxonomyVersion,TAXONOMY_VERSION);
    assert.deepEqual(db.prepare('SELECT * FROM games WHERE appid=1').get(),before.game);assert.deepEqual(db.prepare('SELECT * FROM catalog_labels').all(),before.labels);assert.deepEqual(db.prepare('SELECT * FROM metric_observations').all(),before.metrics);
    const saved=JSON.parse(db.prepare('SELECT mapping_json FROM catalog_admissions').get().mapping_json);assert.deepEqual(saved.correction.previousMapping,originalMapping);
    const replay=buildCorrectionPlan(readAdmissionRows(db));assert.equal(applyCorrection(db,replay.planHash).mappingsUpdated,0);
  }finally{db.close();}
});
test('correction blocks live collectors and admission/original scope conflicts atomically',()=>{
  const db=database();try{
    const plan=buildCorrectionPlan(readAdmissionRows(db));db.exec("INSERT INTO collection_jobs VALUES('steam_api','running')");assert.throws(()=>applyCorrection(db,plan.planHash),/collector_still_running/);
    assert.equal(db.prepare('SELECT genre FROM games WHERE appid=100').get().genre,originalMapping.genre);db.exec('DELETE FROM collection_jobs');
    db.prepare('INSERT INTO catalog_admissions VALUES(?,?,?)').run(1,originalMapping.version,JSON.stringify(originalMapping));assert.throws(()=>readAdmissionRows(db),/admission_scope_conflict/);
  }finally{db.close();}
});
test('insufficient saved labels produce an explicit unresolved holding group',()=>{
  const value=row();value.labels=[{collection:'keywords',id:510,name:'crafting'}];
  assert.equal(buildCorrectionPlan([value]).entries[0].toGenre,UNRESOLVED_GENRE);
});
