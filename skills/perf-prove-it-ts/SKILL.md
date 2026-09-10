---
name: perf-prove-it-ts
description: "Make TypeScript and JavaScript faster with V8's own evidence instead of profiles and guesses. Use when code must get measurably faster, allocate less, or stop leaking: closure/allocation censuses from Ignition bytecode (--print-bytecode), Maglev to TurboFan tier-up verification (--trace-opt), deopt diagnosis (--trace-deopt: wrong map, insufficient type feedback), a CJS harness with V8 natives, and leak audits. Triggers: optimize this TypeScript, why is this slow, make it faster, check the bytecode, run V8 on it, too many closures, GC pressure, memory leak, microbenchmark, is it deoptimizing."
license: MIT
---

# Perf prove it: TypeScript on V8

Write down the minimum work the function must do. Then make V8 show what it actually does. Close the gap.

Profiles find local minima. Counting operations per call finds the floor. A hot function is a small instruction stream, and you can read it.

## Step 0: pick the function and write the ideal

Take one hot function at a time. State the ideal in operations, not vibes:

- Per element: how many loads, stores, compares, branches? One pass or several?
- Allocations per call: which arrays/objects are required outputs, which are throwaway?
- Closures per call: how many callbacks escape or get constructed inside the loop?
- Static data: can anything be computed once at module load instead of per call?

Example target: "rerank over 200 candidates: one pass, one output array, zero per-candidate closures, three maxima computed inline, no intermediate arrays."

For a whole codebase, fan this out: one subagent per hot function, each returning ideal operation count, the actual bytecode/asm evidence, the gap, and a verdict. Do not let a subagent "optimize" without the evidence attached.

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

## Non-negotiables

- No behavior changes hidden inside a perf change (wire formats, schemas, ranking, public API).
- No timing claim without the process isolation and load context to back it.
- No "optimized" verdict without the before/after bytecode or counters pasted in.

## References

- `references/v8-evidence.md`: harness details, traps, opcode and source lookups, deopt reasons.
- `references/patterns.md`: real before/after code with the census that proved it.
- `scripts/census.mjs`: parse `--print-bytecode` output into a closures/contexts table.
