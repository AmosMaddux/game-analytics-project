# Exact 294-game continuation after an observed CCU HTTP404

This package is limited to the existing panel run panelmetrics-9a53ddb8-22e8-48f1-b765-e6406c988919 and approved manifest dc3840a01e9d68b2e0f7ecef873ecba6fa6430eb847595eacd01e7d4e932e3b9. It does not discover or add games.

The exact diagnostic ledger ffe944dc84fcff62f85db027d4cbfbe15a8e1741fce13e33317cc5ad903890ac records the second failed current-player attempt for917640 at2026-10-12T16:44:51.297Z, HTTP404. The initial continuation saves a null current-player observation with missingReason source_http_404 at that actual response time, preserving both failed attempts,159 prior observations and every request charge. It persists this repair before dispatching any remaining request. No third917640 call is made.

Only current-player HTTP404 responses in this exact run become explicit null/source_http_404. Each null must match a failed same-key HTTP404 attempt and responseObservedAt. A saved404 response interrupted before observation persistence is recovered without another call. Review404, other errors,401/403/429 and redirects retain their existing stop/retry rules. No failure becomes zero. The response body is not persisted.

Initial launch after package/input review:

    bash run-reviewed-ccu404-continuation.sh

The output remains the original frozen path, not a new competing result. Same monthly ledger, baseline, original625/addendum160 receipts, windows ending2026-10-12T00:00:00Z,2s spacing,1276 total attempts/100 retries and90 active minutes remain. Expected completion is1177 attempts/1 retry,2771 monthly requests,1963 bootstrap requests, unless further allowed retries are needed.

Offline tests:

    node --test ccu404-resume.test.mjs panel294.test.mjs collect-review-campaign.regression.test.mjs

After a verified process interruption following durable repair, do not rerun the initial hash-pinned repair wrapper. Check the saved ledger and existing lock/process first. The same reviewed engine supports checkpoint resume without repeating repair:

    node qualification-panel294.mjs --resume --state /workspaces/codespaces-blank/fieldnote-redesign-stage-20261011/pilot-20261011-1746/fieldnote-source-budget-2026-10.json --output /workspaces/codespaces-blank/fieldnote-panel294-run-20261012-1615/panel-metrics-294-live.json --validation ./passed-sentinel-evidence.json --validation-sha a8efd1423272343178ed1813ad03660a18e74169f032c0e06fceb90bd2e40b6f

A recorded denial blocks that resume. Do not clear a permanent stop, reset counters, replace the ledger or delete an active lock. The final sanitized bundle and full authoritative ledger must be independently audited before app import.
