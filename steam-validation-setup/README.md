# Bounded Steam M1 feasibility probe

This package is a separate, credential-free technical test. It does not modify the dated 9 October baseline, run a scheduled collector, collect tags, contact SteamDB, or approve production reuse. The author has not run live API requests while preparing this bundle.

## Run manually in the existing Codespace

Use Node.js **24.5 or newer within major 24** (including 24.21). No package installation is needed. Start from this extracted `steam-validation-setup` directory:

1. `bash scripts/run-steam-validation.sh --test` runs mock-only tests.
2. `bash scripts/run-steam-validation.sh --plan` prints the plan with zero requests.
3. `bash scripts/run-steam-validation.sh --pilot` performs six requests for three games. Read its summary and the printed `REPORT` path.
4. Only after a healthy pilot, manually run the exact printed `NEXT_MANUAL_COMMAND`. Its form is `bash scripts/run-steam-validation.sh --cohort --pilot-report outputs/pilot-.../report.json`.

The cohort command requires a successful, matching-bundle live pilot from the previous 24 hours. It does not start automatically. A failed or inconclusive result is evidence, not permission to switch routes, add a key or retry a denial. Inspect and resolve the blocker first. Each invocation creates a separate report and never resumes or overwrites earlier runs.

## Scope and caps

- Pilot: No Place Like Home, Saturnalia and Balatro. These represent the three historical selection review bands, the old failed review target, and both core/supplement cohorts.
- Cohort: both current-player and all-time review calls for all 36 frozen IDs. Previous successes, original unattempted requests, supplementary unattempted requests and the old Saturnalia failure remain distinct ledger categories.
- Six original September 2026 review-date targets: one month, two disjoint half-months, and an inclusive single-second boundary when a matching review is available. The month permits at most four pages of 100 reviews. Query-summary score totals are never used as period counts.
- Limits: one concurrent request, at least 1.1 seconds between starts, 20 seconds per request, 10 minutes per run, 1 MiB response bodies, 6 pilot requests or 120 cohort requests. Maximum planned cohort calls are 114. No redirects or retries.
- Every non-success response or invalid response stops the run. This includes 401/403, 429, proxy/network failures, timeouts, oversized bodies and schema/range failures. No alternate hosts or transports are tried.

## Outputs and interpretation

`outputs/<run-id>/report.json` contains only aggregate evidence, public AppIDs, frozen cohort labels, exact non-cursor filters, timestamps, statuses, byte/request counts, latency and coverage. Raw review text, author data, review IDs, opaque cursor values, response bodies, response headers, and provider error text are never written or printed. Review IDs and created timestamps are held temporarily in memory to check duplicates and boundaries; only aggregate counts/ranges survive.

All-time/current observations have `purpose: current_snapshot`. Date probes have separate `date_...` purposes. `requested_at` and `completed_at` are collection times; `source_timestamp` is explicitly null. `healthy` indicates the bounded HTTP/schema run completed, not that every date-semantic gate passed. Read `review_window_verdict`, each `date_probes` row, and the failed/unattempted ledger separately. A terminal empty page, stable totals, zero duplicate IDs and an exact unique-count match are required for month completeness. An empty month can establish a current zero matching count, but leaves its boundary check unexercised and its semantic verdict inconclusive. A page cap likewise leaves completeness unproved.

Review activity here means surviving reviews created in the requested UTC period, observed now under the stated filters. Deleted/edited reviews, provider cache behavior and changes during pagination can affect the comparison. These are not reconstructed historical snapshots, sales, daily active users, historical player peaks, or a validated time series. Current-player zero is retained as zero.

## Safe launch and integrity

The launcher never sources `.env` or other config files, requests credentials, reads authentication variable values, or sends keys/cookies. It removes Node debug/TLS overrides and forwards only a small system/proxy environment allowlist to the actual test. Node preserves existing supported HTTPS proxy settings and `NO_PROXY`; unsupported proxy-only routing fails closed. Credential-bearing proxy URLs require a handoff and stop before requests. Nothing is installed and no network/security configuration is changed.

`bundle-manifest.json` is a SHA-256 allowlist for every shipped source/data/test/doc file. The launcher verifies each file before a test, plan or live run. The archive also has an external SHA-256 record. Outputs are not shipped in the archive. Baseline source-file hashes are retained in `data/frozen-targets.json` to show which old evidence was used. Local edits invalidate the manifest and require a separately reviewed/rebuilt bundle.

Technical success does not settle provider licensing, commercial use, retention, redistribution, store-tag rights, marketing-source collection, or any other remaining M1 requirement. See `SOURCE-NOTES.md` for the exact official API references.
