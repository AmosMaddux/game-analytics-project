import type { SqlStatement, SqlValue } from './db.ts';
import { catalogArrays, catalogFields, detail, eventFields, gameFields, mapped, marketingFields, metricFields, provenanceFields, type RecordValue } from './records.ts';
import { EVIDENCE_STATUSES, evidenceStatus, metricFreshness } from './evidence.ts';

const positiveId = (id: unknown): id is number => typeof id === 'number' && Number.isSafeInteger(id) && id > 0 && id <= 4294967295;
const titleKey = (value: string) => value.replace(/[™®]/g,'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const object = (value: unknown): value is RecordValue => !!value && typeof value === 'object' && !Array.isArray(value);
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(`Seed validation: ${message}`); }
function sourceUrl(value: unknown): boolean {
  try { const url = new URL(String(value)); return ['http:','https:'].includes(url.protocol) && !url.username && !url.password; } catch { return false; }
}
function exactSteamUrl(url: unknown, appid: number): boolean {
  try { const value = new URL(String(url)); return value.protocol === 'https:' && !value.username && !value.password && value.hostname === 'store.steampowered.com' && /^\/app\/([1-9]\d*)\/?$/.exec(value.pathname)?.[1] === String(appid); } catch { return false; }
}
/** Validation completes before producing mutating statements; no name-based joining. */
export function validateSnapshot(input: unknown): asserts input is RecordValue {
  assert(object(input) && object(input.meta) && Array.isArray(input.games) && Array.isArray(input.genres), 'expected saved snapshot meta, games and genres');
  assert(input.meta.mode === 'offline_preserved_evidence', 'only explicitly labeled preserved source evidence is accepted');
  assert(typeof input.meta.builtAt === 'string' && Number.isFinite(Date.parse(input.meta.builtAt)), 'snapshot build timestamp required');
  assert(Array.isArray(input.meta.cohorts), 'cohort definitions required');
  assert(input.genres.every((genre: unknown) => typeof genre === 'string' && genre.length > 0), 'genre labels must be nonempty strings');
  assert(new Set(input.genres).size === input.genres.length, 'duplicate genre labels');
  const cohortIds = new Set(input.meta.cohorts.map((row: RecordValue) => row.id));
  assert(cohortIds.size === input.meta.cohorts.length, 'duplicate cohort IDs');
  const seen = new Set<number>(); const catalogIds = new Set<number>();
  for (const game of input.games) {
    assert(object(game) && positiveId(game.appid), 'Steam AppID must be a positive integer');
    assert(game.id === String(game.appid), `Steam AppID/source id mismatch: ${game.appid}`);
    assert(!seen.has(game.appid), `duplicate Steam AppID ${game.appid}`); seen.add(game.appid);
    assert(typeof game.name === 'string' && typeof game.steamName === 'string', 'names are display metadata, required independently of identity');
    assert(input.genres.includes(game.genre) && cohortIds.has(game.cohort), `unknown genre/cohort for ${game.appid}`);
    assert(game.provenance?.identityVerified === true, `saved Steam identity is not verified for ${game.appid}`);
    assert(exactSteamUrl(game.storeUrl, game.appid), `store URL AppID mismatch for ${game.appid}`);
    assert(Array.isArray(game.tags) && game.tags.every((tag: unknown) => typeof tag === 'string'), `invalid saved Steam tags for ${game.appid}`);
    const catalog = game.catalog;
    assert(object(catalog) && catalog.status === 'matched' && catalog.source === 'IGDB' && positiveId(catalog.sourceId), `verified IGDB match required for ${game.appid}`);
    assert(catalog.gameType?.id === 0 && typeof catalog.gameType.type === 'string' && catalog.gameType.type.toLowerCase().replace(/[ _-]/g,'') === 'maingame', `base-game type is not established for ${game.appid}`);
    for (const key of ['parent_game_id','parentGameId','parentGame','parent_game','version_parent_id','versionParentId','versionParent','version_parent','version_title','versionTitle']) assert(catalog[key] == null || catalog[key] === '', `edition/parent/version relationship is not eligible for ${game.appid}`);
    assert(typeof catalog.name === 'string' && titleKey(catalog.name) && titleKey(catalog.name) === titleKey(game.steamName), `catalog title conflict needs review for ${game.appid}`);
    const desktopPlatforms = Array.isArray(catalog.platforms) ? catalog.platforms.filter((platform: RecordValue) => [3,6,14].includes(platform.id) && (/^(PC \(Microsoft Windows\)|Linux|Mac|macOS)$/i.test(platform.name ?? '') || /^(PC|Win|Linux|Mac)$/i.test(platform.abbreviation ?? ''))) : [];
    assert(desktopPlatforms.length > 0, `compatible desktop platform missing for ${game.appid}`);
    assert(typeof catalog.fetchedAt === 'string' && Number.isFinite(Date.parse(catalog.fetchedAt)), `catalog collection timestamp missing for ${game.appid}`);
    assert(!catalogIds.has(catalog.sourceId), `IGDB identity ${catalog.sourceId} already assigned to a different Steam game`); catalogIds.add(catalog.sourceId);
    assert(object(catalog.identity) && catalog.identity.status === 'exact_steam_appid_verified' && catalog.identity.steamAppid === game.appid, `exact crosswalk required for ${game.appid}`);
    assert(Array.isArray(catalog.identity.crosswalk) && catalog.identity.crosswalk.length > 0, `missing crosswalk for ${game.appid}`);
    for (const crosswalk of catalog.identity.crosswalk) {
      assert(crosswalk.platformId == null || (positiveId(crosswalk.platformId) && desktopPlatforms.some((platform: RecordValue) => platform.id === crosswalk.platformId)), `crosswalk platform disagrees with desktop identity for ${game.appid}`);
      assert(crosswalk.uid === String(game.appid) && crosswalk.gameId === catalog.sourceId && crosswalk.sourceId === 1 && crosswalk.sourceName === 'Steam' && crosswalk.urlValidation === 'valid' && exactSteamUrl(crosswalk.url, game.appid), `crosswalk AppID/provider/URL mismatch for ${game.appid}`);
    }
    for (const key of catalogArrays) assert(Array.isArray(catalog[key]), `catalog ${key} must preserve an explicit array for ${game.appid}`);
    assert(object(catalog.provenance), `catalog field provenance missing for ${game.appid}`);
    assert(object(game.marketing) && Array.isArray(game.marketing.events), `marketing evidence must be explicit for ${game.appid}`);
    for (const name of ['players','reviews','storeReviews']) {
      const metric = game[name]; assert(object(metric), `metric ${name} missing for ${game.appid}`);
      assert((name === 'storeReviews' && metric.status === undefined) || EVIDENCE_STATUSES.includes(metric.status), `unsupported evidence status for ${name}/${game.appid}`);
      assert(metric.value === null || (typeof metric.value === 'number' && Number.isFinite(metric.value) && metric.value >= 0), `invalid metric ${name} value for ${game.appid}`);
      assert(metric.sourceTimestamp == null || (typeof metric.sourceTimestamp === 'string' && Number.isFinite(Date.parse(metric.sourceTimestamp))), `invalid source measurement timestamp for ${game.appid}`);
      assert(metric.observedAt == null || (typeof metric.observedAt === 'string' && Number.isFinite(Date.parse(metric.observedAt))), `invalid collection timestamp for ${game.appid}`);
      const status = evidenceStatus(metric,name === 'storeReviews');
      if (['observed','reported'].includes(status)) assert(typeof metric.value === 'number' && sourceUrl(metric.sourceUrl) && typeof metric.observedAt === 'string' && Number.isFinite(Date.parse(metric.observedAt)), `observed/reported metric ${name}/${game.appid} requires a numeric value, source URL and collection timestamp`);
      assert(!['unknown','unavailable'].includes(status) || metric.value === null, `unknown/unavailable values must remain null for ${game.appid}`);
      assert(typeof metric.scope === 'string', `source scope required for ${name}/${game.appid}`);
    }
  }
}

