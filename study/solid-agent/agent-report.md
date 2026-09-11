# perf-prove-it report: packed subscription edges in solid-js reactive core

Date: 2026-09-10
Sandbox: `/tmp/opencode/solid-sandbox` (git clone of solidjs/solid @ `5dc898a`, clean except the patch)
Unit: `packages/solid/src/reactive/signal.ts` - one code unit (subscription-edge representation)
Verdict: **win** (repo benchmark, paired median −14.6%, 18/20 blocks, p = 4.0e-4; A/A control p = 0.115)

---

## 1. Step 1 ledger and target line

### The unit

Every time a computation (memo, computed, effect) reads a signal/memo for the first time in a run,
`readSignal` records a directed edge on both sides so that a later `cleanNode` can remove it in
O(1):

- computation side: `sources[i]` = signal, `sourceSlots[i]` = the computation's index in that
  signal's observer list;
- signal side: `observers[j]` = computation, `observerSlots[j]` = that computation's index in its
  own source list.

The baseline allocates **two parallel arrays per side** on first subscription.

| operation | source (baseline) | per-edge count | allocation |
| --- | --- | --- | --- |
| computation records source | `Listener.sources = [this]` | 1 JSArray + 1 FixedArray[1] | 48 B |
| computation records slot | `Listener.sourceSlots = [sSlot]` | 1 JSArray + 1 FixedArray[1] | 48 B |
| signal records observer | `this.observers = [Listener]` | 1 JSArray + 1 FixedArray[1] | 48 B |
| signal records slot | `this.observerSlots = [cSlot]` | 1 JSArray + 1 FixedArray[1] | 48 B |
| **total per edge** | | **8 objects** | **192 B** |

The slot arrays and the reference arrays are always pushed, popped, and swap-updated together
(`readSignal` subscribe, `cleanNode` swap-remove). The floor is one array per side with the pair
packed in it: 2 JSArray + 2 FixedArray[2] = 4 objects, 112 B. `--print-bytecode` agrees the four
sites are unconditional on the subscription path.

### Target line

> first subscription edge: **2 array literals instead of 4**, each `[reference, slot]` packed, zero
> extra calls, zero extra branches on the update path; identical on every reactive graph the
> callers in this repo build (all `readSignal` callers are inside `signal.ts`); external code that
> reads `SignalState.observers` / `Computation.sources` element-wise is out of scope (not exported
> from `solid-js`).

### Identity envelope

- Callers of the changed fields: only `signal.ts` itself (`readSignal`, `cleanNode`, `lookUpstream`,
  `markDownstream`, `writeSignal`). Nothing in `web/`, `store/`, `render/`, `server/` touches
  `.sources` / `.observers` element-wise (grep over `packages/solid/src`).
- Adversarial edges tested: duplicate read of the same signal by one computation; read order
  `A, B, A`; non-last observer removal via individual root disposal; multiple observers on one
  signal; dependency-set change on re-run; memo root disposed while a computation still subscribes;
  20-way fan-out with interleaved disposal; nested roots; post-dispose setters. All identical
  (`final/edges-*.json`, `diff-*.json`).
- Known divergence class: none in-process. Only direct introspection of the internal packed arrays
  (devtools-style consumers of unexported types) would see a different layout.

### Counts that moved (static, Ignition)

| function | bytecode before | bytecode after | `arr[]` sites before | after |
| --- | --- | --- | --- | --- |
| `readSignal` | 458 B | **372 B** | **4** | **2** |
| `cleanNode` | 359 B | 366 B | 0 | 0 |

Raw before (4 sites, `FixedArray[1]`):

```text
0x... @  207 : 84 0c 19 25  CreateArrayLiteral [... <FixedArray[1]>>], FBV[25], #25
0x... @  231 : 84 0d 1e 25  CreateArrayLiteral [... <FixedArray[1]>>], FBV[30], #25
0x... @  302 : 84 10 2d 25  CreateArrayLiteral [... <FixedArray[1]>>], FBV[45], #25
0x... @  326 : 84 11 32 25  CreateArrayLiteral [... <FixedArray[1]>>], FBV[50], #25
```

