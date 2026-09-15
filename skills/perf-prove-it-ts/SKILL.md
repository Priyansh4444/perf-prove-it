---
name: perf-prove-it-ts
description: "Reach peak TypeScript and JavaScript performance with V8's own evidence instead of profiles. Use when code must get faster, allocate less, or stop leaking: Ignition bytecode censuses for closures and allocations, Maglev and TurboFan tier checks in Node and the browser, deopt diagnosis, CPU profiles for discovery, heap snapshots and GC traces for leak proof, behavior-locked A/B harnesses, and swarm battle testing. Triggers: optimize this TypeScript, why is this slow, make it faster, check the bytecode, run V8 on it, too many closures, GC pressure, memory leak, heap snapshot, microbenchmark, is it deoptimizing, battle test this, peak performance."
license: Apache-2.0
---

# Perf prove it: TypeScript on V8

**Experimental:** whole-codebase mode consumes substantial tokens and review time. Use it only with ample budget and review capacity. Large repositories produce many false positives and candidates. Inspired by React Doctor and Casey Muratori; inspect and prove candidates one at a time.

Write down the mathematically smallest sequence of steps the function must perform. Then make V8 bytecode to model that math, and then show what the code actually runs. Close the gap, prove behavior did not change, and disclose what the optimization costs.

JavaScript compiles through several optimization tiers depending on how often the code actually runs. Re-benchmark at the tier the code reaches before calling a change a win; see `scripts/tier-check.mjs` for how to check the tier.

Measure both sides of every change: runtime speed and memory behavior. Time the code at the tier it actually runs at, and separately record allocation rate (collections per unit of work, or bytes from `--heap-prof`), GC time, pause, promotion, and peak RSS. A change can win one and lose the other; a heap-used snapshot alone is not an allocation measurement. Report both verdicts together, and call out any allocation-rate win that shows up as a GC-cost loss.

Profiles are for discovery, never for the target. They find local minima and cannot tell you what should be possible. The target comes from counting the work the problem requires. Establish what the hardware could theoretically do, then do not stop until the gap is closed or explained.

Always be willing to dive deeper. Patching the framework, or even the packages used are an option.

This skill is viable function to function. Optimizing an entire stack is still hard for a model because intent is hard to recover, though it is possible. Ask the user whether they want one function or an end-to-end interaction optimized.

Recover intent from callers, tests, types, invariants, and user-visible behavior. Static findings are fallible candidates, never hot paths or wins.

## Route

Read only the matching reference.

- Repository or unknown hot code: `references/codebase-audit.md`; run `scripts/static-audit.mjs`.
- Named function or measured bottleneck: `references/discovery.md`.
- JSX/HTML, bundles, or source maps: `references/compiled-artifact.md`.
- Rendering/reconciliation/DOM: `references/rendering.md`.
- Bytecode, tiers, or deopts: `references/v8-evidence.md`.
- Benchmark or A/B requested: `references/benchmark-protocol.md`.
- Allocation, GC, retention, or leaks: `references/memory-and-heap.md`.
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

## Provenance

Small proof-of-concept code is allowed for a bounded hypothesis and may be benched with Node bytecode. Label it **model probe**: it proves only that model's mechanism, not the application. Prefer the real emitted artifact and its source map. Shipped-code claims require:

```text
source + commit → real build + versions → emitted JS path/hash → exact runtime command/version → observation
```

For JSX/HTML, inspect emitted JavaScript and use a browser trace for DOM/layout/paint claims. Bytecode shows interpreter instructions and static construction sites, not dynamic allocation or browser work. For more details refer to `skills/perf-prove-it-dom`.

## Commands

```sh
# Bounded candidates; NDJSON streams during scanning.
node <skill-dir>/scripts/static-audit.mjs --stream src
node <skill-dir>/scripts/static-audit.mjs --json src

# Noisy leads, explicit opt-in.
node <skill-dir>/scripts/static-audit.mjs --include-advisory --max=100 src

# Persist false-positive decisions outside prompt context; ledgers expire after 24h.
node <skill-dir>/scripts/static-audit.mjs --dismiss=<id> --reason='<short reason>'
node <skill-dir>/scripts/static-audit.mjs --cleanup-ledger

# Static emitted-artifact/sourcemap inventory; never executes application code.
node <skill-dir>/scripts/compiled-audit.mjs dist ChatMarkdown thread.message-sent

# Opcode classes, loop-attributed allocation sites, protocol ops, and A/B diff.
node --print-bytecode --print-bytecode-filter='fnName' harness.cjs | node <skill-dir>/scripts/census.mjs --classes
node <skill-dir>/scripts/census.mjs --diff before.txt after.txt

node <skill-dir>/scripts/static-audit.test.mjs
node <skill-dir>/scripts/compiled-audit.test.mjs
node <skill-dir>/scripts/census.test.mjs
```

Full tool and scanner-rule index: `scripts/README.md`. The scanner resolves `typescript`, `@babel/parser`, or `acorn` from the scanned repository and reads the census from the AST; with none present it falls back to a dependency-free lexical scan (`PERF_PROVE_IT_LEXICAL=1` forces the fallback). The summary reports the backend.

Set `PERF_PROVE_IT_SESSION_ID` when the host has a run/agent identifier. Each finding has a stable ID, confidence, work formula, candidate floor, next proof, and the enclosing locally-defined function's static call-site count when there is one. Rank rises with that count; it is reachability, never runtime frequency. The temporary ledger suppresses reviewed false positives for that run; output prints its path.

## Report

For each reviewed candidate: **intent → current work → floor → predicted action → observed mechanism → impact → behavior/cost/revert**. Report speed and memory together: time at the measured tier, allocation rate, GC time, peak RSS. One without the other is an incomplete verdict. For static-only work, title it **candidates, not measured hot paths** and name the next probe.

Be transparent. Explain why the change is impactful, show the bytecode delta, and make the cost and benefit concrete. Every change is a tradeoff: show what is lost and what is gained, unless the change removes genuinely redundant work, which is the goal.
