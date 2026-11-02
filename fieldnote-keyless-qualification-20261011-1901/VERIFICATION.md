# Verification record

11 October 2026 UTC.

## Source proof

The completed keyless sentinel campaign passed all 13 unique checks across five identities. Exact report SHA-256:

`a8efd1423272343178ed1813ad03660a18e74169f032c0e06fceb90bd2e40b6f`

The corrected live run used 36 requests. Its campaign ledger includes all 41 requests, 25,018 bytes and 77.063 active seconds, including the initial two-request stop and three-request shape diagnostic. The source result was independently audited. No full-panel metrics are implied by it.

## Code review and offline testing

An independent reviewer approved the final qualification extension and panel transition at these exact SHA-256 hashes:

- `collect-panel-metrics.mjs`: `57d472ec100971fd9f8a3f4095f3c282e04e898e15ef1445c3076c11d00dcb17`
- `collect-panel-metrics.test.mjs`: `ee957b2e2eec7c4922c7d9b17631e3d1e9d49db07b9e43e9975705c95d21ad03`
- `join-qualified-candidates.mjs`: `bfba48043f2e50a3d9a340132df4569f4392f3c0d4a44fbaa175540c4449446d`

The final JavaScript run passed 45 tests: 21 sentinel-harness tests plus 24 collector/qualification/join tests. Six additional Python CLI tests exercise the read-only discovery-checkpoint budget adapter. The transport is mocked in all these tests. Synthetic IDs and titles stay in test code and are not packaged as a collection manifest.

The reviewer also independently ran a fully mocked qualification → join → actual application allocator → panel transition → first panel game. It produced exact 75/100/100/25 allocations, preserved metadata and all 304 new request charges over a 777-request baseline, and enforced a 2,000 ms gap between phases.

Review fixes cover durable denial state, persistent logical retry allowances, one authoritative monthly ledger, strict saved observation/configuration integrity, directory fsync, and pacing across phase transition. The ledger guarantee is limited to the approved campaign with a reconciled baseline; it does not control unrelated collectors.

## Remaining execution prerequisites

The real population-discovery artifact, current actual-environment monthly baseline, explicit bootstrap allowance and eventually a complete eligible 300-member manifest are required. Current 137-member drafts reject before source calls. The owner personally executes any credential-bearing metadata command. No qualification or 300-game metrics have been collected live, and no application database or schedule has been changed by this package.


The read-only budget adapter was independently approved at `prepare-budget-baseline.py` SHA-256 `4da1a04f354f49370008231dae4a534d2fcf4a766791ea6e8e9eb474e721153e` and test SHA-256 `f78e4eccd9e7d100c868c99494d5205319c132dfa3d041782124134e6dd9278d`. The reviewer reran all six tests and three additional rejection cases (duplicate checkpoint, duplicate matching use, unused checkpoint), and verified raw-byte envelope hashing against the staged discovery writer. No discovery source/package or user command was changed.
