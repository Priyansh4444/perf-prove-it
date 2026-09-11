---
name: perf-prove-it-ts
description: "Reach peak TypeScript and JavaScript performance with V8's own evidence instead of profiles. Use when code must get faster, allocate less, or stop leaking: Ignition bytecode censuses for closures and allocations, Maglev and TurboFan tier checks in Node and the browser, deopt diagnosis, CPU profiles for discovery, heap snapshots and GC traces for leak proof, behavior-locked A/B harnesses, and swarm battle testing. Triggers: optimize this TypeScript, why is this slow, make it faster, check the bytecode, run V8 on it, too many closures, GC pressure, memory leak, heap snapshot, microbenchmark, is it deoptimizing, battle test this, peak performance."
license: Apache-2.0
---

# Perf prove it: TypeScript on V8

Write down the mathematically smallest sequence of steps the function must perform. Then make V8 show what it actually runs. Close the gap, prove behavior did not change, and disclose what the optimization cost.

Profiles are for discovery, never for the target. They find local minima and cannot tell you what should be possible. The target comes from counting the work the problem requires. The rule is Casey Muratori's: establish what the hardware could theoretically do, then do not stop until the gap is closed or explained.

## The general method

This is the skill behind the skill, and it works the same in every language:

1. Establish the floor. For the function, write down the minimum the machine must do: bytes moved, loads, stores, arithmetic, branches per element, allocations per call. That number is the target, not a guess.
2. Make the source read like those operations. If the code hides work (a callback that allocates, a callee that parses HTML or clones a regex, a spread that copies), the machine still pays for it, and you cannot see it without the compiler's output.
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

## Step 1: derive the floor from this function's code

Read the function with its callees, one hot function at a time. The floor is what the code forces the machine to do on the shapes production actually passes.

0. Avoidance. Before pricing the unit's work, ask whether the work must exist at all: a caller-level skip, an upstream cache, a precomputed table, or a different algorithm can delete the whole ledger row. Deleting work beats optimizing it. The profile chose the unit; it does not prove the unit should run. If avoidance changes the unit, restart Step 1 on the new one.
1. Inputs and shapes. Name what arrives: strings interned or built, arrays packed or holey, ids unique or not, params absent or present, regex global or not. Cost and behavior both key off shape, and shape can make a change legal or illegal: unique Map keys make index-based dedup safe, interned strings make a `switch` cheap. A second shape gets its own floor and its own bench.
2. Callee inventory. Walk every call on the hot path until you hit a platform or native boundary or code outside the repo, and write what it does per invocation, not what its name says: `bm25` recomputes idf per candidate-term; `matchAll` clones the regex and allocates an iterator; `innerHTML` runs an HTML parse; a spread plus `includes` builds and scans a fresh array; a comparator does two Map `get`s per comparison. Every large win in the study came from this inventory, none from a cut list.
3. Count per call and per element. One pass or several, and can the passes fuse? Loads, stores, compares, branches, allocations (objects, arrays, closures, contexts). Separate call-scoped work (hoistable) from element-scoped work (irreducible) and multiply through: 200 candidates x 3 terms x `Math.log` is 600 logs where 8 suffice.
4. Guards and branches. For each guard, name what it skips and whether it runs hot or cold: early return, cache hit, known entity, valid sort, unique id. A branch that skips an HTML parse is worth more than one that reorders arithmetic.
5. Identity envelope. List the inputs where old and new must agree, with the adversarial edges: duplicates, empty, single, overlong, NaN, -0, lone surrogates, truthy non-booleans, preset `lastIndex`, unknown entities. Name the reachable domain, what the production caller can actually build, and claim identity only over it.

Write one target line with numbers, for example: "rerank over 200 unique-id candidates and 8 distinct terms: one pass, one idf computation per distinct term, index-based sort, three maxima inline, zero per-candidate calls, zero throwaway arrays; identical on every input search.ts builds; duplicate ids out of scope."

## Step 2: build the harness

Bundle the real modules, do not hand-copy them.

```sh
npx esbuild entry.ts --bundle --format=esm --platform=node --outfile=/tmp/v8bench/engine.mjs
# or: ./node_modules/.bin/esbuild ... ; the repo needs esbuild as a dev dependency
```

Drive the bundle from a harness. Test whether `%` natives parse in ESM under `--allow-natives-syntax` on your Node; fall back to CJS when they do not. Record which.

