# Milestone 1: technical feasibility complete

**10 October 2026. Complete for the user-approved private, non-commercial technical-feasibility scope. Operational and production gates remain unpassed.**

This is a portable summary of the final acceptance ledger. It establishes bounded source feasibility, observed coverage, metric definitions, limitations and a conditional cost envelope. It does not claim an always-on collector, representative market coverage, historical analytics or production readiness.

## What the evidence establishes

- **36 verified games:** a fixed editorial cohort across seven displayed research groups. This is not the whole Steam market or a representative ranking.
- **IGDB catalog, 36/36 exact identity matches:** names, summaries, platforms and scoped release records cover 36/36; developer and publisher roles cover 35/36; provider-classified official websites cover 34/36. Unknown fields remain unknown. Taxonomies and release records remain separate from Steam tags and app-specific dates.
- **Steam current metrics, 36/36 players and 36/36 review totals:** all 72 current observations passed validation in the 17:55:23–17:56:43 UTC run. Genuine zero remains zero. Review totals use the recorded all-language, Steam-purchase and off-topic filters; they are not the localized store summary, sales or owners.
- **Six actual September review-window results:** the separate 18:03:31–18:03:57 UTC date-only run made 24 successful requests. All six windows were completely enumerated at this bounded scale and matched their split-window checks. Three windows contained two matching reviews each and exercised inclusive timestamp boundaries; three were observed zero and had no boundary event to exercise.
- **Saved Steam-tag lineage:** all 36 games retain their dated source tags. Exact-tag mechanic/theme classification is versioned and distinct from IGDB taxonomy. Recurrence supports exploratory comparisons within the sample, not temporal trends or market-wide prevalence.
- **Marketing research format:** 23/30 official pages were readable in the original bounded research test; six deeper game examples contain 13 curated evidence records. These are discovered evidence, not exhaustive campaign counts, proof of sponsorship, spend or causal ROI.
- **Methods and cost:** source/definition/refresh/fallback rules and prospective trend/hot/studio-band semantics are explicit. Costs receive a conditional planning pass; actual operating cost and controls still need measurement.

## Results that must not be flattened into “all passed”

The current-metric run stopped after its next request, a date probe, failed local schema interpretation despite HTTP 200. Its 72 independently valid current metrics remain usable; the failed request and stopped run status are preserved.

The corrected date-only run completed successfully, but its raw overall verdict remains `inconclusive_or_incomplete` because that collector requires a positive boundary event in every game. The three observed-zero windows cannot exercise that event. M1 accepts the positive and empty-window feasibility evidence with this limitation; it does **not** claim six boundary passes or production-scale pagination.

Review-window counts describe surviving matching reviews observed now. They are not immutable snapshots of what existed at the historical date. Current-player observations cannot backfill past player counts. There is no validated yearly trend, hot duration or mechanic/theme time series.

Sales, current exact team size, advertising spend and causal marketing return stay unknown where no defensible method supports them. Dated disclosures remain scoped historical statements. Popularity Score is a transparent provisional relative engagement heuristic, not calibrated commercial success or market share.

## What is in this preview

The app uses the saved snapshot built at **2026-10-10T18:05:29.011Z**. It retains the original IGDB fetch window, the newer current-metric window, the separate date-validation window and original tag dates. The browser does not call source APIs.

Source syntax, static build and **109 offline tests** passed for the updated prototype. Packaged-handler security checks are separate; live forwarded-browser verification is not implied by an offline test result.

The three report files are for Codespaces Explorer review. They are deliberately not HTTP routes. Keep forwarded port 4173 **Private**. The service is a development preview, not authenticated production hosting; Codespaces supplies its external access control.

## Remaining rollout gates

1. Establish a permitted route before automated new Steam-tag collection. Existing tags remain dated evidence.
2. Review IGDB commercial eligibility if the current non-commercial purpose changes. Resolve applicable enduring research/retention, images, exports, public display and downstream AI use before those features are enabled.
3. Complete later milestones separately: broader ingestion, resilient recurring collection, sufficient real history, ranking sensitivity, classification/marketing/model evaluations, grounded chat, budget enforcement and private-access/reliability testing.

No additional M1 user choice or required source fetch remains. No public release, paid activation, recurring collection or new legal agreement follows from this result. See [source rights](reports/source-rights.md) and [cost feasibility](reports/cost-feasibility.md).

## Evidence identifiers

The original workspace retains the detailed acceptance ledger `m1-acceptance-status-2026-10-10.md`, source-use review `source-rights-review-2026-10-10.md`, cost review `cost-validation-2026-10-10.md`, raw/canonical `igdb-catalog-import.json`, `steam-metrics-import.json` and `steam-date-validation.json`, and integration audits. Those evidence files are intentionally not included in this portable preview.

The included app snapshot is `public/data/snapshot.json`; it carries run IDs, provenance, source hashes, coverage and limitations. Its SHA-256 is `b82ced8fafda2393203ede54e9958c7144058790197a6d17ce7ee9d5cc852630`.

Primary method references: [Steam current players](https://partner.steamgames.com/doc/webapi/ISteamUserStats#GetNumberOfCurrentPlayers), [Steam review API](https://partner.steamgames.com/doc/webapi/IUserReviewsService#GetAppReviews), [IGDB API documentation](https://api-docs.igdb.com/).
