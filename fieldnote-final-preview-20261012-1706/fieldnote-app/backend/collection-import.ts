import { buildSeedStatements } from './seed.ts';
import type { RecordValue } from './records.ts';
export { readGames } from './repository.ts';

/** Reuse M2's complete identity and evidence validator without invoking reseed. */
export function admissionStatements(game: RecordValue, position: number) {
  const rows=buildSeedStatements({meta:{mode:'offline_preserved_evidence',builtAt:game.catalog.fetchedAt,cohorts:[{id:game.cohort,label:'M3 bounded discovery sample',count:1}]},genres:[game.genre],games:[game]});
  return rows.filter(row=>/^INSERT INTO (?:games|steam_tags|metric_observations|catalog_\w+|identity_crosswalks|marketing_\w+) /.test(row.sql)).map(row=>{
    if(row.sql.startsWith('INSERT INTO games ')){
      const columns=/\(([^)]+)\)/.exec(row.sql)![1].split(',');
      row.values[columns.indexOf('position')]=position;
    }
    return row;
  });
}
