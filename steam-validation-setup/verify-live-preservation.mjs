// Offline Node 24 acceptance helper. Reads no environment variables or credentials.
// Usage: node qa/verify-live-preservation.mjs --baseline .data/m2-before-m3-20261010.sqlite --current .data/fieldnote.sqlite --output m3-preservation-verification.json
// Database connections are read-only; the optional report is exclusive-create.
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { lstatSync, realpathSync, openSync, writeFileSync, closeSync, constants } from 'node:fs';
import { resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const EXACT_TABLES = Object.freeze(['foundation_schema', 'snapshot_metadata', 'genres', 'cohorts', 'games', 'steam_tags',
  'metric_observations', 'catalog_games', 'identity_crosswalks', 'catalog_platforms', 'catalog_company_roles',
  'catalog_labels', 'catalog_links', 'catalog_releases', 'catalog_field_provenance', 'catalog_conflicts',
  'marketing_profiles', 'marketing_events', 'ui_settings', 'review_windows']);
const REQUIRED_EXACT = Object.freeze(['genres', 'cohorts', 'steam_tags', 'metric_observations',
  'marketing_profiles', 'marketing_events', 'ui_settings', 'review_windows']);
const MAX_ROWS = 250_000;
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const quote = value => '"' + value.replaceAll('"', '""') + '"';
const failure = code => { const error = new Error(code); error.safeCode = code; throw error; };

function inputPath(filename) {
  if (typeof filename !== 'string' || !filename || filename.includes('\0')) failure('invalid_database_path');
  const path = resolve(filename);
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 256 * 1024 * 1024 || realpathSync(path) !== path) failure('unsafe_database_path');
  return { path, stat };
}
function columns(db, table) {
  const result = db.prepare(`PRAGMA table_info(${quote(table)})`).all();
  if (!result.length || result.some(row => !/^[a-zA-Z0-9_]+$/.test(row.name))) failure('unsupported_database_schema');
  return result;
}
function count(db, table) {
  const total = db.prepare(`SELECT COUNT(*) AS n FROM ${quote(table)}`).get().n;
  if (!Number.isSafeInteger(total) || total < 0 || total > MAX_ROWS) failure('verification_row_limit');
  return total;
}

function compareRows(baseline, current, table, selectedColumns = null) {
  const schema = columns(baseline, table), currentColumns = new Set(columns(current, table).map(row => row.name));
  const fields = selectedColumns ?? schema.map(row => row.name);
  if (fields.some(field => !schema.some(row => row.name === field) || !currentColumns.has(field))) failure('incompatible_database_schema');
  const keys = schema.filter(row => row.pk).sort((a, b) => a.pk - b.pk).map(row => row.name);
  if (!keys.length || keys.some(key => !fields.includes(key))) failure('unsupported_primary_key');
  const baselineRows = count(baseline, table), currentRows = count(current, table);
  const sql = `SELECT ${fields.map(quote).join(',')} FROM ${quote(table)} ORDER BY ${keys.map(quote).join(',')}`;
  const original = baseline.prepare(sql).all(), now = current.prepare(sql).all();
  const rowKey = row => JSON.stringify(keys.map(key => row[key]));
  const rowValue = row => fields.map(field => row[field]);
  const currentByKey = new Map(now.map(row => [rowKey(row), row]));
  const baselineValues = [], currentValues = [];
  let missingOriginalRows = 0, changedOriginalRows = 0;
  for (const row of original) {
    const saved = rowValue(row), found = currentByKey.get(rowKey(row));
    baselineValues.push(saved);
    currentValues.push(found ? rowValue(found) : null);
    if (!found) missingOriginalRows++;
    else if (JSON.stringify(saved) !== JSON.stringify(rowValue(found))) changedOriginalRows++;
  }
  return { baselineRows, currentRows, unchangedOriginalRows: baselineRows - missingOriginalRows - changedOriginalRows,
    missingOriginalRows, changedOriginalRows, additionalRows: currentRows - (baselineRows - missingOriginalRows),
    preserved: missingOriginalRows === 0 && changedOriginalRows === 0,
    baselineSha256: hash({ fields, rows: baselineValues }), matchedCurrentSha256: hash({ fields, rows: currentValues }) };
}

