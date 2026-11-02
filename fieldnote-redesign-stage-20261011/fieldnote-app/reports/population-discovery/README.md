# Fieldnote population-first candidate discovery

This is the reviewed resume/parser repair and offline cached-identity exporter. Read `PATCH-NOTES.md` first: already saved evidence can be materialized without another authenticated run. The base schema and original run budgets stay unchanged.

Version: `fieldnote-population-discovery-1.0` · private, noncommercial metadata research · Node 24.5+ within Node 24 · no dependencies

This standalone package prepares a bounded pool for the separate **300-game panel** allocator. It does not modify, open, migrate, or replace a database. It does not allocate panel slots, collect reviews or CCU, acquire Steam community tags, run on a schedule, or publish anything.

## One command for the owner to execute in Codespaces

Copy this directory into `fieldnote-app/reports/population-discovery`, then personally run from the `fieldnote-app` directory:

```sh
node reports/population-discovery/launch.mjs --run --config /workspaces/codespaces-blank/codespaces-setup/.env.local
```

The config path above is the existing private configuration location documented by the app. Adjust the path only if your own existing file lives elsewhere. Keep the file owned by your account and readable only by its owner (0600). Do not paste its contents into chat, put credentials on the command line, or give the command to an agent to execute. The implementation and review used synthetic fixtures only; **no real credentials were opened, tokens acquired, or live discovery requests sent**.

The package reads these simple dotenv assignments as data, without shell evaluation:

- `IGDB_CLIENT_ID` plus either `IGDB_ACCESS_TOKEN` or `IGDB_CLIENT_SECRET`
- `STEAM_API_KEY`, if available, for independent official game-catalog identity checking

A provided access token is used only in memory. Otherwise, **your execution of this command** obtains a Twitch client-credentials token from the official endpoint using your existing client ID and secret. No token is retained on disk, copied into a document, or printed. Token acquisition has no automatic retry. A missing Steam key does not trigger another source: candidate identities remain pending, the run stays partial, and the allocator-ready array stays empty. After adding your existing Steam key to that private config, resume the same run to complete identity checks without rediscovering metadata.

The launcher starts a clean child without inherited authentication, Node injection, debug, or TLS override environment variables. Config paths, keyed URLs, request headers, raw responses, auth bodies and tokens are never logged. Only allowlisted metadata is checkpointed. Ordinary credential-free proxy routing is supported through Node's HTTPS agent; proxy credentials or unsupported proxy setups stop the command.

Run this separately from other live collectors. A private filesystem lease prevents two copies of this package running at once; it does not acquire or alter the legacy application's database lease.

## Offline preview and verification

These commands do not load the config or use a network transport:

```sh
node reports/population-discovery/launch.mjs --dry-run --as-of 2026-10-11T00:00:00.000Z
node --test reports/population-discovery/tests/*.test.mjs
```

`--dry-run` rejects `--config`. All test fixtures use synthetic titles, IDs and credential strings and are marked as such in their source. Tests never call live endpoints. No installation step is needed.

## Population-first query plan

The command freezes its cohort cutoff once, normally at invocation time. Optional `--as-of YYYY-MM-DDTHH:mm:ss.sssZ` makes that cutoff explicit. The preceding five **completed calendar years** and a 90-day start-inclusive/end-exclusive interval are then fixed across resume.

The 1,000 distinct IGDB-ID discovery budget is allocated as:

| Candidate window | Maximum distinct IDs | Discovery-page allowance |
| --- | ---: | ---: |
| IGDB-reported PC release row in preceding 90 days | 400 | 16 |
| Each preceding completed calendar year | 100 per year, 500 total | 4 each, 20 total |
| Broad desktop main-game discovery | 100 | 4 |

