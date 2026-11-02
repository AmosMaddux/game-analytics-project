# Release-cohort research integration

## Status and bounded scope

This is an offline, transfer-ready working-copy integration of the recovered current M3 application. It has not been deployed to Codespaces, Cloudflare, or any public service. The original recovered app and backups remain immutable. No live Steam/IGDB request, credential access, source collection, schedule activation, Git push, or deployment was performed.

New route: `#/releases`. New API: `GET /api/research/releases`.

The first slice integrates the independently tested dependency-free cohort/statistics foundation through explicit SQL adapters and React views. It does not implement the proposed 300-game allocator, new taxonomy acquisition, weekly job/publication pipeline, review pagination source gate, or calibrated popularity model.

## What the actual data supports

The preserved database has 334 tracked records: the original 36-game pilot and 298 discovery admissions. It contains 328 classified and 6 unresolved records, 1,661 historical metric rows, 701 saved tags, six date-feasibility windows, and three disabled schedule records. The latest compatible saved metric run has 325 concurrent-player observations and 334 cumulative-review observations.

No existing field is reconciled proof of first public playable Steam release (including Early Access), Steam 1.0, or separately verified Steam application type. All 334 therefore remain excluded from the new strict cohort aggregates. The UI shows this evidence gap instead of manufacturing dates or market statistics. The audit retains the original store display and IGDB first-release dates clearly labeled reference-only. Populated/zero/missing/error cases are test-only fixtures and never enter the working database or production seed.

## Query and adapter contract

- Population: `tracked`, `legacy36`, or `discovery`, using existing saved membership. No new panel or Steam census is implied.
- Release preset: `7d`, `14d`, `21d`, `1m`, `2m`, `3m`, `1y`, or inclusive `custom` dates.
- Basis: independently verified `first_playable` or `full_release`. No fallback between bases.
- Explicit strict UTC `asOf` freezes the evaluation cutoff. The UI stores it in the page URL.
- Day-precision dates are midnight UTC. Rolling windows preserve the exact cutoff time; the start day is excluded if its midnight precedes that cutoff. Custom dates include both requested days. Cohort intervals are half-open.
- Population/admission timing and verified game-type checks precede release-cohort filtering and all genre calculations. Unknown, conflicting, demo, DLC, soundtrack and tool types fail closed.
- Metric: saved players or cumulative reviews. Each selected observation set has one exact metric, run, method, source scope and unit. Missing games are never filled from older runs. Audit provenance belongs to the supported value selected.
- Seven/30-day review intervals are displayed independently; activity metrics remain unavailable. The six legacy feasibility windows do not establish broad production validation.
- Current saved taxonomy versions are explicit. Historical membership and historical taxonomy changes are not reconstructed. Unresolved genres remain auditable, not an invented genre bucket.
- Statistics: median, arithmetic mean, R7 quartiles/IQR, missing/observed coverage, largest-game share, n-based sample warnings, and 10%-per-tail trimmed mean at n ≥ 20. No new ranking or calibrated score is produced.
- Existing scores retain the identical legacy computation and are visibly labeled Legacy Popularity Score.

## Additive migration and rollback

`migrations/0004_release_research.sql` adds only `research_application_evidence` and `research_release_evidence`, plus indexes. Both begin empty. Legacy `foundation_schema` stays 3; `local_migrations` tracks this additive migration. No old table or source fact is rewritten.

For an existing installation, keep the original app/database, back up with a valid SQLite backup, verify restore, and migrate only a separate working copy. Do not run setup/seed to upgrade. The original M3 seeding guard also protects databases with collection history.

The rollback script at `migrations/rollback/0004_release_research.sql` drops only the two new evidence tables and removes its migration ledger entry. It was tested on disposable copies. Once new evidence is added, back it up before rollback; dropping it would discard those new records. Do not run rollback on the only copy.

There is deliberately no web evidence-write, collector, scheduler, upload or credential endpoint. Evidence admission/import with provenance requires separate bounded work.

## Validation

See the accompanying verification report for exact executed checks and changed-file hashes. The original 135-test suite passed before edits. The first complete integrated run passed 225 tests before the 12 additional UI tests were added. Final checks include strict TypeScript, source-policy lint, production build, all existing tests, 65 foundation cases, adapter/API tests, independent adversarial tests, React rendering and request-state checks. Migration preservation compares every original table row; rollback returns every original fact exactly.

Node 24.x is required. Cloudflare/D1 deployment behavior is not claimed by local Fetch/SQLite tests. Browser interaction/visual QA is reported separately from static React render tests.

## Safe transfer

The allowlisted source/prebuilt ZIP contains app code, migrations, tests and the unchanged 36-game baseline seed. It excludes databases, dependencies, environment files, secrets and raw research archives. To use the 334-game inventory, copy its existing SQLite database privately to a separate destination and migrate that copy. Never seed it from the 36-game baseline.
