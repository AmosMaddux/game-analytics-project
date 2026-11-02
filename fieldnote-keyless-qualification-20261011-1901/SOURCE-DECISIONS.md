# Fieldnote: practical broad collection and review validation

11 October 2026 UTC. Scope: private, noncommercial, free-source prototype. This report does not authorize a purchase, new credentials, public deployment or an external communication. No authenticated requests were made by the research worker. The keyless sentinel campaign was subsequently executed in Codespaces and independently audited; its final result is recorded below.

## Decision

Keep the requested population-first allocation: 75 reference games, 100 recent releases, 100 older releases (20 each from 2021–2025), and 25 low-traction controls. Do not substitute a hashed 300-game slice of the old genre-selected collection. Retain every old game and observation outside the active panel when necessary.

The practical date option is a separately named **IGDB-reported PC release** mode, contingent on the user's selection. It does not establish first playable on Steam or full 1.0. Continue offering verified Steam date modes for the smaller evidence-backed subset. A generic store date must not become a first-playable claim.

Use raw IGDB genres, themes and keywords immediately, with their source names. The saved catalog already has 20 distinct raw genres over all 334 games, 21 themes over 313, and 1,767 keywords over 323. There is no reason to restrict the interface or discovery to the old 12 editorial genres. Preserve the 36 existing Steam-tag records separately. No new bulk Steam-tag acquisition is cleared by this review.

## Saved inventory proves broader discovery is needed

The read-only `saved-inventory-audit.json` reports database integrity `ok`, zero foreign-key violations, 334 games and 298 reconstructed game-only Steam catalog admissions. All 334 have an IGDB Main Game statement. There are 522 PC release records for 332 games.

At most 322 games have an exact past PC date. This is an exploratory upper bound: it does not yet reject earlier coarse dates or alpha/beta records. Taking the minimum exact past PC date produces no recent games in July 14–October 11, 2026. The older-year leads are 30/19/10/9/4 respectively for 2021–2025. Those can fill at most 62 of the 100 older slots even before overlap/admission checks. One later recent PC event in an old game is not a newly released game under an earliest-date policy.

Therefore, the saved 334 cannot fill the requested quotas under this policy. Filling 300 needs new recent and older candidates, rather than relaxed quotas or fabricated dates. Exact shortfalls are recomputed after deduplication and admissions.

## Source register

| Source | Use now | Meaning and boundary |
| --- | --- | --- |
| Saved IGDB normalized catalog | Yes, offline | Source-reported metadata; preserve IDs, labels, retrieval times and raw release status/precision |
| IGDB API, existing private account | User-executed bounded refresh/discovery | Free noncommercial metadata; no credentials read or transmitted by this research worker |
| Steam IStoreService GetAppList | Existing-key user-executed game-only identity pass | Query membership supports a named derived game classification; `last_modified` is not a release date |
| Steam IUserReviewsService | Keyless bounded validation, then qualified collection | Dated `total_matching`, not page length or a score-summary total |
| Steam current-player API | Keyless timestamped sample | Current online players; unavailable is null, not zero |
| Steam storefront/publisher pages | Targeted manual evidence only | Useful for specific EA/1.0 exceptions; not a 300-page bulk harvesting plan |
| IStoreBrowseService, store HTML tag collection | Not enabled | No supported automated acquisition contract established here |
| SteamDB, Gamalytic, SteamIndex/SteamWebAPI | Excluded | No competing-service workaround |

