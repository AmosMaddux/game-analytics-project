# Bounded 160-game qualification addendum, reconstructed 2026-10-12

This isolated replacement was reconstructed after the temporary workspace reset. It does not overwrite or claim the earlier lost package's approval. The original reviewed collector, original625 observations and their timestamps are retained byte-for-byte in the recovered source and evidence.

## Exact input scope

The owner personally completed the repaired identity resume. The resumed report has785 verified Steam identities, all625 previously qualified plus160 new identities exclusively from the original184 pending set. The other24 are quarantined; none of the prior191 quarantined entries are admitted. Discovery metadata and prior cached identity rows are unchanged. Original31 requests become32: charge only the delta1.

- New candidate SHA256: c6c5a8c61f9f8cbbd7bf24bfce2deb92a089cf40c6f90a78759a814769d28a42
- New checkpoint SHA256: 93432f4a6dc65abacf77da484a436b89d04ba682dbbde13bdc8e2bc2cf9fa659
- Sorted new160 AppIDs SHA256: dd8db9e5f320ef3ce306688eba2427149ab7092de57b293091844b5584d12752
- Original completed ledger SHA256: d3ecb4525c6836638bf4a4304df6ebfb27d6dcd4320733048233123f331fd8e0
- Original625 bundle SHA256: 5ee28cd5f6be9b10f562916fa277a3b50b2bd59550f9ea3ae56814846742cd9d
- Passed source proof SHA256: a8efd1423272343178ed1813ad03660a18e74169f032c0e06fceb90bd2e40b6f
- Approved plan canonical SHA256: abe3776ccf43334ed8baba98603629551d304db734b544cf2105a6801a3fe66f

The plan has no generation timestamp, so its canonical approval hash is reproducible. It binds the exact candidate/input receipts, original ledger, original run,160 IDs, source delta, baseline hash, resulting counters and caps.

## Source and budget contract

One documented keyless IUserReviewsService/GetAppReviews/v1 request per added ID; fixed all-language, all-polarity, Steam-purchase-only purchase_type0 population, off-topic filtered. Use total_matching, num_per_page1. No review text or author data is persisted. No API keys, token calls, credential or environment reads are introduced. Existing reviewed transport may inspect proxy/TLS safety environment options without printing values.

Addendum limits:184 TOTAL attempts including retries, at most10 retries, at most1 retry per logical request,2-second minimum spacing,20-second request deadline,20 minutes active runtime,128 KiB response and32 MiB phase byte caps.160 IDs make the effective maximum170 attempts. An access denial,429, or redirect permanently stops this source lane. Resume never resets counters or retries; interruption reservations stay charged. No authentication fallback.

One existing authoritative ledger and exclusive lock are used. Baseline remains808; old625 charges remain. Charge new discovery delta1 to both monthly and bootstrap totals. Before first addendum request:1434 monthly/626 bootstrap. At nominal160-call completion:1594 monthly/786 bootstrap, leaving1914 of the approved2700 bootstrap allowance. Monthly cap12000. These counts cover the reconciled project jobs and this campaign, not arbitrary external collectors.

Fresh live database/schedule verification is mandatory before dispatch: the same5 saved jobs must total736,3 schedules disabled, no active source job/lease/lock or pending reservation. Root's independently reviewed15:40:37UTC live check satisfied these conditions. Recheck if later activity occurs; do not replace the frozen baseline.

## Tests and staging

Node24.5+ required. Run:

    node --test collect-review-campaign.regression.test.mjs qualification-campaign.test.mjs validate-reviews.test.mjs

The portable campaign-fixtures directory contains actual sanitized immutable receipts, not credentials. Tests use fully mocked transport and never make network calls. Synthetic allocation in tests is explicitly a test fixture, not an actual panel.

After independent source/package review and root's exact scope approval, extract into a new Codespaces sibling folder and verify every package manifest entry. The included run-reviewed-addendum.sh uses only that folder's exact pinned inputs and the existing authoritative ledger. It must be run once; do not run the original collector with a fresh baseline.

## Result/receipt contract

The addendum batch schema is fieldnote-candidate-review-addendum-1.0. Its candidateSet.manifestSha256 is the full new785 source hash, but candidateSet.appids lists only160 additions, membershipMode=new_verified_subset_of_source, sourceVerifiedCount785, parentQualificationRunId and parentBundleSha256 identify the original625. Never interpret this batch as having measured all785.

The campaign schema is fieldnote-candidate-review-campaign-1.0 with temporalScope=multi_batch_observations_not_instantaneous_snapshot. Original Oct11 and new Oct12 observations keep their actual observedAt, observationRunId and sourceBundleSha256. Two explicit batch receipts preserve both input and output hashes. The joined785 file adds compatible lifetime qualification evidence without selecting membership. A campaign run ID groups the selection population; it does not replace actual measurement run IDs/times.

Exports use exclusive durable writes and compare existing bytes. Identical completed orphan exports can recover after a crash before receipt persistence. All output paths are checked before any resumed source call; differing files are never overwritten. Keep original625/source archives unchanged.

## Later exact300 gate

The final allocation must retain75 references,100 recent,100 older (20 per year2021–25),25 controls with the approved scarcity-first policy and existing review/probation floors. Original discovery/cohort release cutoff stays2026-10-11T18:49:27.594Z; final allocation evidenceAsOf is addendum completion Oct12. Every admitted identity/count must be observed by evidenceAsOf. Full metric windows will uniformly end2026-10-12T00:00:00Z (completed UTC days); CCU retains live observedAt. Do not backdate new evidence.

Do not automatically advance after qualification. Download/audit the completed batch, campaign, joined source and ledger, run the real allocator, and review the exact300 manifest first. Only then use the campaign CLI --advance with the exact panel/campaign/proof and explicit --as-of2026-10-12T00:00:00Z. This phase makes4 calls per game, nominal1200, preserving all earlier charges and source pacing. A shortfall, incomplete batch, inconsistent receipt, denial or insufficient budget blocks it.
