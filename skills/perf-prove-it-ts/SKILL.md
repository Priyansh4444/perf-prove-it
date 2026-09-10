---
name: perf-prove-it-ts
description: "Reach peak TypeScript and JavaScript performance with V8's own evidence instead of profiles. Use when code must get faster, allocate less, or stop leaking: Ignition bytecode censuses for closures and allocations, Maglev and TurboFan tier checks, deopt diagnosis, CPU profiles for discovery, heap snapshots and GC traces for leak proof, behavior-locked A/B harnesses, and swarm battle testing. Triggers: optimize this TypeScript, why is this slow, make it faster, check the bytecode, run V8 on it, too many closures, GC pressure, memory leak, heap snapshot, microbenchmark, is it deoptimizing, battle test this, peak performance."
license: Apache-2.0
---

# Perf prove it: TypeScript on V8

Write down the mathematically smallest sequence of steps the function must perform. Then make V8 show what it actually runs. Close the gap, prove behavior did not change, and disclose what the optimization cost.

Profiles are for discovery, never for the target. They find local minima and cannot tell you what should be possible. The target comes from counting the work the problem requires. The rule is Casey Muratori's: establish what the hardware could theoretically do, then do not stop until the gap is closed or explained.

## The general method

This is the skill behind the skill, and it works the same in every language:

1. Establish the floor. For the function, write down the minimum the machine must do: bytes moved, loads, stores, arithmetic, branches per element, allocations per call. That number is the target, not a guess.
2. Make the source read like those operations. If the code hides work (a callback that allocates, a spread that copies), the machine still pays for it, and you cannot see it without the compiler's output.
3. Get the compiler's real output and diff it against the floor. Every extra instruction gets an explanation or gets removed.
4. Close what the design allows, document the rest. Some distance from the floor is physics (cache, bandwidth, latency), some is the compiler, some is structure. Naming which is which is part of the job.
5. Treat measurement as a habit, not a phase. Keep a count visible while you work. Optimizing once a quarter from memory is a different, weaker skill.
6. Disclose the trade. Every win has a price in bytes, complexity, runtime shape, or readability. Show the price next to the evidence and let the user decide. Never take an unmeasured win, and never silently skip a measured one out of style habit.

When reading the machine, three questions explain most results:

- Data movement. Does the working set fit L1/L2/L3 or stream from memory? Are the accesses contiguous?
- Instruction flow. How many branches per element, are they predictable, does the hot loop stay in the instruction cache?
- Execution throughput. Which units run the operations, and is the bottleneck arithmetic, load/store, or branches?

## Step 0: choose the unit, profile only to choose

Find the hot unit with a profile, then stop profiling.

```sh
node --cpu-prof --cpu-prof-dir=/tmp/v8bench app.mjs
# open the .cpuprofile in Chrome DevTools, or parse it
```

The profile answers "where is time going". It does not answer "what should this function cost". The floor answers that. Never let a profile define the target, and never census a function the profile did not put on the critical path.

## Step 1: write the ideal

Take one hot function at a time. State the ideal in operations, not vibes:

- Per element: how many loads, stores, compares, branches? One pass or several?
- Allocations per call: which arrays/objects are required outputs, which are throwaway?
- Closures per call: how many callbacks escape or get constructed inside the loop?
- Static data: can anything be computed once at module load instead of per call?

Example target: "rerank over 200 candidates: one pass, one output array, zero per-candidate closures, three maxima computed inline, no intermediate arrays."

## Step 2: build the harness

Bundle the real modules, do not hand-copy them.

```sh
npx esbuild entry.ts --bundle --format=esm --platform=node --outfile=/tmp/v8bench/engine.mjs
# or: ./node_modules/.bin/esbuild ... ; the repo needs esbuild as a dev dependency
```

Drive the bundle from a harness. On Node 26 `%` natives parse in ESM with `--allow-natives-syntax`; older Node needs CJS. Test once and use what works.

```js
// harness.cjs or harness.mjs
async function main() {
  const E = await import("./engine.mjs");
  const xq = /* stable-shaped inputs */;
  let sink = 0;
  // Warm; raise the count until --trace-opt shows the target tier (Step 3).
  for (let i = 0; i < 20000; i++) sink += E.rerank(xq, CANDIDATES, STATS, NOW).length;
  for (const f of [E.rerank, E.tokenize]) %PrepareFunctionForOptimization(f);
  for (const f of [E.rerank, E.tokenize]) %OptimizeFunctionOnNextCall(f);
  sink += E.rerank(xq, CANDIDATES, STATS, NOW).length;
  for (const [name, fn] of [["rerank", E.rerank], ["tokenize", E.tokenize]]) {
    console.log("opt-status", name, %GetOptimizationStatus(fn));
  }
  console.log("sink", sink);
}
main();
```

