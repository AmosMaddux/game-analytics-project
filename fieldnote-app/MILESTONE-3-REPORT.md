# Milestone 3 implementation · 10 October 2026

## Current status

Implementation and offline acceptance checks are complete for the private collection pipeline. **The live catalog contains 334 independently verified games across 12 agreed categories. The bounded Steam run has finished with fresh player counts for 325 games and fresh review aggregates for all 334; nine player counts remain missing.** The corrected final diagnostic and live browser checks passed. No synthetic test data is installed in the app.

The user approved the 12-category starting taxonomy on 10 October 2026. The seven original editorial groups remain unchanged. Added categories are Role-playing, Shooter, Strategy, Survival / crafting, and Racing / sports. Initial imports used `editorial-expanded-1.0`; the corrective release uses `editorial-expanded-1.1`. Original and raw provider labels remain separately inspectable.

## Implemented

- Strictly bounded IGDB discovery over stable numeric cursors, validated current source/type reference records, high- and low/missing-rating-count strata, balanced quotas and explicit reallocation when narrow routes are exhausted.
- Separately bounded known-ID IGDB refresh, with no discovery side effect.
- Independent official Steam game-only AppID/name verification using the current `IStoreService/GetAppList/v1/` public API host. DLC, software, video and hardware are excluded. Ambiguous identities, title differences, non-main-game/parent/edition records and non-desktop mappings are quarantined.
- Normalized, transactional admissions and current catalog updates using the existing strict identity validator. The original 36-game cohort, saved tags, metrics, marketing evidence and preferences are preserved.
- Keyless Steam concurrent-player and all-time aggregate-review collection with explicit query scope, append-only observations, run/item idempotency and real observed zero. Reviewer text and identities are discarded.
- Fixed provider endpoints, verified TLS, clean child-process environment, no redirects, full Retry-After handling, bounded retries and source stop on authentication/permission failure. Credential-bearing commands must be personally run by the user; no credential file is read during build, packaging, server startup or keyless collection.
- Request, byte, page, game, per-request time and cumulative runtime bounds. Pre-dispatch reservations and normalized checkpoints preserve remaining budgets after interruption. Successful checkpoints compact to IDs/counts/provenance rather than retaining repeated whole-provider import archives.
- Optional disabled-by-default daily and six-hour watchlist schedules. Explicit expiry is at most seven days; a watchlist is at most 20 verified AppIDs. A manually invoked tick runs at most one keyless job and exits within 25 minutes. Catalog schedules report that a personally invoked refresh is required. No daemon, cron, cloud resource or paid service is installed.
- A shared SQLite/PID lease prevents manual and scheduled collectors from overlapping, without assuming a timed-out process is dead.
- Read-only source-health API and UI with actual catalog/genre coverage, under-15 warnings, missing/stale coverage, collection windows, source gates, jobs, bounded counters, independent success/failure times and truthful schedule state.
- Failed refreshes retain cached values and original dates but label them stale. Once operational collection is active, failed or age-stale/unknown-freshness player readings are excluded from score inputs. Original stored scoring flags and the M2-only preserved baseline remain intact. The score formula is unchanged; expanded catalog membership changes the sample baseline and is not a trend.
- Source-labeled official game/studio website links, raw provider labels and scoped release provenance. IGDB fields never substitute for Steam tags. New games have missing Steam tags until a permitted acquisition route is established.

## Verification completed

- Strict TypeScript, source-policy/JavaScript syntax lint, production frontend/backend builds: passed.
- Application tests: **123 passed, 0 failed** at the current integration checkpoint.
- Original prototype regressions: **109 passed, 0 failed**.
- Preserved snapshot SHA-256 is unchanged: `b82ced8fafda2393203ede54e9958c7144058790197a6d17ce7ee9d5cc852630`.
- Independent transport, archive and real-SQLite upgrade audits passed for the initial user-run releases. The frozen RC2 archive has 71 entries and SHA-256 `3b19a18dda314bff26c2fd2f229f953090d56d477f55a0ce8fa42c8a45d72b45`.
- Clean prebuilt extraction seeded the original evidence with Node 24 and no npm installation. Manifest hashes matched; missing explicit `--run` stopped before collection.
- The existing Codespaces database was backed up using SQLite `VACUUM INTO` before the RC2 overlay, and migration 0003 was applied without reseeding.
- A single bounded test of the deprecated keyless Steam app-list endpoint returned HTTP 404. It was not retried or replaced with undocumented store scraping. The documented keyed public API is configured before any authenticated run.

