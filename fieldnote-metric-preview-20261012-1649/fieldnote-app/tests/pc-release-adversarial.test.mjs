import test from 'node:test';
import assert from 'node:assert/strict';
import {selectSourcePcDate,PC_RELEASE_POLICY} from '../backend/pc-release-policy.mjs';
const asOf='2026-10-11T19:30:00.000Z';
const row=(id,date,extra={})=>({id,date,platform:{id:6,name:'PC (Microsoft Windows)'},dateFormat:{id:0,format:'YYYYMMDD'},year:Number(date?.slice(0,4)),month:Number(date?.slice(5,7)),status:{id:6,name:'Full Release'},...extra});

test('PC policy chooses earliest exact playable date without relabeling Steam or 1.0',()=>{
 const result=selectSourcePcDate([row(1,'2020-06-01T00:00:00.000Z'),row(2,'2019-01-01T00:00:00.000Z',{status:{id:3,name:'Early Access'}}),row(3,'2010-01-01T00:00:00.000Z',{platform:{id:48,name:'PlayStation 4'}})],asOf);
 assert.equal(PC_RELEASE_POLICY,'igdb-pc-earliest-unambiguous-v2');assert.equal(result.date,'2019-01-01');assert.equal(result.evidenceId,2);assert.match(result.reason,/not_steam_first_playable/);
});

test('earlier coarse month/year/quarter dates or unknown statuses block false exact certainty',()=>{
 const exact=row(1,'2020-06-01T00:00:00.000Z');
 for(const unresolved of [row(2,'2020-12-31T00:00:00.000Z',{dateFormat:{id:2,format:'YYYY'}}),row(2,'2020-06-30T00:00:00.000Z',{dateFormat:{id:1,format:'YYYYMM'}}),row(2,'2020-09-30T00:00:00.000Z',{dateFormat:{id:4,format:'YYYYQ2'}}),row(2,'2019-06-01T00:00:00.000Z',{status:{id:34,name:'Advanced Access'}}),row(2,null,{dateFormat:{id:7,format:'TBD'}})]){
  assert.equal(selectSourcePcDate([exact,unresolved],asOf).date,null);
 }
});

test('known alpha/beta/cancelled metadata does not block a later playable date; future exact dates are excluded',()=>{
 const exact=row(1,'2020-06-01T00:00:00.000Z');
 for(const status of ['Alpha','Beta','Cancelled','Pre-Release'])assert.equal(selectSourcePcDate([exact,row(2,'2019-06-01T00:00:00.000Z',{status:{name:status}})],asOf).date,'2020-06-01');
 assert.equal(selectSourcePcDate([row(1,'2027-01-01T00:00:00.000Z')],asOf).date,null);
 assert.equal(selectSourcePcDate([exact,row(2,'2027-01-01T00:00:00.000Z')],asOf).date,'2020-06-01');
});

test('later coarse metadata cannot replace an earlier unambiguous exact PC date',()=>{
 const actual=selectSourcePcDate([row(1,'2020-01-01T00:00:00.000Z'),row(2,'2020-12-31T00:00:00.000Z',{dateFormat:{id:1,format:'YYYYMM'},month:12})],asOf);
 assert.equal(actual.date,'2020-01-01');assert.equal(actual.precision,'day');
});
