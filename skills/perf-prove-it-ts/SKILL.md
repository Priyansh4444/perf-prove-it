---
name: perf-prove-it-ts
description: "Optimize TypeScript performance on V8 and JavaScriptCore with engine evidence instead of profiles."
license: Apache-2.0
---

# Perf prove it: TypeScript on V8 and JavaScriptCore

**Experimental:** Whole-codebase mode consumes substantial tokens and review time. Use it only with ample budget and review capacity. Large repositories produce many false positives and candidates. Inspired by React Doctor and Casey Muratori; inspect and prove candidates one at a time.

Write down the mathematically smallest sequence of steps the function must perform. Then make the engine's bytecode model that math, and then show what the code actually runs. Close the gap, prove behavior did not change, and disclose what the optimization costs.

JavaScript compiles through several optimization tiers depending on how often the code actually runs. Re-benchmark at the tier the code reaches before calling a change a win; see `npx perf-prove-it tier` for how to check the tier.

Measure both sides of every change: runtime speed and memory behavior. Time the code at the tier it actually runs at, and separately record allocation rate (collections per unit of work, or bytes from `--heap-prof`), GC time, pause, promotion, and peak RSS. A change can win one and lose the other; a heap-used snapshot alone is not an allocation measurement. Report both verdicts together, and call out any allocation-rate win that shows up as a GC-cost loss.

Profiles are for discovery, never for the target. They find local minima and cannot tell you what should be possible. The target comes from counting the work the problem requires. Establish what the hardware could theoretically do, then do not stop until the gap is closed or explained.

Always be willing to dive deeper. Patching the framework, or even the packages used are an option.

This skill is viable function to function. Optimizing an entire stack is still hard for a model because intent is hard to recover, though it is possible. Ask the user whether they want one function or an end-to-end interaction optimized.

Recover intent from callers, tests, types, invariants, and user-visible behavior. Static findings are fallible candidates, never hot paths or wins.

## Route

Read only the matching reference.

- Repository or unknown hot code: `references/codebase-audit.md`; run `npx perf-prove-it audit`.
- Named function or measured bottleneck: `references/discovery.md`.
- JSX/HTML, bundles, or source maps: `references/compiled-artifact.md`.
- Rendering/reconciliation/DOM: `references/rendering.md`.
- Bytecode, tiers, deopts, or object shapes and inline caches: `references/v8-evidence.md`.
- Bun or Safari (JavaScriptCore) tiers, shapes, or memory: `references/jsc-evidence.md`.
- Benchmark or A/B requested: `references/benchmark-protocol.md`.
- Allocation, GC, retention, or leaks: `references/memory-and-heap.md`.
- Measured outcomes and surprises from the recorded runs: `references/findings.md`.
- Multiple agents or battle testing: `references/swarm.md`.
- Node versus browser/Bun/Deno: `references/runtime-matrix.md`.
- Known source shape after inspection: `references/patterns.md`.
- Worked cases from real studies, with raw evidence: `examples/`.

## Loop

1. State required behavior and reachable workload.
2. Count current traversals, calls, allocations, data movement, and boundaries; derive the permitted floor. Record allocation rate and GC cost next to the timing.
3. Establish only the evidence needed for the claim.
4. Predict one change's term-by-term effect, make it, and repeat behavior/mechanism/impact checks, timing and memory both.
5. Keep results unchanged: win, zero, or regression. Include costs and revert path.

Evidence ascends: static candidate → reachability → frequency → mechanism → impact. Stop at the supported rung.

## Evidence ladder

Use the lowest rung that can support the claim, then stop. Each rung names what it proves and the command that produces it.

1. **Static candidate.** `npx perf-prove-it audit` returns a file, line, enclosing function, the matched construct, a symbolic current-work model, and a candidate floor. It ranks review order and proves only that the code exists.
2. **Reachability.** Callers and entry points show the code can run in the target workload. The audit's `staticCallSites` and rank boost are reachability within this codebase, never executions.
3. **Frequency.** A profile, trace, counter, or representative workload shows how often it runs. `--cpu-prof` or a CDP trace for the interaction; a call counter for one function.
4. **Mechanism.** Bytecode, tier or deopt output, an allocation profile, or a heap snapshot explains the cost. `npx perf-prove-it census`, `npx perf-prove-it tier`, `--trace-opt`, `--trace-deopt`, `--heap-prof`.
5. **Impact.** Isolated A/B runs beat the A/A band without behavior drift. Follow `references/benchmark-protocol.md`: one process per arm, warm to the target tier, at least five trials per arm.

