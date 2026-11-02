# Fieldnote collection-redesign foundation

Status: **Vendored unchanged computation modules in the Fieldnote release-research integration.** Runtime files match the independently tested offline foundation. The app adapter and UI have separate integration tests. This document below describes the original foundation contract; deployment and live collection remain gated.

This is the dependency-free computation layer for the offline release-cohort slice. Its five runtime modules are byte-identical to the independently tested standalone foundation. `backend/release-research.ts` supplies conservative database adapters; `src/ReleaseResearch.tsx` renders saved evidence. The new evidence tables are empty in the preserved real database, so no verified release cohorts are claimed. No live collection or deployment is included.

## Run

Node.js 20 or newer. No dependencies and no install step.

```sh
cd fieldnote-app
node --test tests/foundation.test.mjs
# Equivalent: npm test
```

All runtime modules are pure ESM, use supplied values only, and perform no I/O. `index.mjs` is the public entry point. `tests/cohort-foundation/test/` contains implementation fixtures; `tests/cohort-foundation/review/` contains independent adversarial fixtures. `VALIDATION.txt` records the final executed checks.

## Minimal example

```js
import { resolveReleaseWindow, resolveReviewWindows, analyzeGenres } from './index.mjs';

const asOf = '2026-10-11T00:00:00Z';
const window = resolveReleaseWindow({ preset: '7d', asOf });
const reviewWindows = resolveReviewWindows({ asOf });
const games = [{
  appId: 123,
  genres: ['Action', 'RPG'],
  releases: {
    firstPlayableSteam: {
      date: '2026-10-05',
      precision: 'day',
      verified: true,
      status: 'released',
      phase: 'early_access',
      source: 'fixture',
      retrievedAt: '2026-10-10T00:00:00Z',
      confidence: 'verified'
    }
  },
  metrics: { reviews7d: 0, reviews30d: { value: null, missingReason: 'source_unavailable' } }
}];
const result = analyzeGenres(games, { window, metric: 'reviews7d' });
// result.genres has Action and RPG; each contains this app exactly once.
// observedCount=1, mean=median=0, sampleStatus='insufficient_sample'.
// reviewWindows.reviews7d and reviews30d describe measurement, not membership.
```

The supplied game rows must already represent the chosen population, membership date, eligible application types, taxonomy version, and compatible observation snapshot. This package does not invent those decisions or fetch observations.

## Release windows

`resolveReleaseWindow({ preset, asOf, startDate?, endDate? })` returns a frozen serializable object:

- `version: 'utc-half-open-v1'`, `kind: 'release_cohort'`, `timeZone: 'UTC'`
- `asOf`: caller-supplied evaluation instant, normalized to ISO UTC
- `startInclusive`, `endExclusive`: resolved ISO UTC boundaries
- `definition`: original preset/custom date definition

Supported presets:

| Preset | Meaning |
| --- | --- |
| `7d`, `14d`, `21d` | Exactly 7, 14, 21 elapsed UTC days before `asOf` |
| `1m`, `2m`, `3m` | Direct subtraction of 1, 2, 3 calendar months, clamped to target month end |
| `1y` | One calendar year, with February 29 clamped to February 28 when necessary |
| `custom` | `startDate` through `endDate`, both inclusive YYYY-MM-DD dates |

Rolling windows preserve the exact UTC time of day and milliseconds. For example, one month before `2024-03-31T12:34:56.789Z` is `2024-02-29T12:34:56.789Z`. Subtracting two months is direct, not two successive one-month operations. It produces January 31 in that example.

Custom boundaries are start midnight and midnight **after** the requested end day. Start and end may be the same date. The requested interval is not silently clipped to `asOf`; release evaluation separately excludes known future dates. All cohort tests use `[startInclusive, endExclusive)`.

`asOf` is mandatory: a valid `Date` or strict UTC `YYYY-MM-DDTHH:mm:ss[.SSS]Z` string. Local timestamps, numeric epochs, offset strings including `+00:00`, leap-second strings, impossible Gregorian dates, and years outside 0001–9999 are rejected. There is no hidden clock or machine-timezone dependency. Persist one resolved window at job creation and reuse it across all games.