Run with `node --allow-natives-syntax harness.cjs`. Warm until tier-up is observed (see Step 3), not a fixed number of calls. Record the harness environment in every report:

```sh
node -v; node -p "process.versions.v8"; node -p "process.arch"
```

Scope note: this harness is Node/V8. Bun runs JavaScriptCore and browsers cannot use `%` natives. For those, use the same floor and behavior locks, and the engine's own tools.

## Step 3: prove the backend

```sh
node --allow-natives-syntax --trace-opt harness.cjs 2>&1 | grep -E "rerank|tokenize"
```

Record what this V8 build does. Forced lines from the harness (`manually marking ... TURBOFAN_JS`) prove capability, not production tiering; a production claim also needs one unforced run where the same function shows `reason: hot and stable`. A function that stops at Maglev can still be correct for the job, say so. Deopts mean the optimized code was thrown away:

```sh
node --allow-natives-syntax --trace-deopt harness.cjs 2>&1 | grep -E "rerank|tokenize"
```

Quote the lines. Never decode `%GetOptimizationStatus` from memory; it is a version-defined bit set and `--trace-opt` is the authority.

## Step 4: run the churn census

The census measures allocation churn, not speed.

```sh
node --allow-natives-syntax --print-bytecode --print-bytecode-filter='rerank' harness.cjs \
  | node <skill-dir>/scripts/census.mjs
```

`census.mjs` lives in this skill's `scripts/` directory; call it by its absolute path from a scratch harness directory. One function per filter (`|` alternation does not match).

```text
function           closures contexts
rerank                    7        1
tokenize                  4        1
```

`CreateClosure` = a function object constructed when that instruction executes. `CreateFunctionContext` = a captured scope constructed when it executes. `CreateEmptyArrayLiteral`, `CreateObjectLiteral`, and `CreateRegExpLiteral` show throwaway temporaries.

Read it correctly:

- The count is static sites in Ignition bytecode, so a branch-guarded closure can be counted even when it rarely runs. For dynamic truth, cross-check with allocation sampling (`--heap-prof`) or a heap snapshot diff.
- Counts are deterministic for a fixed V8 build and input. They are not a speed prediction: TurboFan inlines small callbacks and escape-analyzes allocations, so the hot tier can erase what the census counted.
- Use counts to find churn and to keep the fix honest. Use tier evidence, timings, GC time, and peak RSS to judge the result.
- An allocation claim in the report is either labeled static sites or backed by a dynamic number from a heap snapshot object-count delta. Sampled profiles can miss small closures; say when evidence is sampled.

## Step 5: cut, in this order

1. Per-record closures in the hottest loop (`.some`, `.every`, `.map` callbacks) become module-level loops.
2. Fuse passes: `candidates.map(...)` then `Math.max(...rows.map(pick))` becomes one loop computing values and maxima together.
3. Spread-into-Set unions become one `Set` and one output array.
4. Hoist per-call defaults and predicates to module scope.
5. Parse static data once at module load, not per query. In serverless and edge contexts, weigh the init cost against the request cost and say which you chose.
6. Preallocated numeric scratch can be holey. `new Array(n)` filled with doubles transitions to `HOLEY_DOUBLE_ELEMENTS` and allocates a new backing store on the way. `Float64Array` is packed and transition-free when the values are internal numbers.

Take every win you can prove and disclose its cost. Do not take an unmeasured win, and do not skip a measured one out of style habit. The trade-off section of the report is where the user decides.

## Step 6: prove it again

- Assert same-result equivalence in the harness on identical inputs before believing any delta.
- Repo goldens and tests must be green. Identical behavior is the entry ticket.
- Re-run the census and `--trace-opt` after the change.
- Speed: median of 5 runs per arm, one process per arm, same machine, recorded load. Report ns/op. Never A/B two bundles in one process; dual module instances deoptimize each other (a 16x phantom win was once observed from exactly this).
- Memory: peak RSS, total GC time, and max pause are the verdict. Scavenge count is allocation rate, not harm. More scavenges with flat GC time and lower peak RSS is acceptable; a memory win fails when GC time, max pause, or major-GC time rises above the A/A noise.
- Escape analysis can delete micro-allocations, so a 0.5% timing "win" may be zero. Count constructions, do not guess.
- Report what you measured, how, and what confounded it. A noisy win sold as a win is worse than no benchmark.

## Step 7: leaks and heap snapshots

