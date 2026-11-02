import { openDatabase, migrate } from './database.mjs';
const db = openDatabase(process.env.FIELDNOTE_DB);
try { console.log(JSON.stringify({ migrationsApplied: migrate(db) })); }
finally { db.close(); }