**Day-precision boundary convention:** verified release dates have no time of day; this foundation represents each as midnight UTC for membership tests. Consequently a release dated the rolling start day is excluded if that start cutoff is later than midnight. A date on the `asOf` day is not considered future once midnight has passed. The future date exclusion does not prove an unknown launch hour has occurred. An adapter/UI must explain this convention or introduce a separately versioned date-only policy; it must not silently change it.

`resolveReviewWindows({ asOf })` returns `reviews7d` and `reviews30d`, both with `kind: 'review_activity'`. These always mean 7 and 30 elapsed days. A 30-day review interval is not the one-calendar-month release filter. Supplying a review window to the cohort API throws. No API result asserts that upstream review-date filtering has passed source validation.

`toInclusiveEpochSeconds(window)` converts an exact second-aligned interval to `{ start, end }`, with one second subtracted from the internal exclusive end. Fractional-second boundaries are rejected rather than rounded. This is a conversion helper, not an endpoint call or evidence of a supported endpoint contract.

## Release evidence and duplicate games

`filterReleaseCohort(games, { window, releaseBasis = 'first_playable' })` performs normalization, duplicate resolution, release evidence checks, and cohort filtering before any aggregate is calculated.

Each game uses a positive safe-integer Steam `appId`, numeric or all-digit string. `42`, `'42'`, and `'00042'` are one game. Invalid IDs are recorded in `invalidRows`, not counted as valid unique games. Genre strings are trimmed, deduplicated, sorted, and merged across fragments of the same game; case and synonyms are not reclassified. Invalid genres remain in diagnostics, and games with no valid genre remain visible as unclassified.

Release fields are **separate**:

- `releases.firstPlayableSteam`: verified first public playable release on Steam, including Early Access. Its `phase` may be `early_access` or `full_release`. The caller must establish that it truly is the first playable date.
- `releases.fullReleaseSteam`: verified full 1.0 release. If `phase` is supplied here, it must be `full_release`.

Evidence object: `{ date, precision, verified, status, phase?, source?, retrievedAt?, confidence?, ... }`.

Membership requires a valid exact date, `precision: 'day'`, `verified: true`, and `status: 'released'`. `source`, `retrievedAt`, `confidence`, and other evidence metadata are preserved; this offline package cannot verify a source or manufacture provenance. A `full_release` request only uses `fullReleaseSteam`. There is no fallback in either direction, including when one field is missing. Do not feed a store's current 1.0 date into `firstPlayableSteam` without reconciling Early Access history.

Duplicate rows are fragments of a single selected snapshot, not a time series. Their evidence is retained. Two different verified exact dates for the same basis exclude the game with `conflicting_release_dates`; a released/planned contradiction produces `conflicting_release_status`. A verified full release preceding the verified first playable date produces `conflicting_release_chronology` on either basis. Valid verified day evidence can resolve lower-quality imprecise/unverified evidence; the latter is still returned in `evidenceIssues`. It cannot override another conflicting verified day date.

Reasons include missing/invalid/imprecise/unverified release dates, unverified playability, not released, invalid phase, unresolved evidence, conflicting dates/status/chronology, future release date, and outside release window. An entirely unresolved record remains excluded. Both selected evidence and per-evidence issues are returned for auditing, and excluded games retain both release fields. These are conservative resolution rules, not live metadata research.

Coverage includes `inputRowCount`, `uniqueGameCount`, `duplicateRowCount`, invalid rows, eligible/excluded counts, per-reason counts, and the actual eligible/excluded records. Invalid rows are separate from unique-game coverage. A game outside a cohort is not a missing metric inside it.

## Genre analysis and missing values

`analyzeGenres(games, { window, releaseBasis?, metric, genreUniverse? })` invokes cohort filtering first, then calculates each genre independently. The caller selects one raw metric key, such as `reviews7d`, `reviews30d`, `currentPlayers`, or `lifetimeReviews`. `genreUniverse` optionally requests explicit empty buckets.

The genre API is for nonnegative raw component measures. Metrics may be finite nonnegative numbers, `null`/absent, or `{ value: number | null, missingReason?: string }`. Zero is observed data. Negative numeric/object values are unavailable with `negative_metric`; null/absent, nonnumeric values, NaN, and infinities are also unavailable and counted by reason. There is no coercion from strings and no imputation to zero. Signed observed-change series require a separate compatibility-aware analysis adapter; they are not accepted by this raw-measure aggregation API.

