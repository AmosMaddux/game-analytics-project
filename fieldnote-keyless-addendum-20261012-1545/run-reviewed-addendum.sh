#!/bin/bash
set -euo pipefail
cd -- "$(dirname -- "$0")"
exec node qualification-addendum.mjs --extend \
 --state /workspaces/codespaces-blank/fieldnote-redesign-stage-20261011/pilot-20261011-1746/fieldnote-source-budget-2026-10.json \
 --expected-ledger-sha d3ecb4525c6836638bf4a4304df6ebfb27d6dcd4320733048233123f331fd8e0 \
 --approved-plan-sha abe3776ccf43334ed8baba98603629551d304db734b544cf2105a6801a3fe66f \
 --previous-candidates campaign-fixtures/previous-candidates.json \
 --previous-source-report campaign-fixtures/previous-source-report.json \
 --previous-source-checkpoint campaign-fixtures/previous-source-checkpoint.json \
 --candidates campaign-fixtures/resumed-candidates.json \
 --source-report campaign-fixtures/resumed-candidates.json \
 --source-checkpoint campaign-fixtures/resumed-checkpoint.json \
 --validation passed-sentinel-evidence.json \
 --validation-sha a8efd1423272343178ed1813ad03660a18e74169f032c0e06fceb90bd2e40b6f \
 --output qualification-addendum-160-live.json \
 --campaign-output qualification-campaign-785-live.json \
 --joined-output qualified-candidates-785-live.json
