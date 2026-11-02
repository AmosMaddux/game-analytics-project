# Population panel and category filters · reconstructed offline checkpoint

See [PANEL-RESEARCH.md](PANEL-RESEARCH.md) for the current source-category filters, separately labeled IGDB PC dates, deterministic 300-slot policy, exact review intervals and copy-only imports. This checkpoint preserves the original pilot and adds 785 real lifetime-review observations in two dated batches, the verified 785-game source catalog, and frozen 294-of-300 membership with six recent slots unfilled. Panel activity and current-player measurements remain separate inputs; no completed 300-game collection is claimed here.

# Release-cohort research integration · offline working copy

## Existing installation: back up and migrate only

This release adds `#/releases` and read-only `/api/research/releases`. The accompanying offline five-game evidence pilot provides five explicitly manual-reviewed game classifications and five supported Steam release facts. The importer defaults to a read-only dry run and can apply only to a new database copy; it does not update a running app. Darkwood and Half-Life date bases remain unresolved, and 9 Kings has no released 1.0 date. All 298 saved-query type reconstructions remain pending. The strict Steam bases continue to require reviewed evidence; IGDB PC dates are available only through the separately labeled source-reported basis. Generic legacy store dates remain reference-only. See [RELEASE-EVIDENCE-IMPORT.md](RELEASE-EVIDENCE-IMPORT.md) for provenance, limitations and exact commands.

**Never run `npm run setup` or `npm run db:seed` as an upgrade on an existing research database.** Keep the original app and database untouched, copy the database to a separate working path, and run only migrations against that copy:

```sh
# Node 24.x. FIELDNOTE_DB must point to your separate database copy.
npm ci --ignore-scripts
npm run check
FIELDNOTE_DB=/absolute/path/to/working-copy.sqlite npm run db:migrate
FIELDNOTE_DB=/absolute/path/to/working-copy.sqlite npm start
```

A transfer package excludes all SQLite databases. Copy the existing database separately through an authorized private transfer; no reseed is needed. See [REDESIGN-INTEGRATION.md](REDESIGN-INTEGRATION.md) for scope, verification, preservation and rollback. Source collectors and schedules were not changed or started.

The older M3 instructions below describe the inherited app. Their seed/setup commands apply only to a deliberately new empty baseline database, never an existing installation.

---

# Fieldnote · Milestone 3 bounded collection

React + TypeScript, a Fetch-standard Workers-compatible API, and a normalized, persistent SQLite database with a D1-compatible SQL schema. This separate `app/` directory preserves the original `prototype/` and all Milestone 1 source artifacts.

The app preserves the real 36-game research baseline and adds bounded local IGDB/Steam collection commands, normalized catalog admissions and append-only Steam metric observations. See **[COLLECTION.md](COLLECTION.md)** for the audited user-run command, source permissions, strict limits and recovery. The web app never authenticates or collects. Test-only fixtures stay in tests and never enter the release database.

## Clean development setup

Requirements: **Node.js 24.x**, npm, and Python 3 only when creating a ZIP release. Node's built-in `node:sqlite` is experimental in this Node line and may print a warning; the local database is a real on-disk SQLite file. No system SQLite or native npm add-on is needed.

```sh
cd game-market-research/app
npm ci --ignore-scripts
npm run setup
npm run check
npm start
```

Open `http://127.0.0.1:4174` in the browser on the machine running the app. The server binds to loopback only. In a private Codespace, forward port 4174 with visibility **Private** and use its verified preview URL. Port 4173 and the original prototype are unchanged. Merely closing a Codespaces browser tab does not stop its compute billing.

`npm ci` uses the exact versions and integrity hashes in `package-lock.json`. Install scripts are unnecessary. All frontend runtime dependencies are bundled locally; the browser fetches only this app's same-origin API and assets, until a user explicitly opens a source link.

### Prebuilt release: no npm install or registry access required

Unzip `fieldnote-m3-collection.zip` beside the existing prototype, then:

```sh
cd fieldnote-app
node scripts/seed-local.mjs
node scripts/serve.mjs
```