Identical duplicate observed values contribute once. If duplicate rows disagree on two finite values, the game's metric becomes missing with `conflicting_duplicate_values`; values are not averaged and input order does not pick a winner. A single consistent observed value can resolve missing fragments, retaining `candidateMissingReasons`. The adapter must ensure fragments belong to one compatible snapshot before using this rule; never mix historical runs.

Each observed game has equal weight once per genre. Multilabel games appear in all applicable genres, so totals across genres overlap and cannot be interpreted as market size or share. Games without genres remain in `unclassifiedAppIds`, not an invented category.

Every genre contains:

- `eligibleCount`, `observedCount`/`n`, `missingCount`, and `coveragePercent`
- Mean, median, R7 `q1`, `q3`, IQR and `iqrStatus`
- `trimmedMean10`, `trimmedCountPerTail`, `trimmedN`
- `sampleStatus`, `rankable`, largest-game share and its status
- Raw observed values with app IDs, missing observations with reasons, and counts by missing reason

An empty bucket has null statistics and null coverage. A nonempty all-missing bucket has null statistics and zero coverage. An observed all-zero bucket has zero statistics and real observation coverage. Arithmetic outputs are not display-rounded.

## Versioned statistics

`summarizeValues(values)` accepts only finite numbers. Missing values must first be separated, as the genre API does. It never mutates the array. `STATISTIC_VERSION` is `r7-trim10-floor-v1`.

- Median is the primary descriptive value. Raw arithmetic mean is also returned; no ranking is automatically created.
- Quartiles use R7: index `(n - 1) × p`, linearly interpolated at `p=0.25, 0.5, 0.75`. IQR is Q3 minus Q1.
- At `n >= 20`, remove `floor(n × 0.1)` values from **each** sorted tail and calculate the remaining arithmetic mean. All three trimmed fields are null below 20.
- `n < 5`: `insufficient_sample`, `rankable: false`; 5–9: `low_sample`; 10+: `adequate_sample`. These are pilot display thresholds, not confidence guarantees or representativeness claims. Statistics remain available for inspection even when ranking is discouraged.
- `largestGameShare` is the largest nonnegative value divided by the sum, as a 0–1 fraction. All-zero data returns null with `zero_total`; signed data returns null with `contains_negative`; empty data returns null with `empty`.
- Means, interpolated quartiles, trimming, and shares use an exact binary BigInt accumulator and round to binary64 only at the result. Repeated `Number.MAX_VALUE` remains finite and yields correct shares even when the mathematical sum is larger than a finite JavaScript number. Small cancellation residuals are retained.
- The standalone `summarizeValues` utility accepts signed finite numbers for descriptive use; `analyzeGenres` accepts only nonnegative raw metrics. If a signed utility input's mathematical IQR exceeds finite binary64 range, IQR is null with `iqrStatus: 'overflow'`; the other statistics remain available.

No popularity score, universal weights, model call, market-wide estimate, or synthetic historical metric is implemented.

## Files

- `windows.mjs`: strict UTC parsing, release presets, independent review intervals, endpoint-boundary adapter
- `releases.mjs`: canonical app IDs, evidence resolution, duplicate handling, release cohort exclusion audit
- `statistics.mjs`: overflow-safe descriptive statistics and sample flags
- `analysis.mjs`: filter-before-aggregate, per-genre equal weighting, coverage and raw-value audit
- `index.mjs`: public exports
- `tests/cohort-foundation/test/*.test.mjs`, `tests/cohort-foundation/review/adversarial.test.mjs`: offline deterministic tests
- `VALIDATION.txt`: final check results and scope

## App integration and remaining gates

The application integrates this layer through a read-only API, with separate adapter, API, migration, render and adversarial tests. Runtime tests and the existing collection tests are offline.

- Existing tracked, legacy-36 and discovery populations are explicitly selected before aggregation.
- Verified game-type evidence is required independently of Steam identity. Unknown or non-game application types fail closed.
- No IGDB date or legacy Steam display date is promoted to verified first playable or 1.0 evidence.
- A metric set has exactly one metric, run, method, scope and unit. Missing games are never backfilled from another run.
- Current saved taxonomy is identified; historical membership/taxonomy and a newly allocated 300-game panel are not implemented.
- Seven/30-day review activity remains gated and unavailable. Full production source validation, collection jobs, provider permissions and deployment remain separate work.

See the root `REDESIGN-INTEGRATION.md` and executed verification report for current integration results.
