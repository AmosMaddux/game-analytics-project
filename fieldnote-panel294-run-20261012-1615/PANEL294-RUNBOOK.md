# Explicit approved 294-game metric phase

The user chose "Let's proceed with 294" at 2026-10-12T16:08:26 UTC. This dedicated entry point accepts only the actual frozen294 manifest. It does not relax the generic300 gate for other partial panels, change release/review criteria, borrow quota slots, or modify the old source packages.

## Pinned inputs

- Panel canonical SHA256: dc3840a01e9d68b2e0f7ecef873ecba6fa6430eb847595eacd01e7d4e932e3b9
- Exact panel file SHA256: c9b5d6497d6a2d4ddf15f7ca07a8d87f2603ac89da8b7998ca03137830e84220
- Sorted294 AppIDs SHA256: 2266fa98f1bedef695a0af66cb0f50ca362d077941ba80002a852a619c37acf4
- Completed785 campaign SHA256: b31ba4d90a768c9ff191c8b4d54df9016ecc7df1a462e49bee35e7ea8c150532
- Before-transition authoritative ledger SHA256: f14af4ede086cb7616335a17875a28770869ea9605a241c06e5c6b1ca154b705
- Source proof SHA256: a8efd1423272343178ed1813ad03660a18e74169f032c0e06fceb90bd2e40b6f

Membership is exactly75 references,94 recent,100 older (20 per calendar year2021–25),25 controls. The target remains300; six recent slots are explicitly unfilled. Original cohort cutoff is2026-10-11T18:49:27.594Z. Final allocation evidenceAsOf is2026-10-12T16:02:24.274Z, after all identity and qualification observations. Every member retains campaign ID plus actual qualification observation run/time/source bundle receipt.

## Source measurements and budget

Four documented keyless calls per game: surviving Steam-purchase matching reviews over lifetime,7 days and30 days, plus current online players. All review populations share languages=all, purchase_type=0, review_type=0, off-topic filtered. Review counts use total_matching. Review text/author information is never saved.

All dated windows end at2026-10-12T00:00:00Z, covering completed UTC days. The7-day interval is[Oct5,Oct12), and30-day interval[Sep12,Oct12). The source's inclusive end is sent as end−1. Every observation retains its real observedAt. CCU is a live point observation and is not assigned a historical date-window count.

Nominal1,176 calls/observations. With at most100 retries, explicit maximum1,276 attempts (generic300 caps are unchanged). One retry per logical request,2-second pacing,20-second deadline,90 active-minute runtime,128 KiB/response and32 MiB total bytes. Expected minimum pacing duration39 minutes10 seconds; practical duration about45 minutes. Missing/invalid CCU remains null with a reason; invalid review schema or inconsistent7<=30<=lifetime counts stop publication. Access denial,429 or redirect permanently stops the source lane.

Use the same authoritative monthly ledger and its exclusive lock. Preserve625+160 qualification calls and the one incremental owner-discovery charge. Start at1,594 monthly /786 bootstrap. Nominal completion is2,770 monthly /1,962 bootstrap, leaving738 of the approved2,700 bootstrap allowance. Monthly cap12,000. No baseline reset, new authentication, schedule or database writes.

## Verification and launch

Node24.5+ is required. Run all offline tests:

    node --test collect-review-campaign.regression.test.mjs qualification-campaign.test.mjs panel294.test.mjs validate-reviews.test.mjs

`transitionApproved294` is a pure exported preflight. Feed it the exact raw before-ledger, panel,785 campaign and source proof plus the explicit canonical approval hash. It returns an in-memory staged job with294 IDs, the same existing charges, two archived qualification receipts and the fixed Oct12 windows. It must not write the live ledger or call providers during staging.

After independent package review and root staging verification, execute `bash run-reviewed-panel294.sh` once from a new Codespaces sibling directory. The wrapper pins all inputs, the exact current ledger and the explicit user-approved manifest. It cannot create a fresh qualification campaign. The source/input paths in the existing ledger remain in the prior addendum stage and are rehashed before dispatch.

On an interrupted run, use `qualification-panel294.mjs --resume` with only the same state/output/source-proof arguments. Do not change windows, approval, manifest or output path. Persistent counters, retries, reservations, permanent stops and atomic immutable output recovery remain enforced.

The metric bundle remains fieldnote-panel-metrics-1.0, with the pinned panel hash,294 IDs and1,176 observations. The application importer must accept this exact manifest only and display the six-slot recent-release shortfall. No sales/revenue estimate, peak-player reconstruction or instantaneous multi-batch qualification claim is introduced.