export function verifyPreservation(baselineFilename, currentFilename) {
  const oldFile = inputPath(baselineFilename), newFile = inputPath(currentFilename);
  if (oldFile.stat.dev === newFile.stat.dev && oldFile.stat.ino === newFile.stat.ino) failure('distinct_databases_required');
  const baseline = new DatabaseSync(oldFile.path, { readOnly: true });
  let current;
  try {
    current = new DatabaseSync(newFile.path, { readOnly: true });
    for (const db of [baseline, current]) db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=5000; BEGIN;');
    const exactRows = Object.fromEntries(EXACT_TABLES.map(table => [table, compareRows(baseline, current, table)]));
    const identities = {
      games: compareRows(baseline, current, 'games', ['appid', 'source_id', 'genre', 'cohort_id', 'store_url', 'position']),
      catalog: compareRows(baseline, current, 'catalog_games', ['appid', 'igdb_id']),
      crosswalks: compareRows(baseline, current, 'identity_crosswalks', ['appid', 'position', 'igdb_id', 'steam_uid', 'external_source_id', 'source_name']),
    };
    const foreignKeyViolations = current.prepare('PRAGMA foreign_key_check').all().length;
    const duplicateObservationKeys = current.prepare('SELECT COUNT(*) AS n FROM (SELECT appid,metric,run_id,COUNT(*) AS n FROM metric_observations GROUP BY appid,metric,run_id HAVING COUNT(*)>1)').get().n;
    const identityPreserved = Object.values(identities).every(row => row.preserved);
    const expectedBaseline = exactRows.games.baselineRows === 36 && exactRows.metric_observations.baselineRows === 108;
    const requiredEvidencePreserved = REQUIRED_EXACT.every(table => exactRows[table].preserved);
    const checks = { expectedBaseline36Games108Observations: expectedBaseline, originalIdentitiesAndEditorialGroups: identityPreserved,
      originalSteamTags: exactRows.steam_tags.preserved, originalMarketing: exactRows.marketing_profiles.preserved && exactRows.marketing_events.preserved,
      originalSettings: exactRows.ui_settings.preserved, originalObservations: exactRows.metric_observations.preserved,
      originalReviewWindows: exactRows.review_windows.preserved, originalGenresAndCohorts: exactRows.genres.preserved && exactRows.cohorts.preserved,
      allOriginalM2RowsExactlyRetained: Object.values(exactRows).every(row => row.preserved), foreignKeysClean: foreignKeyViolations === 0,
      noDuplicateObservationKeys: duplicateObservationKeys === 0 };
    const preservedFieldHashes = { identities: Object.fromEntries(Object.entries(identities).map(([name, row]) => [name, row.baselineSha256])),
      evidence: Object.fromEntries(REQUIRED_EXACT.map(table => [table, exactRows[table].baselineSha256])) };
    return { verifiedAt: new Date().toISOString(), methodVersion: 'm2-to-m3-preservation-1.0', databaseAccess: 'read_only_consistent_snapshots',
      pass: expectedBaseline && identityPreserved && requiredEvidencePreserved && foreignKeyViolations === 0 && duplicateObservationKeys === 0,
      counts: { originalGames: exactRows.games.baselineRows, currentGames: exactRows.games.currentRows,
        originalObservations: exactRows.metric_observations.baselineRows, retainedOriginalObservations: exactRows.metric_observations.unchangedOriginalRows,
        currentObservations: exactRows.metric_observations.currentRows, additionalObservations: exactRows.metric_observations.additionalRows,
        foreignKeyViolations, duplicateObservationKeys }, checks, preservedFieldsSha256: hash(preservedFieldHashes), identities, exactRows,
      note: 'Additional games and observations are allowed. Refreshable catalog metadata and global snapshot metadata have separate exact-row diagnostics; legitimate metadata changes do not fail the required preservation gate. No row contents, paths, credentials or environment values are emitted.' };
  } finally {
    if (current) current.close();
    baseline.close();
  }
}

export function saveReport(filename, report) {
  if (typeof filename !== 'string' || extname(filename) !== '.json') failure('invalid_report_path');
  const path = resolve(filename), parent = dirname(path);
  if (realpathSync(parent) !== parent || !lstatSync(parent).isDirectory()) failure('unsafe_report_directory');
  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { writeFileSync(fd, JSON.stringify(report, null, 2) + '\n'); } finally { closeSync(fd); }
}

function main(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    if (!['--baseline', '--current', '--output'].includes(key) || parsed[key] || !args[index + 1] || args[index + 1].startsWith('--')) failure('invalid_arguments');
    parsed[key] = args[index + 1];
  }
  if (!parsed['--baseline'] || !parsed['--current']) failure('explicit_database_paths_required');
  const report = verifyPreservation(parsed['--baseline'], parsed['--current']);
  if (parsed['--output']) saveReport(parsed['--output'], report);
  console.log(JSON.stringify({ status: report.pass ? 'pass' : 'review_required', ...report.counts, checks: report.checks,
    preservedFieldsSha256: report.preservedFieldsSha256, reportSaved: Boolean(parsed['--output']) }));
  return report.pass ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = main(process.argv.slice(2)); }
  catch (error) { console.error(JSON.stringify({ status: 'stopped', errorCode: error.safeCode ?? 'preservation_verification_failed' })); process.exitCode = 2; }
}
