import type { Catalog, Metric, ScoredGenreRow, Snapshot, TimeWindow } from './types';
import { GENRE_TAG_METHOD, POPULARITY_SCORE_METHOD, safeUrl } from './model';
import { ExternalLink, PageTitle, Pill, formatDate, formatNumber, readable, stamp, windowText } from './ui';

type MethodsProps = { data: Snapshot; ranks: ScoredGenreRow[] };

function observationWindow(values: (string | null | undefined)[]): TimeWindow {
  const times = values.filter((value): value is string =>
    typeof value === 'string' && Number.isFinite(Date.parse(value)),
  ).sort((a, b) => Date.parse(a) - Date.parse(b));
  return { start: times[0] ?? null, end: times.at(-1) ?? null };
}

function supportedMetric(metric: Metric): boolean {
  const status = metric.evidence?.status ?? metric.status ?? (safeUrl(metric.sourceUrl) && metric.observedAt && Number.isFinite(Date.parse(metric.observedAt)) ? 'observed' : 'unknown');
  return typeof metric.value === 'number' && Number.isFinite(metric.value) && metric.value >= 0 && ['observed','reported'].includes(status);
}

function SteamMethods({ data, ranks }: MethodsProps) {
  const metrics = data.meta.steamMetricsIntegration;
  const savedWindow = observationWindow(data.games.flatMap(game => [game.players.observedAt, game.reviews.observedAt]));
  const collection = savedWindow;
  const scoring = observationWindow(ranks.flatMap(row => [row.observedStart, row.observedEnd]));
  return <section className="panel definitions steam-methods" aria-labelledby="steam-methods-heading">
    <h2 id="steam-methods-heading">Steam metric collection</h2>
    <div>
      <h3>Current saved observation window</h3>
      <p>{windowText(collection.start, collection.end)}. These are collection dates from the metric values currently displayed. Observations can come from separate bounded runs; they are not synchronized readings. See <a href="#/sources">Source health</a> for current freshness, missingness and job outcomes.</p>
    </div>
    <div>
      <h3>Original imported current-metric run</h3>
      <p>{metrics?.status === 'imported'
        ? <>Run {metrics.runId} · {readable(metrics.runStatus)} · {windowText(metrics.fetchWindow.start,metrics.fetchWindow.end)}. The preserved import accepted {metrics.accepted.players} current-player values and {metrics.accepted.reviews} all-time review totals. It retained {metrics.staleCache.players} older player counts and {metrics.staleCache.reviews} older review totals as stale cache.</>
        : 'No original bounded Steam run metadata is stored.'} These historical run counts are separate from current catalog coverage and do not change when later jobs are added.</p>
      {metrics?.status === 'imported' && <p>Original run missing: {metrics.missing.players} player counts and {metrics.missing.reviews} review totals. Rejected: {metrics.rejected.players} player observations and {metrics.rejected.reviews} review observations. Failed or missing observations never become zero.</p>}
      <p>Current scoring window: {windowText(scoring.start, scoring.end)}. Only source-supported observed values not marked ineligible enter the saved score denominator. Retained numeric cache can make overall metric coverage larger than scoring coverage.</p>
    </div>
    <div>
      <h3>All-time review scope</h3>
      <p>All-language, Steam-purchase, both positive and negative reviews; off-topic activity filtered. Only the exact verified Steam AppID and explicit all-time request filters can replace this metric. Date-window feasibility probes stay separate and cannot replace cumulative totals.</p>
    </div>
    <div>
      <h3>Initial date-window review feasibility</h3>
      <p>{metrics?.dateProbe
        ? <>{metrics.dateProbe.accepted} validated aggregate probe records; {metrics.dateProbe.rejected} rejected or failed records. {metrics.dateProbe.note}</>
        : 'No date-window aggregate probe artifact has been imported for this current-metric run.'} These are endpoint feasibility observations, not a review history, player history or a validated trend. No review text or reviewer identities are included.</p>
      {!!metrics?.dateProbe?.failures?.length && <ul className="fineprint">
        {metrics.dateProbe.failures.map((failure, index) => <li key={`${failure.appid}-${index}`}>
          Steam app {failure.appid} · {readable(failure.purpose)}{failure.httpStatus !== undefined ? ` · HTTP ${failure.httpStatus}` : ''}: {failure.reason}
        </li>)}
      </ul>}
      {!!metrics?.dateProbe?.failures?.length && <p>An HTTP 200 response alone does not establish valid evidence. A failed schema check remains a failed request, even when a separate follow-up later succeeds.</p>}
    </div>
  </section>;
}

