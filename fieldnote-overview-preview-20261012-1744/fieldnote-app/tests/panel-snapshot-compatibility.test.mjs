import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase,migrate} from '../scripts/database.mjs';
import {seedLocal} from '../scripts/seed-local.mjs';
import {readSnapshot} from '../backend/repository.ts';
import {readCategoryEvidence} from '../backend/research-categories.ts';
const asOf='2026-10-12T18:00:00.000Z';
test('snapshot panel summary is derived from saved membership and visible raw labels without rewriting the baseline',async t=>{
 const db=openDatabase(':memory:');t.after(()=>db.close());migrate(db);await seedLocal(db);
 const baseline=await readSnapshot(db,{now:Date.parse(asOf)});assert.equal(baseline.meta.researchPanelSummary,undefined);
 const ids=baseline.games.slice(0,2).map(g=>g.appid),before=db.raw.prepare('SELECT * FROM games').all();
 db.raw.prepare('INSERT INTO research_panels VALUES(?,?,?,?,?,?,?)').run('test-panel','Fixture','test',asOf,asOf,'0'.repeat(64),'{}');
 for(const id of ids)db.raw.prepare('INSERT INTO research_panel_memberships VALUES(?,?,?,?,?)').run('test-panel',id,'controls','Fixture','{}');
 const after=await readSnapshot(db,{now:Date.parse(asOf)}),labels=await readCategoryEvidence(db,'igdb_genre',asOf);
 assert.deepEqual(after.meta.researchPanelSummary,{selectedCount:2,igdbGenreCount:new Set(labels.filter(r=>ids.includes(r.appid)).map(r=>r.name)).size,legacyEditorialCount:2,asOf});
 assert.deepEqual(after.genres,baseline.genres);assert.deepEqual(db.raw.prepare('SELECT * FROM games').all(),before);
 const earlier=await readSnapshot(db,{now:Date.parse(asOf)-1});assert.equal(earlier.meta.researchPanelSummary,undefined);
});
