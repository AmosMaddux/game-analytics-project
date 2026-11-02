import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeGenres, resolveReleaseWindow, resolveReviewWindows } from '../../../backend/cohort-foundation/index.mjs';
const window = resolveReleaseWindow({ preset:'7d', asOf:'2026-10-11T00:00:00Z' });
const game = (appId, value, genres = ['Action'], date = '2026-10-05') => ({ appId, genres, releases:{firstPlayableSteam:{date,precision:'day',verified:true,status:'released'}}, metrics:{reviews7d:value} });
const run = (games, options = {}) => analyzeGenres(games,{window,metric:'reviews7d',...options});

test('recent-release filtering precedes per-genre statistics', () => {
  const result = run([game(1,1_000_000,['Action'],'2021-01-01'),game(2,10),game(3,20)]);
  assert.equal(result.cohort.excludedCount,1);
  assert.equal(result.genres[0].mean,15);
  assert.equal(result.genres[0].median,15);
  assert.equal(result.genres[0].eligibleCount,2);
});
test('each unique app is equally weighted once per genre despite duplicates and multiple labels', () => {
  const result = run([game(1,10,['Action','RPG','Action']),game('001',10,['Action']),game(2,30,['Action']),game(3,0,['RPG'])]);
  assert.equal(result.cohort.uniqueGameCount,3);
  assert.deepEqual(result.genres.map(({genre,n,mean})=>({genre,n,mean})),[{genre:'Action',n:2,mean:20},{genre:'RPG',n:2,mean:5}]);
  assert.equal(result.genres.reduce((sum,item)=>sum+item.n,0),4);
});
test('missing, nonfinite, invalid and zero retain distinct coverage and reasons', () => {
  const result = run([game(1,0),game(2,null),game(3,{value:null,missingReason:'source_unavailable'}),game(4,undefined),game(5,NaN),game(6,'0'),game(7,Infinity)]).genres[0];
  assert.equal(result.eligibleCount,7);
  assert.equal(result.observedCount,1);
  assert.equal(result.missingCount,6);
  assert.equal(result.mean,0);
  assert.equal(result.median,0);
  assert.ok(Math.abs(result.coveragePercent - 100/7) < 1e-12);
  assert.deepEqual(result.missingReasonCounts,{missing_metric:2,source_unavailable:1,nonfinite_metric:2,invalid_metric:1});
  assert.equal(result.largestGameShare,null);
  assert.equal(result.largestGameShareStatus,'zero_total');
});
test('empty genre, all missing and genuinely zero are distinguishable', () => {
  const result = run([game(1,null,['Missing']),game(2,0,['Zero'])],{genreUniverse:['Empty']});
  const [empty,missing,zero] = result.genres;
  assert.equal(empty.eligibleCount,0); assert.equal(empty.mean,null); assert.equal(empty.coveragePercent,null);
  assert.equal(missing.eligibleCount,1); assert.equal(missing.mean,null); assert.equal(missing.coveragePercent,0);
  assert.equal(zero.eligibleCount,1); assert.equal(zero.mean,0); assert.equal(zero.coveragePercent,100);
});
test('conflicting duplicate metric values are unavailable rather than averaged or first-wins', () => {
  const rows = [game(1,2),game(1,100),game(2,10)];
  const a = run(rows).genres[0];
  const b = run([...rows].reverse()).genres[0];
  assert.equal(a.eligibleCount,2); assert.equal(a.n,1); assert.equal(a.mean,10);
  assert.equal(a.missingReasonCounts.conflicting_duplicate_values,1);
  assert.deepEqual(a,b);
});
test('one observed duplicate plus an unavailable duplicate preserves value and audit reason', () => {
  const result = run([game(1,0),game(1,{value:null,missingReason:'not_in_fragment'})]).genres[0];
  assert.equal(result.n,1);
  assert.equal(result.mean,0);
  assert.deepEqual(result.values[0].candidateMissingReasons,['not_in_fragment']);
});
test('supplied missing reasons use own-key-safe counting', () => {
  const counts = run([game(1,{value:null,missingReason:'__proto__'}),game(2,{value:null,missingReason:'constructor'}),game(3,{value:null,missingReason:'__proto__'})]).genres[0].missingReasonCounts;
  assert.equal(Object.getOwnPropertyDescriptor(counts,'__proto__').value,2);
  assert.equal(counts.constructor,1);
  assert.equal(Object.getPrototypeOf(counts),Object.prototype);
});
test('unclassified games stay in cohort coverage but do not invent a genre', () => {
  const result = run([game(1,7,[]),game(2,1)]);
  assert.equal(result.cohort.eligibleCount,2);
  assert.deepEqual(result.unclassifiedAppIds,['1']);
  assert.equal(result.genres.length,1);
  assert.equal(result.genres[0].n,1);
});
test('large finite values remain finite through genre aggregation', () => {
  const result = run([game(1,Number.MAX_VALUE),game(2,Number.MAX_VALUE)]).genres[0];
  assert.equal(result.mean,Number.MAX_VALUE);
  assert.equal(result.median,Number.MAX_VALUE);
  assert.equal(result.largestGameShare,0.5);
});
test('extreme hit leaves median descriptive and raises largest-game concentration', () => {
  const result = run(Array.from({length:20},(_,index)=>game(index+1,index === 19 ? 1_000_000 : 1))).genres[0];
  assert.equal(result.median,1);
  assert.equal(result.trimmedMean10,1);
  assert.ok(result.mean > 50_000);
  assert.ok(result.largestGameShare > 0.9999);
  assert.equal(result.sampleStatus,'adequate_sample');
});
test('small-sample status is based on observed unique games, never eligible row count', () => {
  const result = run([...Array.from({length:4},(_,i)=>game(i+1,i)),...Array.from({length:20},(_,i)=>game(i+10,null))]).genres[0];
  assert.equal(result.eligibleCount,24);
  assert.equal(result.n,4);
  assert.equal(result.sampleStatus,'insufficient_sample');
  assert.equal(result.rankable,false);
});
test('invalid options fail closed and review windows cannot masquerade as release cohorts', () => {
  assert.throws(()=>run([],{metric:''}),/metric/);
  assert.throws(()=>run([],{genreUniverse:[null]}),/genreUniverse/);
  assert.throws(()=>run([],{releaseBasis:'latest'}),/basis/);
  assert.throws(()=>run([],{window:resolveReviewWindows({asOf:window.asOf}).reviews7d}),/release_cohort/);
});
test('analysis does not mutate inputs and publishes version and weighting metadata', () => {
  const rows = [game(1,1,['RPG','Action']),game(2,null)];
  const copy = structuredClone(rows);
  const result = run(rows);
  assert.deepEqual(rows,copy);
  assert.equal(result.weighting,'one-equal-weight-per-unique-app-per-genre');
  assert.equal(typeof result.statisticVersion,'string');
  assert.equal(result.multilabel,true);
  assert.equal(Object.hasOwn(result,'popularityScore'),false);
});


test('negative raw numeric and object metrics are missing, while zero remains observed', () => {
  const result = run([game(1,-1),game(2,{value:-10}),game(3,0),game(4,10)]).genres[0];
  assert.equal(result.eligibleCount,4);
  assert.equal(result.observedCount,2);
  assert.equal(result.missingCount,2);
  assert.equal(result.missingReasonCounts.negative_metric,2);
  assert.equal(result.mean,5);
  assert.equal(result.median,5);
  assert.equal(result.largestGameShare,1);
});
