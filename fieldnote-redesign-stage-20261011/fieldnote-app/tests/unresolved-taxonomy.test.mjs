import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openDatabase, migrate } from '../scripts/database.mjs';
import { buildSeedStatements } from '../backend/seed.ts';
import { readGames, readSnapshot, searchGames } from '../backend/repository.ts';
import { readSources } from '../backend/source-health.ts';
import { rankGenres } from '../src/model.ts';

const source = JSON.parse(readFileSync(new URL('../seed/snapshot.json',import.meta.url),'utf8'));
const now = Date.parse('2026-10-10T20:00:00Z');
const holding = 'Unresolved / needs review';
async function database() {
  const db = openDatabase(':memory:'); migrate(db);
  await db.batch(buildSeedStatements(source).map(row => db.prepare(row.sql).bind(...row.values)));
  return db;
}
function addGame(db,appid,genre,version) {
  const sourceId = source.games[0].appid;
  db.raw.prepare(`INSERT INTO games(appid,source_id,name,steam_name,genre,cohort_id,release_display,store_url,collected_at,position,detail_json)
    SELECT ?,?,?,?,?,cohort_id,release_display,store_url,collected_at,(SELECT MAX(position)+1 FROM games),detail_json FROM games WHERE appid=?`).run(appid,String(appid),`Test-only unresolved ${appid}`,`Test-only unresolved ${appid}`,genre,sourceId);
  db.raw.prepare(`INSERT INTO metric_observations(observation_id,appid,metric,value,evidence_status,freshness,freshness_as_of,measured_at,collected_at,source_url,source_label,source_scope,unit,method_version,source_status,source_freshness,run_id,original_keys_json,detail_json)
    SELECT observation_id || ?,?,metric,value,evidence_status,freshness,freshness_as_of,measured_at,collected_at,source_url,source_label,source_scope,unit,method_version,source_status,source_freshness,run_id,original_keys_json,detail_json FROM metric_observations WHERE appid=?`).run(`-${appid}`,appid,sourceId);
  db.raw.prepare('INSERT INTO catalog_admissions(appid,admitted_at,job_id,taxonomy_version,mapping_json,steam_verified_at,steam_name_source,catalog_stratum) VALUES(?,?,?,?,?,?,?,?)').run(appid,'2026-10-10T19:00:00Z','test-only-admission',version,'{}','2026-10-10T19:00:00Z','https://api.steampowered.com/','test-only');
}

test('unresolved mapping stays browseable but cannot become a genre or ranking baseline', async () => {
  const db = await database();
  try {
    const original = await readSnapshot(db,{includeEvidence:false,now});
    db.raw.prepare('INSERT INTO genres(name,position,taxonomy_version) VALUES(?,?,?)').run(holding,99,'editorial-expanded-1.1');
    addGame(db,90000001,holding,'editorial-expanded-1.1');
    const data = await readSnapshot(db,{includeEvidence:false,now});
    assert.equal(data.games.length,37); assert.deepEqual(data.genres,source.genres);
    assert.equal(data.foundation.catalogSample.unresolvedGames,1); assert.equal(data.foundation.catalogSample.classifiedGames,36);
    assert.equal(data.foundation.catalogSample.taxonomyVersion,'editorial-expanded-1.1');
    assert.deepEqual(data.foundation.catalogSample.taxonomyVersions,['editorial-expanded-1.1']);
    assert.match(data.foundation.catalogSample.baselineNote,/taxonomy corrections/);
    assert.match(data.foundation.catalogSample.baselineNote,/not evidence of a time trend/);
    assert.deepEqual(data.games.filter(game => game.appid !== 90000001),original.games);
    assert.deepEqual(rankGenres(data.games,data.genres),rankGenres(original.games,original.genres));
    const game = (await readGames(db,{appids:[90000001],now}))[0];
    assert.equal(game.genre,holding); assert.equal(game.players.scoreEligible,false); assert.equal(game.players.scoreEligibilityReason,'unresolved_genre_mapping');
    assert.equal((await searchGames(db,'90000001','',10))[0].appid,90000001);
    assert.equal((await searchGames(db,'','',100)).length,37);
    const health = await readSources(db,now);
    assert.equal(health.catalog.totalGames,37); assert.equal(health.catalog.unresolvedGames,1);
    assert.equal(health.catalog.genres.length,7); assert.equal(health.catalog.genresBelowMinimum,7);
    assert.equal(health.catalog.genres.reduce((total,genre) => total + genre.games,0),36);
    assert.ok(!health.catalog.genres.some(row => row.genre === holding));
    assert.deepEqual(health.catalog.taxonomyVersions,['editorial-expanded-1.1']);
    assert.match(health.catalog.classificationNote,/provisional inferences/);
    assert.match(health.catalog.classificationNote,/not evidence of a trend/);
  } finally { db.close(); }
});

test('actual distinct admission versions are reported and corrected mappings restore derived eligibility', async () => {
  const db = await database();
  try {
    db.raw.prepare('INSERT INTO genres(name,position,taxonomy_version) VALUES(?,?,?)').run(holding,99,'editorial-expanded-1.1');
    addGame(db,90000001,holding,'editorial-expanded-1.1');
    addGame(db,90000002,holding,'editorial-expanded-1.2');
    const data = await readSnapshot(db,{now});
    assert.equal(data.foundation.catalogSample.taxonomyVersion,'mixed');
    assert.deepEqual(data.foundation.catalogSample.taxonomyVersions,['editorial-expanded-1.1','editorial-expanded-1.2']);
    const health = await readSources(db,now); assert.equal(health.catalog.unresolvedGames,2);
    assert.deepEqual(health.catalog.taxonomyVersions,['editorial-expanded-1.1','editorial-expanded-1.2']);
    db.raw.prepare('UPDATE games SET genre=? WHERE appid=?').run(source.games[0].genre,90000001);
    const corrected = (await readGames(db,{appids:[90000001],now}))[0];
    assert.equal(corrected.players.scoreEligible,true); assert.equal(corrected.players.scoreEligibilityReason,undefined);
    assert.equal((await readSources(db,now)).catalog.unresolvedGames,1);
  } finally { db.close(); }
});
