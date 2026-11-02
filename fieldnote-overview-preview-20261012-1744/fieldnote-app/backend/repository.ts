import type { D1Database, SqlValue } from './db.ts';
import { observationEvidence } from './evidence.ts';
import { readCategoryEvidence } from './research-categories.ts';
import { catalogArrays, catalogFields, eventFields, gameFields, marketingFields, metricFields, provenanceFields, restore, type RecordValue } from './records.ts';

async function rows(db: D1Database, table: string, appids?: number[], order = 'appid, position'): Promise<RecordValue[]> {
  const where = appids ? ` WHERE appid IN (${appids.map(() => '?').join(',') || 'NULL'})` : '';
  const result = await db.prepare(`SELECT * FROM ${table}${where} ORDER BY ${order}`).bind(...(appids ?? [])).all<RecordValue>();
  return result.results;
}
const UNRESOLVED_GENRE = 'Unresolved / needs review';
const json = (value: string | null) => value === null ? null : JSON.parse(value);

/** All game records are reconstructed from entity tables; no snapshot-blob cache. */
export async function readGames(db: D1Database, options: {appids?: number[]; includeEvidence?: boolean; now?: number} = {}): Promise<RecordValue[]> {
  const appids = options.appids;
  const [games, tags, metrics, catalogs, crosswalks, platforms, roles, labels, links, releases, provenances, conflicts, marketing, events, attempts, operational] = await Promise.all([
    rows(db,'games',appids,'position'), rows(db,'steam_tags',appids), rows(db,'metric_observations',appids,'appid, metric, julianday(collected_at), observation_id'),
    rows(db,'catalog_games',appids,'appid'), rows(db,'identity_crosswalks',appids), rows(db,'catalog_platforms',appids),
    rows(db,'catalog_company_roles',appids,'appid, collection, position'), rows(db,'catalog_labels',appids,'appid, collection, position'), rows(db,'catalog_links',appids,'appid, collection, position'),
    rows(db,'catalog_releases',appids), rows(db,'catalog_field_provenance',appids,'appid, field'), rows(db,'catalog_conflicts',appids),
    rows(db,'marketing_profiles',appids,'appid'), rows(db,'marketing_events',appids),
    rows(db,'collection_attempts',appids,'appid, metric, julianday(attempted_at), job_id'),
    db.prepare("SELECT EXISTS(SELECT 1 FROM collection_jobs WHERE source IN ('igdb','steam_api','steam_catalog')) AS active").first<{active:number}>(),
  ]);
  const result = new Map<number, RecordValue>();
  for (const row of games) result.set(row.appid,{...restore(row,gameFields),appid:row.appid,tags:[]});
  for (const row of tags) result.get(row.appid)?.tags.push(row.tag);
  for (const row of metrics) {
    const game = result.get(row.appid); if (!game) continue;
    const metric = restore(row,metricFields,json(row.original_keys_json));
    // Reviewed panel imports store their status in normalized evidence columns.
    // Adapt only that method; preserve every legacy source field and raw DB row.
    if (row.method_version === 'steam-dated-counts-1.0') {
      if (row.source_status === null && metric.status == null) metric.status = row.evidence_status;
      if (row.source_freshness === null && metric.freshness == null) metric.freshness = row.freshness;
    }
    const evidence=observationEvidence(row,options.now);
    if (options.includeEvidence !== false) metric.evidence = evidence;
    if(operational?.active&&row.metric==='players'&&evidence.freshness!=='fresh') {
      metric.savedScoreEligible=metric.scoreEligible??null;metric.scoreEligible=false;metric.scoreEligibilityReason='outside_operational_freshness_window';
    }
    if (row.metric === 'players' && game.genre === UNRESOLVED_GENRE) {
      metric.savedScoreEligible ??= metric.scoreEligible ?? null;
      metric.scoreEligible = false;
      metric.scoreEligibilityReason = 'unresolved_genre_mapping';
    }
    game[row.metric] = metric;
  }
  const latestAttempts=new Map<string,RecordValue>();
  for(const row of attempts)if(['players','reviews'].includes(row.metric))latestAttempts.set(`${row.appid}:${row.metric}`,row);
  for(const row of latestAttempts.values()) {
    const game=result.get(row.appid),metric=game?.[row.metric];if(!metric)continue;
    if(row.status!=='accepted'&&Number.isFinite(Date.parse(row.attempted_at))&&(!metric.observedAt||Date.parse(row.attempted_at)>=Date.parse(metric.observedAt))) {
      metric.refresh={runId:row.job_id,attemptedAt:row.attempted_at,status:'failed',reason:row.error_code??'source_failure'};
      metric.freshness=typeof metric.value==='number'?'stale_cache':'unknown';metric.scoreEligible=false;
      if(metric.evidence)metric.evidence.freshness=typeof metric.value==='number'?'stale':'unknown';
    }
  }
  for (const row of catalogs) {
    const game = result.get(row.appid); if (!game) continue;
    game.catalog = {...restore(row,catalogFields),identity:{...json(row.identity_json),crosswalk:[]},provenance:{}};
    for (const key of catalogArrays) game.catalog[key] = [];
  }
  for (const row of crosswalks) result.get(row.appid)?.catalog.identity.crosswalk.push({...json(row.detail_json),id:row.external_record_id,uid:row.steam_uid,gameId:row.igdb_id,sourceId:row.external_source_id,sourceName:row.source_name,url:row.source_url,sourceUpdatedAt:row.source_updated_at});
  for (const row of platforms) result.get(row.appid)?.catalog.platforms.push({...json(row.detail_json),id:row.source_id,name:row.name});
  for (const row of roles) {
    const item = {...json(row.detail_json),id:row.source_id};
    if (row.collection === 'companies') Object.assign(item,{company:{id:row.company_id,name:row.name},developer:row.developer===null?null:!!row.developer,publisher:row.publisher===null?null:!!row.publisher,porting:row.porting===null?null:!!row.porting,supporting:row.supporting===null?null:!!row.supporting});
    else item.name = row.name;
    result.get(row.appid)?.catalog[row.collection].push(item);
  }
  for (const row of labels) result.get(row.appid)?.catalog[row.collection].push({...json(row.detail_json),id:row.source_id,name:row.name});
  for (const row of links) result.get(row.appid)?.catalog[row.collection].push({...json(row.detail_json),id:row.source_id,url:row.url,type:row.type_id === null ? null : {id:row.type_id,type:row.type_name},trusted:!!row.trusted});
  for (const row of releases) result.get(row.appid)?.catalog.releaseDates.push({...json(row.detail_json),id:row.source_id,date:row.release_at,displayDate:row.display_date,platform:json(row.platform_json),region:json(row.region_json),dateFormat:json(row.date_format_json),status:json(row.status_json)});
  for (const row of provenances) {
    const game = result.get(row.appid); if (game) game.catalog.provenance[row.field] = restore(row,provenanceFields);
  }
  for (const row of conflicts) result.get(row.appid)?.catalog.conflicts.push({...json(row.detail_json),field:row.field,status:row.status,reason:row.reason});
  for (const row of marketing) {
    const game = result.get(row.appid); if (!game) continue;
    game.marketing = {...restore(row,marketingFields,json(row.original_keys_json)),events:[]};
    if ('deepProof' in game.marketing) game.marketing.deepProof = !!row.deep_proof;
    if ('exhaustive' in game.marketing) game.marketing.exhaustive = !!row.exhaustive;
  }
  for (const row of events) result.get(row.appid)?.marketing.events.push(restore(row,eventFields));
  return [...result.values()];
}