This is intentional bounded over-recruitment: the recent target is four times the 100-slot recent panel allocation; each older-year target is five times the eventual 20-slot allocation. Duplicates, uncertain identities, non-first releases, date ambiguity and metadata gaps will reduce eligible counts. The broad lane provides additional candidates while existing saved games/evidence can supply reference and control eligibility. **These quotas neither guarantee a filled panel nor represent Steam market proportions.** A sparse lane cannot consume all other lanes' discovery-page allowance, and unused quotas are not silently reassigned.

There are no genre, theme, keyword, old editorial-category, rating-count or Steam-review predicates. Recent/older discovery queries the **release_dates endpoint**, with `platform = 6` and both date boundaries on the **same release row**. It then retrieves the selected games in bounded batches. Broad discovery requires desktop platform IDs 3/6/14. Both routes require an IGDB main game, no parent/version parent, and a Steam external-game source relation. All responses are independently checked, and IGDB reference IDs for Steam and Main Game are verified first.

Pagination is ascending source ID with a saved numeric cursor; no offset pagination. Duplicate game IDs and cross-window provenance are retained deterministically. Source ordering and source coverage introduce selection bias. Provider data can change during a run; frozen query windows do not claim a transactional source snapshot.

## Dates, labels and identity

- Valid raw IGDB genre, theme, keyword, game-mode and player-perspective IDs/names are retained. Unknown labels and games without genres are not rejected for editorial reasons. Labels remain IGDB metadata; they are never called Steam community tags.
- All fetched release rows retain raw timestamp, display label, date-format ID/name, year/month/day, platform, region, status, retrieval time and source update time. `first_release_date` is retained separately and is not promoted to Steam evidence.
- A derived PC date uses platform 6 and the earliest known exact day. Explicit Alpha, Beta, Cancelled and other non-playable/unknown named statuses cannot provide that exact date. A missing status can provide a clearly labeled **source-reported PC date**, with `sourceStatus: not_reported`; it is not proof of first public playability or full release.
- Coarse month/year/quarter dates are compared using their earliest possible boundary, not their placeholder timestamp. Earlier or undated unresolved PC evidence that could precede the earliest exact day makes the derived earliest day unknown. Full source rows remain available for review. Future and coarse dates are never changed into exact past dates.
- The PC date can feed an explicitly selected **IGDB-reported PC-date research mode**. It cannot silently satisfy a Steam-first-playable cohort. Steam Early Access, full 1.0 and IGDB platform dates remain separate concepts.
- A Steam UID must be numeric, unambiguous and agree with the IGDB game relation, Steam source, exact Steam app URL and desktop platform. Conflicting crosswalks and multiple IGDB games claiming one Steam AppID are quarantined.
- Independent checking uses only official `IStoreService/GetAppList/v1/`, with game inclusion true and DLC/software/video/hardware false, `last_appid` pagination, and at most 50,000 public identity rows per page. Only matching candidate AppIDs/names are saved. An AppID/title mismatch is quarantined; unobserved identities beyond the checked range stay pending.
- `appType: game` is derived from the documented game-only query and has `typeBasis: derived_game_only_query`. The response does not supply a per-app type field. The script never fabricates such a field.

## Hard limits and failure behavior

The immutable plan limits apply cumulatively across resume:

- At most 1,000 candidate IGDB IDs, 40 discovery pages, 60 total IGDB data pages and 12 Steam catalog pages
- At most 180 total request attempts, including authentication, failures and retries
- One concurrent request; at least 1 second between dispatches
- At most 2 retries for transient network/timeouts or HTTP 500/502/503/504; no token-acquisition retry
- 64 MiB total response bytes per provider lane; 2 MiB per IGDB response; 16 MiB per Steam catalog response; 16 KiB token response
- 20-second IGDB/auth request timeout, 30-second Steam timeout, and 12-minute cumulative active runtime across both lanes
- 32 MiB per checkpoint/output file; no unbounded whole-Steam-catalog archive

Counters and pessimistic byte/time reservations are saved **before** dispatch. A killed process keeps its in-flight allowance charged. Restart does not reset attempts, bytes, windows, page caps or runtime. Completed normalized metadata is reused without another request. A partial page cannot duplicate an admitted candidate.