```js
// harness.cjs or harness.mjs
async function main() {
  const E = await import("./engine.mjs");
  const xq = /* stable-shaped inputs */;
  let sink = 0;
  // Warm until --trace-opt shows the target tier (Step 3).
  for (let i = 0; i < 20000; i++) sink += E.rerank(xq, CANDIDATES, STATS, NOW).length;
  %PrepareFunctionForOptimization(E.rerank);
  %OptimizeFunctionOnNextCall(E.rerank);
  sink += E.rerank(xq, CANDIDATES, STATS, NOW).length;
  console.log("opt-status", %GetOptimizationStatus(E.rerank));
  console.log("sink", sink);
}
main();
```

Run with `node --allow-natives-syntax harness.cjs`. Warm until tier-up is observed (see Step 3), not a fixed number of calls. Repeat the prepare, optimize, and call for every function you measure; `manually marking` proves a compile request, so require a `completed optimizing ... (target TURBOFAN_JS)` line or `%ActiveTierIsTurbofan` before any tier claim. Sandbox the work: a copy or a git worktree, node_modules symlinked, tests run from the sandbox. Paste the sandbox path and a sha256 of the file under test with every log. Record the harness environment in every report:

```sh
node -v; node -p "process.versions.v8"; node -p "process.arch"
```

Scope note: this harness is Node/V8. Bun runs JavaScriptCore. Browsers run V8 but a different build, and a page cannot use `%` natives unless the browser is launched with `--js-flags=--allow-natives-syntax` (verified on Chromium 152: without the flag the page throws `SyntaxError: Unexpected token '%'`). When the target is a browser, use the Node harness for the floor, behavior lock, and churn census, then re-establish the tier in the target runtime:

```js
// Playwright, same Chromium build you ship to
const browser = await chromium.launch({ args: ["--js-flags=--allow-natives-syntax"] });
const page = await browser.newPage();
// Evaluate as a string so the page parser, not Node, parses the intrinsic.
await page.evaluate(`(function () {
  function f(x) { return x + 1; }
  for (let i = 0; i < 50000; i++) f(i); // warm the real interaction, not a fixed count
  return { maglev: %ActiveTierIsMaglev(f), turbofan: %ActiveTierIsTurbofan(f), status: %GetOptimizationStatus(f) };
})()`);
```

Warm the real interaction first; a fresh function may still be interpreted. The tier booleans are the readable check, and `status` stays an opaque bit set, so never decode it from memory. DevTools Performance records optimization and deoptimization markers for sessions you cannot flag. Report `browser.version()`, the V8 version from `chrome://version` on the same build, and production versus dev bundle. A Node tier line does not prove browser tiering, and in real UI sessions many functions never leave Sparkplug or Maglev; state the tier you observed in the target runtime, and say when it was not measured. A win that only exists under forced TurboFan in Node is a capability claim, not a production claim.

Probe every ledger row that reading cannot price. Counts, not timers: wrap the sink and count calls into heavy callees, count regex compiles and iterator constructions, count guard hits per input shape, count allocations. Discovery probes never run inside the timing harness. Recipes in `references/discovery.md`.

## Step 3: prove the backend

```sh
node --allow-natives-syntax --trace-opt harness.cjs 2>&1 | grep -E "rerank|tokenize"
```

Record what this V8 build does. Forced lines from the harness (`manually marking ... TURBOFAN_JS`) prove capability, not production tiering; a production claim also needs one unforced run where the same function shows `reason: hot and stable`. A function that stops at Maglev can still be correct for the job, say so. Deopts mean the optimized code was thrown away:

```sh
node --allow-natives-syntax --trace-deopt harness.cjs 2>&1 | grep -E "rerank|tokenize"
```

Quote the lines. Never decode `%GetOptimizationStatus` from memory; it is a version-defined bit set and `--trace-opt` is the authority. Tie every quoted bytecode line to the source expression it compiles. A removed call is proven by the call opcode that disappeared, with the source excerpt pasted. A verifier will check the attribution.

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

`CreateClosure` = a function object constructed when that instruction executes. `CreateFunctionContext` = a captured scope constructed when it executes. `CreateEmptyArrayLiteral`, `CreateObjectLiteral`, and `CreateRegExpLiteral` are churn only when the constructed value does not escape.

Read it correctly:

