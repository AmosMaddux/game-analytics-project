import type { D1Database } from './db.ts';
import type { RecordValue } from './records.ts';

export async function readSettings(db: D1Database) {
  const row = await db.prepare('SELECT * FROM ui_settings WHERE id = 1').first<RecordValue>();
  if (!row) throw new Error('Database settings have not been initialized');
  return {
    preferences:{monthlyBudgetUsd:row.monthly_budget_usd,compactTables:!!row.compact_tables,showEvidenceDetails:!!row.show_evidence_details,updatedAt:row.updated_at},
    usage:{status:'unknown',billedUsd:null,measuredAt:null,note:'Billing is not connected. This planning value does not enforce or authorize spending.'},
    providers:[
      {id:'steam',label:'Steam',status:'unavailable',connected:false,note:'Saved evidence is available. This web app cannot refresh Steam. Bounded local metric commands are separate; new Steam tag acquisition remains gated.'},
      {id:'igdb',label:'IGDB',status:'unavailable',connected:false,note:'Saved exact-AppID catalog records are available. User-invoked local collection requires its source-use, authentication and retention gates; this web app cannot invoke it.'},
      {id:'openai',label:'OpenAI research chat',status:'unavailable',connected:false,note:'No model, credentials, source-processing approval or measured usage is connected.'},
      {id:'youtube',label:'YouTube analytics',status:'unavailable',connected:false,note:'Disabled pending API access and approval for the exact analytics use.'},
      {id:'cloudflare',label:'Cloudflare production hosting',status:'unavailable',connected:false,note:'Workers-compatible backend and local SQLite foundation only. No production deployment or billing feed.'},
    ],
    mode:'offline_preserved_evidence',persistence:'sqlite',
  };
}
export function validateSettingsPatch(value: unknown): RecordValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a settings object');
  const record = value as RecordValue;
  const allowed = ['monthlyBudgetUsd','compactTables','showEvidenceDetails'];
  if (!Object.keys(record).length || Object.keys(record).some(key => !allowed.includes(key))) throw new Error('Only monthlyBudgetUsd, compactTables and showEvidenceDetails can be changed');
  if ('monthlyBudgetUsd' in record && (typeof record.monthlyBudgetUsd !== 'number' || !Number.isFinite(record.monthlyBudgetUsd) || record.monthlyBudgetUsd < 0 || record.monthlyBudgetUsd > 30)) throw new Error('Monthly planning budget must be a number from 0 to 30 USD');
  for (const key of ['compactTables','showEvidenceDetails']) if (key in record && typeof record[key] !== 'boolean') throw new Error(`${key} must be a boolean`);
  return record;
}
export async function updateSettings(db: D1Database, patch: RecordValue) {
  const columns: Record<string,string> = {monthlyBudgetUsd:'monthly_budget_usd',compactTables:'compact_tables',showEvidenceDetails:'show_evidence_details'};
  const keys = Object.keys(patch);
  await db.prepare(`UPDATE ui_settings SET ${keys.map(key => `${columns[key]} = ?`).join(', ')}, updated_at = ? WHERE id = 1`).bind(...keys.map(key => typeof patch[key] === 'boolean' ? Number(patch[key]) : patch[key]),new Date().toISOString()).run();
  return readSettings(db);
}
