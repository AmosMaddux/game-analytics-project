import { createHash } from 'node:crypto';
import { DatabaseSync, backup } from 'node:sqlite';
import { closeSync, openSync, readFileSync, realpathSync, statSync, unlinkSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EVIDENCE_POLICY_VERSION, FIRST_PLAYABLE_POLICY, SOURCES } from './release-evidence-policy.mjs';

export const MANIFEST_VERSION = 'fieldnote-release-evidence-v1';
export const IMPORTER_VERSION = 'offline-copy-only-v1';
const MAX_BYTES = 1024 * 1024;
const TYPE_TABLE = 'research_application_evidence';
const RELEASE_TABLE = 'research_release_evidence';
const MANIFEST_TABLE = 'research_evidence_imports';
const ASSERTION_TABLE = 'research_evidence_assertions';
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const requireThat = (condition, message) => { if (!condition) throw new Error(message); };
const nonempty = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 8192;
const identifier = value => typeof value === 'string' && /^[a-z0-9][a-z0-9._-]{0,119}$/.test(value);
export const canonicalJson = value => JSON.stringify(value, (_, item) => record(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
export const contentHash = value => createHash('sha256').update(canonicalJson(value)).digest('hex');
export function sealManifest(manifest) { const { contentSha256: ignored, ...content } = manifest; return { ...content, contentSha256: contentHash(content) }; }
function keys(value, required, optional = []) {
  requireThat(record(value), 'Expected an object');
  requireThat(required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => [...required, ...optional].includes(key)), `Unexpected or missing fields: expected ${required.join(', ')}`);
}
function utc(value) {
  requireThat(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value), 'Retrieval/review times must be strict UTC instants');
  requireThat(Number(value.slice(0,4)) >= 1, 'Gregorian year must be 0001–9999');
  const ms = Date.parse(value);
  requireThat(Number.isFinite(ms) && new Date(ms).toISOString() === (value.includes('.') ? value : value.replace('Z', '.000Z')), 'Invalid Gregorian UTC instant');
  return ms;
}
function dateValue(value, precision) {
  requireThat(['day','month','year','unknown'].includes(precision), 'Invalid date precision');
  if (precision === 'unknown') { requireThat(value === null, 'Unknown precision requires null date'); return; }
  const pattern = precision === 'day' ? /^\d{4}-\d{2}-\d{2}$/ : precision === 'month' ? /^\d{4}-\d{2}$/ : /^\d{4}$/;
  requireThat(typeof value === 'string' && pattern.test(value), 'Date does not match precision');
  requireThat(Number(value.slice(0,4)) >= 1, 'Gregorian year must be 0001–9999');
  const day = value + (precision === 'month' ? '-01' : precision === 'year' ? '-01-01' : '');
  const ms = Date.parse(`${day}T00:00:00.000Z`);
  requireThat(Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === day, 'Invalid Gregorian day');
}
function validSource(observation) {
  const source = SOURCES[observation.sourceId];
  requireThat(source && source.appid === observation.appid && source.kind === observation.sourceKind && source.url === observation.sourceUrl, 'Unreviewed source, wrong host/path/AppID, or source kind');
  const url = new URL(observation.sourceUrl);
  requireThat(url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.hash, 'Source must be credential-free reviewed HTTPS');
  if (source.kind === 'steam_store') requireThat(url.hostname === 'store.steampowered.com' && url.pathname.startsWith(`/app/${observation.appid}/`), 'Steam AppID mismatch');
  requireThat(source.roles.includes(observation.role), 'Source role is not reviewed');
}
const retrievedEnd = observation => observation.retrieved.end;
function matchingDate(observation, assertion) { return observation.date === assertion.date && observation.precision === assertion.precision; }
function validateAccepted(assertion, support) {
  if (assertion.kind === 'application_type') {
    requireThat(assertion.appType === 'game' && assertion.method === 'steam_store_base_game_manual_review_v1' && assertion.confidence === 'high_reviewed_classification', 'Unknown/reconstructed types cannot be accepted; explicit manual game classification required');
    requireThat(support.some(o => o.role === 'manual_base_game_review' && o.sourceKind === 'steam_store' && o.classification?.ownNamedPurchaseOffer === true && o.classification?.gameplayDescription === true && o.classification?.otherProductsDistinguished === true), 'Missing positive reviewed standalone-game evidence');
    return;
  }
  requireThat(assertion.confidence === 'reviewed_primary_corroborated', 'Accepted releases need reviewed primary confidence');
  requireThat(assertion.store === 'steam' && assertion.platform === 'pc' && assertion.status === 'released' && assertion.precision === 'day', 'Accepted release needs released, exact-day Steam PC evidence');
  if (assertion.method === 'steam_ea_same_app_first_playable_v1') {
    requireThat(assertion.basis === 'first_playable' && assertion.phase === 'early_access' && assertion.firstPlayablePolicy === FIRST_PLAYABLE_POLICY, 'EA first-playable interpretation must be explicit');
    requireThat(support.some(o => o.role === 'steam_ea_date' && o.status === 'released' && matchingDate(o, assertion)), 'Missing explicit same-AppID Steam EA date');
    requireThat(support.some(o => o.role === 'current_state' && ['released','early_access'].includes(o.state)), 'Missing observed playability');
  } else if (assertion.method === 'steam_full_release_corroborated_v1') {
    requireThat(assertion.basis === 'full_release' && assertion.phase === 'full_release' && assertion.firstPlayablePolicy === null, 'Full release is a separate basis');
    requireThat(support.some(o => o.role === 'steam_display_date' && matchingDate(o, assertion)), 'Missing corroborating Steam event date');
    requireThat(support.some(o => o.role === 'full_release_available' && o.status === 'released'), 'Generic, planned, publication or IGDB dates do not prove actual Steam 1.0');
  } else throw new Error('Unreviewed acceptance method');
  requireThat(support.every(o => Date.parse(`${assertion.date}T00:00:00Z`) <= utc(retrievedEnd(o))), 'Released event cannot be after its supporting retrieval');
}