export async function readSnapshot(db: D1Database, options: {includeEvidence?: boolean; now?: number} = {}) {
  const [metaRows, genreRows, cohortRows, reviewWindows, games, schema, admissions, collectionJobs, taxonomyRows] = await Promise.all([
    db.prepare('SELECT key, value_json FROM snapshot_metadata').all<RecordValue>(),
    db.prepare('SELECT name FROM genres WHERE name <> ? ORDER BY position').bind(UNRESOLVED_GENRE).all<RecordValue>(),
    db.prepare('SELECT * FROM cohorts ORDER BY position').all<RecordValue>(),
    db.prepare('SELECT * FROM review_windows ORDER BY position').all<RecordValue>(),
    readGames(db,options),
    db.prepare('SELECT MAX(version) AS version FROM foundation_schema').first<{version:number}>(),
    db.prepare('SELECT COUNT(*) AS count FROM catalog_admissions').first<{count:number}>(),
    db.prepare("SELECT COUNT(*) AS count FROM collection_jobs WHERE source IN ('igdb','steam_api','steam_catalog')").first<{count:number}>(),
    db.prepare('SELECT DISTINCT taxonomy_version FROM catalog_admissions ORDER BY taxonomy_version').all<{taxonomy_version:string}>(),
  ]);
  const taxonomyVersions = taxonomyRows.results.map(row => row.taxonomy_version);
  const unresolvedGames = games.filter(game => game.genre === UNRESOLVED_GENRE).length;
  const meta: RecordValue = {};
  for (const row of metaRows.results) if (!row.key.startsWith('_')) meta[row.key] = JSON.parse(row.value_json);
  meta.cohorts = cohortRows.results.map(row => ({...json(row.detail_json),id:row.id,label:row.label,count:row.id==='broad_discovery'?games.filter(game=>game.cohort===row.id).length:row.declared_count}));
  if (meta.steamDateValidation) meta.steamDateValidation.probes = reviewWindows.results.map(row => ({...json(row.detail_json),appid:row.appid,status:row.source_status,period:{start:row.period_start,endInclusive:row.period_end_inclusive},totalMatching:row.matching_reviews,completeEnumeration:!!row.complete_enumeration,boundaryExercised:!!row.boundary_exercised}));
  if (!meta.builtAt) throw new Error('Database has not been seeded');
  const panelTables = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('research_panels','research_panel_memberships','research_catalog_records')").all<{name:string}>();
  if (panelTables.results.length === 3) {
    const asOf = new Date(options.now ?? Date.now()).toISOString();
    const panel = await db.prepare('SELECT panel_id FROM research_panels WHERE julianday(created_at)<=julianday(?) AND julianday(as_of)<=julianday(?) ORDER BY julianday(created_at) DESC,panel_id DESC LIMIT 1').bind(asOf,asOf).first<{panel_id:string}>();
    if (panel) {
      const members = await db.prepare('SELECT appid FROM research_panel_memberships WHERE panel_id=?').bind(panel.panel_id).all<{appid:number}>();
      const ids = new Set(members.results.map(row=>row.appid));
      const labels = await readCategoryEvidence(db,'igdb_genre',asOf);
      const editorial = new Set(genreRows.results.map(row=>row.name));
      meta.researchPanelSummary = {selectedCount:ids.size,igdbGenreCount:new Set(labels.filter(row=>ids.has(row.appid)).map(row=>row.name)).size,legacyEditorialCount:games.filter(game=>ids.has(game.appid)&&editorial.has(game.genre)).length,asOf};
    }
  }
  return {
    meta,genres:genreRows.results.map(row => row.name),games,
    foundation: {
      schemaVersion: schema?.version ?? 3, persistence:'normalized_sqlite', mode:collectionJobs?.count ? 'private_bounded_collection_cache' : 'offline_preserved_evidence',
      seedKind:'preserved_source_evidence', fixture:false, liveCollectionEnabled:false,
      boundedLocalCollectionAvailable:true,backgroundCollectionEnabled:false,
      catalogSample:{trackedGames:games.length,classifiedGames:games.length-unresolvedGames,unresolvedGames,admissions:admissions?.count??0,taxonomyVersions,taxonomyVersion:taxonomyVersions.length===1?taxonomyVersions[0]:taxonomyVersions.length?'mixed':'editorial-cohort-1.0',mappingNote:'Expansion genre assignments are provisional inferences from catalog labels, not verified game classifications. Unresolved mappings remain browseable but are excluded from genre coverage and rankings.',baselineNote:'Scores describe the current tracked sample. Catalog admissions and taxonomy corrections change this baseline; a changed classification or score is not evidence of a time trend.'},
      sourceSnapshotBuiltAt:meta.builtAt,
      evidenceStatusValues:['observed','reported','calculated','estimated','unknown','unavailable'],
      freshnessValues:['fresh','stale','unknown'],
      timestampNote:'observedAt in the imported prototype means collection time. Source measurement time remains null unless the source supplied it.',
      freshnessNote:'Freshness is assessed separately from evidence status against a 24-hour metric age target; it does not imply an active refresh job.',
    },
  };
}

