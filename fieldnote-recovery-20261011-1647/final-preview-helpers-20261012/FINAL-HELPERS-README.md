# Fieldnote final private-preview helpers

These fixed-path scripts target the reviewed 294-game prototype in Codespaces. The original 300-slot target and six unfilled recent-game slots remain recorded.

## Ordered gates

1. Wait for the same metric collection job to finish and its authoritative lock to disappear. Run `export-completed-panel294-ccu404.py`; download its sanitized result archive and independently audit the real bundle and ledger. This export binds the original, one-call diagnostic and continuation source versions.
2. The final source-only sibling must already have passed 329 checks at `/workspaces/codespaces-blank/fieldnote-final-preview-20261012-1706`. `stage-final-provenance-source.py` prepares it from the distinct reviewed provenance checkpoint and never changes a database or running server.
3. After the actual bundle and final-ledger byte hashes are approved, run `python3 stage-final-metrics-copy.py APPROVED_BUNDLE_SHA APPROVED_LEDGER_SHA`. It snapshots the currently running 294-game database, imports into a separate copy, verifies all original rows, and checks all four metrics on temporary port4175. It does not switch the live preview.
4. After that staging receipt and API checks pass, run `python3 promote-final-metrics-preview.py`. It verifies the actual previous/current PID from the saved switch receipt, database identity and unchanged logical rows before replacing only port4174. A failed replacement restores the prior 294-game preview. Read its promotion or rollback receipt before any retry.
5. Verify the private browser preview. Then run `python3 export-final-preview-checkpoint.py` to save the final reviewed source, restored-and-verified live SQLite backup, pre-metric rollback database, immutable original pilot, source receipts, genre reports and verification records in one hash-manifested archive.

No helper enables schedules, reseeds data, calls a provider, reads credentials or publishes a public site. Source staging runs the reviewed package's offline check through npm with an isolated empty npm configuration. The final completed exporter and database import/promotion helpers must not be used against the disposable mocked test data.

## Validation

The source and collector packages were separately reviewed. Helper testing used disposable copies only: completed export, copy-only import, 294×4 API value comparisons, explicit unavailable-player receipt checks, successful process promotion, failed-promotion rollback, and a complete SQLite/source checkpoint. Real execution and browser verification remain separate gates.
