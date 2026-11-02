#!/usr/bin/env bash
# Portable, manual-only launch. Never source .env.local or enable tracing.
set +x
set -eu
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
NODE_BIN="$(type -P node || true)"
if [[ -z "$NODE_BIN" ]]; then
  printf '%s\n' 'Node.js is not available on PATH. Use a Codespace with Node 22.21+ or 24.5+.' >&2
  exit 2
fi
# Remove inherited Node injection/debugging and TLS-key logging switches before
# invoking Node. Configured proxy variables are preserved; no alternate route.
unset NODE_OPTIONS NODE_DEBUG NODE_DEBUG_NATIVE SSLKEYLOGFILE NODE_TLS_REJECT_UNAUTHORIZED
if ! "$NODE_BIN" -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>24||(a===24&&b>=5)||(a===22&&b>=21)?0:1)'; then
  printf '%s\n' 'Use Node 22.21+ or 24.5+ (or a newer major than 24) for proxy-aware HTTPS.' >&2
  exit 2
fi
if [[ $# -ne 1 ]]; then
  printf '%s\n' 'Usage: bash scripts/run-igdb-check.sh --test | --network | --run' >&2
  exit 2
fi
case "$1" in
  --test)
    exec "$NODE_BIN" --test "$SCRIPT_DIR/check-igdb-connection.test.mjs" "$SCRIPT_DIR/check-network-routes.test.mjs"
    ;;
  --network)
    exec "$NODE_BIN" "$SCRIPT_DIR/check-network-routes.mjs" --run
    ;;
  --run)
    exec "$NODE_BIN" "$SCRIPT_DIR/check-igdb-connection.mjs" --run
    ;;
  *)
    printf '%s\n' 'Usage: bash scripts/run-igdb-check.sh --test | --network | --run' >&2
    exit 2
    ;;
esac