/**
 * Deterministic, offline-only baseline reseed. Apply every returned statement in
 * one transaction. Imported evidence is replaced; persisted UI preferences stay.
 * This is not a collector, append-only history loader, or source-use authorization.
 */
export function buildSeedStatements(input: unknown): SqlStatement[] {
  validateSnapshot(input);
  const snapshot = input; const statements: SqlStatement[] = [];
  const insert = (table: string, row: RecordValue) => {
    const columns = Object.keys(row);
    statements.push({sql: `INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`, values: columns.map(key => row[key] ?? null) as SqlValue[]});
  };
  for (const table of ['games','genres','cohorts','snapshot_metadata']) statements.push({sql:`DELETE FROM ${table}`,values:[]});
  for (const [key, value] of Object.entries(snapshot.meta)) if (key !== 'cohorts') insert('snapshot_metadata',{key,value_json:key === 'steamDateValidation' ? detail(value as RecordValue,['probes']) : JSON.stringify(value)});
  insert('snapshot_metadata',{key:'_foundation_seed',value_json:JSON.stringify({version:'1.0', source:'prototype/public/data/snapshot.json', kind:'preserved_source_evidence', fixture:false, liveCollectionEnabled:false})});
  snapshot.genres.forEach((name: string, position: number) => insert('genres',{name,position}));
  snapshot.meta.cohorts.forEach((cohort: RecordValue, position: number) => insert('cohorts',{id:cohort.id,label:cohort.label,declared_count:cohort.count,position,detail_json:detail(cohort,['id','label','count'])}));
  snapshot.games.forEach((game: RecordValue, position: number) => {
    const appid = game.appid;
    insert('games',{appid,...mapped(game,gameFields),position,detail_json:detail(game,[...Object.keys(gameFields),'appid','tags','players','reviews','storeReviews','catalog','marketing'])});
    game.tags.forEach((tag: string, position: number) => insert('steam_tags',{appid,position,tag,source_url:game.provenance?.sourceUrl ?? game.storeUrl,collected_at:game.observedAt}));
    for (const metric of ['players','reviews','storeReviews']) {
      const value = game[metric];
      const runId = value.refresh?.runId ?? null;
      insert('metric_observations',{
        observation_id:`${appid}:${metric}:${runId ?? 'saved-store'}:${value.observedAt ?? 'undated'}`,
        appid,metric,...mapped(value,metricFields),evidence_status:evidenceStatus(value,metric === 'storeReviews'),
        freshness:metricFreshness(value.observedAt,snapshot.meta.builtAt,value.freshness),freshness_as_of:snapshot.meta.builtAt,
        // observedAt is collection time; never invent a source measurement time.
        measured_at:value.sourceTimestamp ?? null,
        unit:metric === 'players' ? 'concurrent_players' : 'reviews',
        method_version:metric === 'storeReviews' ? 'saved-store-html-1.0' : `steam-metrics-${snapshot.meta.steamMetricsIntegration?.adapterVersion ?? '1.0'}`,
        run_id:runId,original_keys_json:JSON.stringify(Object.keys(value)),detail_json:detail(value,Object.keys(metricFields)),
      });
    }
    const catalog = game.catalog;
    insert('catalog_games',{appid,...mapped(catalog,catalogFields),identity_json:detail(catalog.identity,['crosswalk']),detail_json:detail(catalog,[...Object.keys(catalogFields),...catalogArrays,'identity','provenance'])});
    catalog.identity.crosswalk.forEach((item: RecordValue, position: number) => insert('identity_crosswalks',{
      appid,igdb_id:item.gameId,position,external_record_id:item.id,steam_uid:item.uid,external_source_id:item.sourceId,source_name:item.sourceName,source_url:item.url,source_updated_at:item.sourceUpdatedAt,rule_version:catalog.identity.ruleVersion,
      detail_json:detail(item,['id','uid','gameId','sourceId','sourceName','url','sourceUpdatedAt']),
    }));
    catalog.platforms.forEach((item: RecordValue, position: number) => insert('catalog_platforms',{appid,position,source_id:item.id,name:item.name,detail_json:detail(item,['id','name'])}));
    for (const collection of ['developers','publishers','companies']) catalog[collection].forEach((item: RecordValue, position: number) => {
      const company = collection === 'companies' ? item.company : item;
      const roleFlag=(field: string) => collection === 'companies' && typeof item[field] === 'boolean' ? Number(item[field]) : null;
      insert('catalog_company_roles',{appid,collection,position,source_id:item.id,company_id:company.id,name:company.name,developer:roleFlag('developer'),publisher:roleFlag('publisher'),porting:roleFlag('porting'),supporting:roleFlag('supporting'),detail_json:detail(item,collection === 'companies' ? ['id','company','developer','publisher','porting','supporting'] : ['id','name'])});
    });
    for (const collection of ['genres','themes','keywords']) catalog[collection].forEach((item: RecordValue, position: number) => insert('catalog_labels',{appid,collection,position,source_id:item.id,name:item.name,detail_json:detail(item,['id','name'])}));
    for (const collection of ['websites','officialWebsites']) catalog[collection].forEach((item: RecordValue, position: number) => insert('catalog_links',{appid,collection,position,source_id:item.id,url:item.url,type_id:item.type?.id,type_name:item.type?.type,trusted:Number(item.trusted),detail_json:detail(item,['id','url','type','trusted'])}));
    catalog.releaseDates.forEach((item: RecordValue, position: number) => insert('catalog_releases',{appid,position,source_id:item.id,release_at:item.date,display_date:item.displayDate,platform_id:item.platform?.id,platform_json:JSON.stringify(item.platform),region_id:item.region?.id,region_json:JSON.stringify(item.region),date_format_json:JSON.stringify(item.dateFormat),status_json:JSON.stringify(item.status),detail_json:detail(item,['id','date','displayDate','platform','region','dateFormat','status'])}));
    for (const [field, value] of Object.entries(catalog.provenance)) insert('catalog_field_provenance',{appid,field,...mapped(value as RecordValue,provenanceFields),detail_json:detail(value as RecordValue,Object.keys(provenanceFields))});
    catalog.conflicts.forEach((item: RecordValue, position: number) => insert('catalog_conflicts',{appid,position,field:item.field,status:item.status,reason:item.reason,detail_json:detail(item,['field','status','reason'])}));
    const marketing = game.marketing;
    insert('marketing_profiles',{appid,...mapped(marketing,marketingFields),deep_proof:Number(marketing.deepProof ?? false),exhaustive:Number(marketing.exhaustive ?? false),original_keys_json:JSON.stringify(Object.keys(marketing)),detail_json:detail(marketing,[...Object.keys(marketingFields),'events'])});
    marketing.events.forEach((item: RecordValue, position: number) => {
      const eventDateKinds = ['publication_and_event','platform_release_date','presskit_release_date'];
      const publicationDateKinds = ['publication_and_event','publication_date_demo_available_by'];
      insert('marketing_events',{appid,position,...mapped(item,eventFields),event_at:eventDateKinds.includes(item.dateKind) ? item.date : null,published_at:publicationDateKinds.includes(item.dateKind) ? item.date : null,discovered_at:null,detail_json:detail(item,Object.keys(eventFields))});
    });
  });
  const validation = snapshot.meta.steamDateValidation;
  if (validation?.probes) validation.probes.forEach((probe: RecordValue, position: number) => {
    assert(snapshot.games.some((game: RecordValue) => game.appid === probe.appid), `review-window AppID outside saved catalog: ${probe.appid}`);
    insert('review_windows',{appid:probe.appid,run_id:validation.runId,position,period_start:probe.period.start,period_end_inclusive:probe.period.endInclusive,matching_reviews:probe.totalMatching,collection_window_start:validation.fetchWindow?.start,collection_window_end:validation.fetchWindow?.end,measured_at:null,collected_at:null,complete_enumeration:Number(probe.completeEnumeration),boundary_exercised:Number(probe.boundaryExercised),source_status:probe.status,source_scope:validation.note,detail_json:detail(probe,['appid','period','totalMatching','completeEnumeration','boundaryExercised','status'])});
  });
  return statements;
}

