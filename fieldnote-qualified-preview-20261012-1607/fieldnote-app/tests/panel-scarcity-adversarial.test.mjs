import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {selectPanel, PANEL_POLICY, LEGACY_PANEL_POLICY, PANEL_SEED, DATED_LIFETIME_SCOPE, reviewContract} from '../backend/panel-selection.mjs';
const asOf='2026-10-11T19:30:00.000Z';
const fixture=(appid,releaseDate=null,lifetimeReviews=1000)=>({appid,name:`Independent ${appid}`,source:'IGDB + Steam IStoreService',sourceUrl:`https://www.igdb.com/games/independent-${appid}`,retrievedAt:'2026-10-10T00:00:00.000Z',appType:'game',typeBasis:'derived_game_only_query',releaseDate,releaseBasis:'igdb_pc',releasePrecision:releaseDate?'day':'unknown',lifetimeReviews,referenceEligible:false,referenceReason:null,genres:['Adventure','Simulator'],...(lifetimeReviews===null?{}:{reviewEvidence:{runId:'qualification-one',methodVersion:'review-contract-v1',scope:DATED_LIFETIME_SCOPE,unit:'reviews',contract:reviewContract(DATED_LIFETIME_SCOPE),collectedAt:'2026-10-11T19:00:00.000Z'}})});
const rank=id=>createHash('sha256').update(`${PANEL_SEED}:${id}`).digest('hex');
const seeded=rows=>[...rows].sort((a,b)=>rank(a.appid).localeCompare(rank(b.appid))||a.appid-b.appid);
const ids=rows=>rows.map(r=>r.appid);
function population(){let id=1;const rows=[];for(let i=0;i<120;i++)rows.push(fixture(id++,'2026-10-01',10000+i));for(let year=2021;year<=2025;year++)for(let i=0;i<25;i++)rows.push(fixture(id++,`${year}-06-01`,20000+i));for(let i=0;i<120;i++)rows.push(fixture(id++,null,5000-i));for(let i=0;i<35;i++)rows.push(fixture(id++,null,i));return rows;}

test('independent v3 oracle reserves dated slots before descending remaining lifetime refs with exact audit',async()=>{
 const input=population(), expectedRecent=seeded(input.filter(x=>x.releaseDate==='2026-10-01')).slice(0,100);
 const expectedOlder=Array.from({length:5},(_,i)=>seeded(input.filter(x=>x.releaseDate===`${2021+i}-06-01`)).slice(0,20)).flat();
 const reserved=new Set(ids([...expectedRecent,...expectedOlder]));
 const references=input.filter(x=>x.lifetimeReviews>=50&&!reserved.has(x.appid)).sort((a,b)=>b.lifetimeReviews-a.lifetimeReviews||a.appid-b.appid).slice(0,75);
 const controls=seeded(input.filter(x=>x.lifetimeReviews<50)).slice(0,25);
 const result=await selectPanel(input,{asOf,releaseBasis:'igdb_pc'});
 assert.equal(result.policyVersion,PANEL_POLICY);assert.equal(result.selectedCount,300);assert.equal(result.shortfallCount,0);
 assert.deepEqual(ids(result.members),ids([...expectedRecent,...expectedOlder,...references,...controls]));
 assert.deepEqual(result.groups.map(g=>g.selected),[75,100,100,25]);
 assert.deepEqual(result.referenceReservation.reservedAppids,[...reserved]);
 const top75=input.filter(x=>x.lifetimeReviews>=50).sort((a,b)=>b.lifetimeReviews-a.lifetimeReviews||a.appid-b.appid).slice(0,75);
 assert.deepEqual(ids(result.referenceReservation.displacedFromUnreservedTop75),ids(top75.filter(x=>reserved.has(x.appid))));
 assert.deepEqual(ids(result.referenceReservation.replacementReferences),ids(references.filter(x=>!top75.some(y=>x.appid===y.appid))));
 assert.match(result.label,/Frozen 300-game/);
});

test('v3 leaves scarce year/recent slots unfilled and never borrows surplus references',async()=>{
 const input=population().filter(x=>x.releaseDate!=='2026-10-01'&&x.releaseDate!=='2023-06-01');
 const result=await selectPanel(input,{asOf,releaseBasis:'igdb_pc'});
 assert.deepEqual(result.groups.map(g=>g.selected),[75,0,80,25]);assert.equal(result.selectedCount,180);assert.equal(result.shortfallCount,120);
 assert.equal(result.olderYears.find(g=>g.id==='older_2023').selected,0);
 assert.match(result.label,/incomplete/);assert.equal(new Set(ids(result.members)).size,result.members.length);
});

