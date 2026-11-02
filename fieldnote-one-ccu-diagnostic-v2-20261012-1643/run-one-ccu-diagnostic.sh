#!/bin/bash
set -euo pipefail
cd -- "$(dirname -- "$0")"
sha256sum --check <<'CHECKS'
3235e4abbb64641a70313abc32b3d331236ea06b876f1553b98ee2c8e4bdf8af  collect-review-campaign.mjs
e1b8f8587c8724e0e6838bde6b3ff945c2d81dc3062764866eca40a9a16e1996  diagnose-stopped-ccu.mjs
ec7e7815a317a9d41f69657d9d09314d3cf16bd4223eb535e1906fa7e074676e  qualification-campaign.mjs
b8dd20609af67841c0f6449cef1c94ea50930670f79d6c52118022e0d004357c  validate-reviews.mjs
a8efd1423272343178ed1813ad03660a18e74169f032c0e06fceb90bd2e40b6f  passed-sentinel-evidence.json
813f92017d063604175d1ebf32af6aee3215815607a5e715271d75b34aa232a8  diagnose-stopped-ccu.test.mjs
0ca45bbca754e1a216f25b254a6c08dd8ad01d6dea57375c389f946add0a6015  stopped-ledger-fixture.json
CHECKS
exec node diagnose-stopped-ccu.mjs \
 --state /workspaces/codespaces-blank/fieldnote-redesign-stage-20261011/pilot-20261011-1746/fieldnote-source-budget-2026-10.json \
 --expected-ledger-sha 0ca45bbca754e1a216f25b254a6c08dd8ad01d6dea57375c389f946add0a6015 \
 --validation "$PWD/passed-sentinel-evidence.json"
