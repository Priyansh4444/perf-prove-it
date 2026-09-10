---
name: perf-prove-it-ts
description: "Make TypeScript and JavaScript faster with V8's own evidence instead of profiles and guesses. Use when code must get measurably faster, allocate less, or stop leaking: closure/allocation censuses from Ignition bytecode (--print-bytecode), Maglev to TurboFan tier-up verification (--trace-opt), deopt diagnosis (--trace-deopt: wrong map, insufficient type feedback), a CJS harness with V8 natives, and leak audits. Triggers: optimize this TypeScript, why is this slow, make it faster, check the bytecode, run V8 on it, too many closures, GC pressure, memory leak, microbenchmark, is it deoptimizing."
license: Apache-2.0
---

# Perf prove it: TypeScript on V8

Write down the minimum work the function must do. Then make V8 show what it actually does. Close the gap.

Profiles find local minima. Counting operations per call finds the floor. A hot function is a small instruction stream, and you can read it.

## The general method

This is the skill behind the skill, and it works the same in every language:

1. Establish the floor. For the function, write down the minimum the machine must do: bytes moved, loads, stores, arithmetic, branches per element, allocations per call. That number is the target, not a guess.
2. Make the source read like those operations. If the code hides work (a callback that allocates, a spread that copies), the machine still pays for it, and you cannot see it without the compiler's output.
3. Get the compiler's real output and diff it against the floor. Every extra instruction gets an explanation or gets removed.
4. Close what the design allows, document the rest. Some distance from the floor is physics (cache, bandwidth, latency), some is the compiler, some is structure. Naming which is which is part of the job.
5. Treat measurement as a habit, not a phase. Keep a count visible while you work. Optimizing once a quarter from memory is a different, weaker skill.

When reading the machine, three questions explain most results:

- Data movement. Does the working set fit L1/L2/L3 or stream from memory? Are the accesses contiguous?
- Instruction flow. How many branches per element, are they predictable, does the hot loop stay in the instruction cache?
- Execution throughput. Which units run the operations, and is the bottleneck arithmetic, load/store, or branches?

## Step 0: pick the function and write the ideal

Take one hot function at a time. State the ideal in operations, not vibes:

- Per element: how many loads, stores, compares, branches? One pass or several?
- Allocations per call: which arrays/objects are required outputs, which are throwaway?
- Closures per call: how many callbacks escape or get constructed inside the loop?
- Static data: can anything be computed once at module load instead of per call?

Example target: "rerank over 200 candidates: one pass, one output array, zero per-candidate closures, three maxima computed inline, no intermediate arrays."

## Step 1: build the harness

Bundle the real modules, do not hand-copy them.

```sh
# from the repo, with esbuild available (node_modules or bun)
esbuild entry.ts --bundle --format=esm --platform=node --outfile=/tmp/v8bench/engine.mjs
```

Drive the bundle from a **CJS** harness. ESM forbids `%` natives syntax.

```js
// /tmp/v8bench/harness.cjs
async function main() {
  const E = await import("./engine.mjs");
  const xq = /* stable-shaped inputs */;
  let sink = 0;
  for (let i = 0; i < 12000; i++) sink += E.rerank(xq, CANDIDATES, STATS, NOW).length;
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

Run with `node --allow-natives-syntax harness.cjs`. Warm ~12k calls with stable shapes first. Never decode the status bitmask from memory; if a value surprises you, read its definition in V8's source and say so in the report (see `references/v8-evidence.md`).

## Step 2: prove the backend

```sh
node --allow-natives-syntax --trace-opt harness.cjs 2>&1 | grep -E "rerank|tokenize"
```

Every hot function must show `MAGLEV` then `completed optimizing ... (target TURBOFAN_JS)`. Deopts mean the optimized code was thrown away; get reasons with `--trace-deopt`. Quote the lines in the final report.

## Step 3: run the closure census

This is the primary metric. Unlike wall time, load average cannot move it.

```sh
node --allow-natives-syntax --print-bytecode --print-bytecode-filter='rerank' harness.cjs
```

One function per filter (`|` alternation does not match). Feed dumps to `scripts/census.mjs` or count manually:

```sh
node --allow-natives-syntax --print-bytecode --print-bytecode-filter='rerank' harness.cjs \
  | node scripts/census.mjs
