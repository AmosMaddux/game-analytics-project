import test from 'node:test';import assert from 'node:assert/strict';import{readFileSync}from'node:fs';
import{validatePanelMetricBundle}from'../scripts/import-panel-metrics.mjs';import{canonicalJson}from'../backend/panel-selection.mjs';import{panelMetricFixture,hash}from'./fixtures/reviewer-metrics.mjs';
const approved=JSON.parse(readFileSync(new URL('./fixtures/approved-panel294.json',import.meta.url),'utf8')),now='2026-10-12T18:00:00.000Z';
async function input(){const {bundle,validationRaw}=await panelMetricFixture(),panel=structuredClone(approved);bundle.startedAt='2026-10-12T16:10:00.000Z';bundle.finishedAt='2026-10-12T17:00:00.000Z';bundle.panel={manifestSha256:panel.manifestSha256,populationVersion:panel.policyVersion,appids:panel.members.map(x=>x.appid)};const templates=bundle.observations.slice(0,4);bundle.observations=panel.members.flatMap(member=>templates.map(row=>({...row,appid:member.appid,observationKey:`approved-fixture-${member.appid}-${row.metric}`,observedAt:'2026-10-12T16:30:00.000Z'})));return{panel,bundle,validationRaw};}
function rehash(panel){const{panelId,manifestSha256,...body}=panel;void panelId;void manifestSha256;const digest=hash(canonicalJson(body));return{...body,panelId:`panel-${digest.slice(0,24)}`,manifestSha256:digest};}

test('the explicitly approved exact294 manifest accepts exactly1176 valid four-metric observations',async()=>{
 const{panel,bundle,validationRaw}=await input();assert.equal(panel.manifestSha256,'dc3840a01e9d68b2e0f7ecef873ecba6fa6430eb847595eacd01e7d4e932e3b9');assert.equal(bundle.observations.length,1176);const checked=await validatePanelMetricBundle(bundle,validationRaw,panel,{now});assert.equal(checked.approvalScope,'exact_user_approved_294_manifest');assert.equal(checked.selectedCount,294);assert.equal(checked.targetCount,300);assert.equal(checked.shortfallCount,6);assert.equal(checked.accepted,1176);assert.equal(checked.missing,0);
});

test('approved294 does not authorize tampering, a different partial panel or a different observation cardinality',async()=>{
 const{panel,bundle,validationRaw}=await input();
 const corrupt=structuredClone(panel);corrupt.members[0].eligibility.lifetimeReviews++;await assert.rejects(()=>validatePanelMetricBundle(bundle,validationRaw,corrupt,{now}));
 const unrelated=rehash({...structuredClone(panel),seed:'a-different-partial-population'}),otherBundle=structuredClone(bundle);otherBundle.panel.manifestSha256=unrelated.manifestSha256;await assert.rejects(()=>validatePanelMetricBundle(otherBundle,validationRaw,unrelated,{now}));
 const incomplete=structuredClone(bundle);incomplete.observations.pop();await assert.rejects(()=>validatePanelMetricBundle(incomplete,validationRaw,panel,{now}));
 const extra=structuredClone(bundle);extra.observations.push({...extra.observations[0],observationKey:'unapproved-extra'});await assert.rejects(()=>validatePanelMetricBundle(extra,validationRaw,panel,{now}));
});

test('approved294 accepts explicit null player404 while preserving zeros and rejecting review404 or completed status',async()=>{
 const{panel,bundle,validationRaw}=await input();bundle.status='completed_with_missing';
 const missing=bundle.observations.find(x=>x.appid===917640&&x.metric==='players');assert.ok(missing);missing.value=null;missing.missingReason='source_http_404';
 const zeroPlayers=bundle.observations.filter(x=>x.metric==='players'&&x.value===0).length;assert.equal(zeroPlayers,293);
 const before=JSON.stringify(bundle),checked=await validatePanelMetricBundle(bundle,validationRaw,panel,{now});assert.equal(checked.accepted,1175);assert.equal(checked.missing,1);assert.equal(JSON.stringify(bundle),before);
 for(const metric of ['reviews7d','reviews30d','lifetimeReviews']){
  const changed=structuredClone(bundle),row=changed.observations.find(x=>x.appid===917640&&x.metric===metric);row.value=null;row.missingReason='source_http_404';
  await assert.rejects(()=>validatePanelMetricBundle(changed,validationRaw,panel,{now}),/only.*current-player/);
 }
 const fakeZero=structuredClone(bundle);fakeZero.observations.find(x=>x.appid===917640&&x.metric==='players').value=0;await assert.rejects(()=>validatePanelMetricBundle(fakeZero,validationRaw,panel,{now}),/Missing and zero/);
 const completed=structuredClone(bundle);completed.status='completed';await assert.rejects(()=>validatePanelMetricBundle(completed,validationRaw,panel,{now}),/hide missing/);
});
