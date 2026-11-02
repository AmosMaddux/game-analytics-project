#!/usr/bin/env bash
# User-run only. Never source a credential file or enable tracing.
set +x
set -eu
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
NODE_BIN="$(type -P node || true)"
if [[ -z "$NODE_BIN" ]]; then printf '%s\n' 'Node.js is required.' >&2; exit 2; fi
unset NODE_OPTIONS NODE_DEBUG NODE_DEBUG_NATIVE SSLKEYLOGFILE NODE_TLS_REJECT_UNAUTHORIZED
if ! "$NODE_BIN" -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>24||(a===24&&b>=5)||(a===22&&b>=21)?0:1)'; then
  printf '%s\n' 'Use Node 22.21+ or 24.5+ for proxy-aware HTTPS.' >&2; exit 2
fi
if [[ $# -ne 1 ]]; then printf '%s\n' 'Usage: bash scripts/run-igdb-import.sh --test | --run' >&2; exit 2; fi
case "$1" in
  --test) exec "$NODE_BIN" --test "$SCRIPT_DIR/check-igdb-connection.test.mjs" "$SCRIPT_DIR/import-igdb-catalog.test.mjs" ;;
  --run) exec "$NODE_BIN" "$SCRIPT_DIR/import-igdb-catalog.mjs" --run ;;
  *) printf '%s\n' 'Usage: bash scripts/run-igdb-import.sh --test | --run' >&2; exit 2 ;;
esac