This runs the already-built frontend and API using only Node 24. Source and lockfile remain included for reproducible rebuilds. Run `npm ci --ignore-scripts` before type checking, rebuilding, or running the complete test suite. Never treat a prebuilt bundle as proof that unrun checks passed.

### Commands

- `npm run build`: compile and bundle the React frontend, Worker backend and offline seed function. Exactly four public files are copied to `dist/`.
- `npm run db:migrate`: apply versioned, transactional migrations to the local database.
- `npm run db:seed`: verify the seed SHA-256, migrate, then replace imported evidence in one transaction. Repeated seeding does not duplicate rows and preserves saved preferences.
- `npm start`: open the existing database and serve the app. An empty database causes a useful setup error; the server never silently fabricates or falls back to browser snapshot data.
- `npm run dev`: rebuild, then serve. This deliberately small setup does not include hot reload.
- `npm run typecheck`: strict TypeScript checks for the frontend and backend.
- `npm run lint`: source-policy lint plus JavaScript syntax checks. This is a focused project lint script, not ESLint.
- `npm test`: database, API, identity, provenance, model, render and security regressions against real temporary SQLite files. Run the build first.
- `npm run check`: typecheck, lint, production build, then tests.
- `npm run package`: create an allowlisted, SHA-256-manifested ZIP release without credentials, local databases, raw research archives or node_modules.

`PORT=4174` is the default. `FIELDNOTE_DB=/absolute/path/research.sqlite` optionally chooses a different database, useful for a fresh verification run. These are non-secret runtime controls. No `.env` file is loaded by the build, seed or server. The default database is `app/.data/fieldnote.sqlite`; stopping and restarting preserves it. To test a clean database, point `FIELDNOTE_DB` at a new path instead of deleting existing data.

## Architecture and boundaries

```text
React/TypeScript browser
  → same-origin /api/*
  → backend/worker.ts (Request → Response; structural D1 binding)
  → normalized SQL tables
      local: scripts/database.mjs → Node 24 SQLite file
      future: Cloudflare D1 binding, after separate deployment approval
```

- `src/`: real React components, typed data contract, hash routing, preserved score/tag algorithms, safe source links and black/neon CSS.
- `backend/`: Worker-compatible request handling, parameterized repository queries, validation, evidence-state logic and offline seed statements. No Node imports, credentials or outbound provider requests.
- `migrations/0001_foundation.sql`: normalized identities, editorial genres/cohorts, metric observations, Steam tags, catalog records, explicit crosswalks, platforms, company roles, labels, releases, links, conflicts, field provenance, marketing profiles/events and persistent preferences.
- `seed/snapshot.json`: byte-identical copy of the preserved snapshot. `seed/manifest.json` records its hash and origin. The API reads database tables, not this file.
- `scripts/`: local SQLite adapter, transactional migration/seed, hardened local server, build, verification and release packaging.
- `dist/`: browser-public files only. `build/` contains server-only bundles outside the served file set.

Secondary entity details are JSON to preserve original provider fields without information loss. This is not a whole-snapshot or whole-game blob store: identifiers, relationships, metric values/provenance, releases, tags and events are separately queryable tables. Reconstructing the snapshot preserves all original fields, while adding explicit evidence and foundation metadata.

## Routes and behavior

- `#/overview`: up to five genre Popularity Scores, raw mean/median, actual denominators and genre search.
- `#/search` and `#/genre/...`: URL-backed search, cohort/tag/genre filters, sorting, full-genre summaries and exact saved Steam-tag recurrence. The global score baseline and genre summaries remain fixed when filtering individual games.
- `#/game/{SteamAppID}`: observed metrics, independent freshness, exact Steam/IGDB identity, source links, scoped catalog releases/conflicts, marketing evidence and unknowns.
- `#/marketing`: the six deep evidence examples and other saved marketing records, with non-exhaustive coverage limits.
- `#/methods`: coverage, source collection windows, method versions, calculation rules, limitations, evidence states, downloadable database snapshot and the current 10 October 2026 reviewed roadmap.
- `#/chat`: visibly unavailable research chat. `/api/chat` returns an explicit 503 `source_not_connected`; no question is sent to a model.
- `#/settings`: persistent presentation preferences and a 0–30 USD monthly **planning** value. Actual provider usage/billing is unknown, web-triggered source refresh and model calls are disabled, and no budget enforcement or spending approval is implied.
- Legacy `#/games` and `#/coverage` routes remain supported. Browser Back/Forward, keyboard search, Escape clearing, focus handling and responsive layouts are retained.