```

```text
function           closures contexts
rerank                    7        1
tokenize                  4        1
```

`CreateClosure` = a function allocated on every call. `CreateFunctionContext` = a captured scope allocated on every call. Those are the two lines that matter. `CreateEmptyArrayLiteral`/`CreateObjectLiteral` show throwaway temporaries.

## Step 4: cut, in this order

1. Per-record closures in the hottest loop (`.some`, `.every`, `.map` callbacks) become module-level loops.
2. Fuse passes: `candidates.map(...)` then `Math.max(...rows.map(pick))` becomes one loop computing values and maxima together.
3. Spread-into-Set unions become one `Set` and one output array.
4. Hoist per-call defaults and predicates to module scope.
5. Parse static data once at module load, not per query.
6. Keep every spread that builds a required output (sorted copies, no-mutate copies). Do not contort readable code for noise-level wins.

See `references/patterns.md` for real before/after code and census tables.

## Step 5: prove it again

- Assert same-result equivalence in the harness on identical inputs before believing any delta.
- Repo goldens and tests must be green. Identical behavior is the entry ticket.
- Re-run the census and `--trace-opt` after the change.
- Wall clock lies on a busy box. Check `/proc/loadavg`; report construction counts and bytecode when it is noisy.
- Never A/B two bundles in one process. Dual module instances deoptimize each other (a 16x phantom win was once observed from exactly this). Bench each arm in its own process.
- Escape analysis can delete micro-allocations, so a 0.5% timing "win" may be zero. Count constructions, do not guess.
- Report what you measured, how, and what confounded it. A noisy win sold as a win is worse than no benchmark.

## Step 6: memory and leaks

Closures only leak when they escape and retain:

- `addEventListener` on persistent nodes (once at init is clean; per render is not)
- timers capturing large scopes
- per-call closures stored into caches
- unbounded module-level `Map`/`Set`

Grep `addEventListener|setInterval|setTimeout` and module-level caches, then state a verdict per site in the report.

## Work in verified units

Never optimize a codebase in one diff. Optimize one unit at a time: one function, one loop, one pass. Each unit gets a sandbox, a behavior lock, and its own evidence.

1. Slice. Pick one hot function. If it is too tangled to sandbox in isolation, that tangle is the first finding.
2. Sandbox it. Bundle the unit plus its real dependencies into a scratch module. Keep the old and new versions as separate bundles (`engine-old.mjs`, `engine.mjs`) and run each arm in its own process, because loading both in one process deoptimizes them.
3. Write the ideal sibling. In the same sandbox, write a small standalone function that does the job with the fewest operations. It is the reference you compare both the old and the new code against. Designing the sibling is usually where the real insight lands.
4. Lock behavior first. Capture golden outputs for the unit, or property-test it, before editing anything. After every change the sandbox must produce identical outputs on identical inputs, and the repo tests and goldens must stay green. Same results, same ordering, same errors, same wire shape.
5. Verify incrementally. One change, one evidence run, one ledger row: function, before and after counts, behavior check, verdict. Do not stack three changes and then try to explain the result.
6. Fan out with subagents. For a codebase, one subagent per unit. Each subagent gets the function and its callers, the sandbox contract (inputs, invariants, edge cases), and must return: ideal operation count, actual bytecode, the gap, a patch, and the pasted evidence. A subagent that cannot show the evidence returns "needs review", not "done".
7. Add a verifier. One subagent produces the patch with evidence. A second subagent reruns the sandbox and the full suite to confirm the claimed counts and the identical behavior. The verifier does not edit code.
8. Integrate in order. Land verified units one at a time, rerun the full suite after each, so any regression points at exactly one unit.

## Non-negotiables

- No behavior changes hidden inside a perf change (wire formats, schemas, ranking, public API).
- No timing claim without the process isolation and load context to back it.
- No "optimized" verdict without the before/after bytecode or counters pasted in.

## References

- `references/v8-evidence.md`: harness details, traps, opcode and source lookups, deopt reasons.
- `references/patterns.md`: real before/after code with the census that proved it.
- `scripts/census.mjs`: parse `--print-bytecode` output into a closures/contexts table.
