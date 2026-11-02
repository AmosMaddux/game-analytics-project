# Fieldnote private Codespaces M1 preview

A self-contained update of the existing game-market-research prototype. Requires Node.js 22 or newer. No npm install, API keys, source-provider login, collector or live API calls are needed.

## Update and start

Upload `fieldnote-codespaces-m1.zip` to `/workspaces/codespaces-blank/`. Stop the running preview with Ctrl+C before applying this update. The ZIP intentionally overlays only its explicit files under `fieldnote-prototype/`; it does not modify the separate collector folder or environment files outside the preview.

```sh
cd /workspaces/codespaces-blank
unzip -o fieldnote-codespaces-m1.zip
cd /workspaces/codespaces-blank/fieldnote-prototype && bash start.sh
```

Keep the terminal running. Stop with Ctrl+C. `npm start` is equivalent from the package directory. The server binds only to `127.0.0.1:4173` inside the Codespace and prints the local URL.

## Private access

In Codespaces Ports, verify port **4173** is **Private** before opening its forwarded URL. Keep it Private. GitHub/Codespaces provides access control; the Node server itself has no authentication. A loopback bind alone does not determine forwarded-port visibility.

## Milestone and snapshot

Open [MILESTONE-1.md](MILESTONE-1.md) in Codespaces Explorer for the concise acceptance outcome, with [source-rights](reports/source-rights.md) and [cost-feasibility](reports/cost-feasibility.md) notes. These are local review documents and are not served by the app.

The six app assets are byte-for-byte copies of the final local prototype. The snapshot has **36 games**, **36 exact IGDB matches**, and build time **2026-10-10T18:05:29.011Z**. It contains saved source observations, not live metrics. Read M1 for final Steam coverage and limitations. The current scope is a private non-commercial technical pilot, not production readiness.

The browser fetches only the packaged JSON. Source links contact external websites only when clicked. The source project's snapshot-rebuild command is unavailable here because raw research and collectors are intentionally excluded.

## Public boundary

Only six routes are served (`/` aliases `/index.html`):

- `/index.html`
- `/src/app.js`
- `/src/model.js`
- `/src/style.css`
- `/data/snapshot.json`
- `/docs/roadmap.docx`

Only GET and HEAD are supported. Explicit allowlisting, traversal/malformed-path rejection, symlink rejection, no-store responses and generic errors remain in place. Reports, README, package metadata, launcher, server scripts and local QA are not served. No credentials, environment files, raw API evidence, tests, collectors, build tooling or node_modules are bundled.
