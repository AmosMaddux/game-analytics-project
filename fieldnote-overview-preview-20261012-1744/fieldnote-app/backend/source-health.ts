import type { D1Database } from './db.ts';
import { EVIDENCE_STATUSES, METRIC_MAX_AGE_MS, metricFreshness } from './evidence.ts';
import type { EvidenceStatus, SourceGateDetails, SourceHealthData, SourceMetricCoverage, TimeWindow } from '../src/types.ts';

type Row = Record<string, unknown>;
const JOB_LIMIT = 20;
const ATTEMPT_LIMIT = 50;
const SCHEDULE_LIMIT = 100;
const MINIMUM_PER_GENRE = 15;
const UNRESOLVED_GENRE = 'Unresolved / needs review';
const LIMIT_KEYS = ['maxRequests','maxPages','maxBytes','maxResponseBytes','maxRuntimeMs','requestTimeoutMs','maxRetries','minIntervalMs','maxGames'];
const COUNTER_KEYS = ['requests','pages','bytes','retries','accepted','rejected','completed','failed'];
const CHECKPOINT_KEYS = ['streamIndex','pageIndex','completedItems','targetCount'];
const SOURCE_LABELS: Record<string, string> = { igdb:'IGDB catalog', steam_api:'Steam metrics', steam_catalog:'Steam catalog verification', steam_tags:'Steam store tags' };
const OFFICIAL_DOC_HOSTS = new Set(['api-docs.igdb.com','dev.twitch.tv','partner.steamgames.com','steamcommunity.com']);

function object(value: unknown): Row {
  if (typeof value === 'string') { try { return object(JSON.parse(value)); } catch { return {}; } }
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
}
function text(value: unknown, maximum = 600): string | null { return typeof value === 'string' && value.trim() ? value.slice(0,maximum) : null; }
function code(value: unknown, fallback = 'unknown'): string { return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value) ? value : fallback; }
function date(value: unknown): string | null { return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null; }
function count(value: unknown): number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0; }
function safeNumbers(value: unknown, keys: string[]): Record<string, number> {
  const input = object(value); const output: Record<string, number> = {};
  for (const key of keys) if (typeof input[key] === 'number' && Number.isFinite(input[key]) && input[key] >= 0) output[key] = input[key];
  return output;
}
function timeWindow(values: unknown[]): TimeWindow {
  const valid = values.map(date).filter((value): value is string => value !== null).sort((left,right) => Date.parse(left) - Date.parse(right));
  return {start:valid[0] ?? null,end:valid.at(-1) ?? null};
}
function savedWindow(value: unknown): TimeWindow { const row = object(value); return {start:date(row.start),end:date(row.end)}; }
function publicDetails(source: string, value: unknown): SourceGateDetails {
  const details = object(value); const gate = object(details.gate);
  const links = Array.isArray(details.officialLinks) ? details.officialLinks : [];
  const officialLinks: SourceGateDetails['officialLinks'] = [];
  for (const candidate of links.slice(0,10)) {
    const link = object(candidate);
    try {
      const url = new URL(String(link.url));
      if (url.protocol === 'https:' && OFFICIAL_DOC_HOSTS.has(url.hostname) && !url.username && !url.password && !url.search && (url.hostname !== 'steamcommunity.com' || url.pathname === '/dev/apiterms')) officialLinks.push({label:text(link.label,100) ?? 'Official documentation',url:url.href});
    } catch { /* Untrusted links never become official references. */ }
  }
  return {
    label:text(details.label,100) ?? SOURCE_LABELS[source] ?? source,
    allowedHosts:Array.isArray(details.allowedHosts) ? details.allowedHosts.filter((host): host is string => typeof host === 'string' && /^[a-z0-9.-]{1,253}$/.test(host)).slice(0,20) : [],
    officialLinks,
    gate:{status:code(gate.status,'not_recorded'),note:text(gate.note) ?? 'No access or collection permission is established by this page.'},
    retentionNote:text(details.retentionNote),collectionNote:text(details.collectionNote),
  };
}
function emptyCoverage(metric: SourceMetricCoverage['metric'], label: string, total: number): SourceMetricCoverage {
  return {metric,label,total,supported:0,missing:0,fresh:0,stale:0,freshnessUnknown:0,sourceMeasurementUnknown:0,evidenceStates:{observed:0,reported:0,calculated:0,estimated:0,unknown:0,unavailable:0},collectionWindow:{start:null,end:null},sourceMeasurementWindow:{start:null,end:null}};
}