function SteamDateMethods({ data }: { data: Snapshot }) {
  const validation = data.meta.steamDateValidation;
  if (validation?.status !== 'imported') return null;
  return <section className="panel definitions steam-date-methods" aria-labelledby="date-methods-heading">
    <h2 id="date-methods-heading">Latest date-window feasibility follow-up</h2>
    <div>
      <h3>Separate saved run</h3>
      <p>{windowText(validation.fetchWindow.start, validation.fetchWindow.end)} · {readable(validation.runStatus)} · {validation.runId}.</p>
      <p>{validation.note} The earlier failed date request remains preserved in the current-metric run above.</p>
    </div>
    <div>
      <h3>Bounded date-window checks</h3>
      <p>{validation.completeEnumerations} / {validation.targetCount} complete matching-count enumerations; {validation.consistentPartitions} / {validation.targetCount} consistent partitions. Overall validation: {readable(validation.overallVerdict)}.</p>
      <p>{validation.checksPassed} / {validation.targetCount} targets passed enumeration, partition and exercised-boundary checks. {validation.emptyWindows} explicit empty windows had no boundary to exercise. {validation.inconclusive} other inconclusive targets · {validation.unattempted} not attempted. {validation.acceptedAggregateRequests} validated aggregate requests; {validation.rejectedAggregateRequests} rejected or failed requests.</p>
      <p>A completed collection run is not the same as a fully validated method. Empty windows can support an observed zero count while leaving timestamp-boundary behavior inconclusive.</p>
    </div>
    <div className="method-table" tabIndex={0} role="region" aria-label="Saved date-window validation results, scroll horizontally">
      <table>
        <thead><tr><th scope="col">Game / saved period</th><th scope="col" className="numeric">Matching reviews</th><th scope="col">Validation status</th><th scope="col">Enumeration / partition / boundary</th></tr></thead>
        <tbody>{validation.probes.map(probe => <tr key={probe.appid}>
          <th scope="row"><a href={`#/game/${data.games.find(game => game.appid === probe.appid)?.id ?? probe.appid}`}>{data.games.find(game => game.appid === probe.appid)?.name ?? `Steam app ${probe.appid}`}</a>
            {probe.period && <small>{formatDate(probe.period.start)} – {formatDate(probe.period.endInclusive)}, UTC inclusive</small>}
          </th>
          <td className={`numeric ${probe.totalMatching === null ? 'missing' : ''}`}>{probe.totalMatching === null ? 'Not captured' : formatNumber(probe.totalMatching, 0)}</td>
          <td>{readable(probe.status)}</td>
          <td>Enumeration: {probe.completeEnumeration ? 'complete' : 'not established'}<br />Partition: {probe.partitionMatches ? 'consistent' : 'not established'}<br />Timestamp boundary: {probe.boundaryExercised ? 'exercised' : 'not exercised'}</td>
        </tr>)}</tbody>
      </table>
    </div>
    <p className="catalog-wide">These endpoint checks cover {validation.targetCount} selected games only. Counts describe surviving matching reviews observed during collection, not immutable historical totals. They do not establish a market-wide result, review time series, player history or trend.</p>
  </section>;
}

const catalogFields: [keyof Catalog, string][] = [
  ['name', 'Name'], ['summary', 'Summary'], ['developers', 'Developer'], ['publishers', 'Publisher'],
  ['companies', 'Company roles'], ['platforms', 'Platforms'], ['releaseDates', 'Platform release records'],
  ['firstReleaseDate', 'First release date'], ['genres', 'IGDB genres'], ['themes', 'IGDB themes'],
  ['keywords', 'IGDB keywords'], ['websites', 'Website records'], ['officialWebsites', 'Official website · IGDB label'],
];

