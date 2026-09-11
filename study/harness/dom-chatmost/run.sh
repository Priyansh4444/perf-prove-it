#!/usr/bin/env bash
# Build or measure the dom-chatmost harness.
#   ./run.sh build-before          build arm-before (pristine chatmost working tree)
#   ./run.sh build-after           build arm-after
#   ./run.sh measure final 3       serve both arms + run CDP measurement
set -euo pipefail
H=/home/pronsh/Coding/perf-prove-it/study/harness/dom-chatmost
VITE=/home/pronsh/Coding/chatmost/node_modules/.bin/vite
PORT=${HARNESS_PORT:-8017}
SERVE=$H/evidence/serve

case "${1:?usage: run.sh build-before|build-after|measure [mode] [rounds]}" in
  build-before|build-after)
    ARM=${1#build-}
    mkdir -p "$SERVE/$ARM"
    (cd "$H" && HARNESS_ARM="$ARM" HARNESS_OUT="$SERVE/$ARM" "$VITE" build --config "$H/vite.config.ts" --logLevel warn)
    ;;
  measure)
    MODE=${2:-final}
    ROUNDS=${3:-3}
    python3 -m http.server "$PORT" --directory "$SERVE" >/dev/null 2>&1 &
    SRV=$!
    trap 'kill $SRV 2>/dev/null || true' EXIT
    sleep 1
    HARNESS_BASE="http://127.0.0.1:$PORT" node "$H/measure.mjs" "$MODE" "$ROUNDS"
    ;;
  *)
    echo "usage: run.sh build-before|build-after|measure [mode] [rounds]" >&2
    exit 2
    ;;
esac
