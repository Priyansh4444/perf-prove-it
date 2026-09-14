# T3 Code static-audit harvest

Turns the static-audit candidates found in T3 Code (`packages/shared`,
`packages/client-runtime`) into measured before/after pairs, so the scanner's
work models can be checked against a clock instead of trusted.

The scanner lives at `skills/perf-prove-it-ts/scripts/static-audit.mjs`. The
candidates are extracted verbatim from T3 Code commit
`66e39ca2` (`https://github.com/pingdotgg/t3code`); only module imports are
replaced with local equivalents so the arms run on plain Node. The T3 Code
sources were read, never edited; `.repos/` is a read-only vendored checkout.

## What is measured

| case | source | rule family | rewrite |
| --- | --- | --- | --- |
| `orderWindow` | `usageLimits.ts:316-318` | `full-sort-then-take` | sort-then-`[0]` → one linear minimum scan |
| `sortedMembers` | `usageLimits.ts:319-330` | repeated work in a comparator | hoist `find` + `Date.parse` out of the sort comparator |
| `hubCredits` | `usageLimits.ts:566-578` | `chained-collection-passes` + `full-sort-then-take` + repeated parse | flatMap+filter+sort+take → one fused pass, one parse per element, running max |
| `runningTerminalIds` | `terminalSession.ts:58-64` | `chained-collection-passes` | `filter().map()` → one loop |
| `retainMessages` | `threadReducer.ts:818-861` | repeated work in a comparator + `full-sort-then-take` | cache `parseTimestamp` per candidate instead of parsing inside the comparator |

## Method

1. `verify.mjs` — differential equivalence. The rewrite must match the
   extracted original on randomized inputs across both profiles and on
   hand-built edges (empty inputs, `undefined` order window, `null` key,
   missing/invalid dates, ties, count-vs-existence). A real ordering bug in the
   first `retainMessages` rewrite was caught here, not in timing.
2. `arm.mjs` — one implementation per process. Builds a deterministic workload,
   masks compile cost, auto-calibrates iterations to run long enough to clear
   the timer.
3. `bench.mjs` — paired A/B. Per trial it spawns, in separate Node processes,
   the before arm, the after arm, and an A/A control (before twice). Order
   alternates. The headline is the median of the per-trial ratios; a delta
   inside the A/A band is rejected as noise.

No two bundles share a V8 isolate (`references/benchmark-protocol.md`). The
workloads are deterministic, so both arms receive the identical object graph.

## Profiles

`realistic` approximates what the product sees at the cited call sites;
`scaled` raises the input so the asymptotic work model is observable.

## Reproduce

```sh
./run.sh
# or
node verify.mjs
HARVEST_TRIALS=7 node bench.mjs | tee bench.ndjson
```

Environment: Node `v24.21.0`, V8 `13.6.233.17-node.53`, Linux x64, 16 cores,
load average under 1.5 during the recorded run.

## Caveat

These are extracted-function probes, not the shipped bundle. They prove the
mechanism and the per-call cost on a controlled input; they do not by
themselves prove product impact. Reachability and input bounds are argued in
`RESULTS.md` from the call sites.
