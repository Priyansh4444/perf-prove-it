<p align="center">
  <img src="https://github.com/Priyansh4444/perf-prove-it/raw/main/assets/logo.png" alt="perf-prove-it" width="420">
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/perf-prove-it"><img alt="npm version" src="https://img.shields.io/npm/v/perf-prove-it?color=34d399&label=npm"></a>
  <a href="https://github.com/Priyansh4444/perf-prove-it/blob/main/LICENSE"><img alt="license" src="https://img.shields.io/npm/l/perf-prove-it?color=22d3ee"></a>
  <img alt="node version" src="https://img.shields.io/node/v/perf-prove-it?color=475569">
</p>

<h3 align="center">Make code faster the honest way.</h3>

<p align="center">
  Derive the floor, make the compiler show what it emitted, close the gap.<br>
  One CLI and three agent skills. No profiles to chase, no "should be faster" claims.
</p>

## Run it

```sh
# rank static performance candidates across a repo
npx perf-prove-it

# machine-readable report, for scripts and agents
npx perf-prove-it audit src convex --json

# what the bytecode actually constructs, with opcode cost classes
node --print-bytecode --print-bytecode-filter='fnName' harness.cjs | npx perf-prove-it census --classes

# provenance: emitted bundles and sourcemaps, hashed
npx perf-prove-it compiled dist

# is this machine's tiering machinery real?
node --allow-natives-syntax "$(command -v perf-prove-it)" tier

# install the three skills for your agent
npx perf-prove-it install
```

> **Experimental warning:** Whole-repository audits are expensive. Use this only when you have plenty of token budget and substantial review capacity. Large codebases contain many functions, many false positives, and many tempting optimizations. This project is experimental, inspired by React Doctor and Casey Muratori's “least work” approach; static findings are hypotheses, not permission to edit broadly. Review and prove each change independently.

Three agent skills that make code faster the honest way: write down the ideal work per function, then make the compiler show you what it actually emitted, and close the gap.

No profiles to chase, no "should be faster" claims, no microbenchmarks invented after the fact.

- `perf-prove-it-ts`: TypeScript and JavaScript on V8, with a JavaScriptCore reference for Bun and Safari. Ignition bytecode censuses, Maglev and TurboFan tier checks, deopt diagnosis, closure and allocation cuts, leak audits.
- `perf-prove-it-rust`: Rust on the CPU you actually own. Ideal instruction sequence first, asm diff second, instruction counters and perf counters third, threads and caches treated as part of the design.
- `perf-prove-it-dom`: Browser UI on Blink. Pipeline stages (DOM, style, layout, paint, composite), CDP counter and trace evidence, forced synchronous layout, INP and long tasks, containment and compositor patterns.

All three come from the same rule, borrowed from Casey Muratori: a good optimizer establishes what the hardware could theoretically do, then does not stop until the gap is closed. Profiles find local minima. Counting what the machine must do finds the floor.

## Receipts

These are from real runs. Same skills, real code, real numbers.

### TypeScript: six hot functions, one bytecode dump

A search engine's ranking path, per call before and after:

```text
function    closures before -> after   contexts before -> after
rerank             7 -> 1                      1 -> 1
tokenize           4 -> 0                      1 -> 0
mapAspects         4 -> 0                      1 -> 0
planL0             1 -> 0                      1 -> 0
escalate           5 -> 0                      1 -> 0
```

The hot loop itself, before and after. One object per candidate plus three throwaway arrays, then one pass with the maxima computed inline:

```ts
// before: 200 objects and 4 temporary arrays per rerank call
const raw = candidates.map((c) => ({ rel: signalRel(c), eng: signalEng(c), auth: signalAuth(c) }));
const z = {
  rel: maxSignal(raw, (r) => r.rel),
  eng: maxSignal(raw, (r) => r.eng),
  auth: maxSignal(raw, (r) => r.auth),
};
```

```ts
// after: one loop, three output arrays, no temporaries
for (let i = 0; i < candidates.length; i++) {
  const c = candidates[i]!;
  const rel = signalRel(c);
  const eng = signalEng(c);
  const auth = signalAuth(c);
  rels[i] = rel;
  engs[i] = eng;
  auths[i] = auth;
  if (rel > zRel) zRel = rel;
  if (eng > zEng) zEng = eng;
  if (auth > zAuth) zAuth = auth;
}
```

What that bought, all visible in bytecode rather than eyeballed:

- `rerank`: 7 closures and about 204 temporary objects per call down to 1 closure and 3 output arrays.
- `escalate`: 443ns to 387ns in isolated runs. `planL0` came back at parity, and the report said parity instead of dressing it up.
- `--trace-opt` confirmed Maglev to TurboFan on every hot function, no deopts, before and after.
- A first A/B run claimed a 16x win. `--trace-deopt` showed `wrong map` bailouts: both bundles in one process deoptimized each other. The 16x was thrown out, not shipped.
- 103 tests stayed green, including goldens asserting identical output.

### Rust: one function, three runs

A video indexer re-cloned, grouped, normalized, and sorted every hit after every backend page just to answer "are there enough distinct videos yet?" A borrowed `HashSet` probe with early exit replaced the whole pass, and the full ranking still runs on the final page:

```text
run   before      after      speedup
1     166.96 ms   71.60 ms   2.33x
2     158.90 ms   72.00 ms   2.21x
3     155.70 ms   63.55 ms   2.45x
```

Exact final video order asserted on every run. And the experiments that lost, on purpose, with numbers:

- Caching normalized strings: median went 0.520ms to 0.540ms per round. Rejected.
- Moving hits into an index-map representation: 0.681ms. Rejected.
- Thin LTO: larger binaries and clean builds went 13.78s to 44.20s. Rejected.
- The transform stage benched at about 53k tweets/s against a 500/s target, so it was left alone. The bottleneck was elsewhere, and saying so was the correct outcome.

A perf record that only contains wins is marketing.

### DOM: three cases, then the verifiers scrolled

Three workers measured real browser interactions with CDP counters and traces: a chat feed render, a transcript expansion, a reply tree mount. The mount wins were real: Nodes 3126 to 1050, LayoutObjects 2197 to 449, LayoutDuration 94.6 to 40.6 ms.

Then the verifiers scrolled, and both containment fixes turned out to defer work rather than remove it: the first revealing scroll re-paid 18 layouts and roughly 46 ms in the transcript case, and 73 ms of layout in the reply tree. Mount plus scroll was worse than the old code in both. The reports now call them mount-scoped wins, and the skill requires a full-cycle measurement:

```text
mount:      layout 27.4 -> 9.9 ms
first scroll: re-pays 18 layouts / ~46 ms
verdict:    deferred, not removed
```

The same review pass caught three wrong facts in the skill's own references before any case ran: a Blink class that does not exist, stale trace event names, and a ScriptDuration claim that CDP-evaluate work is included when it is excluded. Verifiers are for the skill too. Full evidence: `study/reports/`, runnable in `study/harness/` and `study/dom-primitives/`.

## What it tends to find

The census and the asm diff do not care how clever the code looks. These are the patterns they surface most often, and roughly what fixing them tends to buy. Every number is still yours to measure, and some of these come back as zero, which the report says out loud.

- Per-row closures in request paths. A `.map((row) => ...)` over a few thousand rows allocates one closure per row, and a single `CreateClosure` line in the bytecode shows it. The fix is mechanical. The payoff is usually smoother GC behavior and a better p99, not a dramatic average latency win.
- Spread-based max or min. `Math.max(...values)` copies the array before comparing anything. On large arrays the copy can dominate. On a few hundred elements it may not be measurable at all.
- Vec growth in a hot loop. Repeated `push` without capacity shows up as `grow` calls in the asm. `with_capacity` or reusing the buffer is a small, safe change, and the win scales with how often the loop runs and how big the elements are.
- Bounds checks in numeric loops. One compare and panic branch per element. Removing them can let autovectorization kick in, which is where the real gain lives, but only when the loop is compute-bound. Memory-bound loops barely notice.
- Thread scaling that flattens early. Eight threads giving 2x usually means false sharing or a serial stage. Fixing it brings you closer to linear, and the ceiling after that is memory bandwidth, not the thread library.
- Retention bugs. A listener attached per render or a cache with no bound leaks memory that no profiler attributes cleanly. Finding one is worth more than most micro-optimizations in the same file.

Expect uneven results. Occasionally a function gives a clean 2x, like the Rust probe above. Most functions give nothing, and proving the nothing is worth having: it removes a theory from the list and leaves a documented floor for the next person.

## Install

