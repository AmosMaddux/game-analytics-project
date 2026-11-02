import { Component, useCallback, useEffect, useMemo, useState } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { Browse, Overview } from './Browse';
import { GameDetail, MarketingPage } from './GameDetail';
import { Methods } from './Methods';
import { ResearchChat, SettingsPage } from './Settings';
import { SourceHealth } from './SourceHealth';
import { rankGenres } from './model';
import { Icon, PageTitle, route } from './ui';
import type { GameFilters, ScoredGenreRow, Settings, Snapshot } from './types';

export interface RouteState { path: string[]; params: GameFilters }
export function parseRoute(hash: string): RouteState {
  try {
    const url = new URL(hash.replace(/^#/, '') || '/overview', 'https://local.invalid');
    const path = url.pathname.split('/').filter(Boolean).map(part => decodeURIComponent(part));
    if (path[0] === 'games') path[0] = 'search';
    if (path[0] === 'coverage') path[0] = 'methods';
    if (!path.length) path.push('overview');
    return { path, params: Object.fromEntries(url.searchParams) };
  } catch { return { path: ['not-found'], params: {} }; }
}
export function assertSnapshot(value: unknown): asserts value is Snapshot {
  if (!value || typeof value !== 'object') throw new Error('Invalid saved snapshot.');
  const data = value as Partial<Snapshot>;
  if (!Array.isArray(data.games) || !Array.isArray(data.genres) || !data.meta || !data.meta.coverage || !Array.isArray(data.meta.cohorts)) throw new Error('Invalid saved snapshot.');
  const ids = new Set<string>();
  for (const game of data.games) {
    if (!game || typeof game.id !== 'string' || String(game.appid) !== game.id || ids.has(game.id) || typeof game.name !== 'string' || !Array.isArray(game.tags) || !game.players || !game.reviews || !game.storeReviews || !game.marketing || !Array.isArray(game.marketing.events) || !Array.isArray(game.marketing.caveats)) throw new Error('Invalid or duplicate Steam identity in saved snapshot.');
    ids.add(game.id);
  }
}
async function fetchSnapshot(signal: AbortSignal): Promise<Snapshot> {
  const response = await fetch('/api/snapshot', { signal, headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error('The saved research database could not be read. Check that the application has been seeded and the local server is running.');
  const value: unknown = await response.json();
  assertSnapshot(value);
  return value;
}
async function fetchSettings(signal?: AbortSignal): Promise<Settings> {
  const response = await fetch('/api/settings', { signal, headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error('Saved preferences could not be read from the local database.');
  const value: unknown = await response.json();
  if (!value || typeof value !== 'object') throw new Error('Saved preferences have an unsupported format.');
  const settings = value as Partial<Settings>;
  if (!settings.preferences || typeof settings.preferences.monthlyBudgetUsd !== 'number' || !Number.isFinite(settings.preferences.monthlyBudgetUsd) || typeof settings.preferences.compactTables !== 'boolean' || typeof settings.preferences.showEvidenceDetails !== 'boolean' || !settings.usage || settings.usage.status !== 'unknown' || !Array.isArray(settings.providers) || settings.providers.some(provider => typeof provider.label !== 'string' || provider.connected !== false || provider.status !== 'unavailable') || typeof settings.persistence !== 'string') throw new Error('Saved preferences have an unsupported format.');
  return settings as Settings;
}
const nav = [['overview', 'Overview'], ['search', 'Search'], ['marketing', 'Marketing info'], ['chat', 'Research chat'], ['methods', 'Data / sources / methods'], ['sources', 'Source health'], ['settings', 'Usage & settings']] as const;
export function Shell({ page, children, compact = false }: { page: string; children: ReactNode; compact?: boolean }) {
  const activePage = ['game', 'genre'].includes(page) ? 'search' : page;
  const label = nav.find(([key]) => key === activePage)?.[1] || 'Research';
  return <><a className="skip" href="#main" onClick={event => { event.preventDefault(); document.getElementById('main')?.focus(); }}>Skip to research</a><aside className="sidebar"><a href="#/overview" className="brand" aria-label="Fieldnote home"><span className="brand-mark" aria-hidden="true"><svg viewBox="0 0 32 32"><path d="M7 25V7h20l-4 5H13v4h10l-4 5h-6v4Z" fill="currentColor"/></svg></span><span>fieldnote<small>GAME INTELLIGENCE</small></span></a><div className="workspace-label">WORKSPACE <span>01</span></div><nav aria-label="Main navigation">{nav.map(([id, name]) => <a key={id} href={route(id)} className={`nav-link ${activePage === id ? 'active' : ''}`} aria-current={activePage === id ? 'page' : undefined}><span><Icon name={id}/></span>{name}{activePage === id && <i aria-hidden="true"/>}</a>)}</nav><div className="sidebar-bottom"><div className="sidebar-grid" aria-hidden="true"><span>F / N</span></div><span className="status-dot"/> LOCAL FOUNDATION<p>Explore the signal.<br/>Understand the source.</p><a href="#/methods">About the data <span>→</span></a></div></aside><div className={`workspace ${compact ? 'compact-tables' : ''}`}><div className="topbar"><span>Workspace <span className="slash">/</span> <b>{label}</b></span><div className="platforms"><span className="selected"><span className="platform-icon" aria-hidden="true">▣</span> PC / STEAM</span><span className="snapshot-status">SAVED EVIDENCE</span></div></div><main id="main" tabIndex={-1}>{children}</main><footer><span>FIELDNOTE <b>/</b> GAME INTELLIGENCE</span><span>Investigate. Compare. Find your next move.</span></footer></div></>;
}
class ViewBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(_error: Error, _info: ErrorInfo) { /* No source records or sensitive details are logged. */ }
  render() { return this.state.failed ? <section className="panel unavailable-panel" role="alert"><h2>This view could not be displayed.</h2><p>The stored evidence was not changed. Return to another page or reload the workspace.</p><a className="button" href="#/overview">Return to overview</a></section> : this.props.children; }
}
export function AppContent({ data, ranks, location, now, settings, settingsLoading = false, settingsError = null, setFilter = () => {}, resetFilters = () => {}, retrySettings = () => {}, saveSettings = async () => {} }: { data: Snapshot; ranks: ScoredGenreRow[]; location: RouteState; now: number; settings: Settings | null; settingsLoading?: boolean; settingsError?: string | null; setFilter?: (key: string, value: string) => void; resetFilters?: () => void; retrySettings?: () => void; saveSettings?: (preferences: Pick<Settings['preferences'], 'monthlyBudgetUsd' | 'compactTables' | 'showEvidenceDetails'>) => Promise<void> }) {
  const { path, params } = location;
  const common = { data, ranks, params, setFilter };
  switch (path[0]) {
    case 'overview': return <Overview {...common}/>;
    case 'search': return <Browse {...common} resetFilters={resetFilters} now={now}/>;
    case 'genre': return <Browse {...common} resetFilters={resetFilters} genre={path.slice(1).join('/')} now={now}/>;
    case 'game': return <GameDetail data={data} id={path[1] || ''} now={now} showDetails={settings?.preferences.showEvidenceDetails ?? true}/>;
    case 'marketing': return <MarketingPage data={data} category={params.category || ''} setCategory={value => setFilter('category', value)}/>;
    case 'methods': return <Methods data={data} ranks={ranks}/>;
    case 'sources': return <SourceHealth/>;
    case 'chat': return <ResearchChat/>;
    case 'settings': return <SettingsPage settings={settings} loading={settingsLoading} error={settingsError} retry={retrySettings} save={saveSettings}/>;
    default: return <><PageTitle eyebrow="NOT FOUND" title="This page isn’t in the workspace." description="Use the navigation to return to your research."/><a className="button" href="#/overview">Open overview</a></>;
  }
}
export function App() {
  const [location, setLocation] = useState<RouteState>(() => parseRoute(window.location.hash));
  const [data, setData] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [settingsAttempt, setSettingsAttempt] = useState(0);
  const [now, setNow] = useState(Date.now);
  const ranks = useMemo(() => data ? rankGenres(data.games, data.genres) : [], [data]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(null);
    fetchSnapshot(controller.signal).then(snapshot => { setData(snapshot); setLoading(false); }).catch((reason: unknown) => { if (!controller.signal.aborted) { setError(reason instanceof Error ? reason.message : 'The saved research database could not be read.'); setLoading(false); } });
    return () => controller.abort();
  }, [attempt]);
  useEffect(() => {
    const controller = new AbortController();
    setSettingsLoading(true); setSettingsError(null);
    fetchSettings(controller.signal).then(value => { setSettings(value); setSettingsLoading(false); }).catch(() => { if (!controller.signal.aborted) { setSettingsError('Saved preferences could not be read. Research pages remain available.'); setSettingsLoading(false); } });
    return () => controller.abort();
  }, [settingsAttempt]);
  useEffect(() => {
    const onHashChange = () => { setLocation(parseRoute(window.location.hash)); window.scrollTo(0, 0); document.getElementById('main')?.focus({ preventScroll: true }); };
    const onKeyDown = (event: KeyboardEvent) => { if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return; const element = document.activeElement as HTMLElement | null; if (element && (['INPUT', 'SELECT', 'TEXTAREA'].includes(element.tagName) || element.isContentEditable)) return; const input = document.querySelector<HTMLInputElement>('#search') || document.querySelector<HTMLInputElement>('#genre-search'); if (input) { event.preventDefault(); input.focus(); } };
    window.addEventListener('hashchange', onHashChange); window.addEventListener('keydown', onKeyDown);
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => { window.removeEventListener('hashchange', onHashChange); window.removeEventListener('keydown', onKeyDown); window.clearInterval(timer); };
  }, []);
  useEffect(() => { const page = location.path[0]; document.title = `${page === 'game' ? data?.games.find(game => game.id === location.path[1])?.name || 'Game' : nav.find(([key]) => key === page)?.[1] || (page === 'genre' ? 'Genre intelligence' : 'Research')} · Fieldnote`; }, [location.path, data]);
  const setFilter = useCallback((key: string, value: string) => { setLocation(current => { const params = { ...current.params }; if (value) params[key] = value; else delete params[key]; const next = { ...current, params }; const path = current.path.map(encodeURIComponent).join('/'); window.history.replaceState(null, '', route(path, params)); return next; }); }, []);
  const resetFilters = useCallback(() => { setLocation(current => { window.history.replaceState(null, '', route(current.path.map(encodeURIComponent).join('/'))); return { ...current, params: {} }; }); }, []);
  const saveSettings = useCallback(async (preferences: Pick<Settings['preferences'], 'monthlyBudgetUsd' | 'compactTables' | 'showEvidenceDetails'>) => {
    const response = await fetch('/api/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(preferences) });
    if (!response.ok) throw new Error('Save failed.');
    // Read back committed values instead of assuming the write was persisted.
    const saved = await fetchSettings();
    setSettings(saved);
  }, []);
  return <Shell page={location.path[0]} compact={settings?.preferences.compactTables}><ViewBoundary key={`${location.path.join('/')}:${attempt}`}><div className="foundation-banner"><span className="foundation-label">MILESTONE 3 · BOUNDED COLLECTION</span><span>Saved source evidence · page loads never refresh providers</span></div>{loading && <section className="panel unavailable-panel" role="status"><span className="loading-mark" aria-hidden="true"/><h1>Opening your research workspace…</h1><p>Reading the saved evidence from the application database.</p></section>}{!loading && error && <section className="panel unavailable-panel" role="alert"><h1>Research database unavailable</h1><p>{error}</p><button className="button" onClick={() => setAttempt(value => value + 1)}>Try again</button></section>}{!loading && !error && data && <AppContent data={data} ranks={ranks} location={location} now={now} settings={settings} settingsLoading={settingsLoading} settingsError={settingsError} setFilter={setFilter} resetFilters={resetFilters} retrySettings={() => setSettingsAttempt(value => value + 1)} saveSettings={saveSettings}/>}</ViewBoundary></Shell>;
}
