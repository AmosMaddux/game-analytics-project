import type { ReactNode } from 'react';
import { ageLabel, hasValue, metricFreshness, number, safeUrl } from './model';
import type { Metric } from './types';

export const readable = (value?: string | null) => String(value || 'Unknown').replaceAll('_', ' ');
export function formatDate(value?: string | null): string {
  if (!value || !Number.isFinite(Date.parse(value))) return 'Undated';
  return new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}
export function stamp(value?: string | null): string {
  if (!value || !Number.isFinite(Date.parse(value))) return 'Not captured';
  return new Date(value).toLocaleString('en-GB', { timeZone: 'UTC', hour12: false }) + ' UTC';
}
export function windowText(start?: string | null, end?: string | null): string {
  if (!start) return 'Not captured';
  if (!end || start === end) return stamp(start);
  const time = (value: string) => Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleTimeString('en-GB', { timeZone: 'UTC', hour12: false }) : 'Unknown';
  return formatDate(start) === formatDate(end) ? `${formatDate(start)}, ${time(start)}–${time(end)} UTC` : `${stamp(start)} – ${stamp(end)}`;
}
export function formatNumber(value: number | null | undefined, maximumFractionDigits = 1): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString('en-US', { maximumFractionDigits }) : 'Not captured';
}
export function route(path: string, params: Record<string, string | undefined> = {}): string {
  const query = new URLSearchParams(Object.entries(params).filter((entry): entry is [string, string] => !!entry[1])).toString();
  return '#/' + path + (query ? '?' + query : '');
}
export function ExternalLink({ url, children, className = 'source' }: { url?: string | null; children: ReactNode; className?: string }) {
  const href = safeUrl(url);
  return href ? <a className={className} href={href} target="_blank" rel="noopener noreferrer">{children} <span aria-hidden="true">→</span></a> : null;
}
export function Pill({ children, kind = '' }: { children: ReactNode; kind?: string }) { return <span className={`pill ${kind}`}>{children}</span>; }
export function PageTitle({ eyebrow, title, description, extra }: { eyebrow: string; title: string; description: string; extra?: ReactNode }) {
  return <header className="page-heading"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{description}</p></div>{extra}</header>;
}
export function Icon({ name }: { name: string }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true">{name === 'overview' ? <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></> : name === 'search' ? <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></> : name === 'marketing' ? <path d="M4 9v6h4l10 4V5L8 9H4Zm4 6 2 6h3l-2-5M21 9v6"/> : name === 'chat' ? <path d="M4 4h16v12H9l-5 4V4Zm4 5h8M8 12h5"/> : name === 'settings' ? <><path d="M4 6h16M4 12h16M4 18h16"/><circle cx="9" cy="6" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="8" cy="18" r="2"/></> : <><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 4 16 4 16 0V5M4 12c0 4 16 4 16 0"/></>}</svg>;
}
const genrePaths = [
  'M14 41h36M18 41V27l14-12 14 12v14M26 41V30h12v11M32 15V8M27 11h10',
  'm15 39 10-19 10 19M19 32h13M39 42V26M35 30l4-7 7 6M12 47h40',
  'M32 47V20M32 35C17 35 12 27 14 18c12-1 18 5 18 17ZM32 29c13 0 19-8 18-17-12 0-18 6-18 17ZM19 47h26',
  'm32 10 21 38H11l21-38ZM32 21v12M32 39v2',
  'M10 44h12V33h13V22h17M15 18l6-5 6 5-6 5-6-5Z',
  'M12 12h15v8c7-4 12-1 12 4s-5 8-12 4v10H12V12ZM37 38v14h15V27h-9',
  'm17 14 21-4 9 35-21 5-9-36ZM10 20l-2 5 9 27 5-2M31 23l7 6-3 9-7-6 3-9Z',
];
export function GenreArt({ index }: { index: number }) { return <svg viewBox="0 0 64 64" aria-hidden="true"><path d={genrePaths[index] || genrePaths[0]}/></svg>; }
export const shortGenre = (genre: string) => ({ 'Farming / life simulation': 'Farming & life sim', 'Horror / exploration': 'Horror & exploration', 'Platformer / metroidvania': 'Platformer & metroidvania', 'Colony / settlement simulation': 'Colony & settlement sim' } as Record<string, string>)[genre] || genre;
export function MetricFreshness({ metric, now }: { metric: Metric; now: number }) {
  const freshness = metricFreshness(metric, now);
  if (!hasValue(metric)) return <small className="metric-freshness">{readable(metric.evidence?.status || metric.status || 'unknown')} · {readable(metric.refresh?.status || 'no_supported_value')}</small>;
  return <small className={`metric-freshness ${freshness.status === 'stale' ? 'stale-text' : ''}`}>{freshness.status === 'stale' ? 'Stale' : freshness.status === 'unknown' ? 'Freshness unknown' : 'Saved observation'} · {ageLabel(freshness.ageMs)}</small>;
}
export function MetricCard({ metric, label, unit, now, showDetails = true }: { metric: Metric; label: string; unit: string; now: number; showDetails?: boolean }) {
  const freshness = metricFreshness(metric, now);
  const status = metric.evidence?.status || (hasValue(metric) ? ['estimated', 'calculated', 'reported'].includes(metric.status || '') ? metric.status! : 'observed' : metric.status === 'unavailable' ? 'unavailable' : 'unknown');
  return <div className="metric-card"><div className="eyebrow">{label}</div><strong>{number(metric)}</strong><p>{metric.scope || 'No supported observation available.'}</p><div className="metric-meta"><Pill kind={status === 'observed' ? 'green' : status === 'estimated' ? 'amber' : 'neutral'}>{status}</Pill>{hasValue(metric) && freshness.status === 'stale' && <Pill kind="amber">Stale</Pill>}<span>Unit: {metric.evidence?.unit || unit}</span></div><MetricFreshness metric={metric} now={now}/>{showDetails && <dl className="metric-timestamps"><dt>Collected</dt><dd>{stamp(freshness.collectedAt)}</dd><dt>Source measurement time</dt><dd>{stamp(metric.evidence?.measuredAt ?? metric.sourceTimestamp)}{!(metric.evidence?.measuredAt ?? metric.sourceTimestamp) && ' · not supplied by source'}</dd></dl>}<ExternalLink url={metric.sourceUrl}>{metric.sourceLabel || 'Original source'}</ExternalLink>{metric.refresh && <small className="error-note">Saved bounded run: {readable(metric.refresh.status)}. {metric.refresh.reason || 'A saved observation, not a live value.'}{metric.scoreEligible === false && ' Excluded from this run’s score baseline.'}</small>}{metric.error && <small className="error-note">Collection note: {metric.error}</small>}</div>;
}