Raw after (2 sites, `FixedArray[2]`):

```text
0x... @  228 : 84 0c 1d 25  CreateArrayLiteral [... <FixedArray[2]>>], FBV[29], #25
0x... @  279 : 84 0e 26 25  CreateArrayLiteral [... <FixedArray[2]>>], FBV[38], #25
```

Source tie: before, the four sites are `sources = [this]`, `sourceSlots = [sSlot]`,
`observers = [Listener]`, `observerSlots = [cSlot]`; after, `sources.push(this, sSlot)` /
`Listener.sources = [this, sSlot]` and `observers.push(Listener, cSlot)` /
`this.observers = [Listener, cSlot]` (`signal.ts:1321-1328`).

Dynamic churn (independent probe, same protocol both arms): 400 000 first subscriptions,
`heapUsed` growth over the window, seeded in one process:

```text
before: churn 181.0 MB
packed: churn 136.8 MB   (-24.4%)
```

Sibling: no sibling was built; the baseline bundle is the sibling and every number below is
before-vs-after on the same machine and bundle layout.

---

## 2. Backend evidence

Harness runtime: `node v26.8.2`, `process.versions.v8 = 14.6.202.34-node.28`, `process.arch = x64`,
16 cores. Target runtime: Node (this repo's benchmark is a Node harness; no browser tier measured -
no browser claim).

Natural tier-ups in the repo benchmark after the change (unforced, `reason: hot and stable`):

```text
[completed optimizing <JSFunction readSignal ...> (target TURBOFAN_JS)]
[completed optimizing <JSFunction cleanNode ...> (target TURBOFAN_JS)]
[completed optimizing <JSFunction createComputation ...> (target TURBOFAN_JS)]
[completed optimizing <JSFunction runComputation ...> (target TURBOFAN_JS)]
[completed optimizing <JSFunction runTop ...> (target TURBOFAN_JS)]
[completed optimizing <JSFunction updateComputation ...> (target TURBOFAN_JS)]
```

Same functions reach `TURBOFAN_JS` in the before arm (`opt-before.txt`). Forced lines exist only
for the benchmark harness functions and are labeled capability, not production tiering:

```text
[manually marking <JSFunction createComputations1to1 ...> for optimization to TURBOFAN_JS, ConcurrencyMode::kSynchronous]
```

No bailouts of the changed functions appear in either arm's `--trace-deopt` run. The win does not
depend on a tier: it removes allocations, which are paid at Ignition, Sparkplug, and Maglev alike;
TurboFan escape analysis cannot delete them because the arrays escape into the graph.

---

## 3. Behavior proof

- Repo tests: `pnpm --filter solid-js test` → **27 files / 487 tests passed** (jsdom) and
  **1 file / 4 tests passed** (server), exit 0. Log: `/tmp/v8bench-solid/final/tests.log`.
  The vitest config aliases `solid-js` to `packages/solid/src`, so the suite builds the patched
  source, not dist (`vite.config.mjs`).
- Differential identity: seeded mixed workload (signals, memos, computed, effects, batch, untrack,
  nested roots, disposal) run in separate processes against both bundles - 7 seeds, transcripts
  2400-2781 bytes, **0 mismatches** (`diff-before-<seed>.json` vs `diff-packed-<seed>.json`).
  Targeted edge harness (non-last observer removal, duplicate reads, A/B/A order, memo disposal,
  dependency swap, 20-way fan-out) - **identical** (`final/edges-*.json`).
- `pnpm --filter solid-js test-types`: fails with **297 errors on pristine HEAD and the same 297
  errors with the patch** (missing generated `types/`; the repo requires `pnpm types` first).
  Not a regression (`test-types.log` vs `test-types-baseline.log`; second `signal.ts` error is the
  same pre-existing `resolveChildren` `never[]` error, line-shifted 1791→1786).
