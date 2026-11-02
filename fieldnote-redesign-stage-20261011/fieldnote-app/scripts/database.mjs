import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const appRoot = fileURLToPath(new URL('..', import.meta.url));
export const defaultDatabasePath = resolve(appRoot, '.data/fieldnote.sqlite');

/** Real on-disk SQLite implementing the deliberately small D1 binding contract. */
export function openDatabase(filename = defaultDatabasePath) {
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
  const raw = new DatabaseSync(filename);
  raw.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  const prepare = (sql, bound = []) => ({
    bind(...values) { return prepare(sql, values); },
    async all() {
      return { success: true, results: raw.prepare(sql).all(...bound).map(row => ({ ...row })), meta: {} };
    },
    async first(column) {
      const row = raw.prepare(sql).get(...bound);
      return row ? (column === undefined ? { ...row } : row[column]) : null;
    },
    async run() {
      const result = raw.prepare(sql).run(...bound);
      return { success: true, results: [], meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
    },
    _sql: sql,
    _values: bound,
  });
  return {
    raw,
    prepare,
    async exec(sql) { raw.exec(sql); return { count: 1, duration: 0 }; },
    async batch(statements) {
      raw.exec('BEGIN IMMEDIATE');
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        raw.exec('COMMIT');
        return results;
      } catch (error) {
        raw.exec('ROLLBACK');
        throw error;
      }
    },
    close() { raw.close(); },
  };
}

export function migrate(db) {
  const directory = resolve(appRoot, 'migrations');
  db.raw.exec('CREATE TABLE IF NOT EXISTS local_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  const applied = [];
  for (const filename of readdirSync(directory).filter(name => /^\d+_[a-z0-9_-]+\.sql$/.test(name)).sort()) {
    if (db.raw.prepare('SELECT name FROM local_migrations WHERE name = ?').get(filename)) continue;
    const sql = readFileSync(resolve(directory, filename), 'utf8');
    db.raw.exec('BEGIN IMMEDIATE');
    try {
      db.raw.exec(sql);
      db.raw.prepare('INSERT INTO local_migrations(name, applied_at) VALUES (?, ?)').run(filename, new Date().toISOString());
      db.raw.exec('COMMIT');
      applied.push(filename);
    } catch (error) {
      db.raw.exec('ROLLBACK');
      throw error;
    }
  }
  return applied;
}
