# Full pipeline: one closure in a default parameter

This directory is the whole loop on one small unit: the harness files, every command, and the real tool output at each step. The blocks below are the artifact files from one run, not summaries. Counts repeat exactly; profiles and per-event durations drift, so the files on disk are the latest run. Regenerate everything with `bash harness/run.sh`. All commands run from `harness/`.

Runtime for every number here: Node v26.8.2, V8 14.6.202.34-node.28, Linux x64.

## The files

```text
harness/
  arm-default.mjs        the version with the inline default
  arm-hoisted.mjs        the one-line fix
  profile-summary.mjs    turns a .cpuprofile into a table
  run.sh                 writes everything under artifacts/
artifacts/               every raw output quoted below
```

## Step 0: choose the unit

The sampler needs time, so this profile runs 20x the measured workload. The counts in the later steps stay at 1M calls, fixed work for both arms.

```sh
ITERATIONS=20000000 node --cpu-prof --cpu-prof-dir=../artifacts --cpu-prof-name=default.cpuprofile arm-default.mjs
node profile-summary.mjs ../artifacts/default.cpuprofile
```

`artifacts/profile-summary.txt`:

```text
withDefault                      42  31.6%
(garbage collector)              32  24.1%
evaluate                         25  18.8%
cb                               15  11.3%
(anonymous)                      13   9.8%
(idle)                            2   1.5%
getCLIOptionsFromBinding          1   0.8%
readSync                          1   0.8%
total samples 133
```

Inspect: `withDefault` plus its callback `cb` hold 42.9% of samples, GC holds 24.1%, and the top-level loop shows up as `evaluate`. The unit is `withDefault`. Stop profiling.

## Step 1: the floor

The function calls a callback once and returns. When the caller omits the callback, there is nothing to do. Target line: "1M calls with the second argument omitted: one shared callback, zero closures built, one call per iteration."

## Step 2: the harness

`harness/arm-default.mjs`:

```js
const ITERATIONS = Number(process.env.ITERATIONS ?? 1_000_000)

function withDefault(value, cb = () => null) {
  return cb(value)
}

let sink = 0
for (let i = 0; i < ITERATIONS; i++) sink += withDefault(i) === null ? 1 : 0
console.log(sink)
```

`harness/arm-hoisted.mjs`:

```js
const ITERATIONS = Number(process.env.ITERATIONS ?? 1_000_000)
const noop = () => null

function withHoisted(value, cb = noop) {
  return cb(value)
}

let sink = 0
for (let i = 0; i < ITERATIONS; i++) sink += withHoisted(i) === null ? 1 : 0
console.log(sink)
```

One variable between the arms: where the noop lives. Each arm runs in its own process, because two bundles in one process can deoptimize each other.

## Step 3: prove the backend

```sh
node --trace-opt arm-default.mjs
```

`artifacts/trace-opt-default.txt`, `withDefault` lines:

```text
[marking ... <JSFunction withDefault ...> for optimization to MAGLEV, ConcurrencyMode::kConcurrent, reason: hot and stable]
[compiling method ... <JSFunction withDefault ...> (target MAGLEV), mode: ConcurrencyMode::kConcurrent]
[completed compiling ... <JSFunction withDefault ...> (target MAGLEV) - took 0.000, 0.550, 0.002 ms]
```

Inspect: `withDefault` reached Maglev and stayed there for these 1M calls. No TurboFan line for it, so the numbers below are Maglev numbers, not forced-tier numbers.

```sh
node --trace-deopt arm-default.mjs
```

`artifacts/trace-deopt-default.txt`:

```text
[bailout (kind: deopt-eager, reason: prepare for on stack replacement (OSR)): ... <JSFunction (sfi = ...)> ... bytecode offset 103 ...]
[bailout (kind: deopt-eager, reason: Insufficient type feedback for generic named access): ... <JSFunction (sfi = ...)> ... bytecode offset 120 ...]
```