- Other workspace tests: `babel-preset-solid` passes; `test-integration` fails on missing
  `packages/test-integration/node_modules` (environment, pre-existing, unrelated).

Identity claim: **identical on the reactive graph domain built by the repo's callers and test
suite plus the seeded/adversarial corpora above; no divergence observed; the only reachable
divergence is direct element-wise introspection of the unexported internal pair arrays.**

---

## 4. Speed and memory

Protocol: one benchmark process per run (`node --allow-natives-syntax bench/bench.cjs` in
`packages/solid`, arm bundle copied to `packages/solid/dist/solid.cjs` before each run), per skill;
20 runs per arm, order alternated A/B then B/A to cancel drift. Benchmark file untouched
(sha256 `packages/solid/bench/bench.cjs` =
`27ad85bbbb87a05b74afbe55c6071919b2240b350c2cd3b02e736943c3d9094b`; `git status` shows only
`packages/solid/src/reactive/signal.ts` modified).

Machine header and load during the final A/B (from raw logs): load `6.0 / 3.8 / 2.9` on 16 cores;
same machine, same commit, same clock window for both arms.

### A/A control (same bundle both arms, 20 pairs)

| metric | arm A median | arm B median | paired median Δ | B faster | sign test |
| --- | --- | --- | --- | --- | --- |
| total (ms) | 400 | 428 | **+13.5 ms (+3.4%)** | 6/20 | p = 0.115 |

Per-bench phantom deltas up to +51% on single rows; total is null. This is the resolution floor:
single-bench medians are bimodal, so this report judges on the total and on paired deltas.

### A/B (before vs packed, 20 pairs)

Raw totals, before:
`369,335,397,393,460,462,422,340,461,434,431,358,389,398,366,356,306,401,341,354` (median 391)
Raw totals, packed:
`260,338,381,287,317,351,409,277,383,380,347,348,307,344,317,267,309,341,326,353` (median 339.5)

| metric | before | packed | paired median Δ | faster blocks | sign test |
| --- | --- | --- | --- | --- | --- |
| **total (ms)** | **391** | **339.5** | **−57 ms (−14.6%)** | **18/20** | **p = 4.0e-4** |

Per-bench paired deltas (median, sign test):

```text
createComputations1to8      -9.5 ms  (-41.3%)  p=1.9e-6
createComputations1to1000  -10.0 ms  (-47.6%)  p=1.9e-6
createComputations2to1     -12.0 ms  (-38.7%)  p=4.0e-5
createComputations1to1      -5.0 ms  (-21.7%)  p=0.115
createComputations1to4      -4.0 ms  (-16.0%)  p=0.115
createComputations1to2      -1.5 ms  ( -7.7%)  p=0.012
createComputations1000to1   -1.0 ms  ( -4.7%)  p=1.0
createDataSignals            0.0 ms  (  0.0%)  p=0.041
updateComputations1to1      -1.5 ms  ( -4.5%)  p=0.263
updateComputations1000to1   -2.0 ms  ( -5.2%)  p=0.012
updateComputations1to2      -1.5 ms  ( -6.3%)  p=0.012
updateComputations4to1      -1.0 ms  ( -5.3%)  p=0.263
updateComputations1to4      +0.5 ms  ( +2.4%)  p=0.503
updateComputations1to1000   -2.0 ms  (-10.0%)  p=0.824
```

Replication (earlier A/B blocks, unpaired total medians): +15.4% and +20.5% in packed's favor.
Packing does not add or remove update-path allocations; the small update-row deltas are
consistent with the smaller create-phase heap carrying into later benches in the same process.

### Memory

- Peak RSS (wrapper `bench-mem.cjs`, 5 runs/arm, `process.resourceUsage().maxRSS`):
  before `348628, 348632, 333084, 349288, 333348` kB → median **348 628 kB**;
  packed `307288, 337248, 307700, 307580, 308584` kB → median **307 700 kB** (**−11.7%**).
- Scavenges per full benchmark run: before median **60** (`60,61,39,60,39`), packed median **32**
  (`32,52,32,32,32`) - allocation rate halved as expected.