- The count is static sites in Ignition bytecode, so a branch-guarded closure can be counted even when it rarely runs. For dynamic truth, cross-check with allocation sampling (`--heap-prof`) or a heap snapshot diff.
- Counts are deterministic for a fixed V8 build and source revision. They are not a speed prediction: TurboFan inlines small callbacks and escape-analyzes allocations, so the hot tier can erase what the census counted.
- Use counts to find churn and to keep the fix honest. Use tier evidence, timings, GC time, and peak RSS to judge the result.
- An allocation claim is either labeled static sites or backed by `--heap-prof` object counts. A heap snapshot after forced GC backs a retained claim, not an allocation claim. Sampled profiles can miss small closures; say when evidence is sampled.

## Step 5: close the gap

Diff the observed run against the target line from Step 1, item by item. Each live gap gets one hypothesis and one change with a predicted count change. Work gaps in descending predicted count change. Patterns seen so far are a lookup, not the method: `references/discovery.md` lists them with measured costs and failure modes.

- Callee work that does not depend on all of its inputs: cache it per distinct input, inline it, or call a specialized path. One idf per distinct term replaces one `Math.log` per candidate-term.
- Shape-specific work: preallocate packed in the shape production uses, compare by index instead of Map lookup, `switch` on interned literals instead of scanning arrays, reuse one `exec` loop instead of `matchAll` clones, skip a parse when the input class cannot need it.
- Branch and traversal work: hoist invariant guards, fuse passes over the same data, turn per-record closures into loops.
- Static data: compute once at module load, then weigh init cost against request cost in serverless and edge contexts and say which you chose. Numeric scratch: `new Array(n)` and `arr.length = n` are both holey and pay the same Smi-to-Double backing store on the way; `arr.length = n` is chosen when a lint rule bans the former. `Float64Array` is packed and transition-free for internal numbers.

Each gap resolves one way: delete, hoist, replace, or keep and name why (physics, contract, or a measured zero). A change that does not move the harness comes out, or lands with parity disclosed. A gap that remains is physics (cache, bandwidth), compiler, or structure; name which and stop.

## Step 6: prove it again

- Prove identity over the envelope from Step 1. List the callers, derive the reachable domain, map every adversarial edge to a case, then differential-fuzz old against new with a seeded generator and deep `Object.is` (`JSON.stringify` hides NaN and -0). Every mismatch reduces to a named input class: fix it, or move the class out of scope with the caller file:line and the invariant that makes it unreachable, and write "identical on <domain>; diverges on <edge>; unreachable because <caller invariant>". "Bit-identical" without a domain is not a claim.
- If the change touches shared state (module caches, RegExp `lastIndex`, singletons), test preset state, reentrancy, and invalid forms. A hang is a behavior change.
- Repo goldens and tests must be green. A run against the unpatched checkout is not evidence about the patch.
- Re-run the census and `--trace-opt` after the change.
- Speed: at least 5 process runs per arm, one process per arm, same machine. Run an A/A control first (two identical arms); a delta inside the A/A spread is parity. Paste every run with its load; declare the drop rule before running and paste any dropped run. Never A/B two bundles in one process; mixing arms' inputs across bundles causes wrong-map deopts (a 16x phantom win was once observed from exactly this).
- Memory: peak RSS, total GC time, and max pause are the verdict. Scavenge count is allocation rate, not harm. More scavenges with flat GC time and lower peak RSS is acceptable; a memory win fails when GC time, max pause, or major-GC time rises above the A/A noise. Retained growth needs the A/B/C snapshot protocol after `global.gc()` twice; a no-GC heap delta is churn and cannot be reported as retained.
- No extrapolated scale claim (per hour, per user, per day) without the measured per-unit number and the arithmetic shown; a study report printed 180k scans per hour without the arithmetic, which the per-message rate and 3 matchers make 540k.
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

Leak proof shape: run the workload, force `global.gc()` with `--expose-gc`, snapshot, repeat, compare retained size and object counts for the suspect sites. A retained claim needs `global.gc()` twice before each snapshot; a no-GC delta is churn and is labeled churn, never retained. A closure leaks only when it escapes and retains: listeners on persistent nodes, timers capturing large scopes, per-call closures stored in caches, unbounded module-level `Map`/`Set`, buffers retained by closures after transfer or detach, and growing worker or stream queues.

## Battle test with a swarm

Peak performance is a swarm result, not a single pass.

