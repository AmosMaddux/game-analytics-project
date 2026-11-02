import type { RecordValue } from './records.ts';
export const EVIDENCE_STATUSES = ['observed', 'reported', 'calculated', 'estimated', 'unknown', 'unavailable'] as const;
export type EvidenceStatus = typeof EVIDENCE_STATUSES[number];
export type Freshness = 'fresh' | 'stale' | 'unknown';
/** A daily target is an age policy, not a claim that a collector is active. */
export const METRIC_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export function evidenceStatus(metric: RecordValue, legacyStoreSummary = false): EvidenceStatus {
  if (EVIDENCE_STATUSES.includes(metric.status)) return metric.status;
  if (legacyStoreSummary && metric.status === undefined && typeof metric.value === 'number' && Number.isFinite(metric.value) && typeof metric.sourceUrl === 'string' && typeof metric.observedAt === 'string' && Number.isFinite(Date.parse(metric.observedAt))) return 'observed';
  return metric.status === 'unavailable' || metric.error ? 'unavailable' : 'unknown';
}
export function metricFreshness(collectedAt: string | null, referenceTime: string | number, sourceFreshness?: string | null): Freshness {
  if (sourceFreshness === 'stale' || sourceFreshness === 'stale_cache') return 'stale';
  const collected = collectedAt ? Date.parse(collectedAt) : NaN;
  const reference = typeof referenceTime === 'number' ? referenceTime : Date.parse(referenceTime);
  if (!Number.isFinite(collected) || !Number.isFinite(reference) || reference < collected) return 'unknown';
  return reference - collected >= METRIC_MAX_AGE_MS ? 'stale' : 'fresh';
}
export function observationEvidence(row: RecordValue, now = Date.now()) {
  return {
    status: row.evidence_status as EvidenceStatus,
    freshness: metricFreshness(row.collected_at, now, row.source_freshness),
    measuredAt: row.measured_at,
    collectedAt: row.collected_at,
    unit: row.unit,
    methodVersion: row.method_version,
    sourceScope: row.source_scope,
    sourceUrl: row.source_url,
    freshnessAsOf: new Date(now).toISOString(),
    freshnessTargetHours: 24,
    fixture: false,
  };
}
