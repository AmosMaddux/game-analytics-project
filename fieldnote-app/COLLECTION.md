# Milestone 3 bounded local collection

This is a private research catalog. The browser only reads the saved SQLite database. A page load never authenticates to or refreshes providers. Source-health is at `#/sources`. No daemon, cloud deployment, paid resource or public publication is enabled.

## User-owned catalog command

Only the user personally runs the credential-bearing command. Keep `IGDB_CLIENT_ID`, `IGDB_CLIENT_SECRET` and `STEAM_API_KEY` in the existing private file, readable only by its owner (mode 600). Do not paste secrets into chat or a command. The launcher starts a clean child, parses those three assignments as data without shell evaluation, and never prints credentials, token bodies or keyed request URLs.

```sh
cd /workspaces/codespaces-blank/fieldnote-app
node scripts/collect.mjs catalog --config /workspaces/codespaces-blank/codespaces-setup/.env.local --run
```

The command discovers new candidates up to the remaining capacity of a 360-game tracked catalog in the 12 user-approved categories, retrieves an independent official Steam game-only AppID/name list, and admits at most 360 total games. Strict title/AppID/desktop/main-game/crosswalk checks quarantine conflicts. Existing 36 game identities, editorial groupings, saved tags, observations and marketing research stay intact. Some candidate titles may fail independent verification. The final count, not a successful process exit alone, determines whether the 300-game gate is met.

If a completed pass remains below 300, a further personally invoked catalog pass skips both existing games and previously quarantined Steam AppIDs, looking for genuinely new candidates within the remaining 360-game capacity. Earlier quarantines remain available for independent review; the pipeline never relaxes title or identity checks to fill the target. Once capacity is reached, use `catalog-refresh` with the same private config and explicit `--run` to refresh known records without expanding membership.

IGDB limits: 180 attempts (including authentication and retries), 60 discovery pages, 64 MiB total, 2 MiB per response, 12 minutes active runtime, 20 seconds per request, one-second spacing and two bounded retries. Steam identity limits: 36 attempts, 12 pages of at most 50,000 identities, 64 MiB total, 16 MiB per response, 12 minutes active runtime, 30 seconds per request, one-second spacing and two retries. This bounded catalog command terminates; it never establishes a persistent login or background schedule.

The current Steam identity route is `https://api.steampowered.com/IStoreService/GetAppList/v1/`, with a user-supplied Web API key. Its input includes only games and excludes DLC, software, video and hardware. The deprecated keyless `ISteamApps/GetAppList/v2/` was tried once separately on 10 October 2026 and returned HTTP 404. There is no automatic fallback, store-HTML scrape or SteamDB use.

## Separate keyless metric command

After catalog import, run this independently. It neither loads nor receives the private config:

```sh
node scripts/collect.mjs steam --run
```

It queries each tracked Steam AppID once for concurrent players and once for the all-time review summary. It stores aggregate counts and query filters only; individual review text and reviewer identities are discarded. Observations append by job/AppID/metric; a retry of the same run cannot duplicate them. A new run creates genuine new dated observations, including actual observed zero. Missing/failing values never overwrite valid cached values or their dates.

Limits: 500 games, 1,200 attempts including retries, 16 MiB total, 128 KiB per response, 25 minutes active runtime, 15 seconds per request, one-second minimum spacing and two bounded retries. A 360-game run normally needs 720 requests and at least 12 minutes. Provider throttling can extend or stop it. Retry-After is honored in full or the job stops if it cannot fit the remaining runtime. Authentication/permission failures stop the affected job without alternate routes.

## Interruptions and recovery

The terminal prints a safe job ID. An interrupted run can resume with the same command and `--resume JOB_ID`. Catalog resume still requires the user to run it personally with the private config path. Accepted metric items are skipped. Durable pre-dispatch reservations conservatively charge in-flight attempts, response-byte allowance and request time after a process crash. All original run caps still apply; exhausting a cap cannot be bypassed by resume.

Unfinished normalized discovery checkpoints live outside browser-public files, solely for recovery. A successful catalog import compacts its checkpoint to IDs, counts and provenance; it does not accumulate full IGDB/Steam catalog archives. Normalized current metadata and append-only permitted Steam aggregate observations remain in SQLite. Keep a private filesystem/database backup before upgrading. `db:seed` refuses to overwrite a database containing collection history; use migrate/start for an upgrade.

## Taxonomy, samples and unknowns

Taxonomy `editorial-expanded-1.1` retains the seven original groups and adds Role-playing, Shooter, Strategy, Survival / crafting, and Racing / sports. Rules preserve raw IGDB genres/themes/keywords in their own fields. They never become Steam tags. Discovery samples high (at least ten) and low/missing IGDB rating-count strata using a stable numeric cursor. That count is a discovery proxy, not Steam popularity, sales or a representative random market sample. Under-15 categories remain flagged and unfilled categories are never padded with inventions. Expanding admissions changes the provisional score baseline and does not establish a time trend.