function CatalogMethods({ data }: { data: Snapshot }) {
  const catalog = data.meta.catalogIntegration;
  const total = data.games.length;
  const matched = data.games.filter(game => game.catalog?.status === 'matched').length;
  const currentWindow = observationWindow(data.games.map(game => game.catalog?.fetchedAt));
  const fieldCount = (key: keyof Catalog) => data.games.filter(game => { const value = game.catalog?.[key]; return Array.isArray(value) ? value.length > 0 : typeof value === 'string' ? value.trim().length > 0 : value !== null && value !== undefined; }).length;
  const conflicts = data.games.flatMap(game => (game.catalog?.conflicts ?? []).map(conflict => ({ game, conflict })));
  return <section className="panel definitions catalog-methods" aria-labelledby="catalog-methods-heading">
    <h2 id="catalog-methods-heading">IGDB catalog integration</h2>
    <div>
      <h3>{matched} / {total} games enriched</h3>
      <p>{catalog?.status === 'imported'
        ? <>Original import run: {readable(catalog.runStatus)}{catalog.runId ? ` · ${catalog.runId}` : ''}. {catalog.unmatched} unmatched · {catalog.ambiguous} ambiguous · {catalog.quarantined} quarantined · {catalog.unattempted} unattempted. These statuses are not zero-valued catalog observations.</>
        : 'No original IGDB import metadata is stored. Current accepted catalog records are counted above.'}</p>
      <p>Current catalog fetch window: {windowText(currentWindow.start,currentWindow.end)}. Original imported IGDB window: {windowText(catalog?.fetchWindow?.start, catalog?.fetchWindow?.end)}. Browser pages only read saved evidence through the local application API; they never request live IGDB data.</p>
    </div>
    <div>
      <h3>Source ownership stays explicit</h3>
      <p>Accepted IGDB records supply catalog titles, summaries, company roles, platforms and provider taxonomies. Steam controls the Steam release display, concurrent players, review totals and recurring mechanic/theme tags. Editorial research genres and the score formula are unchanged. A catalog refresh never refreshes Steam observations.</p>
    </div>
    <div>
      <h3>Identity before enrichment</h3>
      <p>Only an exact Steam AppID from the verified Steam external-game source, a compatible name and a main-game record can attach. Saved Steam identity is checked again. Ambiguous, duplicate, shared-provider identities and parent/version records are quarantined; title similarity alone is never a join. The proposed pilot identity-coverage target was 33 / 36. {(catalog?.matched ?? 0) >= 33 ? 'The original import reached that historical target.' : 'The original import did not record reaching that historical target.'} Current coverage is shown above; bounded expansion uses versioned editorial mappings and preserves missing Steam tags. Catalog coverage alone does not complete Milestone 1. Its scoped acceptance depends on separate source-validation checks; this private pilot does not establish production readiness.</p>
    </div>
    <div>
      <h3>Conflicts, missingness and rights</h3>
      <p>{conflicts.length} current catalog conflict records are retained. Both provider names and release records remain in the downloadable snapshot. Steam dates and cross-platform IGDB dates have different scopes; unknown region, precision or phase stays unknown. Empty fields mean not captured, not confirmed absence. Source attribution and fetch/provider-update times travel with accepted fields. Commercial use, retention and broader release permissions still need review.</p>
    </div>
    <div className="catalog-field-coverage" aria-label="IGDB field coverage">
      {catalogFields.map(([key, label]) => <div key={key}><span>{label}</span><b>{fieldCount(key)} / {total}</b></div>)}
    </div>
    {!!conflicts.length && <details className="catalog-wide catalog-details">
      <summary>Inspect {conflicts.length} retained provider conflicts</summary>
      <ul className="catalog-releases">{conflicts.map(({ game, conflict }, index) => <li key={`${game.id}-${conflict.field}-${index}`}>
        <b><a href={`#/game/${game.id}`}>{game.name}</a> · {readable(conflict.field)} · {readable(conflict.status)}</b>
        <span>{conflict.reason}</span>
        {conflict.comparisonScope && <span>Comparison scope: {conflict.comparisonScope}</span>}
        {conflict.chosenSource && <span>Display source: {conflict.chosenSource}{conflict.ruleVersion ? ` · rule ${conflict.ruleVersion}` : ''}</span>}
        {typeof conflict.steam?.value === 'string' && <span>Steam: {conflict.steam.value}</span>}
        {typeof conflict.igdb?.value === 'string' && <span>IGDB: {conflict.igdb.value}</span>}
        <ExternalLink url={conflict.steam?.sourceUrl}>Steam conflict source</ExternalLink>{' '}
        <ExternalLink url={conflict.igdb?.sourceUrl}>IGDB conflict source</ExternalLink>
      </li>)}</ul>
    </details>}
  </section>;
}

