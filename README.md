# perf-prove-it

Two agent skills that make code faster the honest way: write down the ideal work per function, then make the compiler show you what it actually emitted, and close the gap.

No profiles-to-chase, no "should be faster" claims, no microbenchmarks invented after the fact.

- `perf-prove-it-ts`: TypeScript/JavaScript on V8. Ignition bytecode censuses, TurboFan/Maglev tier checks, deopt diagnosis, closure and allocation cuts, leak audits.
- `perf-prove-it-rust`: Rust on the CPU you actually own. Ideal instruction sequence first, asm diff second, instruction counters and perf counters third, threads and caches treated as part of the design.

Both are built on the same idea, borrowed from Casey Muratori: a good optimizer establishes what the hardware could theoretically do, then does not stop until the gap is closed. Profiles find local minima. Counting what the machine must do finds the floor.

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

Then it does the boring, provable version:

1. Establish the floor: the minimum operations the function must perform. That is the target, not a profile graph.
2. Work one unit at a time, one function in one sandbox with a behavior lock, so a regression can only come from one change.
3. Force the compiler to prove what it produced (V8 `--print-bytecode` / `--trace-opt`, `cargo asm` / `objdump` / `iai-callgrind`).
4. Show equal outputs on equal inputs before showing any delta.
5. Report construction counts, instruction counts, and the machine they ran on. Wall-clock only when the box is quiet and the arms ran in separate processes.
6. Leave the remaining spikes documented for the next person instead of pretending they don't exist.

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
article/
  x-article.md                   the long-form writeup with the real run
```

## Philosophy

You do not need to write assembly. You need to read about twenty instructions and stop being scared of the truth. A function body is small. The compiler already knows what it did. Ask it.

Three questions explain most machine behavior: where the data moves, how instructions flow through the branch predictor, and which execution units do the work. Answer those before opening a profiler, and most optimizations stop being mysteries.

## License

MIT