## Provenance

Small proof-of-concept code is allowed for a bounded hypothesis and may be benched with Node bytecode. Label it **model probe**: it proves only that model's mechanism, not the application. Prefer the real emitted artifact and its source map. Shipped-code claims require:

```text
source + commit → real build + versions → emitted JS path/hash → exact runtime command/version → observation
```

For JSX/HTML, inspect emitted JavaScript and use a browser trace for DOM/layout/paint claims. Bytecode shows interpreter instructions and static construction sites, not dynamic allocation or browser work. For more details refer to the `perf-prove-it-dom` skill.

## Hard gates

- No source edit before the reachable behavior domain and a baseline are recorded.
- No behavior, schema, ordering, error, or public-API change hidden in a performance patch.
- No static candidate called a hot path. `audit` output is a ranked queue, not a verdict.
- No timing claim without isolated processes, load context, an A/A control, and at least five runs per arm.
- No allocation claim from syntax alone. Label `audit` and `census` counts as **static sites**; use `--heap-prof` or GC counts for dynamic allocation.
- No retained-memory claim without a forced-GC snapshot.
- No tier claim from a forced compile request. Require a completed optimization line or the `npx perf-prove-it tier` check in the shipped runtime (Maglev/TurboFan on V8, DFG/FTL on JavaScriptCore).
- No win without its measured benefit, its readability, cold-start, and memory price, and a revert path.
- No reported patch that fails `git apply --check` and the repo's test/typecheck suite. Verify the patch before the report, not after.
- No report of a replaced site while the replaced work is still in the patch's result. If a diff replaces work (a point read, a full scan), the removed lines must appear as `-` lines in the patch; replacement-only diffs must be labeled as additions.
- No wall-clock-only verdict on a loaded or power-throttled machine. Instruction and allocation counters (perf, `perf stat`, counting allocators) outrank timing there; record the governor and load with the machine fingerprint and report the A/A noise band.

## Commands

The tools ship as one CLI. Run it with `npx perf-prove-it` (or `npm i -g perf-prove-it`). It resolves a parser from the repository it scans.

```sh
# Rank static candidates across a repo. NDJSON with --stream.
npx perf-prove-it audit src convex
npx perf-prove-it audit --json src
npx perf-prove-it audit --stream --include-advisory --max=100 src

# Persist false-positive decisions outside prompt context; the ledger expires after 24h.
npx perf-prove-it audit --dismiss=<id> --reason='<short reason>'
npx perf-prove-it audit --cleanup-ledger

# Bytecode census from an existing V8 dump. Add --classes for opcode cost classes and loop attribution.
node --print-bytecode --print-bytecode-filter='fnName' harness.cjs | npx perf-prove-it census --classes
npx perf-prove-it census --diff before.txt after.txt

# Emitted bundle and sourcemap inventory; never executes application code.
npx perf-prove-it compiled dist ChatMarkdown

# Machine and tier evidence for a benchmark report.
npx perf-prove-it machine
node --allow-natives-syntax "$(command -v perf-prove-it)" tier

# Install these skills into your agent's skill directory.
npx perf-prove-it install
```

Full command list: `npx perf-prove-it --help`. The CLI is the source of truth for tools; `perf-prove-it audit` reads the census from an oxc AST and falls back to a dependency-free lexical scan only if the parser cannot be loaded.

Set `PERF_PROVE_IT_SESSION_ID` when the host has a run/agent identifier. Each finding has a stable ID, confidence, work formula, candidate floor, next proof, and the enclosing locally-defined function's static call-site count when there is one. Rank rises with that count; it is reachability, never runtime frequency. The temporary ledger suppresses reviewed false positives for that run; output prints its path.

## Report

For each reviewed candidate: **intent → current work → floor → predicted action → observed mechanism → impact → behavior/cost/revert**. Report speed and memory together: time at the measured tier, allocation rate, GC time, peak RSS. One without the other is an incomplete verdict. For static-only work, title it **candidates, not measured hot paths** and name the next probe.

Be transparent. Explain why the change is impactful, show the bytecode delta, and make the cost and benefit concrete. Every change is a tradeoff: show what is lost and what is gained, unless the change removes genuinely redundant work, which is the goal.