/** Search identity/labels in normalized tables. Bound parameters are never SQL. */
export async function searchGames(db: D1Database, query: string, genre: string, limit = 100): Promise<RecordValue[]> {
  const clauses: string[] = []; const values: SqlValue[] = [];
  if (query) {
    const escaped = `%${query.replace(/[\\%_]/g,'\\$&')}%`;
    clauses.push("(g.name LIKE ? ESCAPE '\\' OR g.steam_name LIKE ? ESCAPE '\\' OR CAST(g.appid AS TEXT) = ? OR g.genre LIKE ? ESCAPE '\\' OR EXISTS (SELECT 1 FROM steam_tags t WHERE t.appid = g.appid AND t.tag LIKE ? ESCAPE '\\'))");
    values.push(escaped,escaped,query,escaped,escaped);
  }
  if (genre) { clauses.push('g.genre = ?'); values.push(genre); }
  values.push(limit);
  const matches = await db.prepare(`SELECT g.appid FROM games g${clauses.length ? ` WHERE ${clauses.join(' AND ')}` : ''} ORDER BY g.name COLLATE NOCASE, g.appid LIMIT ?`).bind(...values).all<{appid:number}>();
  const appids = matches.results.map(row => row.appid);
  const games = await readGames(db,{appids}); const order = new Map(appids.map((id,index) => [id,index]));
  return games.sort((a,b) => order.get(a.appid)! - order.get(b.appid)!);
}
