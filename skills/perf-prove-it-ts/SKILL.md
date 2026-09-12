---
name: perf-prove-it-ts
description: "Finds and proves TypeScript and JavaScript performance improvements with static codebase audits and V8 evidence. Use for whole-repo performance audits, hot-path candidate discovery, closure or allocation reduction, deopts, GC pressure, leaks, or optimizing one function."
---

# Perf prove it: TypeScript on V8

Use Casey Muratori's method: derive the least work permitted by the program's intent, then compare it with the work the machine actually performs. Intent is not the function body alone; recover it from callers, tests, types, invariants, and user-visible behavior. Static evidence chooses candidates; runtime evidence establishes heat and impact. Never call a static candidate a hot path.

## Route

Choose one route before reading a reference.

- **Codebase audit** — no function is named, the whole repository is in scope, or the user asks what is likely hot. Read `references/codebase-audit.md`, then run `node scripts/static-audit.mjs <paths...>`. This is the default static route.
- **Function optimization** — a function or measured bottleneck is named. Read `references/discovery.md`, then inspect that function and its callers.
- **V8 diagnosis** — bytecode, optimization tier, or deoptimization is the question. Read `references/v8-evidence.md`.
- **Memory or leak** — allocation, GC, retention, or a leak is the question. Read `references/memory-and-heap.md`.
- **Pattern lookup** — consult `references/patterns.md` only after source inspection finds a matching shape.

Do not preload another reference. A route may load a second reference only when its evidence requires it.

## Shared loop

1. Recover intent from callers, tests, types, invariants, and observable behavior. State what may change and what must not.
2. Define the unit: a repository candidate or one named function.
3. Derive the floor: the fewest logical values, traversals, calls, allocations, and data movements that intent permits.
4. Lock behavior over the reachable input domain, including adversarial edges.
5. Record the current work as counts or formulas, plus a runtime baseline appropriate to the claim.
6. Make one change and predict exactly which terms should move.
7. Re-run the work accounting, behavior proof, and runtime evidence.
8. Keep a change only when the mechanism moved as predicted and its measured trade is acceptable. A zero timing delta is still a valid process result; report it as zero.

For a codebase audit, repeat the loop one candidate at a time in ranked order. Do not edit every scanner hit.

## Evidence ladder

Use the lowest rung that can support the claim, then stop.

1. **Static candidate:** file, line, enclosing scope, matched construct, and why repetition is plausible.
2. **Reachability:** callers or entry points show the code can run in the target workload.
3. **Frequency:** a profile, trace, counter, or representative workload shows how often it runs.
4. **Mechanism:** bytecode, tier/deopt output, allocation profile, or heap snapshot explains the cost.
5. **Impact:** isolated A/B runs show the change beats A/A noise without behavior drift.

The static audit produces rung 1. It ranks review order; it does not prove heat, allocations, or speed.

## Hard gates

- No source edit before the reachable behavior domain and baseline are recorded.
- No behavior, schema, ordering, error, or public-API change hidden in a performance patch.
- No timing claim without isolated processes, load context, an A/A control, and at least five runs per arm.
- No allocation claim from syntax alone. Label bytecode counts **static sites**; use `--heap-prof` or GC counts for dynamic allocation.
- No retained-memory claim without forced-GC snapshots.
- No tier claim from a forced compile request; require a completed optimization line or active-tier check in the shipped runtime.
- No win without its measured benefit, readability/cold-start/memory price, and revert path.

## Built-in tools

```sh
# Whole-codebase triage. JSON is stable enough for scripts and evals.
node <skill-dir>/scripts/static-audit.mjs src convex
node <skill-dir>/scripts/static-audit.mjs --json src convex

# Allocation-site census from an existing V8 bytecode dump.
node <skill-dir>/scripts/census.mjs --json bytecode.txt

# Static analyzer self-test.
node <skill-dir>/scripts/static-audit.test.mjs
```

## Report

For each investigated candidate, write an action ledger before any aggregate benchmark summary:

1. **Intent:** required behavior and the context that establishes it.
2. **Current work:** a symbolic count, such as `E edges × 2 array pushes per side`.
3. **Floor:** the least work that preserves intent, with irreducible terms named.
4. **Action:** one source change and its predicted term-by-term delta.
5. **Observed mechanism:** actual bytecode, allocation, instruction, or call counts that moved—or did not.
6. **Observed impact:** the isolated runtime result, including zero or regression, without rewriting the prediction after the fact.
7. **Behavior and price:** identity evidence, source/bytecode size, memory or cold-start cost, uncertainty, and revert.

For a static-only audit, title the output **candidates, not measured hot paths**. Separate reviewed findings from scanner hits and recommend the smallest runtime probe that would promote each finding to the next evidence rung.

## References

- `references/codebase-audit.md`: repository-wide static discovery and candidate ranking.
- `references/discovery.md`: function work ledger, hidden callees, guards, shapes, and identity domains.
- `references/v8-evidence.md`: V8 harnesses, bytecode, tiering, deopts, and measurement traps.
- `references/memory-and-heap.md`: allocation profiles, GC traces, snapshots, and leak proof.
- `references/patterns.md`: measured before/after patterns; lookup only.
- `references/findings.md`: prior results and known surprises; calibration only.
