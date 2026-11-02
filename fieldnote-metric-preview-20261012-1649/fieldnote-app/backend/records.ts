/** Field maps keep the compatibility response derived from normalized columns. */
export type RecordValue = Record<string, any>;
export type FieldMap = Record<string, string>;
export const gameFields: FieldMap = {id:'source_id', name:'name', steamName:'steam_name', genre:'genre', cohort:'cohort_id', releaseDate:'release_display', storeUrl:'store_url', observedAt:'collected_at'};
export const metricFields: FieldMap = {value:'value', observedAt:'collected_at', sourceTimestamp:'measured_at', sourceUrl:'source_url', sourceLabel:'source_label', scope:'source_scope', status:'source_status', freshness:'source_freshness'};
export const catalogFields: FieldMap = {status:'match_status', source:'source', sourceId:'igdb_id', sourceUrl:'source_url', name:'name', summary:'summary', firstReleaseDate:'first_release_at', fetchedAt:'collected_at', sourceUpdatedAt:'source_updated_at'};
export const provenanceFields: FieldMap = {sourceProvider:'source_provider', sourceEntityId:'source_entity_id', fieldPath:'field_path', sourceUrl:'source_url', fetchedAt:'collected_at', sourceUpdatedAt:'source_updated_at', eventOrObservationTime:'measured_at', unit:'unit', status:'source_status'};
export const marketingFields: FieldMap = {status:'source_status', sourceUrl:'source_url', sourceLabel:'source_label', organization:'organization', sourceRole:'source_role', summary:'summary', observedAt:'collected_at', deepProof:'deep_proof', exhaustive:'exhaustive'};
export const eventFields: FieldMap = {type:'event_type', date:'source_date', dateKind:'date_kind', url:'source_url', summary:'summary', observedAt:'collected_at', discoveredOn:'discovery_source_url'};
export const catalogArrays = ['platforms','developers','publishers','companies','genres','themes','keywords','websites','officialWebsites','releaseDates','conflicts'] as const;
export function omit(record: RecordValue, fields: Iterable<string>): RecordValue {
  const excluded = new Set(fields);
  return Object.fromEntries(Object.entries(record).filter(([key]) => !excluded.has(key)));
}
export function detail(record: RecordValue, fields: Iterable<string>): string { return JSON.stringify(omit(record, fields)); }
export function mapped(record: RecordValue, fields: FieldMap): RecordValue {
  return Object.fromEntries(Object.entries(fields).map(([field, column]) => [column, typeof record[field] === 'boolean' ? Number(record[field]) : record[field] ?? null]));
}
export function restore(row: RecordValue, fields: FieldMap, originalKeys?: string[]): RecordValue {
  const result = JSON.parse(row.detail_json || '{}');
  for (const [field, column] of Object.entries(fields)) if (!originalKeys || originalKeys.includes(field)) result[field] = row[column];
  return result;
}
