# Release-cohort panel and source categories

## Status at reconstruction checkpoint: 2026-10-12

The private offline working database has 1,080 unique games: the preserved 334-game catalog plus 746 broad-discovery additions. The latest independently Steam-verified discovery population has 785 members, including 39 overlaps with the preserved catalog. It contains 22 observed IGDB genres and 579 unambiguous exact PC release dates. Categories are computed from source labels, without the prior editorial 12-category limit. These counts describe source coverage, not a representative sample of all Steam.

All 785 lifetime-review observations are now imported in two preserved batches: the original 625 retain their Oct 11 run IDs and collection timestamps (163 genuine observed zeros), and the additional 160 retain their Oct 12 run and times. The frozen panel contains 294 of the 300 target slots: 75 references, 94 recent releases, 100 older releases and 25 controls. Six recent slots remain unfilled under the unchanged rules. The user approved proceeding with this exact 294-member prototype on Oct 12; the original 300-slot target and shortfall remain visible. No 7/30-day or current-player measurement run for this panel has been imported. Any subsequent metric collection remains a separate validated input.

## Release-cohort page

- Population: tracked catalog, broad verified discovery, or an explicitly frozen panel.
- Release basis: verified Steam first playable, verified Steam full release/1.0, or separately labeled IGDB-reported PC release. PC dates never become Steam release evidence.
- Release windows: all saved releases, preset lookbacks, or custom dates.
- Categories: all saved IGDB genres/themes, raw Steam tags, or the legacy editorial classification. Missing labels stay missing. Any/all multiselect filters apply before per-category statistics. A clear action remains available after an invalid filter.
- Review activity: exact saved 7-day, 30-day or custom creation intervals with an independent measurement end. A selector does not cause collection. Missing matching evidence remains unavailable, with known-value coverage shown.
- Sortable per-game and per-category tables show raw source evidence and independent player/review coverage. Categories overlap; their game counts cannot be added to obtain the population total.

## Deterministic panel policy

Default `planned-75-100-100-25-scarcity-first-v3` reserves up to 100 recent releases and 20 per each of the five completed release years, then chooses 75 high-lifetime-review references from the remaining eligible pool, then 25 low-signal controls. No slots are borrowed between quotas and no duplicate game is allowed.

The existing admission rules are unchanged: recent games within their first 30 days are in probation; recent games aged 31–90 days and older-year games require at least 50 known lifetime Steam-purchase reviews. References require at least 50 known reviews. Controls have known totals below 50. Unknown is never zero. Reference order is review count descending, then AppID; non-reference allocation uses a fixed SHA-256 seed. The manifest records all eligibility evidence, shortfalls, displaced top-reference overlaps and their replacements. “Highest remaining lifetime reviews” is not a calibrated popularity score or a claim to be the top 75 across Steam.

The original `planned-75-100-100-25-lifetime-reference-v2` remains explicit and reproducible. Historical reconstruction reproduced the retained source and manifest hashes: v2 selected 257 (75/60/97/25), and v3 selected 274 (75/74/100/25). Neither is a completed 300-game panel. The resumed 785-candidate campaign produces 294 members (75/94/100/25), with the six recent-slot shortfall explicitly retained.

`cohortCutoff` fixes release eligibility and release-age buckets; `asOf`/`evidenceAsOf` fixes knowledge available to allocation. For the resumed campaign, use the original Oct 11 cohort cutoff and the actual Oct 12 addendum completion as evidence time. Multi-batch qualification retains each original observation time and receipt; it is not an instantaneous snapshot.

## Copy-only workflow

Node 24.x is required. Never reseed an existing database. Importers default to validation-only and accept `--apply-copy` only for a new database path. Apply each stage to the previous validated copy, retaining the immutable original backup.

```sh
node scripts/import-broad-catalog.mjs --source ORIGINAL.sqlite --candidates discovery.json --expected-sha SOURCE_SHA --apply-copy catalog-copy.sqlite
node scripts/import-review-qualification.mjs --source catalog-copy.sqlite --qualification qualification.json --validation passed-sentinels.json --expected-sha BUNDLE_SHA --apply-copy qualified-copy.sqlite
node scripts/prepare-panel.mjs --source qualified-copy.sqlite --candidate-file qualified-campaign.json --release-basis igdb_pc --cohort-cutoff 2026-10-11T18:49:27.594Z --as-of ACTUAL_ADDENDUM_FINISH_UTC --output panel.json --apply-copy panel-copy.sqlite
node scripts/import-panel-metrics.mjs --source panel-copy.sqlite --metrics completed-metrics.json --validation passed-sentinels.json --panel panel.json --apply-copy measured-copy.sqlite
node scripts/verify-research-preservation.mjs ORIGINAL.sqlite measured-copy.sqlite --allow-appends
```

The qualification join and provider collectors live in separately reviewed source packages. An addendum binds the full resumed source hash but imports only newly verified identities, with an exact receipt for the original qualification. It cannot reimport the original 625 as newly collected. The metric importer requires an intact 300-member manifest or the exact user-approved 294-member manifest (canonical SHA-256 `dc3840a01e9d68b2e0f7ecef873ecba6fa6430eb847595eacd01e7d4e932e3b9`), one observation for each game × four metrics (1,176 for the approved panel), exact passed sentinel bytes, validated filters, intervals, endpoints, chronology and monotonic review totals. Genuine missing measurements remain explicit. The pinned exception does not admit other partial panels or change any admission floor, membership, quota or seed.

The validated review scope is all-language, all-polarity, Steam-purchase reviews, off-topic activity filtered; `total_matching` is the count. `query_summary` totals do not substitute for dated activity. CCU is a point-in-time current-player observation, not average, peak, owners or sales.

## Preservation, rollback and verification

Migrations 0005–0008 append panel membership, source contracts, versioned raw catalog snapshots and qualification ledgers. Existing catalog metadata is retained; reads choose the latest eligible snapshot rather than unioning conflicting old/new labels. Identity confirmation has its own cutoff, independent of raw metadata retrieval.

Run `npm run check` before packaging. Independent tests cover exact historical selector digests, source/DB/API PC date parity, all category labels, timestamp precision, future evidence, copy-only imports, preflight conflicts, idempotency and transaction rollback. Compare every original raw table row and run integrity/foreign-key checks on each final copy. To undo imported observations, restore the original immutable database to a new path; dropping research ledger tables alone is not a full data rollback.

The web app is read-only and never launches collectors. Existing 24-hour freshness policy still applies: old saved counts remain visible as dated evidence but cannot silently become current scores. The package contains source, build output and fixtures, not private SQLite databases or credentials.