- Major GC count: 36 in both arms (the harness's forced `%CollectGarbage(null)` calls).
- Total GC time (trace sum, noisy): before median 435.6 ms, packed median 273.7 ms; max pause
  printed as 0.00 ms in both (main-thread pause column).
- Churn vs retained: all numbers above are churn (no forced-GC snapshot was used for a retained
  claim). `--heap-prof` on this Node 26 build samples only startup allocations for these
  workloads, so the allocation claim is backed by the create-probe heap growth and scavenge counts,
  labeled churn (`/tmp/v8bench-solid/gcc-*.log`, `mem-*.log`).

---

## 5. The trade

- Bytecode: `readSignal` 458 → 372 B; `cleanNode` 359 → 366 B; net −79 B across the touched hot
  functions. `readSignal` lost two `CreateArrayLiteral` sites; `cleanNode` gained 7 bytes of
  stride-2 swap arithmetic.
- Object layout: `SignalState` and `Computation` each lose one property (8 B/instance), which is
  the other half of the churn and RSS reduction.
- Source delta: +28 / −33 lines, one file, no new module-level state, no new branch on the update
  path, no cold-start work.
- Cost: internal field representation changed; every in-tree consumer was migrated in the same
  patch (the only consumer is `signal.ts`); `SignalState`/`Computation` are not re-exported from
  `solid-js`'s entry point, but devtools that import them via deep paths would need the same
  stride-2 change. Update-path rows show small non-negative deltas at worst (within the A/A
  spread).
- Deliberately not optimized: the update path's per-write allocations (`Updates` backing store),
  documented as the rejected candidate below.

---

## 6. The revert

Command: `git checkout -- packages/solid/src/reactive/signal.ts` (restores git blob `ccce841`,
sha256 `781e091209edcbca5862c15674bf7a3c0d43e40f9ec96be8b6f0bda792318dbc`), or
`git apply -R /tmp/opencode/solid-sandbox/agent.patch`.

Dry-run output:

```text
$ git apply --check -R agent.patch          # against patched tree
REVERSE APPLY OK
$ git stash push -- packages/solid/src/reactive/signal.ts
$ git apply --check agent.patch             # against pristine HEAD
FORWARD APPLY OK
```

Patch: `/tmp/opencode/solid-sandbox/agent.patch` (148 lines, 1 file, +28/−33).
Patched source sha256: `28196ad142dbfd3918d3c81db5753bbace5eecf4d283c6978b2e658a19364652`.
Built bundle sha256: `41be471669ebd2048def98226877418c3540979e9445d4d1dc42d639055de476`
(`packages/solid/dist/solid.cjs`, reproducible from the patched source).
Baseline bundle sha256: `24bbf7a129e16b70811f1eb7e5970439248533e9a2eaee5b3492ccaa98704add`.

---

## 7. One machine read

```text
readSignal before: 4 x "CreateArrayLiteral [... <FixedArray[1]>>]"  (two reference arrays + two slot arrays)
readSignal after:  2 x "CreateArrayLiteral [... <FixedArray[2]>>]"  (one [reference, slot] pair per side)
-> each subscription edge now builds two two-element arrays instead of four one-element arrays.
-> 4 fewer objects and 80 fewer bytes per edge; measured churn -24.4%, peak RSS -11.7%, total benchmark -14.6% (paired).
```

Optimizer paragraph: V8 climbs Ignition → Sparkplug → Maglev → TurboFan while a function stays hot;
`readSignal` and `cleanNode` reached TurboFan with `reason: hot and stable` in the production run.
This win does not depend on that tier: the removed objects are allocated on the first subscription
at every tier, and TurboFan cannot escape-analyze them away because they are stored into the
reactive graph. Anything that adds a field to the signal or computation shape (for example
reintroducing the slot arrays) would restore the churn; a future deopt does not erase the win, it
only slows the surrounding arithmetic.

---

## 8. Remaining spikes

- Update path (`writeSignal` → `runUpdates` → `runTop` → `updateComputation`): still allocates the
  `Updates` queue backing store per top-level write (≈176 B/set). Attempted and rejected - see
  below. Reopen only with a scalar single-observer fast path that keeps the reentrancy guard.
- `cleanNode` grew 7 bytes; if a future change makes it hot in a different shape (deep observer
  lists with many non-last removals), re-check.
- Browser tier was not measured; the benchmark is Node-only, so no browser claim is made.

---

## Rejected candidate: update-path allocation elimination (Unit A)

Built and measured, then reverted. Changes: hoist the `writeSignal` observer-marking closure into a
module-level `markObservers` called through `runUpdates(fn, init, arg)`; reuse the `Updates` array
across cycles; allocate `Effects` lazily behind an `InUpdate` flag; allocate `runTop`'s ancestor
list only when stale ancestors exist.

Numbers (probe mirroring `updateComputations1to1`, 5 000 000 sets, `--trace-gc` windowed to the
measured loop):

| metric | before | Unit A |
| --- | --- | --- |
| scavenges in window | 2160 | 1218 (−44%) |
| GC ms in window | 59.8 | 31.7 (−47%) |
| ns/op | 81-85 | 82-84 (parity) |

Repo benchmark before vs Unit A (20 pairs, paired medians): `updateComputations1to1` **−12.9%**
(i.e. slower), `updateComputations2to1` −9.1%, total −0.8% (parity). The allocation reduction did
not survive the benchmark; added per-write call/branch work outside the GC-bound sections offset
it. Verdict: rejected, kept out of the patch. Raw logs: `/tmp/v8bench-solid/{gcu-*,benchgc-*}`.

Artifacts were produced by `/tmp/v8bench-solid/signal.ts.unitA` (sha256
`3c907ace265d8bb7c23f56bfe28c3d488243e999150aa3165cea266bcf13fc11`); probe and runner sources
are copied to `final/probe-*.cjs`.

---

## 9. Raw artifact paths

Benchmark (all under `/tmp/v8bench-solid/`):

- Raw per-run stdout: `final/raw/aa-ctrlA-run{0..19}.txt`, `final/raw/aa-ctrlB-run{0..19}.txt`,
  `final/raw/ab-before-run{0..19}.txt`, `final/raw/ab-packed-run{0..19}.txt`
- Summaries: `final/raw/aa-summary.json`, `final/raw/ab-summary.json`
- Consoles: `final/aa-console.txt`, `final/ab-console.txt`
- Paired analysis: `final/aa-paired.txt`, `final/ab-paired.txt` (`/tmp/v8bench-solid/paired.mjs`)
- Runner: `/tmp/v8bench-solid/ab-bench.mjs` (alternating order, one process per run)

Evidence:

- Bytecode dumps: `final/bytecode-{before,packed}-{readSignal,cleanNode}.txt`
- Tier traces: `final/opt-{before,packed}.txt` (filtered `--trace-opt`)
- Memory: `final/mem-{before,packed}-{1..5}.log`, wrapper `final/bench-mem.cjs`
- Churn probes: `final/gcc-{before,packed}-{1..3}.log` (`final/probe-create.cjs`),
  `probe-update.cjs` for the update path
- Differential: `final/` + `/tmp/v8bench-solid/diff-{before,packed}-<seed>.json` (seeds 1,7,1234,
  99999,424242,31337,2026), `final/edges-{before,packed}.json`
- Tests: `final/tests.log`, `final/test-types.log`, `final/test-types-baseline.log`,
  `final/workspace-tests.log`
- Arms: `final/arms/{before,packed}-solid.cjs`; source snapshots `signal.ts.orig`,
  `signal.ts.packed`, `signal.ts.unitA`
- Environment: node v26.8.2, V8 14.6.202.34-node.28, x64, 16 cores; benchmark command
  `node --allow-natives-syntax bench/bench.cjs` from `/tmp/opencode/solid-sandbox/packages/solid`.