test('v2 remains explicit reference-first and is stable to candidate ordering',async()=>{
 const input=population(), options={asOf,releaseBasis:'igdb_pc',policyVersion:LEGACY_PANEL_POLICY};
 const a=await selectPanel(input,options),b=await selectPanel([...input].reverse(),options);
 assert.deepEqual(a,b);assert.equal(a.referenceReservation,undefined);assert.equal(a.allocationOrder[0],'popular_reference');
 const expected=input.filter(x=>x.lifetimeReviews>=50).sort((a,b)=>b.lifetimeReviews-a.lifetimeReviews||a.appid-b.appid).slice(0,75);
 assert.deepEqual(ids(a.members.filter(x=>x.allocationGroup==='popular_reference')),ids(expected));
});

test('known zero controls stay distinct from unknown reviews; no invented contract or mixed snapshots',async()=>{
 const zero=fixture(1,null,0),unknown=fixture(2,null,null);
 const result=await selectPanel([zero,unknown],{asOf,releaseBasis:'igdb_pc'});
 assert.deepEqual(ids(result.members),[1]);assert.equal(result.coverage.lifetimeReviewsKnown,1);
 for(const mutate of [r=>r.reviewEvidence.scope='arbitrary lifetime population',r=>r.reviewEvidence.unit='players',r=>r.reviewEvidence.contract.sourceField='score',r=>delete r.reviewEvidence.contract,r=>r.reviewEvidence.collectedAt='2026-10-11T19:30:00.001Z']){
  const row=structuredClone(zero);mutate(row);await assert.rejects(()=>selectPanel([row],{asOf,releaseBasis:'igdb_pc'}));
 }
 const other=fixture(3);other.reviewEvidence.runId='qualification-two';
 await assert.rejects(()=>selectPanel([zero,other],{asOf,releaseBasis:'igdb_pc'}));
});

test('duplicate identity, future metadata, source types and selected date basis stay bounded',async()=>{
 const row=fixture(1,'2026-10-01'), conflicting={...row,name:'Different'};
 await assert.rejects(()=>selectPanel([row,conflicting],{asOf,releaseBasis:'igdb_pc'}));
 const future={...fixture(2,'2026-10-01'),retrievedAt:'2026-10-11T19:30:00.001Z'};
 const excluded={...fixture(3,'2026-10-01'),appType:'excluded'};
 const result=await selectPanel([row,row,future,excluded],{asOf,releaseBasis:'first_playable'});
 assert.equal(result.candidateCount,3);assert.equal(result.groups[1].selected,0);assert.deepEqual(ids(result.members),[1]);
});

test('exact asOf timestamps canonicalize while malformed calendar dates fail',async()=>{
 const input=[fixture(1)];
 assert.deepEqual(await selectPanel(input,{asOf:'2026-10-11T19:30:00Z'}),await selectPanel(input,{asOf}));
 await assert.rejects(()=>selectPanel(input,{asOf:'2026-02-30T00:00:00.000Z'}));
 await assert.rejects(()=>selectPanel([{...fixture(1),releaseDate:'2026-02-30',releasePrecision:'day'}],{asOf}));
});

test('separate cohort cutoff freezes age/year membership while permitting later evidence and rejecting future cutoff',async()=>{
 const evidenceAsOf='2027-01-02T12:00:00.000Z',cohortCutoff='2026-12-31T12:00:00.000Z';
 const inputs=[fixture(1,'2026-12-15',10),fixture(2,'2027-01-01',10),fixture(3,'2021-06-01',100),fixture(4,'2026-06-01',100)];
 for(const row of inputs){row.retrievedAt='2027-01-01T00:00:00.000Z';row.reviewEvidence.collectedAt='2027-01-02T00:00:00.000Z';}
 const result=await selectPanel(inputs,{asOf:evidenceAsOf,cohortCutoff,releaseBasis:'igdb_pc'});
 assert.equal(result.cohortCutoff,cohortCutoff);assert.equal(result.evidenceAsOf,evidenceAsOf);
 assert.deepEqual(ids(result.members.filter(x=>x.allocationGroup==='recent_releases')),[1]);
 assert.deepEqual(ids(result.members.filter(x=>x.allocationGroup==='older_2021')),[3]);
 assert.ok(!result.olderYears.some(x=>x.id==='older_2026'));
 assert.ok(result.members.find(x=>x.appid===4&&x.allocationGroup==='popular_reference'));
 await assert.rejects(()=>selectPanel(inputs,{asOf:evidenceAsOf,cohortCutoff:'2027-01-03T00:00:00.000Z',releaseBasis:'igdb_pc'}));
});