/** A read-only summary of normalized evidence and bounded-job records. Never calls a provider. */
export async function readSources(db: D1Database, now = Date.now()): Promise<SourceHealthData> {
  const [version,games,genres,catalogs,metrics,tags,sourceRows,failureRows,jobRows,attemptRows,scheduleRows,totals,metaRows,latestAttempts,taxonomyRows] = await Promise.all([
    db.prepare('SELECT MAX(version) AS version FROM foundation_schema').first<{version:number}>(),
    db.prepare(`SELECT g.appid, g.genre, EXISTS (
      SELECT 1 FROM catalog_games c JOIN identity_crosswalks x ON x.appid = c.appid AND x.igdb_id = c.igdb_id
      WHERE c.appid = g.appid AND c.match_status = 'matched' AND x.steam_uid = CAST(g.appid AS TEXT)
      AND x.external_source_id = 1 AND x.source_name = 'Steam'
      AND json_extract(c.identity_json, '$.status') = 'exact_steam_appid_verified'
    ) AS verified FROM games g`).all<Row>(),
    db.prepare('SELECT name FROM genres WHERE name <> ? ORDER BY position').bind(UNRESOLVED_GENRE).all<{name:string}>(),
    db.prepare('SELECT collected_at FROM catalog_games').all<Row>(),
    db.prepare(`SELECT appid, metric, value, evidence_status, collected_at, measured_at, source_freshness FROM (
      SELECT appid, metric, value, evidence_status, collected_at, measured_at, source_freshness,
        ROW_NUMBER() OVER (PARTITION BY appid, metric ORDER BY julianday(collected_at) DESC, observation_id DESC) AS latest
      FROM metric_observations
    ) WHERE latest = 1`).all<Row>(),
    db.prepare('SELECT appid, collected_at FROM steam_tags WHERE length(trim(tag)) > 0').all<Row>(),
    db.prepare('SELECT source, status, last_attempt_at, last_success_at, last_error_code, details_json FROM source_health ORDER BY source').all<Row>(),
    db.prepare(`SELECT source, failed_at, error_code FROM (
      SELECT source, failed_at, error_code, ROW_NUMBER() OVER (PARTITION BY source ORDER BY julianday(failed_at) DESC) AS latest FROM (
        SELECT source, attempted_at AS failed_at, error_code FROM collection_attempts WHERE error_code IS NOT NULL
        UNION ALL SELECT source, COALESCE(finished_at, started_at) AS failed_at, error_code FROM collection_jobs WHERE error_code IS NOT NULL
      )
    ) WHERE latest = 1`).all<Row>(),
    db.prepare('SELECT * FROM collection_jobs ORDER BY started_at DESC, job_id DESC LIMIT ?').bind(JOB_LIMIT).all<Row>(),
    db.prepare('SELECT job_id, source, appid, metric, status, attempted_at, error_code FROM collection_attempts ORDER BY attempted_at DESC, job_id DESC, item_key DESC LIMIT ?').bind(ATTEMPT_LIMIT).all<Row>(),
    db.prepare('SELECT * FROM collection_schedules ORDER BY enabled DESC, next_run_at, id LIMIT ?').bind(SCHEDULE_LIMIT).all<Row>(),
    db.prepare(`SELECT (SELECT COUNT(*) FROM collection_jobs) AS jobs, (SELECT COUNT(*) FROM collection_attempts) AS attempts,
      (SELECT COUNT(*) FROM collection_schedules) AS schedules, (SELECT COUNT(*) FROM collection_schedules WHERE enabled = 1) AS enabled`).first<Row>(),
    db.prepare("SELECT key, value_json FROM snapshot_metadata WHERE key IN ('builtAt','collectionWindow','tagCollectionWindow','steamMetricsIntegration','catalogIntegration')").all<{key:string;value_json:string}>(),
    db.prepare("SELECT appid,metric,status,attempted_at FROM (SELECT appid,metric,status,attempted_at,ROW_NUMBER() OVER(PARTITION BY appid,metric ORDER BY julianday(attempted_at) DESC,job_id DESC) AS latest FROM collection_attempts WHERE metric IN ('players','reviews')) WHERE latest=1").all<Row>(),
    db.prepare('SELECT DISTINCT taxonomy_version FROM catalog_admissions ORDER BY taxonomy_version').all<{taxonomy_version:string}>(),
  ]);
  const total = games.results.length;
  const unresolvedGames = games.results.filter(game => game.genre === UNRESOLVED_GENRE).length;
  const failureMap = new Map(failureRows.results.map(row => [row.source,row]));
  const metricMap = new Map(metrics.results.map(row => [`${row.appid}:${row.metric}`,row]));
  const latestAttemptMap=new Map(latestAttempts.results.map(row=>[`${row.appid}:${row.metric}`,row]));
  const coverage: SourceMetricCoverage[] = (['players','reviews','storeReviews'] as const).map(metric => {
    const entry = emptyCoverage(metric,{players:'Concurrent players',reviews:'All-time API reviews',storeReviews:'Localized store review summaries'}[metric],total);
    const collected: unknown[] = []; const measured: unknown[] = [];
    for (const game of games.results) {
      const row = metricMap.get(`${game.appid}:${metric}`);
      const state = row && EVIDENCE_STATUSES.includes(row.evidence_status as EvidenceStatus) ? row.evidence_status as EvidenceStatus : 'unknown';
      entry.evidenceStates[state]++;
      if (!row || !['observed','reported'].includes(state) || typeof row.value !== 'number' || !Number.isFinite(row.value) || row.value < 0) { entry.missing++; continue; }
      entry.supported++;
      const attempt=latestAttemptMap.get(`${game.appid}:${metric}`);
      const failedLatest=attempt&&attempt.status!=='accepted'&&date(attempt.attempted_at)&&(!date(row.collected_at)||Date.parse(String(attempt.attempted_at))>=Date.parse(String(row.collected_at)));
      const freshness = failedLatest?'stale':metricFreshness(date(row.collected_at),now,text(row.source_freshness));
      if (freshness === 'unknown') entry.freshnessUnknown++; else entry[freshness]++;
      if (!date(row.measured_at)) entry.sourceMeasurementUnknown++;
      collected.push(row.collected_at); measured.push(row.measured_at);
    }
    entry.collectionWindow = timeWindow(collected); entry.sourceMeasurementWindow = timeWindow(measured);
    return entry;
  });
  const tagCoverage = emptyCoverage('tags','Saved Steam tags',total);
  const tagMap = new Map<number, Row[]>();
  for (const row of tags.results) { const id = Number(row.appid); const values = tagMap.get(id) ?? []; values.push(row); tagMap.set(id,values); }
  for (const game of games.results) {
    const saved = tagMap.get(Number(game.appid));
    if (!saved?.length) { tagCoverage.missing++; tagCoverage.evidenceStates.unknown++; continue; }
    tagCoverage.supported++; tagCoverage.evidenceStates.observed++; tagCoverage.sourceMeasurementUnknown++;
    // A partly undated or stale tag set must not be presented as wholly fresh.
    const states = saved.map(row => metricFreshness(date(row.collected_at),now));
    if (states.includes('stale')) tagCoverage.stale++;
    else if (states.includes('unknown')) tagCoverage.freshnessUnknown++;
    else tagCoverage.fresh++;
  }
  tagCoverage.collectionWindow = timeWindow(tags.results.map(row => row.collected_at));
  coverage.push(tagCoverage);
  const genreCoverage = genres.results.map(row => {
    const members = games.results.filter(game => game.genre === row.name);
    return {genre:row.name,games:members.length,verifiedCrosswalkGames:members.filter(game => game.verified === 1).length,belowMinimum:members.length < MINIMUM_PER_GENRE};
  });
  const meta = new Map(metaRows.results.map(row => { let value: unknown = null; try { value = JSON.parse(row.value_json); } catch { /* Invalid optional metadata is unknown. */ } return [row.key,value]; }));
  return {
    schemaVersion:version?.version ?? null,asOf:new Date(now).toISOString(),mode:'read_only_saved_collection_state',collectionControlsAvailable:false,
    scheduler:{status:'not_running_in_web_app',enabledSchedules:count(totals?.enabled),note:'The web app does not run collection or schedule timers. Enabled records require a separately invoked, bounded scheduler command; a saved next-run time is not proof that a process is active.'},
    freshness:{targetHours:METRIC_MAX_AGE_MS / 3_600_000,note:'A 24-hour display age target is applied to supported saved metrics and tag sets. Missing values are separate from stale values and unknown freshness. Source measurement times are unknown unless supplied; collection times are never relabeled as measurement times. This target is not a running schedule.'},
    catalog:{totalGames:total,unresolvedGames,taxonomyVersions:taxonomyRows.results.map(row => row.taxonomy_version),classificationNote:'Original pilot groupings are preserved. Expansion genre assignments are provisional inferences from catalog labels, not verified game classifications. Unresolved mappings remain browseable in all-game search and details, but are excluded from agreed-genre coverage and scoring rankings. Taxonomy corrections change the comparison baseline and are not evidence of a trend.',igdbCatalogGames:catalogs.results.length,verifiedCrosswalkGames:games.results.filter(game => game.verified === 1).length,genresBelowMinimum:genreCoverage.filter(row => row.belowMinimum).length,minimumPerGenre:MINIMUM_PER_GENRE,genres:genreCoverage,collectionWindow:timeWindow(catalogs.results.map(row => row.collected_at))},
    coverage,
    sources:sourceRows.results.map(row => ({source:code(row.source),status:code(row.status),lastAttemptAt:date(row.last_attempt_at),lastSuccessAt:date(row.last_success_at),lastFailureAt:date(failureMap.get(row.source)?.failed_at),lastFailureCode:failureMap.get(row.source)?.error_code ? code(failureMap.get(row.source)?.error_code) : null,lastErrorCode:row.last_error_code ? code(row.last_error_code) : null,details:publicDetails(code(row.source),row.details_json)})),
    jobs:{total:count(totals?.jobs),limit:JOB_LIMIT,items:jobRows.results.map(row => {
      const savedCheckpoint = object(row.checkpoint_json); const checkpoint: Record<string,number | boolean> = safeNumbers(savedCheckpoint,CHECKPOINT_KEYS);
      if (typeof savedCheckpoint.discoveryComplete === 'boolean') checkpoint.discoveryComplete = savedCheckpoint.discoveryComplete;
      return {jobId:text(row.job_id,160) ?? 'Unknown',source:code(row.source),kind:code(row.kind),status:code(row.status),startedAt:date(row.started_at),finishedAt:date(row.finished_at),errorCode:row.error_code ? code(row.error_code) : null,nextRunAt:date(row.next_run_at),limits:safeNumbers(row.limits_json,LIMIT_KEYS),counters:safeNumbers(row.counters_json,COUNTER_KEYS),checkpoint,hasSavedCursor:typeof savedCheckpoint.cursor === 'string' && savedCheckpoint.cursor.length > 0};
    })},
    attempts:{total:count(totals?.attempts),limit:ATTEMPT_LIMIT,items:attemptRows.results.map(row => ({jobId:text(row.job_id,160) ?? 'Unknown',source:code(row.source),appid:typeof row.appid === 'number' && Number.isSafeInteger(row.appid) && row.appid > 0 ? row.appid : null,metric:row.metric ? code(row.metric) : null,status:code(row.status),attemptedAt:date(row.attempted_at),errorCode:row.error_code ? code(row.error_code) : null}))},
    schedules:{total:count(totals?.schedules),limit:SCHEDULE_LIMIT,items:scheduleRows.results.map(row => {
      let watchlist: unknown = []; try { watchlist = JSON.parse(String(row.watchlist_json)); } catch { /* Unknown watchlists do not imply targets. */ }
      const expiresAt = date(row.expires_at);
      return {id:text(row.id,160) ?? 'Unknown',source:code(row.source),kind:code(row.kind),enabled:row.enabled === 1,intervalHours:typeof row.interval_hours === 'number' && row.interval_hours > 0 ? row.interval_hours : null,watchlistCount:Array.isArray(watchlist) ? new Set(watchlist.filter(id => typeof id === 'number' && Number.isSafeInteger(id) && id > 0)).size : 0,nextRunAt:date(row.next_run_at),expiresAt,expired:expiresAt !== null && Date.parse(expiresAt) <= now,limits:safeNumbers(row.limits_json,LIMIT_KEYS)};
    })},
    preservedSnapshot:{builtAt:date(meta.get('builtAt')),collectionWindow:savedWindow(meta.get('collectionWindow')),metricWindow:savedWindow(object(meta.get('steamMetricsIntegration')).fetchWindow),tagWindow:savedWindow(meta.get('tagCollectionWindow')),catalogWindow:savedWindow(object(meta.get('catalogIntegration')).fetchWindow)},
  };
}