function RankingMethods({ data, ranks }: MethodsProps) {
  const supported = ranks.filter(row => row.observedCount > 0).length;
  const scoring = observationWindow(ranks.flatMap(row => [row.observedStart, row.observedEnd]));
  return <section className="panel definitions" aria-labelledby="ranking-methods-heading">
    <h2 id="ranking-methods-heading">How the genre ranking works</h2>
    <div>
      <h3>Popularity Score · heuristic v{POPULARITY_SCORE_METHOD.version}</h3>
      <p>A provisional 0–100 relative engagement proxy, built from concurrent-player observations. It is not calibrated market popularity, a percentile, a probability, market share or a sales estimate. A score of 100 means the strongest measured genre in this snapshot, not perfect or global popularity.</p>
    </div>
    <div>
      <h3>70% median + 30% mean, on a log scale</h3>
      <p className="score-formula">signal = 0.30 × ln(1 + mean) + 0.70 × ln(1 + median)<br />Popularity Score = 100 × signal ÷ max(signal across all rankable genres)</p>
      <p>ln is the natural logarithm. The median has 70% weight to emphasize the typical observed game; the mean has 30% to retain some signal from hits. The logarithm compresses large values. These weights are a product choice, not empirically validated or fitted to outcomes; outlier influence is reduced, not eliminated.</p>
    </div>
    <div>
      <h3>One global, fixed saved-snapshot baseline</h3>
      <p>The maximum uses every genre with supported observations in the complete saved snapshot, before any search, game filter or page selection. Scores display with one decimal place; ranking uses unrounded scores, highest first, with alphabetical ties. If every supported signal is zero, supported genres score 0.0; unknown genres remain unranked with a null score.</p>
    </div>
    <div>
      <h3>Provisional · small sample</h3>
      <p>{supported} genres have accepted player observations; actual per-genre denominators are shown below. There is no uncertainty or sample-size adjustment. This editorial sample is not representative of the whole genre or Steam. Selection and missing coverage can materially change the ranking, so small score differences are not evidence of a reliable market advantage.</p>
    </div>
    <div>
      <h3>Average players per observed game</h3>
      <p>Average (arithmetic mean) = sum of supported concurrent-player observations in a genre ÷ number of games with supported observations in that genre. Raw mean, median and total remain visible below. The score combines the mean and median; it does not rank by raw total.</p>
    </div>
    <div>
      <h3>Median alongside the mean</h3>
      <p>The median is the middle player count after sorting supported observations. For an even number of games, it is the mean of the two middle values. Averaging does not eliminate outliers: a high-player game such as Stardew Valley can strongly raise the farming mean. The median-weighted log blend reduces this influence without discarding it.</p>
    </div>
    <div>
      <h3>Missing values never enter the denominator</h3>
      <p>Only finite, non-negative numeric values marked observed, with a valid HTTP(S) source URL and parseable collection timestamp, are included; observations explicitly marked ineligible for scoring are excluded. Each game belongs to one editorial group and contributes once. A captured zero is included in both the mean and median. Unknown or unsupported counts are excluded from both the sum and the denominator. A genre without supported observations has no score; missing is never treated as zero. A missing rank stays unavailable. Cached readings explicitly marked ineligible remain outside the score, even when displayed on a game page.</p>
    </div>
    <div>
      <h3>Future target: up to 100 games per genre</h3>
      <p>A future comparison would select the top 100 eligible games in each genre by concurrent players at a comparable timestamp. If fewer than 100 eligible games have supported observations, use the actual number available as the denominator and disclose it. This snapshot does not yet contain that top-100 sample. Broader coverage may change both the ranking and its calibration.</p>
    </div>
    <div>
      <h3>Relative scores are not a trend measure</h3>
      <p>A genre’s score can change when the leading genre changes, even if its own player observations stay the same. Do not compare these normalized scores as a historical trend without a future fixed calibration. A single snapshot does not measure momentum or how long a game was popular.</p>
    </div>
    <div>
      <h3>One collection window, not one instant</h3>
      <p>Accepted scoring observations were captured sequentially during {windowText(scoring.start, scoring.end)}. Means, medians, totals and scores combine those saved readings; they are not synchronized live counts, daily averages or unique players across the whole collection window.</p>
    </div>
    <div className="method-table" tabIndex={0} role="region" aria-label="Genre score inputs and denominators, scroll horizontally">
      <table>
        <thead><tr><th scope="col">Editorial genre</th><th scope="col" className="numeric">Popularity Score<small>Provisional · / 100</small></th><th scope="col" className="numeric">Average players / game</th><th scope="col" className="numeric">Median players / game</th><th scope="col" className="numeric">Observed total</th><th scope="col" className="numeric">Games observed</th></tr></thead>
        <tbody>{ranks.map(row => <tr key={row.genre}>
          <th scope="row"><a href={`#/genre/${encodeURIComponent(row.genre)}`}>{row.genre}</a></th>
          <td className={`numeric ${row.popularityScore === null ? 'missing' : ''}`}>{row.popularityScore === null ? 'Unranked' : `${row.popularityScore.toFixed(1)} / 100`}</td>
          <td className={`numeric ${row.average === null ? 'missing' : ''}`}>{formatNumber(row.average)}</td>
          <td className={`numeric ${row.median === null ? 'missing' : ''}`}>{formatNumber(row.median)}</td>
          <td className={`numeric ${row.total === null ? 'missing' : ''}`}>{formatNumber(row.total, 0)}</td>
          <td className="numeric">{row.observedCount} / {row.gameCount}</td>
        </tr>)}</tbody>
      </table>
    </div>
  </section>;
}

