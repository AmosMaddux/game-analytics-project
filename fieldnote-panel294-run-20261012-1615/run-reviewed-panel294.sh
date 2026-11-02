#!/bin/bash
set -euo pipefail
cd -- "$(dirname -- "$0")"
exec node qualification-panel294.mjs --advance \
 --state /workspaces/codespaces-blank/fieldnote-redesign-stage-20261011/pilot-20261011-1746/fieldnote-source-budget-2026-10.json \
 --panel ./panel-294-frozen.json \
 --campaign /workspaces/codespaces-blank/fieldnote-keyless-addendum-20261012-1545/qualification-campaign-785-live.json \
 --validation ./passed-sentinel-evidence.json \
 --validation-sha a8efd1423272343178ed1813ad03660a18e74169f032c0e06fceb90bd2e40b6f \
 --as-of 2026-10-12T00:00:00Z \
 --approve-panel294-sha dc3840a01e9d68b2e0f7ecef873ecba6fa6430eb847595eacd01e7d4e932e3b9 \
 --output ./panel-metrics-294-live.json