/** Pure validation. Does not fetch pages, read credentials or mutate a database. */
export function validateManifest(manifest, { now = new Date().toISOString() } = {}) {
  keys(manifest, ['schemaVersion','manifestId','contentSha256','policyVersion','review','scope','limitations','observations','assertions']);
  requireThat(manifest.schemaVersion === MANIFEST_VERSION && manifest.policyVersion === EVIDENCE_POLICY_VERSION, 'Unsupported manifest/policy version');
  requireThat(identifier(manifest.manifestId), 'Invalid manifest ID');
  requireThat(manifest.contentSha256 === sealManifest(manifest).contentSha256, 'Manifest content hash mismatch');
  requireThat(Buffer.byteLength(canonicalJson(manifest)) <= MAX_BYTES, 'Manifest exceeds 1 MiB');
  const nowMs = utc(now);
  keys(manifest.review, ['reviewer','reviewedAt','status','basis']);
  requireThat(nonempty(manifest.review.reviewer) && nonempty(manifest.review.basis) && manifest.review.status === 'offline_candidate_not_live_approved', 'Offline review scope must be explicit');
  const reviewedMs = utc(manifest.review.reviewedAt);
  requireThat(reviewedMs <= nowMs, 'Review cannot be in the future');
  keys(manifest.scope, ['appids','selection','reconstructedTypeCandidates','reconstructedTypeDisposition']);
  requireThat(Array.isArray(manifest.scope.appids) && manifest.scope.appids.length > 0 && manifest.scope.appids.length <= 5 && new Set(manifest.scope.appids).size === manifest.scope.appids.length && manifest.scope.appids.every(id => Number.isSafeInteger(id) && id > 0), 'Pilot requires 1–5 unique existing AppIDs');
  requireThat(nonempty(manifest.scope.selection) && Number.isSafeInteger(manifest.scope.reconstructedTypeCandidates) && manifest.scope.reconstructedTypeCandidates >= 0 && manifest.scope.reconstructedTypeDisposition === 'pending_not_verified', 'Reconstructed types must remain pending');
  requireThat(Array.isArray(manifest.limitations) && manifest.limitations.length >= 2 && manifest.limitations.every(nonempty), 'Selection and evidence limitations are required');
  requireThat(Array.isArray(manifest.observations) && manifest.observations.length <= 100 && Array.isArray(manifest.assertions) && manifest.assertions.length > 0 && manifest.assertions.length <= 50, 'Invalid or oversized assertion/observation list');
  const observations = new Map();
  for (const observation of manifest.observations) {
    keys(observation, ['observationId','appid','sourceId','sourceUrl','sourceKind','role','originalLabel','originalValue','date','precision','status','state','store','platform','retrieved','publicationDate','capture'], ['classification']);
    requireThat(identifier(observation.observationId) && !observations.has(observation.observationId), 'Duplicate/invalid observation ID');
    requireThat(manifest.scope.appids.includes(observation.appid), 'Observation AppID outside pilot');
    requireThat(nonempty(observation.originalLabel) && nonempty(observation.originalValue), 'Preserve original source label/value');
    validSource(observation); dateValue(observation.date, observation.precision);
    if (observation.role === 'manual_base_game_review') {
      keys(observation.classification, ['title','developer','ownNamedPurchaseOffer','gameplayDescription','otherProductsDistinguished','rationale']);
      requireThat(nonempty(observation.classification.title) && nonempty(observation.classification.developer) && nonempty(observation.classification.rationale), 'Manual classification needs positive identity and rationale');
      requireThat(['ownNamedPurchaseOffer','gameplayDescription','otherProductsDistinguished'].every(key => observation.classification[key] === true), 'Manual classification requires all positive checks');
    } else requireThat(!Object.hasOwn(observation, 'classification'), 'Classification requires the separately reviewed source role');
    requireThat(['released','planned','unknown'].includes(observation.status) && ['released','early_access','unknown'].includes(observation.state), 'Invalid observation status/state');
    requireThat(['steam','unspecified'].includes(observation.store) && ['pc','unspecified'].includes(observation.platform), 'Invalid observation scope');
    if (observation.sourceKind === 'steam_store') requireThat(observation.store === 'steam' && observation.platform === 'pc', 'Steam source scope mismatch');
    if (observation.role === 'planned_full_release') requireThat(observation.status === 'planned', 'Plan must retain planned status');
    if (['steam_ea_date','full_release_available','ea_available'].includes(observation.role)) requireThat(observation.status === 'released', 'Historical availability requires released status');
    keys(observation.retrieved, ['start','end','precision']);
    const start = utc(observation.retrieved.start), end = utc(observation.retrieved.end);
    requireThat(['instant','interval'].includes(observation.retrieved.precision) && start <= end && end <= reviewedMs && (observation.retrieved.precision !== 'instant' || start === end), 'Invalid/future retrieval interval');
    if (observation.publicationDate !== null) dateValue(observation.publicationDate, 'day');
    keys(observation.capture, ['method','originHttpStatus','responseSha256']);
    requireThat(observation.capture.method === 'reviewed_web_tool_text' && observation.capture.originHttpStatus === null && observation.capture.responseSha256 === null, 'Do not invent HTTP status, raw captures or response hashes');
    observations.set(observation.observationId, observation);
  }
  const ids = new Set(), facts = new Set();
  for (const assertion of manifest.assertions) {
    keys(assertion, ['assertionId','appid','kind','disposition','method','confidence','supportingObservationIds','note'], assertion.kind === 'release' ? ['basis','date','precision','status','phase','store','platform','firstPlayablePolicy'] : ['appType']);
    requireThat(identifier(assertion.assertionId) && !ids.has(assertion.assertionId), 'Duplicate/invalid assertion ID'); ids.add(assertion.assertionId);
    requireThat(manifest.scope.appids.includes(assertion.appid) && ['release','application_type'].includes(assertion.kind) && ['accepted','pending'].includes(assertion.disposition), 'Invalid assertion kind/disposition/AppID');
    requireThat(nonempty(assertion.note) && identifier(assertion.method) && ['reviewed_primary_corroborated','high_reviewed_classification','corroborated_derived','unresolved'].includes(assertion.confidence), 'Missing method/confidence/note');
    requireThat(Array.isArray(assertion.supportingObservationIds) && new Set(assertion.supportingObservationIds).size === assertion.supportingObservationIds.length, 'Duplicate/invalid supporting IDs');
    const support = assertion.supportingObservationIds.map(id => observations.get(id));
    requireThat(support.every(o => o && o.appid === assertion.appid), 'Missing/cross-AppID supporting observation');
    if (assertion.kind === 'release') {
      requireThat(['first_playable','full_release'].includes(assertion.basis) && ['released','planned','unknown'].includes(assertion.status) && ['early_access','full_release',null].includes(assertion.phase), 'Invalid release basis/status/phase');
      requireThat(['steam','unspecified'].includes(assertion.store) && ['pc','unspecified'].includes(assertion.platform), 'Invalid assertion scope');
      requireThat(assertion.firstPlayablePolicy === null || assertion.firstPlayablePolicy === FIRST_PLAYABLE_POLICY, 'Unknown first-playable policy');
      requireThat(assertion.basis !== 'full_release' || assertion.phase !== 'early_access', 'Early Access cannot be full release');
      dateValue(assertion.date, assertion.precision);
    } else requireThat(['game','demo','dlc','soundtrack','tool','unknown'].includes(assertion.appType), 'Invalid application type');
    if (assertion.disposition === 'accepted') {
      requireThat(support.length > 0, 'Accepted claim requires source support');
      validateAccepted(assertion, support);
      const fact = factKey(assertion);
      requireThat(!facts.has(fact), 'Duplicate accepted fact under different IDs'); facts.add(fact);
    } else requireThat(!['reviewed_primary_corroborated','high_reviewed_classification'].includes(assertion.confidence), 'Pending assertions must not claim accepted confidence');
  }
  return { manifest, observations };
}
function factKey(a) { return canonicalJson(a.kind === 'application_type' ? [a.appid,a.kind,a.appType] : [a.appid,a.kind,a.basis,a.date,a.precision,a.status,a.phase]); }
function rowFor(assertion, observations, manifest) {
  const support = assertion.supportingObservationIds.map(id => observations.get(id));
  const primary = support.find(o => o.role === (assertion.kind === 'application_type' ? 'manual_base_game_review' : assertion.basis === 'first_playable' ? 'steam_ea_date' : 'steam_display_date'));
  const retrieved = support.map(retrievedEnd).sort((a,b) => Date.parse(a) - Date.parse(b)).at(-1);
  if (assertion.kind === 'application_type') return { evidence_id: `reviewed-${assertion.assertionId}`, appid: assertion.appid, app_type: assertion.appType, verified: 1, source_url: primary.sourceUrl, retrieved_at: retrieved,
    verification_note: canonicalJson({ policy: manifest.policyVersion, assertionId: assertion.assertionId, method: assertion.method, confidence: assertion.confidence, note: assertion.note, classification: primary.classification, sourceObservation: { id: primary.observationId, url: primary.sourceUrl, retrieved: primary.retrieved }, reviewedAt: manifest.review.reviewedAt, observationTimeRule: 'latest reviewer acquisition interval end of cached/retrieved web-tool text; no origin-response timestamp', rawSteamAppTypeRetained: false }) };
  return { evidence_id: `reviewed-${assertion.assertionId}`, appid: assertion.appid, release_basis: assertion.basis, release_date: assertion.date, date_precision: assertion.precision, verified: 1, release_status: assertion.status, phase: assertion.phase, source_url: primary.sourceUrl, retrieved_at: retrieved,
    verification_note: canonicalJson({ policy: manifest.policyVersion, assertionId: assertion.assertionId, method: assertion.method, confidence: assertion.confidence, firstPlayablePolicy: assertion.firstPlayablePolicy, note: assertion.note, supportingObservations: support.map(o => ({ id: o.observationId, role: o.role, url: o.sourceUrl, retrieved: o.retrieved, publicationDate: o.publicationDate })), observationTimeRule: 'latest supporting retrieval interval end; not an invented exact fetch time' }) };
}
const rows = (db, name) => db.prepare(`SELECT * FROM "${name.replaceAll('"','""')}"`).all();
const tableExists = (db, name) => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
function validateDb(db) {
  for (const name of ['games', TYPE_TABLE, RELEASE_TABLE]) requireThat(tableExists(db, name), `Missing schema 0004 table: ${name}. Migrate a separate copy first.`);
  requireThat(db.prepare('PRAGMA integrity_check').get().integrity_check === 'ok' && db.prepare('PRAGMA foreign_key_check').all().length === 0, 'Database integrity/foreign-key check failed');
}
function conflictCheck(types, releases, incoming, appids) {
  for (const appid of appids) {
    const acceptedTypes = types.filter(row => row.appid === appid && row.verified === 1);
    requireThat(!acceptedTypes.some(row => row.app_type === 'unknown'), `Verified unknown type poison for ${appid}; explicit reconciliation required`);
    requireThat(new Set(acceptedTypes.map(row => row.app_type)).size <= 1, `Conflicting application type for ${appid}`);
    const candidates = releases.filter(row => row.appid === appid);
    for (const basis of ['first_playable','full_release']) {
      const group = candidates.filter(row => row.release_basis === basis);
      const valid = group.filter(row => row.verified === 1 && row.release_status === 'released');
      requireThat(!valid.length || !group.some(row => row.release_status === 'planned'), `Stale planned/released status conflict for ${appid}/${basis}; no automatic supersession`);
      for (const row of valid) { dateValue(row.release_date, row.date_precision); requireThat(row.date_precision === 'day', `Existing verified imprecise evidence for ${appid}`); }
      requireThat(new Set(valid.map(row => row.release_date)).size <= 1, `Conflicting release dates for ${appid}/${basis}`);
    }
    const first = candidates.filter(row => row.verified === 1 && row.release_status === 'released' && row.release_basis === 'first_playable');
    const full = candidates.filter(row => row.verified === 1 && row.release_status === 'released' && row.release_basis === 'full_release');
    requireThat(!first.some(f => full.some(r => r.release_date < f.release_date)), `Conflicting release chronology for ${appid}`);
  }
  for (const row of incoming) utc(row.retrieved_at);
}