Any agent that supports skills (Claude Code, opencode, Codex, Cursor, and [many more](https://skills.sh)):

```sh
npx skills add Priyansh4444/perf-prove-it
```

Install one of them:

```sh
npx skills add Priyansh4444/perf-prove-it --skill perf-prove-it-ts
npx skills add Priyansh4444/perf-prove-it --skill perf-prove-it-rust
npx skills add Priyansh4444/perf-prove-it --skill perf-prove-it-dom
```

Or just mention it to your agent:

> install the perf-prove-it-ts skill from github.com/Priyansh4444/perf-prove-it

Manual copy also works. Drop `skills/<name>/` into any skills directory your agent reads (`.agents/skills/`, `.claude/skills/`, `.config/opencode/skills/`, `.opencode/skills/`).

## Use it

The skills are named and described for the artifact they cover, so a plain request routes to one:

- "make this TypeScript faster", "check the bytecode", "is this deoptimizing", "why is this allocating"
- "optimize this Rust", "check the assembly", "parallelize this properly", "why is this cache-missing"
- "why is my UI janky", "check layout thrashing", "read the trace", "is this interaction slow", "why does this reflow"

Then it works one verified unit at a time:

1. If no function is named, run the static codebase audit to produce a ranked list of candidates. Static candidates are never labeled hot paths until runtime evidence establishes frequency.
2. Establish the floor: the minimum operations the function must perform. That is the target, not a profile graph.
3. Sandbox the unit with an ideal sibling function next to the original, and lock behavior with goldens before editing.
4. Force the compiler to prove what it produced (V8 `--print-bytecode` / `--trace-opt` / tier checks, `cargo asm` / `objdump` / `iai-callgrind`).
5. Show equal outputs on equal inputs before showing any delta.
6. Report construction counts, instruction counts, and the machine they ran on. Wall-clock only when the box is quiet and the arms ran in separate processes.
7. Integrate one verified unit at a time and leave the remaining candidates documented for the next person.

## What's inside

```
src/                           the CLI: oxc facts, rules, Effect v4 commands
test/                          CLI tests and the legacy suites used as the parity oracle
skills/
  perf-prove-it-ts/
    SKILL.md                     the workflow, in order
    references/codebase-audit.md repository-wide static discovery and candidate ranking
    references/discovery.md      the work ledger: hidden-work passes, probes, identity domains
    references/v8-evidence.md    harness, traps, opcode/source lookups, deopt reasons, shapes
    references/jsc-evidence.md   JavaScriptCore tiers, shapes, and memory for Bun and Safari
    references/compiled-artifact.md  emitted JS/bundles, sourcemaps, JSX/HTML route
    references/rendering.md      React/Solid/JSX render and DOM evidence route
    references/benchmark-protocol.md  A/A control, process isolation, timing rules
    references/runtime-matrix.md Node vs browser vs Bun vs Deno caveats
    references/swarm.md          multi-agent slicing and verifier requirements
    references/memory-and-heap.md  heap snapshots, GC traces, leak proof
    references/patterns.md       before/after patterns with real census numbers
    references/findings.md       measured results and the surprises
    examples/                    worked cases: closures, default param, sorting, DOM guards
  perf-prove-it-rust/
    SKILL.md                     the workflow, in order
    references/asm-diff.md       generating and reading asm; common Rust surprises
    references/machine-and-threads.md  core/cache/thread measurement on your box
    examples/                    the video indexer case: the win and the rejected experiments
  perf-prove-it-dom/
    SKILL.md                     the workflow, in order
    references/pipeline.md       Blink pipeline stages, triggers, and source map
    references/measurement.md    CDP commands, metric keys, harness rules, verifier traps
    references/patterns.md       before/after DOM patterns with measured effects and traps
    references/web-vitals.md     Core Web Vitals thresholds, field/lab discipline, INP/CLS levers
    examples/                    three worked cases with floors, counters, and traps
study/
  PROTOCOL.md                    the study frame and rubric
  RESULTS.md                     verified results, corrections, and skill changes
  static-audit-solid-pr.md       static-audit evaluation against a real Solid PR
  static-audit-cross-file/       multi-file TypeScript fixture for the call-site census
  t3code-static-audit-harvest/   measured before/after pairs for scanner candidates
  t3code-qr-eval/                packed-grid QR evaluation and its decision
  reports/                       raw worker, verifier, and judge reports
  dom-primitives/                runnable CDP primitive proofs with results.json
  harness/                       the three DOM case harnesses and evidence
assets/
  logo.svg, logo-mark.svg     wordmark and square mark (vector)
  logo.png                    the mascot hero image the README leads with
  logo-mark.png               raster of the square mark
```

## Philosophy

You do not need to write assembly. You need to read about twenty instructions and stop being scared of the truth. A function body is small. The compiler already knows what it did. Ask it.

Three questions explain most machine behavior: where the data moves, how instructions flow through the branch predictor, and which execution units do the work. Answer those before opening a profiler, and most optimizations stop being mysteries.

## License

Apache-2.0