Grep is triage. A leak verdict needs heap evidence. Full commands and reading guide: `references/memory-and-heap.md`.

```sh
# allocation profile, open the .heapprofile in Chrome DevTools
node --heap-prof --heap-prof-dir=/tmp/v8bench app.mjs

# snapshot on demand or near the limit
node --heapsnapshot-signal=SIGUSR2 app.mjs
node --heapsnapshot-near-heap-limit=3 app.mjs

# GC truth
node --trace-gc app.mjs
```

Leak proof shape: run the workload, force `global.gc()` with `--expose-gc`, snapshot, repeat, compare retained size and object counts for the suspect sites. A closure leaks only when it escapes and retains: listeners on persistent nodes, timers capturing large scopes, per-call closures stored in caches, unbounded module-level `Map`/`Set`, detached buffers, and growing worker or stream queues.

## Battle test with a swarm

Peak performance is a swarm result, not a single pass.

1. Slice (orchestrator). One function per unit. A call site belongs to exactly one unit, the one whose function is hotter. If a unit is too tangled to sandbox in isolation, that tangle is the first finding.
2. Freeze the sibling (orchestrator). Write the standalone function that does the job with the fewest operations and keep it in the sandbox. Freeze it before fan-out so every worker measures against the same target.
3. Lock behavior (orchestrator). Capture goldens or property tests before editing. Same values, ordering, errors, and wire shape, including empty, single, and overlong edges. Deep-compare results, not just counts.
4. Fan out workers. One worker per unit. Each worker gets the function and callers, the frozen sibling, the sandbox contract (inputs, invariants, edges), and the build id. It returns: delta against the sibling, actual bytecode, a patch, pasted counts, pasted tier lines, pasted test output, and the cost line.
5. Verify adversarially (verifier, no edits). Rebuild from source, hash the bundles, rerun the tests and the harness, and try to falsify the win: stale bundle, wrong arm, deopt during measurement, noise floor A/A control, behavior drift, memory regression, uncounted allocation forms. The verifier pastes its own raw output, never the worker's.
6. Tie-break. A falsified unit gets one worker re-run with the falsifier's evidence attached. A second falsification leaves the unit open in the queue, not landed.
7. Land only survivors (orchestrator). One unit at a time with its cost and revert lines, repo suite after each, so a regression points at exactly one unit.
8. Peak rule (orchestrator). Keep a unit open until the remaining gap is physics (cache, bandwidth), the compiler, or structure, and name which. A gap classification requires the sibling measured in the same harness plus the invariant that blocks adoption. Otherwise the unit stays in the queue with the next hypothesis.

## Teach while you prove

Every report ends with one machine read:

```text
<changed bytecode or asm line pasted>
-> <one plain sentence for what the machine does>
-> <what it bought in this function>
```

Look up any mnemonic you do not know (`references/v8-evidence.md` points at the opcode list); never gloss from memory. Append the entry to a running ledger so the learning accumulates across units. One line per report is enough; the user should finish each unit knowing one more thing about the machine.

## The report

1. Counts before and after, with the raw bytecode lines pasted.
2. Backend evidence: tier-up lines and deopt lines, with forced lines labeled capability and natural tiering shown separately.
3. Behavior proof: the exact test command, goldens, and the same-result assertion.
4. Speed and memory: medians, machine header, V8 version, load average, GC time, max pause, peak RSS, and whether allocation evidence is static or dynamic.
5. The trade: bytecode bytes before and after, source line delta in the hot function, module-level state added, cold-start delta when static data moved to module load, and what was deliberately not optimized.
6. The revert: commit, flag, or file that restores the old shape.
7. One machine read: pasted line, plain meaning, what it bought.
8. Remaining spikes with a note on what would reopen them.

## Non-negotiables

- No behavior changes hidden inside a perf change (wire formats, schemas, ranking, public API).
- No timing claim without process isolation, a load context, and a median.
- No "optimized" verdict without the before and after evidence pasted in.
- No win lands without its price and its revert named.
- No allocation claim without either a static-site label or a dynamic heap number.
- No production tier claim from forced optimization alone.
- No leak verdict without heap evidence.
- No skipped measured win and no accepted unmeasured win.

## References

- `references/v8-evidence.md`: harness details, traps, opcode and source lookups, deopt reasons.
- `references/patterns.md`: real before and after code with the census that proved it.
- `references/memory-and-heap.md`: heap snapshots, GC traces, leak proof, scavenger interpretation.
- `references/findings.md`: measured results and what they mean, including the surprises.
- `scripts/census.mjs`: parse `--print-bytecode` output into a closure table.
