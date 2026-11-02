import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,existsSync,rmSync}from'node:fs';import{tmpdir}from'node:os';import{join}from'node:path';import{DatabaseSync}from'node:sqlite';
import{openDatabase,migrate}from'../scripts/database.mjs';import{importPanelMetrics}from'../scripts/import-panel-metrics.mjs';import{panelMetricFixture,METRIC_NOW as now,hash}from'./fixtures/reviewer-metrics.mjs';
async function context(t){const dir=mkdtempSync(join(tmpdir(),'reviewer-full-metric-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const source=join(dir,'source.sqlite'),output=join(dir,'copy.sqlite'),metricFile=join(dir,'metrics.json'),validationFile=join(dir,'validation.json'),panelFile=join(dir,'panel.json'),f=await panelMetricFixture();for(const[path,raw]of[[metricFile,JSON.stringify(f.bundle)],[validationFile,f.validationRaw],[panelFile,JSON.stringify(f.panel)]])writeFileSync(path,raw);
 const db=openDatabase(source);migrate(db);db.raw.exec("INSERT INTO genres VALUES('Fixture',0,'fixture');INSERT INTO cohorts VALUES('original_30','Fixture',300,0,'{}')");const game=db.raw.prepare("INSERT INTO games(appid,source_id,name,steam_name,genre,cohort_id,store_url,collected_at,position) VALUES(?,?,?,?,'Fixture','original_30',?,'2026-10-11T00:00:00.000Z',?)");for(const member of f.panel.members)game.run(member.appid,String(member.appid),member.name,member.name,`https://store.steampowered.com/app/${member.appid}/`,member.appid);
 db.raw.prepare('INSERT INTO research_panels VALUES(?,?,?,?,?,?,?)').run(f.panel.panelId,f.panel.label,f.panel.policyVersion,f.panel.createdAt,f.panel.asOf,f.panel.sourceSha256,JSON.stringify(f.panel));for(const member of f.panel.members)db.raw.prepare('INSERT INTO research_panel_memberships VALUES(?,?,?,?,?)').run(f.panel.panelId,member.appid,member.allocationGroup,member.reason,JSON.stringify(member.eligibility));db.close();return {...f,dir,source,output,metricFile,validationFile,panelFile,options:{source,metricFile,validationFile,panelFile,now}};}
const sha=p=>hash(readFileSync(p));
function counts(path){const db=new DatabaseSync(path,{readOnly:true});try{return Object.fromEntries(['games','research_panels','research_panel_memberships','metric_observations','research_activity_observations','research_metric_imports','research_review_contracts'].map(t=>[t,db.prepare(`SELECT count(*) n FROM ${t}`).get().n]));}finally{db.close();}}

test('full metric import makes a new copy with1200 exact observations and idempotent replay',async t=>{
 const f=await context(t),before=sha(f.source);assert.equal((await importPanelMetrics(f.options)).mode,'read_only_dry_run');assert.equal(existsSync(f.output),false);
 const result=await importPanelMetrics({...f.options,applyCopy:f.output});assert.equal(result.accepted,1200);assert.equal(result.missing,0);assert.equal(sha(f.source),before);assert.deepEqual(counts(f.output),{games:300,research_panels:1,research_panel_memberships:300,metric_observations:600,research_activity_observations:600,research_metric_imports:1,research_review_contracts:1});
 const db=new DatabaseSync(f.output,{readOnly:true});try{assert.equal(db.prepare("SELECT count(*) n FROM metric_observations WHERE metric='players' AND value=0 AND evidence_status='observed'").get().n,300);assert.equal(db.prepare("SELECT count(*) n FROM research_activity_observations WHERE metric='reviews7d' AND value=0").get().n,300);}finally{db.close();}
 const replay=join(f.dir,'replay.sqlite');assert.equal((await importPanelMetrics({...f.options,source:f.output,applyCopy:replay})).mode,'idempotent_copy');assert.deepEqual(counts(replay),counts(f.output));
});

test('full metric run-ID conflict is rejected by preflight before copying or a successful dryrun',async t=>{
 const f=await context(t),db=openDatabase(f.source);db.raw.prepare('INSERT INTO research_metric_imports VALUES(?,?,?,?,?,?,?,?)').run(f.bundle.runId,'0'.repeat(64),f.panel.panelId,hash(f.validationRaw),now,1200,0,'{}');db.close();const before=sha(f.source);
 await assert.rejects(()=>importPanelMetrics(f.options),/conflict/i);await assert.rejects(()=>importPanelMetrics({...f.options,applyCopy:f.output}),/conflict/i);assert.equal(existsSync(f.output),false);assert.equal(sha(f.source),before);
});

test('full metric observation-key conflict is rejected before copy creation',async t=>{
 const f=await context(t),db=openDatabase(f.source),row=f.bundle.observations[0];db.raw.prepare("INSERT INTO metric_observations(observation_id,appid,metric,value,evidence_status,freshness,collected_at,source_scope,unit,method_version,run_id,original_keys_json) VALUES(?,?,'players',1,'observed','fresh',?,'old scope','concurrent_players','old-method','old-run','[]')").run(row.observationKey,row.appid,now);db.close();const before=sha(f.source);
 await assert.rejects(()=>importPanelMetrics(f.options),/conflict/i);await assert.rejects(()=>importPanelMetrics({...f.options,applyCopy:f.output}),/conflict/i);assert.equal(existsSync(f.output),false);assert.equal(sha(f.source),before);
});

test('full metric transaction failure rolls back all appended metrics, contracts and ledger rows',async t=>{
 const f=await context(t),db=openDatabase(f.source);db.raw.exec("CREATE TRIGGER block_second_metric BEFORE INSERT ON metric_observations WHEN (SELECT count(*) FROM metric_observations)>=1 BEGIN SELECT RAISE(ABORT,'reviewer metric transaction failure'); END");db.close();const before=counts(f.source),sourceHash=sha(f.source);
 await assert.rejects(()=>importPanelMetrics({...f.options,applyCopy:f.output}),/reviewer metric transaction failure/);assert.deepEqual(counts(f.output),before);assert.equal(sha(f.source),sourceHash);
});

test('missing player404 is stored as unavailable with exact source time and reason while observed zeros remain observed',async t=>{
 const f=await context(t),row=f.bundle.observations.find(x=>x.metric==='players');f.bundle.status='completed_with_missing';row.value=null;row.missingReason='source_http_404';writeFileSync(f.metricFile,JSON.stringify(f.bundle));
 const before=sha(f.source),result=await importPanelMetrics({...f.options,applyCopy:f.output});assert.equal(result.accepted,1199);assert.equal(result.missing,1);assert.equal(sha(f.source),before);
 const db=new DatabaseSync(f.output,{readOnly:true});try{
  const stored=db.prepare('SELECT * FROM metric_observations WHERE observation_id=?').get(row.observationKey);assert.equal(stored.value,null);assert.equal(stored.evidence_status,'unavailable');assert.equal(stored.freshness,'unknown');assert.equal(stored.collected_at,row.observedAt);assert.equal(stored.run_id,f.bundle.runId);assert.equal(stored.source_url,row.sourceUrl);assert.equal(JSON.parse(stored.detail_json).missingReason,'source_http_404');assert.equal(JSON.parse(stored.detail_json).scoreEligible,false);
  assert.equal(db.prepare("SELECT count(*) n FROM metric_observations WHERE metric='players' AND value=0 AND evidence_status='observed'").get().n,299);
  assert.equal(db.prepare("SELECT count(*) n FROM research_activity_observations WHERE metric='reviews7d' AND value=0").get().n,300);
  const receipt=db.prepare('SELECT accepted_count,missing_count FROM research_metric_imports').get();assert.equal(receipt.accepted_count,1199);assert.equal(receipt.missing_count,1);
 }finally{db.close();}
});