The initial RC2 does not contain the later optional scheduler/shared lease and operational freshness improvements; those belong to the final integrated overlay. Do not confuse a tested artifact with a completed live-data run.

## First actual catalog run

The first personally invoked run finished on 10 October 2026 at 19:15:37 UTC. It admitted 240 new games, giving **276 independently verified unique Steam/IGDB identities across all 12 populated categories**. The 300-game size gate remained open. Forty-two candidates had title conflicts and 42 were absent from the official Steam game-only identity list; no cause is inferred for the latter. No identity rule was relaxed. Cozy building toy and Roguelike deckbuilder each retained six games and are flagged thin.

The run used 30 IGDB requests, 27 discovery pages and 11,806,087 response bytes with zero retries (44.3 seconds active collection), plus four Steam identity requests/pages and 19,477,008 bytes with zero retries (10.3 seconds). There were zero foreign-key violations and zero duplicate observation keys. Official game links covered 235 of 276 games; saved Steam tags still covered only the original 36. Expanded metrics had not yet been collected. The safe result is retained in `research/milestone-3/catalog-first-run-diagnostic.json`.

A small incremental discovery update excludes the 84 earlier quarantined AppIDs as well as all existing games, while preserving every identity requirement. Its next bounded pass sought up to 84 genuinely new candidates within the 360-game total capacity. The independently audited package hash for this update is `59d61a94f652733ec435d0d7fa86404d21a41460ce3749a64f44ebaf08db1a12`.

## Second actual catalog run

The second personally invoked pass ran from 19:27:13.957 to 19:28:12.499 UTC on 10 October 2026. Job `catalog-6b737fda-b294-43f9-891a-6219e4ee0479` admitted 58 new games, updated zero existing games and quarantined 26 candidates, producing **334 independently verified games**. It used the 84 previous quarantine exclusions and did not relax title, identity or eligibility checks. The actual source-health view and final diagnostic confirmed all 12 categories populated: Colony / settlement 66, Cozy building toy 6, Farming / life 53, Horror / exploration 33, Platformer / metroidvania 27, Puzzle 32, Roguelike deckbuilder 6, Role-playing 20, Shooter 27, Strategy 22, Survival / crafting 25 and Racing / sports 17. Cozy and Deckbuilder remain explicitly thin.

The separate keyless Steam metric command was launched at 19:28:46 UTC. Recorded job `metrics-14107c42-52a4-4b41-8c03-25b0cd3f9150` ran from 19:28:49.160 to 19:40:02.671 UTC and ended with terminal status `partial`. It used 668 requests, 421,527 response bytes, zero retries and 673,500 milliseconds of active runtime. There were 659 accepted metric observations, nine failed attempts and zero skipped items: **325 of 334 fresh supported player counts and 334 of 334 fresh review aggregates**. Nine player counts remain missing and are not converted to zero or eligible scoring inputs. The partial status is retained honestly rather than relabeled as complete.

The final read-only diagnostic at 19:43:34.260 UTC confirms 334 unique Steam IDs and 334 unique IGDB IDs, both catalog/genre gates passing, zero foreign-key violations and zero duplicate observation keys. Among 325 supported current-player readings, 94 were observed zero, 79 were 1–10 players, 122 were 11–999, and 30 were at least 1,000. Both lower-traction and popular games are therefore represented in the tracked sample; these descriptive bands do not establish market completeness or sales. There are 285 games with official game links and 36 games with saved Steam tags. All schedules remain disabled. The safe report is `research/milestone-3/live-final-verification.json`.

## Live preservation check

A read-only, consistent-snapshot comparison against the actual pre-M3 SQLite backup passed at 19:30:17 UTC while metric collection was running. All 36 original games, 108 original metric observations, 701 saved Steam-tag rows, original identity crosswalks, seven editorial genres, review windows, marketing evidence and UI preferences were retained exactly. All original rows in the separately checked metadata tables were also unchanged. There were zero foreign-key violations and zero duplicate observation keys. Additional observations in this intermediate check include missing-value admission records and in-progress metrics, so their count is not a completed metric-coverage claim. The report is `research/milestone-3/live-preservation-verification.json`.

## Actual private-app checks