/** Plan union of existing + incoming evidence, including hostile legacy rows. */
export function planImport(db, manifest, options = {}) {
  const { observations } = validateManifest(manifest, options); validateDb(db);
  for (const appid of manifest.scope.appids) requireThat(db.prepare('SELECT 1 FROM games WHERE appid=?').get(appid), `Unknown existing AppID: ${appid}`);
  const previous = tableExists(db, MANIFEST_TABLE) ? db.prepare(`SELECT * FROM ${MANIFEST_TABLE} WHERE manifest_id=?`).get(manifest.manifestId) : null;
  requireThat(!previous || (previous.content_sha256 === manifest.contentSha256 && previous.manifest_json === canonicalJson(manifest) && previous.policy_version === manifest.policyVersion && previous.importer_version === IMPORTER_VERSION), 'Changed content under existing manifest ID');
  const existing = rows(db, RELEASE_TABLE), types = rows(db, TYPE_TABLE);
  const planned = [], plannedTypes = [], ledger = [];
  for (const assertion of manifest.assertions) {
    const support = assertion.supportingObservationIds.map(id => observations.get(id));
    const assertionHash = contentHash({ assertion, support, policyVersion: manifest.policyVersion });
    const old = tableExists(db, ASSERTION_TABLE) ? db.prepare(`SELECT * FROM ${ASSERTION_TABLE} WHERE assertion_id=?`).get(assertion.assertionId) : null;
    requireThat(!old || old.content_sha256 === assertionHash, 'Changed content under existing assertion ID');
    let row = assertion.disposition === 'accepted' ? rowFor(assertion, observations, manifest) : null;
    if (old) {
      requireThat((row !== null) === (old.target_release_id !== null || old.target_type_id !== null), 'Stored disposition mismatch');
      if (row) {
        const actual = db.prepare(`SELECT * FROM ${assertion.kind === 'application_type' ? TYPE_TABLE : RELEASE_TABLE} WHERE evidence_id=?`).get(old.target_type_id ?? old.target_release_id);
        requireThat(actual && canonicalJson(actual) === old.target_row_json, 'Previously imported evidence missing or modified');
      }
      continue;
    }
    requireThat(!previous, 'Existing manifest registry is incomplete');
    if (row) {
      const targetRows = assertion.kind === 'application_type' ? types : existing;
      const sameId = targetRows.find(item => item.evidence_id === row.evidence_id);
      requireThat(!sameId, 'Evidence ID already exists outside this import registry');
      const equivalent = assertion.kind === 'application_type' ? types.find(item => item.appid === row.appid && item.verified === 1 && item.app_type === row.app_type && item.source_url === row.source_url) : existing.find(item => item.appid === row.appid && item.release_basis === row.release_basis && item.release_date === row.release_date && item.date_precision === row.date_precision && item.verified === 1 && item.release_status === row.release_status && item.phase === row.phase && item.source_url === row.source_url);
      if (equivalent) row = { ...equivalent };
      else (assertion.kind === 'application_type' ? plannedTypes : planned).push(row);
    }
    ledger.push({ assertion_id: assertion.assertionId, content_sha256: assertionHash, manifest_id: manifest.manifestId, disposition: assertion.disposition, target_release_id: assertion.kind === 'release' ? row?.evidence_id ?? null : null, target_type_id: assertion.kind === 'application_type' ? row?.evidence_id ?? null : null, target_row_json: row ? canonicalJson(row) : null });
  }
  conflictCheck([...types, ...plannedTypes], [...existing, ...planned], [...planned, ...plannedTypes], manifest.scope.appids);
  return { mode: 'dry_run', manifestId: manifest.manifestId, manifestSha256: manifest.contentSha256, replay: Boolean(previous), acceptedReleaseRows: planned.length, acceptedTypeRows: plannedTypes.length, pendingAssertions: manifest.assertions.filter(a => a.disposition === 'pending').length, ledgerRows: ledger.length, rows: planned, typeRows: plannedTypes, ledger,
    warnings: ['Offline manually selected pilot; not representative of all Steam releases.', 'Five manually reviewed game classifications are distinct from all 298 pending reconstructed classifications; unknown release bases still exclude games.', 'Source text was reviewed in an earlier audit; this importer does not fetch or authenticate sources.'] };
}
const registrySql = `CREATE TABLE IF NOT EXISTS ${MANIFEST_TABLE} (manifest_id TEXT PRIMARY KEY, content_sha256 TEXT NOT NULL, policy_version TEXT NOT NULL, importer_version TEXT NOT NULL, manifest_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS ${ASSERTION_TABLE} (assertion_id TEXT PRIMARY KEY, content_sha256 TEXT NOT NULL, manifest_id TEXT NOT NULL REFERENCES ${MANIFEST_TABLE}(manifest_id), disposition TEXT NOT NULL CHECK(disposition IN ('accepted','pending')), target_release_id TEXT REFERENCES ${RELEASE_TABLE}(evidence_id), target_type_id TEXT REFERENCES ${TYPE_TABLE}(evidence_id), target_row_json TEXT, CHECK(target_release_id IS NULL OR target_type_id IS NULL));`;

