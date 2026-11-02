import test from 'node:test';import assert from 'node:assert/strict';
import {validateSentinelReport,validatePanelMetricBundle} from '../scripts/import-panel-metrics.mjs';
import {sentinelFixture,panelMetricFixture,METRIC_NOW as now} from './fixtures/reviewer-metrics.mjs';

test('sentinel validator enforces all13 unique checks and all5 unique actual sentinels',()=>{
 const valid=sentinelFixture();assert.doesNotThrow(()=>validateSentinelReport(valid,{now}));
 for(const mutate of [x=>x.checks.pop(),x=>x.checks[0]=structuredClone(x.checks[1]),x=>x.games[0].appid=x.games[1].appid,x=>x.checks[0].status='pending',x=>x.filters.purchase_type=1,x=>x.games[0].observations.lifetime.sourceReported=false]){const v=structuredClone(valid);mutate(v);assert.throws(()=>validateSentinelReport(v,{now}));}
});

test('sentinel boundary partitions and lifetime consistency cannot be forged by pass labels',()=>{
 const valid=sentinelFixture();
 for(const mutate of [x=>x.checks.find(c=>c.check==='known_empty').window.start=0,x=>x.checks.find(c=>c.check==='positive_boundary_exact_enumeration').rightCount=0,x=>x.checks.find(c=>c.check==='positive_boundary_exact_enumeration').wholeCount=3,x=>x.checks.find(c=>c.check==='positive_boundary_exact_enumeration').enumerationPages=2,x=>x.checks.find(c=>c.check==='high_volume_7_plus_23_equals_30').preceding23d=19,x=>x.games[0].observations.lifetime.value=0,x=>x.games[0].observations.reviews7d.value=31]){const v=structuredClone(valid);mutate(v);assert.throws(()=>validateSentinelReport(v,{now}));}
});

test('full metric validator preserves real zero and rejects dated>lifetime even when30d is missing',async()=>{
 const {panel,bundle,validationRaw}=await panelMetricFixture();assert.equal((await validatePanelMetricBundle(bundle,validationRaw,panel,{now})).accepted,1200);
 const bad=structuredClone(bundle);bad.status='completed_with_missing';bad.observations[0].value=1;bad.observations[1].value=null;bad.observations[1].missingReason='source_unavailable';bad.observations[2].value=0;
 await assert.rejects(()=>validatePanelMetricBundle(bad,validationRaw,panel,{now}),/lifetime/);
});

test('full metric run and each observation must be bounded by actual collection and panel chronology',async()=>{
 const {panel,bundle,validationRaw}=await panelMetricFixture();
 for(const mutate of [x=>delete x.startedAt,x=>x.finishedAt='2026-10-12T10:20:00.000Z',x=>x.observations[0].observedAt='2026-10-12T09:00:00.000Z',x=>{x.startedAt='2026-10-11T18:30:00.000Z';x.windows.seven.endExclusive=1791676800;x.windows.seven.start=1791072000;x.windows.thirty.endExclusive=1791676800;x.windows.thirty.start=1789084800;for(const o of x.observations)if(o.window)o.window=o.metric==='reviews7d'?x.windows.seven:x.windows.thirty;}]){
  const changed=structuredClone(bundle);mutate(changed);await assert.rejects(()=>validatePanelMetricBundle(changed,validationRaw,panel,{now}),String(mutate));
 }
});
