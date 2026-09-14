#!/usr/bin/env sh
# Reproduce the static-audit harvest: equivalence first, then paired timing.
set -eu
cd "$(dirname "$0")"
node verify.mjs
HARVEST_TRIALS="${HARVEST_TRIALS:-7}" node bench.mjs
