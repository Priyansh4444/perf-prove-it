# Static-audit harvest result

Every extracted rewrite was behavior-identical to the original
(`verify.mjs`: randomized inputs across both profiles plus hand-built edges;
one real ordering bug in the first `retainMessages` rewrite was caught and
fixed before timing). All measurements are paired medians over separate
processes per arm, with an A/A control.

Environment: Node `v24.21.0`, V8 `13.6.233.17-node.53`, Linux x64, 16 cores,
load average < 1.5. Raw run: `bench.ndjson` / `run.sh`.

## Measured (paired median ratio, 7 trials)

| case | profile | before ns/call | after ns/call | speedup | A/A median |
| --- | --- | ---: | ---: | ---: | ---: |
| `orderWindow` | realistic | 1,157.9 | 153.4 | **7.34×** | 1.005 |
| `orderWindow` | scaled | 759,993.7 | 73,376.2 | **10.0×** | 1.007 |
| `sortedMembers` | realistic | 407.7 | 276.6 | **1.43×** | 0.985 |
| `sortedMembers` | scaled | 637,815.5 | 123,722.0 | **4.72×** | 0.997 |
| `hubCredits` | realistic | 11,464.7 | 3,607.3 | **2.71×** | 1.046 |
| `hubCredits` | scaled | 10,799,679.7 | 522,087.0 | **21.0×** | 0.973 |
| `runningTerminalIds` | realistic | 534.8 | 410.0 | **1.33×** | 0.976 |
| `runningTerminalIds` | scaled | 11,805,064.5 | 7,158,330.8 | **1.71×** | 0.993 |
| `retainMessages` | realistic | 10,988,431.3 | 1,400,546.3 | **7.75×** | 1.071 |
| `retainMessages` | scaled | 416,084,858 | 20,892,345.8 | **11.0×** | 1.000 |

`retainMessages` realistic was re-run with 11 trials (A/A 1.071). The first
7-trial pass had an A/A median of 1.243; the result is reported from the
cleaner pass.

## The real comparator makes it larger

The harness's `parseTimestamp` replica is behaviorally identical to T3 Code's
effect-based one (encoded: 0 sign mismatches across 1,004,004 pairs, including
malformed and impossible dates) but is **2.8× cheaper** per call (514 vs 1438
ns). Running the rewrite against the real
`packages/shared/src/dateTime.ts` comparator:

| profile | real-comparator before | after | speedup | comparator calls |
| --- | ---: | ---: | ---: | ---: |
| realistic (2,000 msgs) | 10.000 ms | 0.678 ms | **14.7×** | 9,037 |
| scaled (50,000 msgs) | 397.386 ms | 17.472 ms | **22.7×** | 335,982 |

So the replica numbers above are a conservative floor on the real-world win.

## Work models, checked

- `orderWindow` scaled: 3,200 windows, ≈37k comparator calls → 3,200 reads.
- `sortedMembers` scaled: 400 accounts → ≈3,457 comparisons, each running a
  linear `find` over 8 windows plus `Date.parse` → 400 finds + 400 parses.
- `hubCredits` scaled: 2,000 matching accounts, ≈21.9k comparisons with **two
  `Date.parse` per comparison** (≈43.9k parses) → 2,000 parses, running max.
- `runningTerminalIds` scaled: 200k filter callbacks + ~70k map callbacks and
  one intermediate array → 200k iterations + 70k pushes.
- `retainMessages` scaled: 335,982 comparisons × 2 `parseTimestamp` →
  one parse per candidate plus numeric comparisons.

## Bytecode and tier evidence

`census.mjs` on Ignition bytecode:

| function | closures | other constructions | bytecode length |
| --- | ---: | ---: | ---: |
| `runningTerminalIdsBefore` | 2 | 0 | 32 |
| `runningTerminalIdsAfter` | 0 | 1 output array | 151 |
| `orderWindowBefore` | 2 | 0 | 37 |
| `orderWindowAfter` | 0 | 0 | 312 |

`--trace-opt` shows both arms climbing MAGLEV → `TURBOFAN_JS`. A
`--trace-deopt` pass (which the first write-up skipped) shows the rewrites are
*not* deopt-free, and corrects the earlier "no bailout lines" claim:

- `retainMessagesAfter` takes 3 `exit from OSR'd inner loop` bailouts from
  MAGLEV where `retainMessagesBefore` takes none. The win holds after
  re-optimization, but the candidate-collection loop reaches TurboFan only
  through OSR and deopts on loop exit.
- `hubCreditsBefore` takes one `wrong map` bailout on the target function, so
  the measured before may be pessimistic: the 21× is an upper bound, not a
  floor.
- The `orderWindow` bailouts are on unnamed harness/workload functions at a
  shared bytecode offset, not on the target function.

The bytecode grew where callbacks were inlined (cold-tier compile cost), the
closure sites went to zero, and the timings improved anyway.

## Reachability: how much is harvestable in the product

The mechanism is real for all five. Materiality is decided by the input the
call site actually sees, which the scanner cannot know:

| site | callers | realistic input | material |
| --- | --- | --- | --- |
| `collectLimitPools` (`orderWindow`, `sortedMembers`) | web `UsageLimitsPooled.tsx`, mobile usage widgets | accounts per driver, typically 1–5 | no — ~1 µs/render |
| `collectProviderUsageLimits` (`hubCredits`) | web `ChatView.tsx` (memoized), mobile thread/composer | `key` filters to ~1 hub account | no — sort is over ~1 element |
| `selectRunningSubprocessTerminalIds` | web `terminalSessions.ts` | open terminals, small | no — ~0.1 µs |
| `retainMessagesAfterRevert` | `threadReducer.ts:612` on `thread.reverted` | messages per thread can be large | **maybe** — see below |

**Harvest:** four of the five are correct but immaterial at production input
sizes; shipping them is optional cleanup. The one worth a PR is
`retainMessagesAfterRevert`: on a 2,000-message thread it drops from ~10 ms to
~0.7 ms (~15×), and the cost grows super-linearly with message count because
every comparison re-parses two timestamps. That is a user-felt jank on revert
if real threads reach the thousands. The missing evidence is production
message-count distribution; without it this stays a proven mechanism, not a
shipped win.

## Costs and revert path

- `orderWindow` / `runningTerminalIds`: replace a declarative chain with a
  small loop; bytecode grows (37→312, 32→151) as callbacks inline. Revert is a
  one-hunk restore.
- `sortedMembers`: adds a per-call `prepared` array of M small objects, trading
  allocation for cached comparator keys. Measured faster even at M=4.
- `hubCredits`: imperative scan must preserve the stable-sort tie-break and the
  invalid-date ordering; `verify.mjs` covers both.
- `retainMessages`: adds a decorated candidate array (one object per candidate)
  per role per revert and a local comparator; the `id.localeCompare` tie-break
  must be kept (the bug the differential test caught).

## Skill gap this harvest exposed

The scanner surfaced every site, but the repeated expensive work *inside a
comparator* — `Date.parse`, `.find`, `parseTimestamp` — is not named by any
rule. `sortedMembers` only gets the generic advisory `sort-callback`;
`retainMessages` gets `sort-callback` + the new `full-sort-then-take`. Those
two cases are the largest wins in the study (4.7×–22.7×). A
`comparator-repeated-work` rule (score ~7, advisory) that inspects the
comparator body for `Date.parse` / `.find(` / `localeCompare`-plus-parse would
have pointed straight at them. That is the highest-leverage follow-up.