function TagMethods() {
  return <section className="panel definitions tag-methods" aria-labelledby="tag-methods-heading">
    <h2 id="tag-methods-heading">Recurring mechanics &amp; themes · tag heuristic v{GENRE_TAG_METHOD.version}</h2>
    <div>
      <h3>What these patterns mean</h3>
      <p>Newly admitted games remain untagged unless permitted Steam tag evidence is available. IGDB labels never substitute for missing Steam tags. These are recurring saved Steam source tags, not validated descriptions of actual game features. A conservative, explicit allowlist classifies a tag as a mechanic (an interaction or system) or theme (a setting or narrative subject). Unlisted tags are not classified. Exact labels remain unchanged; related tags are not merged or inferred. Matching uses exact saved tag text, without aliases or case folding.</p>
    </div>
    <div>
      <h3>Frequency, coverage and ties</h3>
      <p>Each exact tag is counted at most once per unique saved game. A recurring tag must appear in at least {GENRE_TAG_METHOD.minimumGameCount} games. The combined top five mechanics and themes are ordered by game count descending, then alphabetically in English for ties. Percentage = games with that tag ÷ all unique games in the genre with at least one nonempty saved tag × 100. Games with only unclassified tags still enter that denominator. Untagged games are excluded, with coverage displayed. Fewer than five qualifying tags means fewer rows; no patterns are invented.</p>
    </div>
    <div>
      <h3>Fixed whole-genre sample</h3>
      <p>The Search genre selector and dedicated genre pages use the same complete saved genre sample. Game queries, cohort filters, sorting and tag clicks change only the individual game list. They never recompute the displayed genre metrics, global score baseline or recurring-tag frequencies. Tag coverage is independent of concurrent-player coverage, so an unranked genre can still have supported tag patterns.</p>
    </div>
    <div>
      <h3>What the classifier leaves out</h3>
      <p>Generic genre labels, play modes, visual styles, perspectives, difficulty, subjective quality, input devices and release labels are excluded. For example, Indie, Singleplayer, Multiplayer, Casual, Difficult, Puzzle, RPG, Strategy, Pixel Graphics and Early Access are not mechanics or themes in this heuristic. This conservative selection can miss relevant concepts. All saved source labels remain available on game pages and in the genre’s raw-tag filters.</p>
    </div>
    <div><h3>Mechanic tag allowlist</h3><p className="tag-rule-list">{GENRE_TAG_METHOD.mechanicTags.join(' · ')}</p></div>
    <div><h3>Theme tag allowlist</h3><p className="tag-rule-list">{GENRE_TAG_METHOD.themeTags.join(' · ')}</p></div>
  </section>;
}

