# Bounded qualification and 300-game metrics

Status: the live v1.1 source proof passed. The new qualification and panel collectors have only run with mocked transport. No 300-game dataset exists yet. Current 137-member draft manifests are rejected before any request.

## Preconditions

- Use Node 24.5 or later within major version 24 and Python 3; no package installation.
- The user first personally executes the separately reviewed population-discovery command with their existing private configuration. This package never opens credentials or calls authentication endpoints.
- Use the explicitly approved IGDB-reported PC-date mode for those source dates. They are not Steam first-playable or full 1.0 dates.
- Keep the legacy schedule and other collectors stopped while this one reconciled campaign runs. The shared ledger protects this campaign, not unrelated processes that ignore it.
- Use the real discovery `candidates.json` and its matching `checkpoint.json`. The frozen report has counters but no execution timestamp; the adapter verifies its checkpoint hash and matching contents before using the recorded completion time. Do not use synthetic test fixtures or the old 334-title genre-selected sample as a broad-discovery substitute.
- Inspect the discovered population and source shortfalls before collection. Identity-pending or quarantined rows are excluded. Qualification permits 1–1,000 unique verified Steam identities, and does not promise that all panel quotas can be filled.

These examples assume this package is installed at `fieldnote-app/reports/bulk-source-validation` and commands are run from `fieldnote-app`. Set these ordinary paths to the actual files, with no credentials in variables:

```sh
B=reports/bulk-source-validation
DB=/absolute/path/to/the/current/fieldnote.sqlite
CANDIDATES=/absolute/path/to/population-discovery/.runs/RUN_ID/candidates.json
CHECKPOINT=/absolute/path/to/population-discovery/.runs/RUN_ID/checkpoint.json
WORK=/absolute/path/to/a/new/private/collection-output-directory
PROOF=a8efd1423272343178ed1813ad03660a18e74169f032c0e06fceb90bd2e40b6f
```

Use an existing private output directory owned by the current user. Do not overwrite a previous run. First run the offline checks:

```sh
node --test "$B/validate-reviews.test.mjs" "$B/collect-panel-metrics.test.mjs"
python3 "$B/prepare-budget-baseline.test.py"
sha256sum "$B/passed-sentinel-evidence.json"
```

The evidence hash must equal `PROOF`. Do not rerun the sentinel campaign merely to start collection.

## 1. Reconcile the actual monthly baseline

The following reads the database and supplied reports only. Run it after metadata discovery and any other source jobs have stopped. The checkpoint adapter reads no config, imports none of the discovery authentication code, and does not change the already-staged discovery package. Include any other unrecorded source-job report with another `--evidence` argument. Do not include the earlier failed sentinel/diagnostic reports separately because the passed campaign report already includes those five calls. Do not double-count a report whose requests are already in the database.

A 2,700-attempt bootstrap allowance covers the qualification and panel phase caps together. This is an explicit upper limit within the 12,000/month project budget, not a new recurring schedule. Only enable this allowance for the approved bootstrap.

```sh
(set -C; python3 "$B/prepare-budget-baseline.py" \
  --database "$DB" \
  --evidence "$B/passed-sentinel-evidence.json" \
  --evidence "$CANDIDATES" --discovery-checkpoint "$CHECKPOINT" \
  --bootstrap-allowance 2700 > "$WORK/budget-baseline.json")
STATE=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["authoritativeLedgerPath"])' "$WORK/budget-baseline.json")
```

Review the new baseline's entries and sum. The saved audit before new discovery showed 736 existing project requests plus 41 sentinel campaign requests, or 777; do not reuse that number as the current budget after new calls. Do not use the VM example baseline in Codespaces: its absolute path is environment-specific.

`STATE` is the one authoritative `fieldnote-source-budget-YYYY-MM.json` next to the actual database. An existing state must be resumed/reconciled, never deleted or replaced to reset the budget. The runner rejects a different state path, an enabled schedule, changed baseline, or month rollover.

## 2. Qualify all verified candidates with lifetime totals

```sh
node "$B/collect-panel-metrics.mjs" --run \
  --candidates "$CANDIDATES" \
  --validation "$B/passed-sentinel-evidence.json" --validation-sha "$PROOF" \
  --budget-baseline "$WORK/budget-baseline.json" --kind bootstrap \
  --state "$STATE" --output "$WORK/qualification.json"
```

This makes one keyless lifetime-review request per verified unique AppID. It does not collect dated activity, CCU, metadata or review text. At 1,000 candidates, normal spacing alone is about 33 minutes; the cumulative active-runtime cap is 40 minutes and the attempt cap is 1,200. Provider latency or caps can leave the phase incomplete. Partial output is not usable for panel allocation.

For controlled batches add `--batch-games 100`; the state pauses after that many games and no completion bundle is written. Continue a paused/interrupted non-denied run using the exact inputs and the same unused output path:

```sh
node "$B/collect-panel-metrics.mjs" --resume \
  --candidates "$CANDIDATES" \
  --validation "$B/passed-sentinel-evidence.json" --validation-sha "$PROOF" \
  --state "$STATE" --output "$WORK/qualification.json"
```

Resume preserves attempt, byte, time, monthly and bootstrap charges. Do not pass a new baseline, kind or window on resume. HTTP 401/403/429 or redirect denial cannot be resumed. A leftover lock is never automatically removed: verify the prior process is gone on the same host before reviewing recovery. Do not change transport or endpoints to work around a denial.

## 3. Join qualification and select the panel offline

```sh
node "$B/join-qualified-candidates.mjs" \
  --candidates "$CANDIDATES" --qualification "$WORK/qualification.json" \
  --validation "$B/passed-sentinel-evidence.json" --validation-sha "$PROOF" \
  --output "$WORK/qualified-candidates.json"
PANEL_AS_OF=$(node -p 'new Date().toISOString()')
node scripts/prepare-panel.mjs --source "$DB" \
  --candidate-file "$WORK/qualified-candidates.json" \
  --output "$WORK/panel.json" --as-of "$PANEL_AS_OF" --release-basis igdb_pc
```

These commands make no network calls. The join requires the exact original discovery bytes and one completed qualification run covering all verified candidates. The allocator must be the reviewed app implementation. `PANEL_AS_OF` is after qualification so fresh observations are not excluded as future evidence. This command creates a manifest only; it does not apply a database copy or import metadata.

Inspect `selectedCount: 300`, `shortfallCount: 0`, 75 popular references, 100 recent games, 20 in each of the preceding five completed calendar years, and 25 low-traction controls. Every member must retain the qualification run ID, retrieval time and lifetime value. If any quota falls short, stop here and report the actual gap. Do not borrow quotas, broaden the definition silently, mix incompatible old review runs, or fill with invented entries.

## 4. Advance the same ledger to the complete panel

Freeze the dated-window end at a chosen UTC boundary no later than now. This example uses the start of the execution day. All 7/30-day intervals are recorded exactly and are never relabeled as current after time passes.

```sh
WINDOW_END=$(node -p 'new Date(Math.floor(Date.now()/86400000)*86400000).toISOString()')
node "$B/collect-panel-metrics.mjs" --advance-to-panel \
  --panel "$WORK/panel.json" --as-of "$WINDOW_END" \
  --validation "$B/passed-sentinel-evidence.json" --validation-sha "$PROOF" \
  --state "$STATE" --output "$WORK/panel-metrics.json"
```

The transition verifies the completed qualification export, membership, qualifying review evidence and panel hash. It preserves previous charges and shared 2-second source pacing. It does not accept a fresh baseline. Normal work is 1,200 calls: lifetime, exact 7 days, exact 30 days and current players for each of 300 games. Minimum spacing takes about 40 minutes; the panel phase cap is 90 active minutes and 1,500 attempts.

Resume a paused panel phase with `--resume --panel "$WORK/panel.json"` and the same validation, state and unused output arguments, omitting `--as-of`. The original windows stay frozen. Export is allowed only after all 1,200 observations exist. Reviews must be explicit nonnegative integer counts with `7d <= 30d <= lifetime`; removals or inconsistencies stop publication. Unavailable current-player data alone can be null with an explicit reason and `completed_with_missing` status.

The resulting bundle is staged evidence. Import it only through the reviewed application importer with the exact panel and passed-proof hashes; metadata admission and deployment are separate reviewed steps. This package does not open or modify the app database.

## Source and safety contract

- Reviews: documented keyless `IUserReviewsService/GetAppReviews/v1/`; `total_matching`, all languages, both sentiments, purchase_type 0 (Steam purchases), off-topic activity filtered. One returned review per response is enough for the aggregate. Review text, authors and identifiers are never saved.
- Dated ranges: exact half-open `[start,endExclusive)` in the bundle; API inclusive end is `endExclusive-1`. Counts describe surviving matching reviews observed at retrieval, not immutable historical totals.
- Players: documented keyless `ISteamUserStats/GetNumberOfCurrentPlayers/v1/`; current online players at the saved instant.
- Both phases: one request at a time, at least 2 seconds between calls, 20-second deadline, 128 KiB response cap, 32 MiB phase cap, at most one retry per logical request and 100 retries per phase. Failures and interrupted in-flight reservations remain charged.
- Source denials, throttling, redirects, schema errors, caps and budget exhaustion stop collection. No host fallback, HTML scraping, proxy rotation or credential use.
- Writes are limited to private sanitized JSON outputs/checkpoints. Reservations use atomic replacement and fsync before dispatch. Published bundles are whitelisted. No schedule is enabled.
- Normal maximum for 1,000 candidates plus the 300 panel is 2,200 calls; phase attempt caps total 2,700. Prior discovery, validation and saved project jobs count toward the reconciled 12,000/month ceiling. Data-service spending is $0; environment/hosting charges are separate.
