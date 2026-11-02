# Offline reviewed release-evidence pilot

This bounded tool imports reviewed statements into a **new throwaway SQLite copy**, never into its input database. It has no HTTP client, collector, credential loading, scheduler, API route or deployment action. The current working database is not a test destination. A reviewed copy becoming the staged app database is a separate, explicitly authorized operational step with its own backup and verification.

## What the pilot establishes

Five exact official Steam pages support `game` through the named method `steam_store_base_game_manual_review_v1`, confidence `high_reviewed_classification`. Each manual review checks exact AppID/title/developer, a named main-product offer, gameplay description, and separation from demo/DLC/soundtrack/bundle products. This is a reasoned classification from direct official product-page evidence, **not an API-returned `app_type` field**. The 298 classifications reconstructed from earlier game-only query admissions remain pending and are not promoted by this policy. The pilot separately reviews five of those/legacy products, so these independent assertions must not be counted as acceptance of all reconstructed rows.

| Game | First playable on Steam | Full Steam release |
| --- | --- | --- |
| Fields of Mistria 2142790 | 2024-08-05, explicit EA date | 2026-08-05, actual 1.0 post plus Steam date |
| Against the Storm 1336490 | 2022-11-01, explicit EA date | 2023-12-08, actual 1.0 statement plus Steam date |
| 9 Kings 2784470 | 2025-05-23, explicit EA date | Unknown; 2026-11-12 is only a plan |
| Darkwood 274520 | Pending Steam-specific scope | Pending explicit full-release semantics |
| Half-Life 70 | Unknown | Unknown |

First playable is the public EA release of the same Steam AppID under `same-steam-appid-public-ea-release-v1`. Separate demos/playtests and closed betas do not count. This bounded review does not establish exhaustive historical beta or paid Advance Access research. Full release never fills first playable, and a generic Steam display date alone does not establish Steam 1.0. IGDB original/platform dates are never promoted.

The pilot is manually selected to exercise different evidence states. Neither its dates, date coverage, types nor metrics represent all Steam releases or unbiased genre demand. These are small data-validation results, not a market census.

## Commands (Node 24)

Use an existing database with migrations through `0004_release_research.sql`. Do not run seed/setup to upgrade it. The importer does not automatically migrate the input or read `FIELDNOTE_DB`/environment secrets.

```sh
# Default: read-only validation, conflict check and dry run. No ledger/table creation.
node scripts/release-evidence-import.mjs \
  --manifest evidence/five-game-reviewed-pilot-2026-10-11.json \
  --database /absolute/path/existing.sqlite

# Makes a consistent SQLite backup to a NEW path, applies there, checks preservation,
# integrity, foreign keys and an idempotent replay. Existing destinations are refused.
node scripts/release-evidence-import.mjs \
  --manifest evidence/five-game-reviewed-pilot-2026-10-11.json \
  --database /absolute/path/existing.sqlite \
  --apply-copy /absolute/path/new-throwaway-evidence.sqlite

npm run check
```

There is deliberately no CLI `--apply` or in-place destination. Database paths must be explicit; no path defaults to the working database. Keep the source backup until the authorized staged integration has passed its own checks. The CLI never switches the running application to its output.

## Manifest and source contract