1. Slice (orchestrator). One function per unit. A call site belongs to exactly one unit, the one whose function is hotter. If a unit is too tangled to sandbox in isolation, that tangle is the first finding.
2. Freeze the sibling (orchestrator). Write the standalone function that does the job with the fewest operations and keep it in the sandbox. Freeze it before fan-out so every worker measures against the same target.
3. Lock behavior (orchestrator). Capture goldens or property tests before editing. Same values, ordering, errors, and wire shape, including empty, single, and overlong edges. Deep-compare results, not just counts.
4. Fan out workers. One worker per unit. Each worker gets the function and callers, the frozen sibling, the sandbox contract (inputs, invariants, edges), the Step 1 target line and identity envelope, and the build id. It returns: delta against the sibling, actual bytecode, a patch, pasted counts with each raw artifact path, pasted tier lines, pasted test output with the file hash under test, and the cost line.
5. Verify adversarially (verifier, no edits). Rebuild from source, build its own harness and corpus with a fresh seed, hash the bundles and the file under test, rerun the tests, paste its own numbers next to the worker's, and try to falsify the win: stale bundle, wrong arm, deopt during measurement, A/A control, behavior drift on every envelope edge, memory regression, uncounted allocation forms. Reject any test log whose tree hash differs from the patched hash, and check every claim against the worker's raw logs; a study worker reported +0.28 MB while its log said +2.63 MB. No verifier report, no landing.
6. Tie-break. A falsified unit gets one re-run that fixes the identified method error with the original corpus and protocol and is re-checked by the same falsifier. A second falsification leaves the unit open in the queue, not landed.
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

Also teach the optimizer, once per report, in plain words and without hand-waving: the ladder is Ignition (interpreter), Sparkplug (baseline), Maglev (mid tier), TurboFan (top). A function climbs only while it stays hot, and a deopt drops it back to the interpreter and makes it climb again. Say which rung the function reached in the runtime that ships, what the win depends on (a tier, an inlining or escape-analysis decision that a new object shape can undo), and what would knock it down. The machine read teaches the machine; this paragraph teaches the optimizer, and it is what makes a browser-targeted report honest.

## The report

1. The Step 1 ledger rows that moved (operation, source line, per-call count predicted and observed), the target line, the identity envelope with the reachable domain, counts before and after with raw bytecode lines tied to their source expressions, and the sibling delta when a sibling was built.
2. Backend evidence: tier-up lines and deopt lines, with forced lines labeled capability and natural tiering shown separately, plus the runtime line: harness runtime (Node and V8 versions) and target runtime (browser build, V8 version from `chrome://version`, production or dev bundle) with the tier observed there, or the explicit statement that the browser tier was not measured.
3. Behavior proof: the exact test command, goldens, the identity claim with its domain and known divergences, and the differential counts.
4. Speed and memory: medians, machine header, V8 version, load average, GC time, max pause, peak RSS, and whether allocation evidence is static or dynamic. Churn and retained are labeled as what they are.
5. The trade: bytecode bytes before and after, source line delta in the hot function, module-level state added, cold-start delta when static data moved to module load, and what was deliberately not optimized.
6. The revert: the command that restores the old shape, the hash it restores, and the dry-run output.
7. One machine read: pasted line, plain meaning, what it bought.
8. Remaining spikes with a note on what would reopen them.

## Non-negotiables

- No behavior changes hidden inside a perf change (wire formats, schemas, ranking, public API).
- No timing claim without process isolation, a load context, and a median.
- No "optimized" verdict without the before and after evidence pasted in.
- No win lands without its price and its revert named.
- No allocation claim without either a static-site label or `--heap-prof` object counts; retained claims need a forced-GC snapshot.
- No identity claim without a named domain and pasted differential counts.
- No retained-memory claim from a no-GC delta.
- No extrapolated scale claim without the measured per-unit number and the arithmetic.
- No tier claim from a `manually marking` line; require a completed optimization line or an active-tier check.
- No verifier report, no landing; an unverified unit stays open.
- No leak verdict without heap evidence.
- No skipped measured win and no accepted unmeasured win.

## References

- `references/discovery.md`: the work ledger, hidden-work passes, probes, gap patterns with measured costs, domain-scoped identity claims.
- `references/v8-evidence.md`: harness details, traps, opcode and source lookups, deopt reasons.
- `references/patterns.md`: real before and after code with the census that proved it.
- `references/memory-and-heap.md`: heap snapshots, GC traces, leak proof, scavenger interpretation.
- `references/findings.md`: measured results and what they mean, including the surprises.
- `scripts/census.mjs`: parse `--print-bytecode` output into a closure table.