New games have missing Steam tags because no permitted new tag acquisition route has been established. Existing tag recurrence uses only games with actual saved tags. Official game links are those designated by IGDB, with source attribution; provider labels are not independent endorsement. Scoped platform/region releases remain separate from unverified Steam release dates. No 7/30/90-day history is fabricated.

## Source lifecycle and permissions

Reviewed 10 October 2026 for a bounded, private, non-commercial research cache. IGDB documents non-commercial API use and local caching; no fixed cache TTL was found. Steam's API terms do not specify a general cache TTL. This is not approval for public redistribution or indefinite IGDB archival. Refresh current records, preserve provenance, quarantine conflicting corrections, and review source removals. On a valid source correction/deletion or termination instruction, stop the affected collector and prepare a scoped cache cleanup for the owner rather than silently deleting unrelated saved research. Owner-created backups and baseline evidence are never automatically purged.

Official references: [IGDB documentation and business FAQ](https://api-docs.igdb.com/#business-related-faq), [Steam API terms](https://steamcommunity.com/dev/apiterms), [Steam game catalog](https://partner.steamgames.com/doc/webapi/IStoreService#GetAppList), [Steam reviews](https://partner.steamgames.com/doc/webapi/IUserReviewsService#GetAppReviews).

## Optional bounded scheduler commands

The three schedule records start disabled. There is no installed cron job, daemon, web timer, paid resource or background process. These commands only plan or run one personally invoked, terminating local operation; saving an enabled record does not start collection. Run the clean launcher with Node 24.5 or later in the Node 24 line.

```sh
node scripts/schedule.mjs plan
node scripts/schedule.mjs configure --id daily-steam --expires YYYY-MM-DDTHH:mm:ssZ --run
node scripts/schedule.mjs configure --id six-hour-watchlist --watchlist 413150,730050 --expires YYYY-MM-DDTHH:mm:ssZ --run
node scripts/schedule.mjs tick --run
node scripts/schedule.mjs disable --id six-hour-watchlist --run
```

Replace the expiry placeholder with an explicit UTC timestamp later than now and no more than seven days away. The watchlist must contain 1–20 distinct numeric AppIDs already in the catalog with an exact independently verified Steam/IGDB crosswalk. The daily Steam schedule targets at most 500 verified catalog identities. The other supported ID, `daily-catalog`, can be configured with the same explicit expiry but always reports `user_run_required` when due. The scheduler never launches a catalog command, authenticates, loads a private config, or receives authentication/debug/TLS environment overrides. A keyed catalog refresh remains a separate, personally run command above.

`plan` reads an existing database without running migrations or altering rows. It reports disabled, expired, waiting, due, retry-waiting, blocked and user-run-required states. `configure` and `disable` change local records only and require `--run`. `tick --run` selects at most one due Steam job, prioritizing the six-hour watchlist over the daily metrics schedule, then exits. Other due jobs wait for another explicit invocation. A completed job advances its own next-run time by six or 24 hours from completion; missed intervals never cause a catch-up loop.

A tick has one-request concurrency, a persisted deadline, and at most 25 minutes total runtime. The clean launcher also terminates its child at the 25-minute wall-clock limit. The daily job retains the Steam limits above. Each watchlist job is capped at 20 games, 120 request attempts including retries, 5 MiB total, 128 KiB per response and five minutes cumulative active runtime, with the same one-second spacing, 15-second request timeout and two bounded retries. Expiry can shorten either deadline. Request/byte/time allowances are stored before dispatch and never reset when an interrupted due period resumes.

The SQLite ledger links each tick to its source job, schedule, due period and deadline. A shared process-aware local lease prevents overlap between scheduler ticks and personally invoked collector commands across database connections. It also preserves at least one second between the previous owner's release and the next owner's first request. A live or reused owner PID stays locked even after its deadline; only a definitely exited process can be reclaimed. Abrupt termination leaves its source job and conservative in-flight reservations available for a later explicit tick. Keep the database on this one local machine; copying a running database between machines is not a supported distributed scheduler.

Partial or interrupted jobs retain their original due period and source job ID. Retryable failures wait at least five minutes before another explicit tick can resume them, skipping accepted items and using the original remaining allowance. Exhausted jobs cannot obtain fresh budgets by repeating ticks. Permission, redirect, endpoint or response-integrity failures block the affected source and require review before collection continues. Disabling a schedule stops new dispatch at the next request boundary; it does not erase prior observations. Source-health records distinguish complete, partial, interrupted, blocked and exhausted outcomes without exposing credentials. No schedules were enabled as part of implementation or tests.

## Offline taxonomy correction

The v1.1 correction uses saved IGDB labels only. Run `node scripts/correct-taxonomy.mjs plan` first; `apply --expect <reviewed-plan-sha256>` refuses changed input or active collectors. It changes only new-admission grouping and mapping metadata, retaining prior mappings and preserving the original 36 records, raw labels and all observations. Unresolved games remain browseable but do not enter genre coverage/rankings. Mapped groups are provisional mixed-label editorial inferences, not manually validated primary genres. Manual taxonomy review is required before decision-ready genre conclusions. This baseline change is not a time trend. Interrupted v1.0 discovery checkpoints are not resumed under the changed v1.1 mapping rules.
