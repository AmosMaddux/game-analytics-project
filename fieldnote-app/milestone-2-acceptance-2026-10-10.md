# Milestone 2 acceptance · 10 October 2026

## Outcome

**Complete for the authorized private, offline application foundation.** The new `app/` implements a real React/TypeScript frontend, Workers-compatible backend and normalized persistent database. It is running in the existing private Codespace, alongside the unchanged prototype. This acceptance does not claim a Cloudflare deployment, live data refresh, connected chat or production cost/access controls.

Private review URL: https://didactic-space-carnival-rw456rp5jqxhp674-4174.app.github.dev/

Port 4174 was verified as **Private** in the Codespaces Ports UI. The original prototype on 4173 remains available. Codespaces compute is separately metered; a closed browser tab does not stop the Codespace.

## Deliverables

- Isolated `app/` source tree; original `prototype/`, Milestone 1 source evidence and private configuration remain untouched.
- React 19.2.4 and TypeScript 5.9.3 frontend with preserved black/neon presentation, actual JSX components and strict type checking.
- Fetch-standard Worker backend with a structural D1 binding contract and no provider/network calls.
- Real persisted Node 24 SQLite runtime, two versioned transactional migrations and normalized game identities, observations, tags, IGDB entities/crosswalks, scoped releases, provenance, conflicts, marketing events, review windows and preferences.
- SHA-verified deterministic seed from the original saved snapshot; repeat seeding does not duplicate evidence and preserves preferences.
- Overview, Search, genre/game details, marketing, Methods/coverage, clearly unavailable research chat and usage/settings.
- Pinned dependency lockfile, repeatable setup/build/typecheck/lint/test commands, hardened public-file boundary and portable Node-only prebuilt release.

## Acceptance criteria

| Roadmap criterion | Evidence and result |
| --- | --- |
| Clean setup seeds, runs and tests | A fresh copy of the release ran without node_modules. Generated outputs and database were then removed, exact dependencies reinstalled from the populated official-registry cache, and setup plus aggregate checks passed. |
| Preserve useful UI behavior | The original scores/tag rules remain covered by model and real React render tests. Actual private-browser review verified navigation, filters, keyboard entry, caret stability, Back/Forward, marketing, methods and responsive views. |
| Stable Steam identity and explicit IGDB crosswalks | 36 unique AppIDs and 36 exact crosswalks. Mismatched provider/ID/URL, console crosswalks, unverified Steam provenance, parent/version records and non-main-game records fail closed. Same-name identities do not merge. |
| Source and measurement provenance retained | Complete reconstructed data deep-equals the original snapshot before additive foundation/evidence metadata. All 108 metrics preserve collection time; source-supplied measurement timestamps remain null where absent. Scoped catalog and marketing dates remain distinct. |
| Observed/estimated/stale/unknown and fixtures distinct | Stored evidence states and independent freshness enums are tested. UI labels calculated, observed, estimated, reported, stale, unknown and unavailable appropriately. Seed identifies saved observations; synthetic tests are not installed. Null never becomes zero. |
| Secrets outside browser and committed assets | No private credential file was read or packaged. Only four public build files are served through an explicit allowlist. Tests reject private paths, traversal, file/ancestor symlinks, unsafe source links and cross-origin settings writes. Frontend imports are limited to source and installed dependencies. |
| Readable, responsive and keyboard-usable neon UI | Actual browser review at 388 CSS pixels found no horizontal page overflow on Overview, Search, Settings or Methods. Overview retains the five-score focus; detailed evidence stays in drilldowns and Methods. |

## Verification results

- Strict TypeScript: passed.
- Focused source-policy lint and JavaScript syntax checks: passed. This is the project's own lint script, not ESLint.
- Frontend/backend production build: passed.
- Application tests: **53 passed, 0 failed**. Includes 23 backend tests, model, React SSR, persistence, API and security checks.
- Existing prototype regression baseline: **109 passed**, independently verified during acceptance review.
- Preserved dataset: **36 games, 108 metric observations, 36 crosswalks, 13 marketing events and six review windows**. Full original-field round-trip and foreign-key checks passed.
- Actual process close/restart: persisted settings survived in an isolated copy of the portable release using real SQLite. The remote browser additionally verified save and reload persistence. A separate remote process-restart test was not performed.
- Clean rebuild: frontend and backend bundle hashes exactly matched the shipped release.
- Dependency audit: **zero known vulnerabilities reported** at verification time.
- Workers compatibility: platform-neutral ESM bundle passed six API routes in an isolated VM without Node `process` or `require`, backed by the real SQLite D1 contract. Zero outbound fetches. **Cloudflare/workerd runtime execution and deployment were not tested.**

## Actual private-browser review

The parent task uploaded the exact archive, verified its SHA-256, seeded 36 games with Node 24 and started port 4174. It verified:

- Five original Overview scores and actual denominators.
- Puzzle: Popularity Score 60.1, mean players 309.5, median 30 and three recurring tags.
- Keyboard genre-search Enter navigation; game-search Home/Delete edits retain caret position.
- Exact Bean and Nothingness IGDB details and the honest missing source measurement timestamp.
- Browser Back/Forward restores the query.
- Six deep marketing examples and 13 evidence records.
- Methods coverage and separate date-window proofs.
- Disabled research-chat controls and unavailable connection state.
- A preference checkbox save survives reload; the compact-table default was restored afterward.
- Clean visual layout without page overflow at 388 CSS pixels for Overview, Search, Settings and Methods.

Minor nonblocking wording: the Overview accessibility label uses “1 observed games” for a singleton group; the visible text uses the correct singular. This was recorded rather than changing the already verified release.

## Release and integrity

Archive: `app/release/fieldnote-m2-foundation.zip` (401,946 bytes; 49 packaged files including the manifest).

SHA-256:

`05b28dde63bcec139a532bbcd36b1bcfbc3fde24b98895b1cb7944509e9be0f9`

Saved snapshot SHA-256, matching `prototype/public/data/snapshot.json` exactly:

`b82ced8fafda2393203ede54e9958c7144058790197a6d17ce7ee9d5cc852630`

The downloaded roadmap is the current reviewed `docs/roadmap-review-2026-10-10.docx`, not the older prototype copy. Its SHA-256 is `ba7bc4642b424da77d0acfa734e2bc0b5025de2a0098354a2bd2273a876a32c1`.

Portable launch after extraction:

```sh
cd /workspaces/codespaces-blank/fieldnote-app
node scripts/seed-local.mjs
node scripts/serve.mjs
```

Detailed local verification artifacts are in `app/qa/verification-summary.json`, `check.log`, `clean-check.log`, `clean-release.json`, `workers-contract.json` and `dependency-audit.json`. The source/run guide is `app/README.md`.

## Explicit deferred gates

No new credentials, accounts, live providers, schedules, paid services, Cloudflare resources, publication or git push were used. The Workers example configuration remains intentionally non-deployable without separate provisioning and authorization.

Later milestones still own operational source-use and retention permissions, live collectors, catalog expansion, real history, validated estimates, grounded chat, measured billing/usage, enforced spend limits, production authentication, backups and load testing. The settings budget is a planning value only and neither authorizes nor controls spending. The app is currently a private local/Codespaces service, not an authenticated production host.