- `schemaVersion` and `policyVersion` are fixed, versioned values. A deterministic SHA-256 covers canonical manifest content except its own hash. IDs are immutable: same ID plus changed content aborts.
- Source observations are distinct from assertions. Observations preserve exact reviewed URL/AppID, source kind/role, original label/value, normalized candidate, precision, status, platform/store scope, review acquisition interval, and source publication date separately.
- Allowed URLs, AppIDs and roles are pinned in `scripts/release-evidence-policy.mjs`. An arbitrary HTTPS URL, official-looking hostname or caller-supplied authority flag is insufficient. Future source additions and new acceptance methods require a new policy review.
- The original release audit acquired web-tool text between 17:25 and 17:30 UTC on 2026-10-11. Manual type evidence was inspected from 17:38:00 through review completion 17:38:52 UTC. These are explicit acquisition intervals, not precise origin fetch times. Origin HTTP status, raw response hash and server publication times unavailable from the audit remain null.
- For the existing tables' mandatory `retrieved_at`, the importer conservatively uses the latest supporting acquisition-interval end. This means no assertion appears in a historical `asOf` before all its supporting evidence was acquired. The interval and its meaning stay in `verification_note` and the manifest.
- The actual Fields of Mistria 1.0 post displayed Aug 5 without a year; Steam plus the separate dated announcement corroborate 2026. Against the Storm's developer post publication date 2023-12-30 is not substituted for the Steam event date 2023-12-08.
- `review.status=offline_candidate_not_live_approved` describes the bundle's review boundary. It is not a live-application authorization flag. Acceptance is a policy-qualified normalized assertion, not evidence of an origin API response or completed deployment review.
- This parser checks structure, known associations and claim semantics. A content hash is an integrity identifier, not a digital signature or proof that source prose is true. Independent review must verify this manually prepared bundle before staged/live integration.

## Atomic, append-only persistence

Only accepted exact-day `released` assertions enter `research_release_evidence`; only accepted reviewed game classifications enter `research_application_evidence`. The five release rows and five type rows retain policy, method, confidence, source association and review caveats in their notes.

Two sidecar registry tables are created **inside the successful copy import transaction**, not as an app-startup migration:

- `research_evidence_imports`: immutable manifest identity/hash, policy/importer version and complete canonical manifest JSON.
- `research_evidence_assertions`: immutable assertion identity/hash, accepted/pending disposition and optional foreign key to its accepted type/release row, with the expected original row JSON.

Pending release dates, plans and reconstructed types live only in this registry/manifest. They never become verified unknown types or planned rows in the adapter's accepted evidence tables. Seven pending assertions remain: five unresolved/planned release assertions and two example reconstructed-type assertions. The other 296 reconstructed candidates are not imported or enumerated.

Dry runs check the union of incoming and existing facts. Verified unknown types, conflicting types/dates, full release before first playable, and even an old unverified planned row alongside released evidence block the transaction. No latest-wins, delete, correction or automatic supersession exists. Conflict resolution is separate review; this tool cannot rewrite history to make an import pass.

Stable-ID replay adds no facts or ledger rows. Equivalent pre-existing supported facts are linked instead of copied again. Changed IDs/content, missing or modified previously imported evidence, duplicate assertions, bad sources, impossible dates, year zero, non-UTC/future acquisition times and future released claims fail closed. Inserts and preservation checks share one transaction; any write failure or trigger mutation rolls back all new rows and registry creation.

## Expected release-date filter checks

At an `asOf` on or after `2026-10-11T17:38:52Z`, using a custom inclusive range `1990-01-01` through `2026-10-11`, first-playable filters include Mistria, Against the Storm and 9 Kings (3); full-release filters include Mistria and Against the Storm (2). Darkwood and Half-Life remain missing dates. Metrics remain unchanged and are not newly collected.

At `asOf=2026-10-11T18:00:00Z`, the 1-month preset contains neither first-playable nor full-release dates. The 3-month full-release preset includes Mistria; first playable includes none. A custom range `2025-05-23` through `2025-05-23` includes 9 Kings under first playable and none under full release. Missing date coverage is separate from dates outside the selected range.

Before `17:30:00Z`, no new release evidence is available. Between `17:30:00Z` and `17:38:52Z`, release evidence may be visible, but these new manual types are not yet available, so they do not establish eligibility. All other inventory games retain their prior evidence state.

## Deferred work

No automated acquisition route, complete Steam release history, production 7/30-day review validation, broad catalog type acceptance, public deployment, scheduling, credentials or subscriptions are enabled. Repeated import is safe, but the pilot does not settle those separate tasks.