The backend offers `/api/health`, `/api/snapshot`, `/api/games`, `/api/games/{appid}`, `/api/settings` (GET/PATCH) and `/api/chat` (POST). Search uses bounded validated input and SQL parameters. Only local display/planning preferences are writable. There is no collection, import, execution, upload or secret-management web endpoint. M3 adds the read-only `/api/sources` source-health endpoint and `#/sources` view.

## Evidence contract

- Steam AppIDs are stable primary keys. IGDB joins require an explicit matching Steam external crosswalk; name similarity never merges records. Editions/platform records and release scopes are not silently reconciled.
- Observation rows preserve source URL/label, scope, collection time, nullable source-supplied measurement time, unit, method version, original status and run identity.
- In the saved Steam input, `observedAt` is a collection timestamp and `sourceTimestamp` is null. The normalized `collected_at` preserves the former; `measured_at` remains null. No source timestamp is invented.
- Evidence status (`observed`, `reported`, `calculated`, `estimated`, `unknown`, `unavailable`) and freshness (`fresh`, `stale`, `unknown`) are independent. Age uses a disclosed daily display target; the app does not claim any scheduler is running. Original observations and saved-run scoring eligibility are not rewritten as evidence ages. Once collection is active, API scoring eligibility additionally excludes failed latest refreshes and age-stale/unknown-freshness player readings, while preserving their values and original dates.
- Missing is null, never a fabricated zero. Observed zero remains 0. Unsupported sales/revenue/spend/headcount stay unknown. Calculated scores are provisional, relative to this editorial sample, and use the unchanged 70% log-median / 30% log-mean formula.
- Marketing event/publication/discovery/collection dates remain distinct. IGDB fetch/source-update/platform-release dates remain distinct. Source provenance and release conflicts are inspectable.
- The seed manifest identifies saved observations. Synthetic edge cases are clearly test-only and are never installed in the production seed.

## Security and production gates

Only `/`, `/index.html`, `/assets/app.js`, `/assets/app.css` and `/docs/roadmap.docx` are static routes; the first two use the same file. Dotfiles, private configuration, seed files, migrations, scripts, package files, server bundles, local databases, traversal variants and symlinks are not served. The frontend build has an import-boundary check. Source links accept HTTP(S) only; React escapes source text. CSP restricts execution and connection origins. Settings enforce same-origin writes, a small JSON body limit, whitelisted fields and bounded values; they cannot activate providers.

This is a private local/Codespaces development foundation, **not an authenticated production service**. Keep the port private. The example Cloudflare config is intentionally non-deployable without a real D1 database ID and separate authorization. No Cloudflare account, database, secret, Worker or paid service was created.

Worker compatibility is checked by a platform-neutral bundle and the Fetch/D1 contract running against real SQLite. This is not proof of a deployed Worker, Cloudflare Access policy or production D1 load limits. Those require a separately authorized environment test and rollout.

M3 implements bounded private source collection, retries/checkpoint recovery, current catalog caches and real appended metric observations. Actual catalog size, freshness and coverage depend on completed source runs. Deferred gates include broader source redistribution, new Steam-tag acquisition, representative market sampling, sufficient multi-day trend history, validated estimates, grounded chat, provider billing/usage measurement, hard spend enforcement, authentication, production deployment, backups and load testing. A settings planning amount cannot enforce a bill. These remain later milestones.

## Official implementation references

- [React installation](https://react.dev/learn/installation)
- [TypeScript configuration](https://www.typescriptlang.org/tsconfig/)
- [Cloudflare Worker fetch handler](https://developers.cloudflare.com/workers/runtime-apis/handlers/fetch/)
- [Cloudflare D1 binding API](https://developers.cloudflare.com/d1/worker-api/)
- [Node.js SQLite](https://nodejs.org/docs/latest-v24.x/api/sqlite.html)

These references inform interfaces; the pinned lockfile and executed checks define this build's actual dependency/runtime compatibility.