HTTP 401/403, 429, redirects, response integrity errors and reflected credentials stop the run. HTTP 429 is **not automatically retried**, so no work occurs during the provider's requested delay. The same blocked run cannot be resumed; review the cause and any provider delay before deciding whether a separate owner-executed run is appropriate. There is no alternate endpoint, browser scrape, proxy rotation or authentication workaround.

An exhausted quota is reported as a shortfall. It never changes source criteria or synthesizes records. A socket can deliver its final received chunk across a byte threshold; that response is immediately destroyed and rejected, and its actual observed bytes remain charged.

## Output and resume

The command prints a safe run ID and writes private 0600 files beneath its own `.runs/RUN_ID/` directory:

- `checkpoint.json`: allowlisted current metadata, source IDs, stream cursors, fixed plan and charged budgets, with SHA-256 integrity protection
- `candidates.json`: versioned candidate result, quarantine/pending reasons, source provenance, all labels/date evidence, coverage and shortfall counts

Resume an interrupted nonblocked run by personally invoking:

```sh
node reports/population-discovery/launch.mjs --run --config /workspaces/codespaces-blank/codespaces-setup/.env.local --resume RUN_ID
```

Use the exact printed run ID. A completed run returns its cached result and makes no requests. An apparently stale filesystem lease stops with `stale_lease_review_required`; it is never automatically deleted, avoiding a takeover race. If an abrupt kill left `.runs/active.lock`, personally verify that the recorded process is gone on this same host, then remove only that lock and retry the same run ID. Never remove a lock for a live process. Moving a running checkpoint across machines is unsupported. An expired or invalid provided token stops rather than silently acquiring another token.

Outputs are metadata candidates, **not a success claim that 300 games were admitted**. In particular, `panelAllocated` is always zero here. Missing source coverage and pending identities remain visible. Treat the run files as a short-lived private working cache: retain the current accepted provenance through the app's reviewed import, then remove redundant operational payloads when no longer needed. No public redistribution or indefinite source archive is approved by this package.

## Allocator handoff contract

Top-level `schemaVersion` is `fieldnote-population-discovery-1.0`. `candidates` contains all processed allowed metadata, including quarantine reasons. `panelCandidates` includes only independently verified identities and has this shape:

```json
{
  "appid": 123456,
  "name": "Illustrative shape only",
  "source": "IGDB + Steam IStoreService",
  "sourceUrl": "https://www.igdb.com/games/example",
  "retrievedAt": "2026-10-11T00:00:00.000Z",
  "appType": "game",
  "typeBasis": "derived_game_only_query",
  "releaseDate": null,
  "releaseBasis": "igdb_pc",
  "releasePrecision": "unknown",
  "lifetimeReviews": null,
  "referenceEligible": false,
  "referenceReason": null,
  "genres": ["Visual Novel"]
}
```

The allocator must join compatible, saved review observations and source provenance by verified AppID. Unknown reviews are not zero. This script does not choose popular references or low-traction controls. The allocator owns the versioned 75 reference / 100 recent / 100 older (20 per completed year) / 25 control policy and overlap handling. Existing database records, old editorial mappings and observations remain untouched. Do not send this output through the legacy 12-category discovery normalizer: that would recreate the excluded genre gate.

## Source references and verification status

Official documentation reviewed for this implementation on 11 October 2026:

- IGDB API/query/reference fields and private noncommercial use: https://api-docs.igdb.com/
- Steam game catalog and keyed game-only pagination: https://partner.steamgames.com/doc/webapi/IStoreService
- Steam API terms: https://steamcommunity.com/dev/apiterms

The current API shapes align with the recovered application's saved public metadata and documented routes. **Live behavior of this new script is not yet tested.** Offline tests cover fixture correctness, budgets, no-secret logging, cache/resume, filesystem safety and dry-run behavior; they do not replace a personally executed bounded source validation.
