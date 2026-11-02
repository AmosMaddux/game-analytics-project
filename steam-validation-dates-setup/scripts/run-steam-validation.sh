#!/usr/bin/env bash
# Never source a config file, enable tracing, or accept authentication options.
set +x
set -eu
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
NODE_BIN="$(type -P node || true)"
if [[ -z "$NODE_BIN" ]]; then printf '%s\n' 'Node.js 24.5+ is required. Nothing was installed or requested.' >&2; exit 2; fi
unset NODE_OPTIONS NODE_DEBUG NODE_DEBUG_NATIVE SSLKEYLOGFILE NODE_TLS_REJECT_UNAUTHORIZED NODE_EXTRA_CA_CERTS
exec "$NODE_BIN" "$SCRIPT_DIR/launch.mjs" "$@"