The final M3 build was overlaid without reseeding and the existing private preview was restarted on port 4174. Browser checks confirmed 334 verified games, all 12 populated groups, the two thin-category warnings, accurate job status and honest tag coverage: 298 games have no saved Steam tags and the original 36 retain dated saved tags. The Role-playing view showed 20 games, unknown metrics for games not yet collected and 0/20 tag coverage. After collection, Overview displayed the actual score-input window of 19:28:49–19:40:01 UTC, and the search table distinguished missing player counts from supported zero review counts. The historical M2 baseline remained unchanged. The Source health mobile layout had a 388-pixel viewport and 388-pixel scroll width, with no horizontal overflow.

Daily and small-watchlist scheduling is implemented and regression-tested through explicit bounded commands. **No unattended timer, cron process or recurring collection has been enabled.** Schedules remain disabled until separately configured with an explicit expiry, and each tick is a bounded invocation rather than a daemon.

## Final acceptance check

The catalog-size, genre, high/lower-traction representation, integrity and baseline-preservation evidence is recorded. The initial integrated collection artifact was the independently audited `59d61a94f652733ec435d0d7fa86404d21a41460ce3749a64f44ebaf08db1a12` package. The final game-detail check confirmed source links, metrics and unknown tags, but exposed the taxonomy issue described below; its correction is a separate auditable overlay.

## Corrective taxonomy release

The actual Rust detail check found that the discovery route had selected Farming from an incidental keyword despite stronger Survival evidence. The same issue affected other mixed-label games. This is a classification defect, not a metric or identity failure. The corrective version removes exploration-only Horror and crafting-only Survival assignments, requires stronger simulation evidence for Farming, gives explicit Survival evidence precedence over incidental farming/cozy keywords, and preserves equally direct RPG/Shooter evidence without a forced precedence. Existing supported mixed-label choices are retained only while they remain in the strongest evidence tier. Every inference remains provisional and alternative labels are retained; the map does not claim objective exclusive genre truth. Many mixed-label groupings still need manual review, including valid but non-exclusive prior choices. Manual taxonomy-quality review remains a separate gate before treating rankings as decision-ready.

The read-only plan from all 298 new admissions changes 31 genre assignments, including Rust and Core Keeper to Survival and Team Fortress 2 to Shooter. Six games have unresolved evidence rather than a forced choice. The plan leaves **328 classified verified games across all 12 agreed categories**, plus six unresolved games still accessible in the catalog. The unresolved holding label is excluded from research genre counts, server scoring eligibility and frontend rankings. The two thin categories become Cozy building toy (5) and Roguelike deckbuilder (6); no coverage is padded. Original 36 groupings, raw labels, metrics, tags, marketing and preferences are unchanged.

`scripts/correct-taxonomy.mjs plan` is read-only. Applying a correction requires the exact reviewed plan hash, refuses while a collector is running, and uses one transaction scoped to new admissions only. Previous mappings are retained inside the admission history. Replay is idempotent. There are zero provider requests and no credential reads. A changed taxonomy is an explicit comparison-baseline change, never a market trend.

The reviewed plan hash is `154f7e7d0de255a2025138bc3970f9175c95eb2d6f9d06cc043e02167e7b8189`. Applying the overlay and reviewed plan must be followed by the read-only verifier and the Rust/Overview browser check; those runtime outputs establish the correction's live state. The accompanying correction manifest lists exact source and built-asset hashes.

No Cloudflare deployment, publication, git push, billing integration, OpenAI calls, new automated Steam-tag acquisition, fabricated historical trends or indefinite background collection is included. Broader redistribution and enduring IGDB archive permissions remain separate gates. Operating instructions and documented source lifecycle are in `app/COLLECTION.md`.

Correction build validation: strict TypeScript, lint, frontend/backend production builds and all 135 tests pass. The original 109-test prototype regression pass and baseline preservation evidence remain recorded above.


## Final live acceptance - 10 October 2026

The audited offline correction was applied and verified at 19:52:28 UTC: 334 verified games, 328 provisionally classified across 12 agreed categories, six unresolved games excluded from genre scores. Rust now displays Survival / crafting. Source health reports taxonomy 1.1 and the six exclusions. All 36 original games and 108 original observations remain exactly preserved; foreign-key and duplicate-observation checks are clean. Steam coverage is 325 player counts and 334 review aggregates, with nine player counts missing. The bounded pipeline and catalog implementation are complete. Genre assignments still require manual quality review before decision-ready ranking use; Cozy (5) and Deckbuilder (6) remain thin. No recurring timer or new tag acquisition is enabled.
