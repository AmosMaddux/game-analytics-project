import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveReleaseWindow } from '../../../backend/cohort-foundation/windows.mjs';
import { filterReleaseCohort } from '../../../backend/cohort-foundation/releases.mjs';
const window = resolveReleaseWindow({ preset:'7d', asOf:'2026-10-11T00:00:00Z' });
const evidence = (date, extra = {}) => ({ date, precision:'day', verified:true, status:'released', ...extra });
const game = (appId, date, extra = {}) => ({ appId, genres:['Action'], releases:{ firstPlayableSteam:evidence(date) }, metrics:{ reviews7d:10 }, ...extra });

test('filters release before activity: old game with recent measurements stays excluded', () => {
  const result = filterReleaseCohort([game(1,'2021-10-08'),game(2,'2026-10-04'),game(3,'2026-10-10'),game(4,'2026-10-11')], { window });
  assert.deepEqual(result.eligibleGames.map(item => item.appId), ['2','3']);
  assert.equal(result.exclusionCounts.outside_release_window, 2);
});
test('Early Access stays the first playable date and full 1.0 is an explicit switch', () => {
  const input = [{ appId:10, genres:['RPG'], releases:{ firstPlayableSteam:evidence('2024-01-01',{phase:'early_access'}),fullReleaseSteam:evidence('2026-10-05',{phase:'full_release'}) } }];
  assert.equal(filterReleaseCohort(input,{window}).eligibleCount,0);
  assert.equal(filterReleaseCohort(input,{window,releaseBasis:'full_release'}).eligibleCount,1);
  assert.equal(filterReleaseCohort([game(1,'2026-10-05')],{window,releaseBasis:'full_release'}).excludedGames[0].reason,'missing_release_date');
});
test('unknown, imprecise, unverified, invalid, future and planned dates have reasons', () => {
  const futureWindow = resolveReleaseWindow({ preset:'custom',asOf:'2026-10-11T12:00:00Z',startDate:'2026-10-01',endDate:'2026-10-31' });
  const input = [
    {appId:1}, game(2,'2026-10',{releases:{firstPlayableSteam:evidence('2026-10',{precision:'month'})}}),
    game(3,'2026-10-10',{releases:{firstPlayableSteam:evidence('2026-10-10',{verified:false})}}),
    game(4,'2026-02-30'), game(5,'2026-10-12'),
    game(6,'2026-10-05',{releases:{firstPlayableSteam:evidence('2026-10-05',{status:'planned'})}})
  ];
  assert.deepEqual(filterReleaseCohort(input,{window:futureWindow}).excludedGames.map(item=>item.reason), ['missing_release_date','imprecise_release_date','unverified_release_date','invalid_release_date','future_release_date','not_released']);
});
test('duplicate IDs normalize, merge genre labels and retain one eligible game', () => {
  const result = filterReleaseCohort([game(42,'2026-10-05'),game('00042','2026-10-05',{genres:['Action','RPG','RPG']}),game(43,'2026-10-06')],{window});
  assert.equal(result.duplicateRowCount,1);
  assert.equal(result.uniqueGameCount,2);
  assert.deepEqual(result.eligibleGames[0].genres,['Action','RPG']);
  assert.equal(result.eligibleGames[0].sourceRowCount,2);
});
test('conflicting verified dates or planned/released states are never first-row wins', () => {
  const rows = [game(1,'2026-10-05'),game(1,'2021-01-01'),game(2,'2026-10-05'),game(2,'2026-10-05',{releases:{firstPlayableSteam:evidence('2026-10-05',{status:'planned'})}})];
  const reasons = filterReleaseCohort(rows,{window}).excludedGames.map(item=>item.reason);
  assert.deepEqual(reasons,['conflicting_release_dates','conflicting_release_status']);
  assert.deepEqual(filterReleaseCohort([...rows].reverse(),{window}).excludedGames.map(item=>item.reason),reasons);
});
test('full release earlier than claimed first playable is a chronology conflict', () => {
  const row = game(1,'2026-10-05',{releases:{firstPlayableSteam:evidence('2026-10-05'),fullReleaseSteam:evidence('2026-09-01')}});
  for (const releaseBasis of ['first_playable','full_release']) assert.equal(filterReleaseCohort([row],{window,releaseBasis}).excludedGames[0].reason,'conflicting_release_chronology');
});
test('source provenance and rejected evidence are preserved without mutating input', () => {
  const row = game(1,'2026-10-05',{releases:{firstPlayableSteam:evidence('2026-10-05',{source:'fixture',retrievedAt:'2026-10-10T00:00:00Z',confidence:'verified'})}});
  const copy = structuredClone(row);
  const result = filterReleaseCohort([row,game(1,'2026-10',{releases:{firstPlayableSteam:evidence('2026-10',{precision:'month'})}})],{window});
  assert.equal(result.eligibleGames[0].evidence[0].source,'fixture');
  assert.equal(result.eligibleGames[0].evidenceIssues[0].reason,'imprecise_release_date');
  assert.deepEqual(row,copy);
});
test('invalid IDs remain audited separately from unique game coverage', () => {
  const result = filterReleaseCohort([{appId:0},{appId:-1},{appId:'abc'},{appId:Number.MAX_SAFE_INTEGER+1},null,game(1,'2026-10-05')],{window});
  assert.equal(result.invalidRows.length,5);
  assert.equal(result.uniqueGameCount,1);
  assert.equal(result.duplicateRowCount,0);
});
