# Cached identity export and optional Steam resume repair

Implementation patch: `steam-catalog-parser-1.0.1`; candidate/checkpoint schema remains `fieldnote-population-discovery-1.0` so the original frozen plan and charged budgets remain valid.

Base source archive SHA-256: `09af94c793a346596e7ce7262f9a4189ea2eac57584fe555af8cf6d167794c62`. That archive is unchanged.

## Observed owner-run result

The owner personally ran the original package on 11 October 2026. It saved all 1,000 candidate metadata records and three Steam identity pages, including 750 matching AppID/name records. The fourth Steam request returned JSON that the page validator rejected with `invalid_steam_catalog_page`.

The run had 31 total source requests, no retries, 26 IGDB data pages, four Steam attempts, three accepted Steam pages and a saved AppID cursor of 4,110,900. Metadata and the prior identity pages are reusable. The failed raw page was not retained, so the exact rejected field cannot be identified offline. An omitted terminal `have_more_results` field is consistent with the failure location but remains an unproven explanation.

The original implementation required that field, although Steam's official documentation promises ordered AppIDs and continuation using the last returned AppID, not a mandatory response completion flag. It also allowed a single unusable public title anywhere in a 50,000-row page to reject the entire page.

## Preferred next step: use the saved evidence offline

`materialize-cached-identities.mjs` reads an explicitly named candidate report and matching checkpoint, verifies both expected file hashes, verifies the checkpoint's internal hash, and checks that the two documents agree. It applies the **unchanged** exact AppID/title identity rule to the already saved official Steam records.

It does not read a private config, acquire a token, create a network transport, fetch metadata, access a database, or overwrite either source file. The output directory must be new; output files are created exclusively with mode 0600. Its manifest binds both input hashes, the output hash, original source counters, original completion time and remaining coverage gaps. Materialization time is recorded separately and does not become a new source observation time.

For the actual recovered run this produces:

- 625 verified identities, 184 pending identities and 191 quarantined candidates
- The 191 quarantines comprise 27 original crosswalk problems, 125 Steam-title mismatches and 39 AppIDs absent below the already checked cursor
- 498 verified games have an exact derived IGDB-PC date
- 103 have an exact date in the frozen recent interval; older-year counts are 63, 75, 82, 72 and 68 for 2021–2025
- Source request count remains 31; source catalog completeness remains false; no panel slots are allocated here

These are saved-source identity results, not a claim that the catalog is complete or the 300-game allocation can ignore review eligibility and overlaps. PC dates retain their IGDB basis. The allocator must still use the explicitly selected date mode and approved eligibility rules.

Example offline command, substituting the correct existing local paths and verified hashes:

```sh
node materialize-cached-identities.mjs --candidates /path/to/candidates.json --checkpoint /path/to/checkpoint.json --out-dir /path/to/new-output-directory --expect-candidates-sha256 CANDIDATE_SHA256 --expect-checkpoint-sha256 CHECKPOINT_SHA256
```

Actual source hashes:

- candidates.json: `cdd2278bea3fa218f987d08a7d0f71090c668cab9b74cea15f5910b322eff80f`
- checkpoint.json: `7327d3ee4f06de3ab8f0eebd58c99fb02eb522708da2e13847511282acea9f57`

## Optional same-run live resume

If more identities are needed after using the verified subset, this patch can replace code files in the original package directory while preserving its `.runs` directory and original run ID. Keep the original archive and source artifacts. Only the owner personally executes the credential-bearing resume, as before. The command does not reacquire an IGDB token or repeat metadata when the original checkpoint already contains all metadata.

Changes are limited to Steam-page validation, identity finalization, additive provenance/diagnostics and the offline exporter:

1. A valid nonempty ordered AppID array can be processed when `have_more_results` is absent. Its absence **never** means the catalog is complete. Paging continues from the last actual row only while candidate IDs still need coverage and the original caps allow another request.
2. An explicit empty apps array without a completion flag stops as `steam_completion_unconfirmed`. Unmatched IDs above the checked cursor remain pending. An absent apps field still fails validation with safe shape diagnostics. No missing field becomes an invented empty catalog.
3. An explicit false completion flag can complete the catalog. For an empty terminal page, an absent, unchanged or zero response cursor never moves the saved checked cursor backward. Other contradictory cursors fail.
4. A missing, blank, overlong or unsafe title cannot verify that candidate. It is represented as unavailable and quarantined if its AppID is a target. Unrelated unusable names no longer invalidate the page. Numeric IDs, ascending order, duplicates, bounds and cursor consistency remain strictly checked.
5. Existing exact matches are finalized before the next request, and new matches are finalized after every accepted page. A later page failure no longer hides already verified identities.
6. Sanitized diagnostics contain only fixed field types, counts and public numeric AppIDs/cursors, with no raw title strings, URLs, headers, credentials or raw response bodies.
7. The parser upgrade records the prior parser version, original stop reason, prior completion time and charged/accepted page counts before current error state is cleared. The frozen plan/schema version and all budgets are unchanged. `finishedAt` is now included in candidate reports for accurate monthly request accounting.

The original 180-attempt, 12-minute, per-provider byte and page caps, pacing, retries, stop-on-401/403/429, TLS rules and no-database-write scope remain unchanged.

## Verification and source boundaries

The combined package passes 57 offline tests, including 16 added regressions for the parser repair and offline materialization. A separately reviewed exact recovered-checkpoint test confirmed no metadata or token calls and unchanged plan, metadata and budget provenance. The new parser has not been executed live by an agent.

Official references:

- https://partner.steamgames.com/doc/webapi/IStoreService
- https://partner.steamgames.com/doc/webapi_overview/responses

These documents do not establish a mandatory response flag or default-field serialization. Generic protobuf default-omission behavior is not treated as proof of Steam's implementation.
