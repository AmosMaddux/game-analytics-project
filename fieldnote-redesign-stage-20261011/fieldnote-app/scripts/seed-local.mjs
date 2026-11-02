import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { appRoot, openDatabase, migrate } from './database.mjs';
import { buildSeedStatements } from '../build/seed.mjs';

export async function seedLocal(db, filename = resolve(appRoot, 'seed/snapshot.json')) {
  const bytes = readFileSync(filename);
  const manifest = JSON.parse(readFileSync(resolve(appRoot, 'seed/manifest.json'), 'utf8'));
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (sha256 !== manifest.sha256) throw new Error('Saved evidence seed does not match its reviewed SHA-256 manifest.');
  const snapshot = JSON.parse(bytes);
  migrate(db);
  if(db.raw.prepare('SELECT COUNT(*) AS count FROM collection_jobs').get().count || db.raw.prepare('SELECT COUNT(*) AS count FROM catalog_admissions').get().count) throw new Error('Existing collection history is protected. Migrate/start this database; seed a new empty path for a separate baseline.');
  const statements = buildSeedStatements(snapshot);
  await db.batch(statements.map(({ sql, values }) => db.prepare(sql).bind(...values)));
  return { games: snapshot.games.length, source: manifest.source, sha256, fixture: false };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(appRoot, 'scripts/seed-local.mjs')) {
  const db = openDatabase(process.env.FIELDNOTE_DB);
  try { console.log(JSON.stringify(await seedLocal(db))); }
  finally { db.close(); }
}
