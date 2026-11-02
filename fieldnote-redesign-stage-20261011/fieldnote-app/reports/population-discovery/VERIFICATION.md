# Offline verification

Implementation scope: standalone population-first candidate discovery only. No real config files were read, no network/authentication requests were made, and no database was opened or written.

Validation command:

```sh
node --test tests/*.test.mjs
```

Result: **57 tests, 57 passed, 0 failed** on Node v24.19.0. See `offline-tests.log`.

The suite includes a complete synthetic 1,000-candidate flow, one-to-one independent Steam identity, all raw IGDB genres/modes including previously unmapped genres, calendar-year/recent query windows, same-row PC date filtering, missing and coarse date ambiguity, source status, conflicting crosswalk quarantine, exact cache/resume, missing-key completion on the same run, malformed/blank Steam titles, conflicting Steam pagination cursors, request/page/byte/runtime/retry caps, credential-reflection prevention, synthetic private-config parsing, private atomic files, checksum tampering, a live lease, stale-lock competing starters, output symlink protection, and an offline dry-run.

All six production modules also pass `node --check`. The dry-run output is saved as `offline-plan.json`; it confirms zero network requests, credential reads and database writes. Tests use dependency-injected synthetic transports. They do not establish live source compatibility or guarantee 300 eligible panel members.

Independent review caught and prompted regression coverage for coarse-date lower-bound comparisons, blank Steam titles on resume, stale-lock takeover races, and the missing-Steam-key completion state. The final design refuses automatic stale-lock takeover.

Maximum candidate budget is 1,000. Discovery stops at the fixed bounds and reports real shortfalls. Only an explicit owner-executed run can establish real candidate counts.

The follow-on parser/materialization patch adds 16 regressions and applies the existing exact identity rule to recovered public identity evidence offline. See PATCH-NOTES.md for the owner-executed original run, remaining source uncertainty and separate offline materialization provenance. No authenticated request was executed by the implementation or review agents.
