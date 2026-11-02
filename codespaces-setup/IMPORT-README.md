# Private 36-game IGDB catalog import

This dependency-free overlay adds one manually initiated catalog import to the
existing `codespaces-setup` folder. It contains code, a fixed public Steam cohort,
and explicitly synthetic tests. No live IGDB catalog was collected while building
it. It does not update the prototype, publish anything, schedule a job, or change
production-provider status.

## Existing Codespace setup

Extract the archive in `/workspaces/codespaces-blank`. Its entries begin with
`codespaces-setup/`, so they land next to the already configured private file.
The archive does not contain or replace `.env.local`, the existing README,
`.gitignore`, or connection reports. It includes the unchanged connection-check
module and its offline tests because the importer reuses its safe configuration,
proxy routing, and fixed token-error classifier.

From `/workspaces/codespaces-blank/codespaces-setup`, run the offline tests:

```sh
bash scripts/run-igdb-import.sh --test
```

All 69 tests use mocks or temporary synthetic credentials. No network or actual
credential-file access occurs in the tests. Node 22.21+ or 24.5+ is required.

Then personally start the authenticated batch:

```sh
bash scripts/run-igdb-import.sh --run
```

Only you should initiate this command. It reuses this folder's owner-only,
non-symlink `.env.local`; no credential copy is needed. It sends the client ID
and secret to the official Twitch token endpoint and keeps the resulting token
only in process memory. The launcher clears inherited debugging, injection,
TLS-key logging and TLS overrides. Do not run under tracing or a debugger.

## Boundaries

- Frozen input: exactly the original 30 plus six recent Steam AppIDs, verified by
  a pinned SHA-256 before configuration is read. No title search or new Steam
  requests. Existing Steam identities and dates remain dated baseline evidence.
- Requests: sequential, at least one second between completed requests; hard
  ceiling 80 total, including Twitch. Source discovery: at most three pages;
  exact-UID mapping: three batches of 12, at most three pages each; details:
  at most 144 candidate games in batches of 12. Thus at most 25 requests are
  structurally possible for this input, including one token exchange.
- Each request: fixed endpoint, verified TLS, preserved configured proxy route,
  20-second deadline, 16 KiB token-body cap or 2 MiB catalog-body cap. No redirect,
  alternate route, automatic retry, refresh loop, or auth retry.
- A network, HTTP/auth, rate-limit, malformed-response or budget failure stops
  the run. HTTP errors expose only status and fixed labels; raw errors, headers
  and auth responses are never saved or logged. Earlier valid observations stay
  intact in prior run folders.
- Accepted joins require an exact Steam external UID, the discovered Steam
  source, one IGDB game, compatible saved Steam name, a main-game type, a desktop
  platform, and no edition/parent/version relationship. Shared IGDB IDs,
  conflicting mapping URLs/platforms, ambiguous joins and unavailable details
  stay quarantined. Missing values remain null/empty.
- IGDB genres/themes/keywords are catalog context only. Saved Steam tags alone
  continue to own mechanic/theme analysis. Steam CCU and reviews are unchanged;
  no IGDB rating, hype, or PopScore is requested.

## Saved results and private transfer

The command prints the exact location of two new owner-only files:

- `research/milestone-1/igdb-catalog-imports/<timestamp>-<run-id>/catalog.json`
- `research/milestone-1/igdb-catalog-imports/<timestamp>-<run-id>/summary.json`

`catalog.json` contains every cohort row, crosswalk evidence, normalized catalog
fields, all candidate evidence, provider URLs/timestamps, field-level provenance,
source-scoped release differences and a request/coverage ledger. `summary.json`
is a smaller reviewable outcome. They contain no credentials or tokens. Download
only these named result files from the Codespace Explorer when asked; never
share `.env.local` or the full working folder. For app ingestion, the selected
catalog artifact can be saved privately as
`research/milestone-1/igdb-catalog-import.json` in the game-research repository.
Do not confuse synthetic fixtures with real observations or install them there.

Exit 0 means the bounded collection finished, even if some joins are quarantined;
it does not mean the 33/36 proposed coverage targets passed. Exit 1 means a stopped
run with an outcome artifact. Exit 2 means usage/runtime/input/output failure.
Read the counts and summary gates rather than assuming all 36 matched.

The import is a private validation pilot. Commercial/public display, production
collection, retention and broader exports still require the source-strategy
rights review. No gate is silently promoted; fresh Steam verification and
remaining Steam measurement/history tests are still separate unfinished work.

## Current protocol basis

Official documentation checked 10 October 2026:

- [IGDB external mappings](https://api-docs.igdb.com/#external-game)
- [External game sources](https://api-docs.igdb.com/#external-game-source)
- [Enum migration](https://api-docs.igdb.com/#migration-enums-to-tables)
- [IGDB rate limits](https://api-docs.igdb.com/#rate-limits)
- [Twitch app-token flow](https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/#client-credentials-grant-flow)

The importer uses `external_game_source`, `game_type`, website `type`,
`date_format` and `release_region` rather than deprecated enum-field names.
Steam's source ID is discovered by its name. Enum-table IDs can include zero,
which is preserved. It uses a stricter one-request-per-second pilot limit than
IGDB's documented four-request-per-second ceiling.