export function Methods({ data, ranks }: MethodsProps) {
  const coverage = data.meta.coverage;
  const metrics = data.meta.steamMetricsIntegration;
  const total = data.games.length;
  const metricWindow = observationWindow(data.games.flatMap(game => [game.players.observedAt, game.reviews.observedAt]));
  const counts: [number, string][] = [
    [data.games.filter(game => game.provenance.identityVerified).length, 'Verified game identities'],
    [data.games.filter(game => supportedMetric(game.players)).length, 'Concurrent-player observations'], [data.games.filter(game => supportedMetric(game.reviews)).length, 'API review totals'],
    [data.games.filter(game => supportedMetric(game.storeReviews)).length, 'Localized store review summaries'], [data.games.filter(game => !!game.marketing.sourceUrl).length, 'Marketing source profiles'],
    [data.games.filter(game => game.marketing.deepProof).length, 'Deep-evidence examples'], [data.games.filter(game => game.catalog?.status === 'matched').length, 'IGDB catalog records'],
    [data.games.filter(game => game.tags.some(tag => !!tag.trim())).length, 'Games with saved Steam tags'],
  ];
  return <>
    <PageTitle eyebrow="DATA / SOURCES / METHODS" title="Know the source." description="How observations become insights, and where the evidence ends." />
    <div className="status-banner">
      <span className="status-dot" aria-hidden="true" />
      <div>
        <h2>Page loads read saved evidence.</h2>
        <p>The browser reads the local application API and never refreshes a provider. Separately invoked bounded local jobs can update permitted catalog and metric evidence. Configured schedules are inactive until explicitly enabled and invoked; the web app has no scheduler. Current dates and missing tags stay visible. <a href="#/sources">Inspect source health, job limits and gates</a>.</p>
      </div>
      <Pill kind="outline">NOT LIVE</Pill>
    </div>
    <section className="coverage-layout" aria-label="Evidence coverage and limits">
      <div className="panel coverage-card">
        <h2>What we have</h2>
        <p className="muted">Coverage within the current {total}-game tracked catalog</p>
        {counts.map(([count, label]) => <div className="coverage-row" key={label}>
          <div><span>{label}</span><b>{count} / {total}</b></div>
          <div className="bar" aria-hidden="true"><span style={{ width: `${total ? Math.min(100, Math.max(0, count / total * 100)) : 0}%` }} /></div>
        </div>)}
      </div>
      <div className="panel coverage-card">
        <h2>What we can’t claim</h2>
        <ul className="limits-list">
          <li><b>Market-wide rankings</b><span>This is an editorial cohort, not a representative sample of all Steam games.</span></li>
          <li><b>Historical momentum</b><span>No time series, validated popularity score or hot-duration measure.</span></li>
          <li><b>Commercial outcomes</b><span>No supported sales, revenue, spend, conversion or ROI estimates.</span></li>
          <li><b>Team size</b><span>Credits and “indie” tags cannot establish a studio’s current headcount.</span></li>
          <li><b>Mobile comparisons</b><span>Mobile data is not included in this pilot.</span></li>
        </ul>
      </div>
    </section>
    <SteamMethods data={data} ranks={ranks} />
    <SteamDateMethods data={data} />
    <CatalogMethods data={data} />
    <RankingMethods data={data} ranks={ranks} />
    <TagMethods />
    <section className="panel definitions" aria-labelledby="reading-numbers-heading">
      <h2 id="reading-numbers-heading">Reading the numbers</h2>
      <div><h3>Concurrent players</h3><p>Steam-connected players at the observation time. Not owners, daily active users, sales, daily averages or all-time peaks.</p></div>
      <div><h3>API review total</h3><p>All-language, all-time Steam-purchase reviews with off-topic activity filtered. Not interchangeable with the localized store summary shown separately on game pages.</p></div>
      <div><h3>Missing is not zero</h3><p>“Not captured” means no supported numeric value was saved. An observed zero is displayed as 0. Missing values always sort last.</p></div>
      <div><h3>Marketing records</h3><p>{data.games.reduce((count,game) => count + game.marketing.events.length,0)} non-exhaustive discovered event records. Event date, publication date and collection time are distinct. Source accessibility is not permission for bulk collection or redistribution. A creator mention is not proof of paid sponsorship or effectiveness.</p></div>
      <div><h3>Evidence and freshness are separate</h3><p>Observed means a source-supported reading; reported means an attributed source claim; calculated means a disclosed derivation; estimated requires a supported estimation method. Unknown means no defensible value is available, while unavailable records a source or access limitation. Freshness is independent of these evidence states. A saved metric is displayed as stale after 24 hours from its collection time, or when explicitly stored as stale cache. This presentation threshold is not a collection schedule or a claim of accuracy. The original preserved baseline is unchanged. After collection begins, operational scores exclude failed refreshes and readings that are stale or have unknown freshness when the workspace loads; raw observations and their original scoring flags remain stored. Missing or future collection times show freshness unknown. Source measurement time remains unknown when the source did not supply one.</p></div>
      <div><h3>Milestone 3 bounded local collection</h3><p>This React application reads normalized saved evidence through an application API backed by local SQLite persistence. User-invoked collection commands have explicit source gates, bounds and recorded outcomes. The web app cannot start jobs or enable schedules. Source health reports stored state rather than a background-process heartbeat. No authenticated production service or Cloudflare deployment is established.</p></div>
    </section>
    {!!data.meta.limitations.length && <section className="panel definitions" aria-labelledby="snapshot-limitations-heading">
      <h2 id="snapshot-limitations-heading">Preserved import limitations</h2>
      <p className="catalog-wide fineprint">These are the original source artifact’s historical limitations, including its original cohort size. Current catalog coverage and bounded-job state are reported above and in Source health.</p>
      <ul className="catalog-wide fineprint">{data.meta.limitations.map((limitation, index) => <li key={index}>{limitation}</li>)}</ul>
    </section>}
    <section className="panel provenance" aria-labelledby="provenance-heading">
      <h2 id="provenance-heading">Original import provenance</h2>
      <dl>
        <dt>Saved Steam / marketing evidence began</dt><dd>{stamp(data.meta.collectionWindow.start)}</dd>
        <dt>Saved Steam / marketing evidence ended</dt><dd>{stamp(data.meta.collectionWindow.end)}</dd>
        <dt>Original imported Steam metric run</dt><dd>{windowText(metrics?.fetchWindow?.start ?? metricWindow.start, metrics?.fetchWindow?.end ?? metricWindow.end)}</dd>
        <dt>Saved date follow-up</dt><dd>{windowText(data.meta.steamDateValidation?.fetchWindow.start, data.meta.steamDateValidation?.fetchWindow.end)}</dd>
        <dt>Original imported IGDB catalog fetch</dt><dd>{windowText(data.meta.catalogIntegration?.fetchWindow?.start, data.meta.catalogIntegration?.fetchWindow?.end)}</dd>
        <dt>Saved Steam tags</dt><dd>{windowText(data.meta.tagCollectionWindow?.start, data.meta.tagCollectionWindow?.end)}</dd>
        <dt>Source snapshot built</dt><dd>{stamp(data.meta.builtAt)}</dd>
        <dt>Snapshot schema / mode</dt><dd>{data.meta.schemaVersion} · {readable(data.meta.mode)}</dd>
        <dt>Original pilot scope</dt><dd>{coverage.originalGames} original games + {coverage.supplementGames}-game recent supplement</dd>
        <dt>Current catalog size</dt><dd>{total} tracked games; current missingness and job outcomes are in <a href="#/sources">Source health</a>.</dd>
        <dt>Runtime</dt><dd>React application + local API + SQLite persistence. The source snapshot’s original timestamps remain unchanged by import or page load. No production authentication guarantee.</dd>
      </dl>
      <details className="catalog-details">
        <summary>Source artifact SHA-256 hashes · {data.meta.sourceFiles.length} files</summary>
        <p className="fineprint">These hashes identify the saved input artifacts. They support reproducibility and integrity checks; they do not establish that a source’s claims are true or that redistribution is permitted.</p>
        <dl>{data.meta.sourceFiles.map(source => <div key={source.path} style={{ display: 'contents' }}>
          <dt style={{ overflowWrap: 'anywhere' }}>{source.path}</dt>
          <dd style={{ overflowWrap: 'anywhere' }}><code>{source.sha256}</code></dd>
        </div>)}</dl>
      </details>
      <p className="fineprint">Independent research application; not affiliated with or endorsed by Valve, Steam, IGDB, or Twitch. <ExternalLink url="https://partner.steamgames.com/doc/webapi_overview">Steam Web API source</ExternalLink>{' · '}<ExternalLink url="https://api-docs.igdb.com/">IGDB API source</ExternalLink></p>
      <div className="download-actions"><a className="button secondary" href="/api/snapshot" download="fieldnote-snapshot.json">Download source-linked snapshot ↓</a><a className="button secondary" href="/docs/roadmap.docx" download="game-market-research-roadmap.docx">Download project roadmap ↓</a></div>
    </section>
  </>;
}