/** Low-level transactional writer for tests/disposable copies only. CLI never writes its source DB. */
export function applyToDisposableDatabase(db, manifest, options = {}) {
  db.exec('PRAGMA foreign_keys=ON; BEGIN IMMEDIATE');
  try {
    const before = databaseSnapshot(db);
    const plan = planImport(db, manifest, options);
    if (!plan.replay) {
      db.exec(registrySql);
      db.prepare(`INSERT INTO ${MANIFEST_TABLE} VALUES(?,?,?,?,?)`).run(manifest.manifestId, manifest.contentSha256, manifest.policyVersion, IMPORTER_VERSION, canonicalJson(manifest));
      for (const row of plan.rows) db.prepare(`INSERT INTO ${RELEASE_TABLE} (${Object.keys(row).join(',')}) VALUES(${Object.keys(row).map(() => '?').join(',')})`).run(...Object.values(row));
      for (const row of plan.typeRows) db.prepare(`INSERT INTO ${TYPE_TABLE} (${Object.keys(row).join(',')}) VALUES(${Object.keys(row).map(() => '?').join(',')})`).run(...Object.values(row));
      for (const item of plan.ledger) db.prepare(`INSERT INTO ${ASSERTION_TABLE} VALUES(?,?,?,?,?,?,?)`).run(...Object.values(item));
    }
    verifyPreservation(before, databaseSnapshot(db));
    requireThat(db.prepare('PRAGMA foreign_key_check').all().length === 0, 'Post-import foreign-key violation');
    db.exec('COMMIT');
    return { ...plan, mode: 'applied_disposable_copy' };
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
export function databaseSnapshot(db) {
  return Object.fromEntries(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(({name}) => [name, rows(db, name).map(row => canonicalJson(row)).sort()]));
}
export function verifyPreservation(before, after) {
  for (const [name, original] of Object.entries(before)) {
    requireThat(Array.isArray(after[name]), `Lost original table ${name}`);
    if ([TYPE_TABLE, RELEASE_TABLE, MANIFEST_TABLE, ASSERTION_TABLE].includes(name)) requireThat(original.every(row => after[name].includes(row)), `Changed/deleted original evidence in ${name}`);
    else requireThat(canonicalJson(original) === canonicalJson(after[name]), `Changed original rows in ${name}`);
  }
  return true;
}
function readManifest(filename) {
  requireThat(statSync(filename).isFile() && statSync(filename).size <= MAX_BYTES, 'Manifest must be a regular JSON file at most 1 MiB');
  return JSON.parse(readFileSync(filename, 'utf8'));
}
export async function runCli(args) {
  const allowed = new Set(['--manifest','--database','--apply-copy']);
  const flags = {};
  for (let i = 0; i < args.length; i += 2) {
    requireThat(allowed.has(args[i]) && !flags[args[i]] && args[i + 1] && !args[i + 1].startsWith('--'), 'Use --manifest FILE --database SOURCE [--apply-copy NEW_THROWAWAY_FILE]');
    flags[args[i]] = args[i + 1];
  }
  requireThat(flags['--manifest'] && flags['--database'], 'Explicit manifest and database paths required; no environment/default database is read');
  const manifest = readManifest(flags['--manifest']);
  const sourcePath = realpathSync(flags['--database']);
  const source = new DatabaseSync(sourcePath, { readOnly: true });
  let destination = null, reserved = false;
  try {
    const plan = planImport(source, manifest);
    if (!flags['--apply-copy']) return plan;
    const destinationPath = resolve(realpathSync(dirname(resolve(flags['--apply-copy']))), flags['--apply-copy'].split('/').at(-1));
    requireThat(destinationPath !== sourcePath, 'Apply destination must differ from read-only source');
    closeSync(openSync(destinationPath, 'wx', 0o600)); reserved = true;
    await backup(source, destinationPath);
    destination = new DatabaseSync(destinationPath); destination.exec('PRAGMA foreign_keys=ON');
    const before = databaseSnapshot(destination);
    const result = applyToDisposableDatabase(destination, manifest);
    const after = databaseSnapshot(destination);
    verifyPreservation(before, after);
    requireThat(destination.prepare('PRAGMA integrity_check').get().integrity_check === 'ok', 'Post-import integrity check failed');
    const replay = applyToDisposableDatabase(destination, manifest);
    requireThat(replay.replay && replay.acceptedReleaseRows === 0 && replay.acceptedTypeRows === 0 && canonicalJson(after) === canonicalJson(databaseSnapshot(destination)), 'Idempotent replay failed');
    return { ...result, destinationPath, preservation: 'all original rows preserved', integrity: 'ok', replay: 'no_op_verified' };
  } catch (error) {
    if (destination) { destination.close(); destination = null; }
    if (reserved) unlinkSync(resolve(flags['--apply-copy']));
    throw error;
  } finally { destination?.close(); source.close(); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await runCli(process.argv.slice(2)), null, 2)); }
  catch (error) { console.error(`Evidence import blocked: ${error.message}`); process.exitCode = 1; }
}
