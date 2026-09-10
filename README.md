<p align="center">
  <img src="assets/logo.svg" alt="perf-prove-it" width="560">
</p>

Two agent skills that make code faster the honest way: write down the ideal work per function, then make the compiler show you what it actually emitted, and close the gap.

No profiles to chase, no "should be faster" claims, no microbenchmarks invented after the fact.

- `perf-prove-it-ts`: TypeScript and JavaScript on V8. Ignition bytecode censuses, Maglev and TurboFan tier checks, deopt diagnosis, closure and allocation cuts, leak audits.
- `perf-prove-it-rust`: Rust on the CPU you actually own. Ideal instruction sequence first, asm diff second, instruction counters and perf counters third, threads and caches treated as part of the design.

Both come from the same rule, borrowed from Casey Muratori: a good optimizer establishes what the hardware could theoretically do, then does not stop until the gap is closed. Profiles find local minima. Counting what the machine must do finds the floor.

## Receipts

These are from two real runs. Same skills, real code, real numbers.

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
```

Or just mention it to your agent:

> install the perf-prove-it-ts skill from github.com/Priyansh4444/perf-prove-it

Manual copy also works. Drop `skills/<name>/` into any skills directory your agent reads (`.agents/skills/`, `.claude/skills/`, `.config/opencode/skills/`, `.opencode/skills/`).

## Use it

The descriptions are written as triggers, so the agent picks the skill up when you say things like:

- "make this TypeScript faster", "check the bytecode", "is this deoptimizing", "why is this allocating"
- "optimize this Rust", "check the assembly", "parallelize this properly", "why is this cache-missing"

Then it works one verified unit at a time:

1. Establish the floor: the minimum operations the function must perform. That is the target, not a profile graph.
2. Sandbox the unit with an ideal sibling function next to the original, and lock behavior with goldens before editing.
3. Force the compiler to prove what it produced (V8 `--print-bytecode` / `--trace-opt`, `cargo asm` / `objdump` / `iai-callgrind`).
4. Show equal outputs on equal inputs before showing any delta.
5. Report construction counts, instruction counts, and the machine they ran on. Wall-clock only when the box is quiet and the arms ran in separate processes.
6. Fan out one subagent per unit, each returning pasted evidence. A second subagent verifies the patch and the behavior lock.
7. Integrate one unit at a time and leave the remaining spikes documented for the next person.

## What's inside

```
skills/
  perf-prove-it-ts/
    SKILL.md                     the workflow, in order
    references/v8-evidence.md    harness, traps, opcode/source lookups, deopt reasons
    references/patterns.md       before/after patterns with real census numbers
    scripts/census.mjs           parse --print-bytecode output into a closure table
  perf-prove-it-rust/
    SKILL.md                     the workflow, in order
    references/asm-diff.md       generating and reading asm; common Rust surprises
    references/machine-and-threads.md  core/cache/thread measurement on your box
    scripts/machine.sh           one-shot machine profile for benchmark reports
presentation/
  README.md                      how to run the demo and regenerate the cards
  talk-outline.md                talk script built on the presentation rules
  census.html                    animated closure census for live demos
  cards/                         code and evidence cards, SVG plus PNG
  generate-cards.mjs             regenerate the cards from source snippets
assets/
  logo.svg, logo-mark.svg, logo.png, logo-mark.png
```

## Philosophy

You do not need to write assembly. You need to read about twenty instructions and stop being scared of the truth. A function body is small. The compiler already knows what it did. Ask it.

Three questions explain most machine behavior: where the data moves, how instructions flow through the branch predictor, and which execution units do the work. Answer those before opening a profiler, and most optimizations stop being mysteries.

## License

MIT
