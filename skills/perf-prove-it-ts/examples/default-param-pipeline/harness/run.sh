#!/usr/bin/env bash
# Regenerates every artifact in ../artifacts from the two arms.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p ../artifacts

# Step 0: the profile that chooses the unit. A longer run so the sampler has room.
ITERATIONS=20000000 node --cpu-prof --cpu-prof-dir=../artifacts --cpu-prof-name=default.cpuprofile arm-default.mjs > /dev/null
node profile-summary.mjs ../artifacts/default.cpuprofile > ../artifacts/profile-summary.txt

# Step 4: the census, one dump per arm.
node --print-bytecode --print-bytecode-filter=withDefault arm-default.mjs > ../artifacts/bytecode-default.txt 2>&1
node --print-bytecode --print-bytecode-filter=withHoisted arm-hoisted.mjs > ../artifacts/bytecode-hoisted.txt 2>&1
node ../../../scripts/census.mjs ../artifacts/bytecode-default.txt > ../artifacts/census-default.txt
node ../../../scripts/census.mjs ../artifacts/bytecode-hoisted.txt > ../artifacts/census-hoisted.txt

# Step 3: backend evidence.
node --trace-opt arm-default.mjs > ../artifacts/trace-opt-default.txt 2>&1
node --trace-opt arm-hoisted.mjs > ../artifacts/trace-opt-hoisted.txt 2>&1
node --trace-deopt arm-default.mjs > ../artifacts/trace-deopt-default.txt 2>&1
node --trace-deopt arm-hoisted.mjs > ../artifacts/trace-deopt-hoisted.txt 2>&1

# Step 6: allocation rate, three runs per arm.
for arm in default hoisted; do
  for run in 1 2 3; do
    node --trace-gc arm-$arm.mjs > "../artifacts/gc-$arm-run$run.txt" 2>&1
  done
  printf '%s scavenges per run: ' "$arm"
  for run in 1 2 3; do
    count=$(grep -c Scavenge "../artifacts/gc-$arm-run$run.txt" || true)
    printf '%s ' "$count"
  done
  echo
done