Official technical references checked today: [IGDB documentation](https://api-docs.igdb.com/), [Steam catalog](https://partner.steamgames.com/doc/webapi/IStoreService), [review API](https://partner.steamgames.com/doc/webapi/IUserReviewsService), [current players](https://partner.steamgames.com/doc/webapi/ISteamUserStats), and [Steam API terms](https://steamcommunity.com/dev/apiterms). IGDB documents 500-result pagination, 4 requests/second, and 8 simultaneous requests, plus local caching. Use materially lower operational limits. Steam documents optional authentication for reviews and a lower anonymous rate limit; throttling is a stop condition here. These references establish endpoint contracts, not a claim that every underlying database statement is correct.

## Broad candidate acquisition contract

1. Reuse saved normalized identities and observations. Add population-first discovery streams for recent releases, each older year, and broad reference/control leads. No genre, theme or IGDB rating-count predicate belongs in general eligibility.
2. For each dated stream query IGDB `release_dates`, applying `platform = 6` and the date interval to the **same release row**. Then fetch the resulting game IDs in bounded batches and inspect every PC release record locally. A filter against different elements of a nested array can otherwise match a PC record and a date from a different platform.
3. A broad games stream can use `game_type = 0 & parent_game = null & version_parent = null & platforms = (3,6,14) & external_games.external_game_source = 1 & id > CURSOR`, ordered by ID. Main Game is the chosen initial inclusion policy, not a universal claim that remasters/expansions are never games.
4. Expand `game_type`, the Steam external-game mapping, release platform/status/format/region, genres, themes, keywords, game modes and player perspectives. Do not reuse the old `normalizeDiscoveryCandidate` unchanged: it rejects candidates merely for missing or ambiguous old editorial genres. Identity/type validity and taxonomy coverage are separate.
5. Resolve exact Steam AppIDs from IGDB crosswalks; reject ambiguous mappings. Join new candidates to a completed documented game-only Steam catalog response. Retain query flags, source time, page completion and method. Store `derived_game_only_query`, not an invented `app_type` field.
6. Choose the date policy explicitly. Exact past full/EA PC events can support a source-reported date. Null release status remains null and need not exclude a clearly labeled source date; exclude explicit alpha/beta from a released-game interpretation. Earlier coarse dates prevent a confident earliest-day assertion. Preserve regional differences, plans, precision and conflicts. Do not backfill missing dates from the all-platform `first_release_date`.
7. Qualify candidate traction using actual Steam review totals, not IGDB rating counts. Preserve new-release probation and the separate low-review control allowance. Seed selection within each eligible bucket, deduplicate by AppID, and keep the 75/100/100/25 allocations. Store the seed, pool, policy, reason and date basis. Exhausted candidates/caps produce visible shortfalls.

The separate population-discovery implementation owns the exact command and file contract. Do not run the old `catalog` CLI as a substitute: it aims at 360 total games, has an old genre-route adapter, and may renew OAuth credentials. A personally executed command may use the existing private configuration, but the assistant must not read it or invoke a credential-bearing run. Missing/expired credentials require the user to handle the existing authentication flow; no new key is proposed here.

## M1 evidence and the small remaining validation

Recovered evidence: `fieldnote-recovered-20261011/database/m1-date-validation-evidence.json`, run `dates-20261010T180331650Z-2d32a062-1960-469e-8624-ae14ea485d4b`, fetched October 10, 2026 18:03:31–18:03:57 UTC.

- 24 aggregate requests accepted, none rejected
- Six complete September enumerations and six consistent partitions
- Positive boundaries already passed for Phantom Rose, Bean and Nothingness, and Saturnalia
- Verdant Skies, Goblins of Elderstone and Psycron had zero September reviews, so a positive boundary could not be exercised in those windows

The old `inconclusive_or_incomplete` label does not mean the zero counts failed. The new harness reuses the positive evidence and asks the three previous zero cases for their latest review timestamp, using that observed second for a tiny positive boundary test. A pre-review-era window supplies a genuinely empty discriminator. Counter-Strike 2 exercises populated, above-page-size 7/30-day totals, a 23+7 partition and a tiny complete boundary enumeration. It never pages through the game's full history.

## Historical sentinel harness (completed; do not rerun for panel collection)

Files: `validate-reviews.mjs`, `validate-reviews.test.mjs`, `sentinel-plan.json`, and the mandatory `validation-campaign-ledger.json`. Requires Node 24.5+ within major version 24. No third-party package installation.

Offline checks:

```
node --test validate-reviews.test.mjs
node validate-reviews.mjs --plan
```

The reviewed v1.1 campaign command was:

```
node validate-reviews.mjs --run --campaign-ledger ./validation-campaign-ledger.json --as-of 2026-10-11T00:00:00Z --output ./review-validation-v1.1-live.json
```

The default end boundary is the start of the current UTC day, frozen once. An optional `--as-of 2026-10-11T00:00:00Z` reproduces that historical cutoff. The user can run it personally; it uses no authentication and does not inspect `.env`. It reads only runtime proxy/safety environment settings. It writes a new evidence file exclusively, never a database. It will not overwrite an existing result.

Allowlist: AppIDs 730050, 693580, 1368410, 1054550 and 730; only the documented review/current-player API paths on `api.steampowered.com`. No cookies, keys, token request, redirect, alternative host or fallback route. Source responses are reduced to counts/temporary IDs/timestamps immediately; final output omits review IDs, text, author information, raw payloads, headers and request URLs. Zero, missing and stopped are distinct states.

Hard caps: 60 requests, 4 dispatched retries in total and at most 1 per request, 2-second spacing, 20-second request deadline, 12-minute total runtime, 1 MiB per response, 16 MiB overall, 3 pages per tiny enumeration. The normal plan is 36 calls. HTTP 401/403, 429 and redirects stop the entire run; no retry or alternate transport. Transient network/timeout/500/502/503/504 errors have the bounded retry allowance. Runtime and byte caps include failed attempts. A cap, changed enumeration total, bad schema or inconsistent partition results in a stopped/inconclusive report, not a fabricated metric or wider crawl. CCU schema unavailability alone records null and does not invalidate a completed review proof.

## What the live result permits

`status: passed` means the documented count/date behavior passed the specified live sentinel checks. It does not certify every game's source metadata. Review counts are surviving matching reviews observed at retrieval, so later moderation or removal can change an old interval.

The saved metric fields are `observations.reviews7d` and `reviews30d`, with exact half-open Unix intervals, source-reported counts and observation times. Purchase mode is Steam purchases, all languages, all review polarities, off-topic filtering enabled. These settings must be stored with future metrics and match comparisons. The exact API end is internal end minus one second.

The separate bounded collector now implements lifetime, 7-day, 30-day and CCU collection. Merely importing this five-game proof does not create 300 activity observations. Only a fully staged panel manifest with real successful measurements should be published. Do not import stopped output as validated metrics.

## Request and cost envelope

Data-service spending: proposed **$0**. No paid source or subscription is needed for this route. Hosting and Codespaces charges are separate.

- Sentinel validation: 36 normal calls, at most 60
- Metadata bootstrap: estimate 15–40 IGDB calls for up to 1,000 candidates with targeted date streams and batches; this is an estimate, not a quota-fill guarantee. Use the separate collector's lower bounded caps and stop if exhausted.
- Steam catalog identity bootstrap: up to 50,000 rows per documented request; page count depends on catalog size. Bound it separately (existing ceiling is 12 pages/36 attempts), reuse retained current complete evidence where possible.
- Traction qualification: at most one lifetime review call per newly admitted candidate. A 1,000-candidate cap is not permission to deeply collect all 1,000. Give bootstrap qualification its own allowance; do not hide it inside a 1,500-call panel job.
- Complete 300-game snapshot: 1,200 normal calls = lifetime + 7-day + 30-day + CCU per game. At 2-second spacing a serial run takes at least 40 minutes, so the existing 25-minute Steam job ceiling must change or the work must be checkpointed into bounded batches. Do not claim the existing runtime can complete that workload.
- Five weekly runs: 6,000 normal metric calls/month. With a 12,000-call monthly budget, reserve the remaining scheduled work before manual refreshes and include discovery/tests/retries in separate counters. The 100,000/day API terms ceiling is not an anonymous throughput entitlement.

Remaining execution prerequisites are the approved date mode, personally executed existing-credential discovery, a reconciled current budget, and a complete quota-conforming panel. The keyless sentinel requirement passed as recorded below. A 300-game claim remains blocked until actual per-bucket counts and measurements reconcile. No arbitrary manual verification of every IGDB PC date is required for the source-reported mode.

## Live validation update, 18:04 UTC

An independently reviewed source-only archive was run once in the existing Codespaces environment. It stopped after 2 requests, 0 retries and 2,184 bytes with `invalid_review_schema`. Verdant Skies' lifetime count succeeded (364); the subsequent 7-day response did not satisfy the parser. No validation checks completed and no app or database was changed.

The sanitized result SHA-256 is `3a8aefec83375d04c74beabeeacad930d9060e1259dbe621ff64bcf233840f5d`. No raw payload was retained, so this result does not identify the schema discrepancy. A separate three-request structure-only diagnostic has been prepared for review; it distinguishes absent fields, wrong types and wrapper differences without exposing review content, authors or identifiers. Missing values have not been reinterpreted as zeros. The 300-game activity collector remains blocked until a repaired sentinel run passes.


## Final source result and bounded collection artifacts, 11 October 2026

The three-request diagnostic identified two concrete source behaviors: empty review results may omit `reviews` when both `total_matching` and `query_summary.num_reviews` are explicitly zero; a zero Unix boundary is treated as unset. The v1.1 parser accepts only that explicit-zero omission and tests empty windows with positive 1–2 January 1990 boundaries. Missing or malformed totals remain errors.

The corrected v1.1 live validation **passed** all 13 unique checks across exactly five sentinels. Its 36 requests had no retries. The whole campaign, including the initial stop and diagnostic, charged **41 requests, 25,018 bytes and 77.063 seconds of active runtime**. Four positive boundary proofs each enumerated 1 = 0 + 1 in three pages; CS2's populated partition was 11,190 + 38,709 = 49,899. An independent reviewer verified the result, identities, checks, arithmetic, timestamps, report hash and campaign accounting.

Exact accepted evidence: `passed-sentinel-evidence.json`, SHA-256 `a8efd1423272343178ed1813ad03660a18e74169f032c0e06fceb90bd2e40b6f`. It is a source-method proof, not a 300-game dataset.

The code now provides two explicit phases through one authoritative monthly ledger:

1. `collect-panel-metrics.mjs --run --candidates ...` qualifies 1–1,000 deduplicated, independently verified Steam game identities with lifetime review totals only. Caps: 1,200 attempts, 40 active minutes, one retry per logical request and 100 retries overall.
2. `join-qualified-candidates.mjs` joins that one complete qualification run to the exact discovery artifact entirely offline. The app allocator selects 75 reference, 100 recent, 20 per older year and 25 controls. A shortfall remains a shortfall.
3. `collect-panel-metrics.mjs --advance-to-panel --panel ...` requires a complete 300-member manifest whose selection evidence matches that qualification run. It carries all earlier charges and source-lane pacing forward. Caps: 1,500 attempts and 90 active minutes; 1,200 normal requests.

Both phases use 2-second minimum spacing, 20-second deadlines, 128 KiB per response and 32 MiB per phase. Denials, throttling and redirects permanently stop the lane. Durable reservations, strict checkpoints, logical retry accounting, exclusive locking and directory fsync protect the reviewed campaign across interruption. Existing output files are not overwritten. Only sanitized counts/provenance are exported. No provider credentials, application database writes or schedule changes are involved.

At the current saved audit, 736 actual saved project-job requests plus the 41-request sentinel campaign give 777 known October requests. The baseline must be regenerated in the actual execution environment after discovery, with all additional relevant reports included. It covers known reconciled project jobs; it cannot discover unrelated external collectors. No weekly schedule is currently enabled and no imaginary future reservation is used. A 2,700-attempt bootstrap allowance bounds both new phases (normal maximum 2,200 calls) within the project's 12,000/month ceiling. Metadata discovery has its own bounded request budget and is included as actual baseline expenditure before qualification.

See `RUNBOOK.md` for exact preparation, resume and transition commands. All collector tests are mocked/offline. The existing 137-member draft is rejected before any collection call. No live qualification or 300-game metric run has occurred.
