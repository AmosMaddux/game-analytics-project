# Codespaces: private IGDB connection check

This standalone, dependency-free bundle contains no credentials. It does not
change the existing game-research prototype, start a server, or publish anything.
Use the extracted `codespaces-setup` folder as the working directory. Requires
Bash and Node.js 22.21+ or 24.5+ (or a newer major than 24), available on PATH.
No npm install is needed. The launcher resolves Node dynamically.

## 1. Verify offline and check the network before entering secrets

Run these in the Codespace terminal, from this folder:

```sh
bash scripts/run-igdb-check.sh --test
bash scripts/run-igdb-check.sh --network
```

The first command runs 30 connection tests (including nine token-error safety
regressions) plus 8 bundle/route tests. All 38 tests use mock requests and
synthetic temporary configuration.

The separate network check sends exactly one credential-free HEAD request to
each official route, with no request body, client ID, secret, or authorization:

- https://id.twitch.tv/oauth2/token
- https://api.igdb.com/v4/games

It never reads `.env.local`, exchanges a token, reads/logs response bodies, or
saves a report. Output is only time, fixed service/status labels, and HTTP status.
Each request has a 20-second deadline. TLS verification and existing proxy
configuration are preserved; redirects, retries, and alternate routes are not used.
An HTTP response demonstrates an HTTPS response along that route, not successful
authentication or readiness for the real request. HEAD may return 400, 401, 403,
404, or 405. Stop and investigate a network error, redirect, proxy-authentication
response, rate limit, server error, or unexpected status before entering secrets.
A network check exit code of 0 means both routes returned HTTP responses only.

## 2. Personally enter credentials in the Codespace

Only after the route check is satisfactory, create a private local file:

```sh
(umask 077; set -C; cat .env.example > .env.local)
chmod 600 .env.local
```

The creation command refuses to overwrite an existing file. Open `.env.local`
in the Codespace editor and personally fill the two blank values. Do not paste
secrets into chat, terminal commands, `.env.example`, browser code, or screenshots.
Do not read aloud, print, upload, commit, or share `.env.local`. Codespaces is a
cloud-hosted computer: the private file will live in your Codespace. Keep the
workspace private, do not serve this directory over HTTP, and do not share it.
`.gitignore` is only a safety net, not access control. No access token is needed.

## 3. Personally run the authenticated check

```sh
bash scripts/run-igdb-check.sh --run
```

This command sends the client ID and client secret in a form POST body to Twitch
to obtain one app access token, then sends the token and client ID to IGDB for
one read-only query: `fields id,name; limit 3;`. Only you should initiate it.
The token is kept in process memory and is never logged, saved, or placed in
`.env.local`. Existing access-token environment/configuration values are ignored.
Do not use tracing, a debugger, or a token-capturing proxy during the real check.
The launcher clears inherited Node debugging/injection/key-log/TLS overrides.

The check reads only this folder's owner-only, regular, non-symlink `.env.local`.
It uses exact endpoint allowlisting, verified TLS, configured proxy routing,
no redirects or retries, a 20-second deadline per request, and 16 KiB body caps.
It logs fixed outcome labels and creates an owner-only, sanitized JSON report in
`research/milestone-1/igdb-connection-checks/` beneath this folder. Reports contain
only timestamp, status, phase, record count, HTTP status when available, and a
fixed token-error reason when applicable. No credentials, tokens, arbitrary
provider messages, raw bodies, game names, or game IDs appear in reports.

For token-endpoint HTTP 4xx/5xx errors only, the checker reads at most 16 KiB of
JSON within the same 20-second request deadline. Exact approved message/code
strings map to `invalid_client_secret`, `invalid_client_id`,
`unsupported_grant_type`, `invalid_grant`, or `access_denied`. All other or
conflicting text, non-JSON, malformed, oversized, or interrupted error bodies
produce `unknown` while preserving the HTTP status. Unknown text is never
printed or saved. Redirects and IGDB error bodies remain unread. A status such
as HTTP 403 alone never determines a cause; the reason labels only summarize
recognized provider text and do not independently verify credentials.

Share only the printed outcome or sanitized report. `igdb_success` establishes
this bounded authenticated query; it does not establish dataset coverage or
commercial-use rights. `missing_config` means inspect the private file and its
permissions in the editor. `network_error` means transport did not complete;
it does not reveal whether a request reached Twitch or prove credentials invalid.
`token_rejected` / `igdb_rejected` include the provider HTTP status in the report.
`token_rejected` also prints/saves only an approved reason label or `unknown`.
There is no automatic retry. Authenticated check exit codes: 0 success, 1 failed
check with saved report, 2 usage/runtime restriction or report-save problem.

Protocol references: [Twitch client credentials flow](https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/#client-credentials-grant-flow)
and [IGDB getting started](https://api-docs.igdb.com/#getting-started).

## Bundle allowlist

- `.env.example` (two blank fields)
- `.gitignore`
- `README.md`
- `scripts/check-igdb-connection.mjs`
- `scripts/check-igdb-connection.test.mjs`
- `scripts/check-network-routes.mjs`
- `scripts/check-network-routes.test.mjs`
- `scripts/run-igdb-check.sh`

Importing either module performs no application filesystem or network I/O.
No real network or authentication test was run while preparing this bundle.