Inspect: the deopts belong to the anonymous top-level loop, not the unit. The offset is past 120 and `withDefault` is 21 bytes long; the reason is an OSR preparation and a named-access feedback issue in the loop itself. The unit has no deopt lines.

## Step 4: the census

```sh
node --print-bytecode --print-bytecode-filter=withDefault arm-default.mjs
```

`artifacts/bytecode-default.txt`, the interesting part of the body:

```text
Bytecode length: 21
@    5 : aa 08              JumpIfNotUndefined [8]
@    7 : 8b 00 00 02        CreateClosure [0:... <SharedFunctionInfo cb>], FBV[0], #2
@   13 : 0b 04              Ldar a1
@   15 : d1                 Star1
@   16 : 6b f8 f9 00        CallUndefinedReceiver1 r1, r0, FBV[0]
@   20 : b7                 Return
```

Inspect: the default is a branch. When the second argument is not `undefined`, the jump skips the closure. When it is omitted, `CreateClosure` builds a new function object for `cb`. This is the allocation, and it lives inside the per-call body.

```sh
node ../../../scripts/census.mjs ../artifacts/bytecode-default.txt
node ../../../scripts/census.mjs ../artifacts/bytecode-hoisted.txt
```

`artifacts/census-default.txt`:

```text
function    len closures contexts arr[] obj{} re{} other
----------- --- -------- -------- ----- ----- ---- -----
withDefault 21  1        0        0     0     0    0

1 function(s), 1 closure/context construction sites
rule-based columns: closures, contexts, arrays, objects, regexps, other
```

`artifacts/census-hoisted.txt`:

```text
function    len closures contexts arr[] obj{} re{} other
----------- --- -------- -------- ----- ----- ---- -----
withHoisted 21  0        0        0     0     0    0

1 function(s), 0 closure/context construction sites
rule-based columns: closures, contexts, arrays, objects, regexps, other
```

Inspect: same 21-byte function, one closure site versus none. The hoisted arm loads a module constant in the same slots, so the bytecode size did not move.

## Step 5: close the gap

```diff
-function withDefault(value, cb = () => null) {
+const noop = () => null
+function withHoisted(value, cb = noop) {
   return cb(value)
 }
```

## Step 6: prove it again

Backend, bytecode, and allocation rate:

```sh
node --trace-opt arm-hoisted.mjs        # Maglev, same as before
node --print-bytecode --print-bytecode-filter=withHoisted arm-hoisted.mjs   # no CreateClosure
node --trace-gc arm-default.mjs         # three runs
node --trace-gc arm-hoisted.mjs         # three runs
```

`artifacts/gc-default-run1.txt`, first collection:

```text
23 ms: Scavenge 4.7 (5.6) -> 3.9 (5.9) MB, pooled: 0.0 MB, 0.21 / 0.00 ms (average mu = 1.000, current mu = 1.000) allocation failure;
```

The sizes and times inside a GC line move between runs. The count does not.

Scavenge counts, three runs each, identical every run:

| arm | run 1 | run 2 | run 3 |
| --- | ---: | ---: | ---: |
| `arm-default` | 54 | 54 | 54 |
| `arm-hoisted` | 0 | 0 | 0 |

`artifacts/gc-hoisted-run1.txt` contains one line, the arm's own output:

```text
1000000
```

Identity: both arms print `1000000` and call the callback once per iteration. Only the callback's identity changes, and nothing in the reachable code compares it.

## The report

- Floor: one shared callback, zero closures built, one call per iteration.
- Observed: one `CreateClosure` site, 54 scavenges per 1M omitted-argument calls, 0 after the fix, identical across three runs and unchanged under `--max-opt=0`.
- Backend: Maglev for the unit, no deopts in the unit.
- Cost: one module-level constant. Code that depends on a fresh callback object per call would change behavior, so check callers before applying. Revert: inline the arrow and delete the constant.
- Machine read:

```text
JumpIfNotUndefined; CreateClosure
-> the default value is evaluated on every call that omits the argument
-> 54 young-generation collections per 1M calls, 0 when the noop is hoisted
```
