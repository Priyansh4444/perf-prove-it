# Real bytecode captures

Every `.txt` here is raw output from the xearch repo at PR #10 (`11d2ef6 engine: fuse rerank loop, hoist closures, precompute lexicon`). Nothing is hand-trimmed. Machine addresses are present in the raw files; the GIFs trim addresses for width and say so.

```
rerank-before.txt    full Ignition dump, convex/engine/rank.ts at 11d2ef6^
rerank-after.txt     full Ignition dump, convex/engine/rank.ts at 11d2ef6
census-before.txt    closures/contexts per call, all six hot functions, before
census-after.txt     same, after
opt-after.txt        node --trace-opt, after bundle
deopt-ab.txt         node --trace-deopt with both bundles in one process
```

## Reproduce

The engine was bundled from a detached worktree at each commit, then driven by a CJS harness with V8 natives enabled. The exact files are in `harness/`.

```sh
cd /path/to/xearch
git worktree add --detach /tmp/xearch-before 11d2ef6^
git worktree add --detach /tmp/xearch-after  11d2ef6

# entry.ts exports rerank, planL0, escalate, uniqueTerms, tokenize, mapAspects, emptyXQuery
esbuild /tmp/xearch-before/v8-entry.ts --bundle --format=esm --platform=node --outfile=before.mjs
esbuild /tmp/xearch-after/v8-entry.ts  --bundle --format=esm --platform=node --outfile=after.mjs
```

The worktrees need `node_modules` for `convex/values`. Symlink it from the main checkout.

```sh
# full dump, one function per filter (| alternation does not match)
node --allow-natives-syntax --print-bytecode --print-bytecode-filter=rerank harness.cjs ./before.mjs

# tier-up
node --allow-natives-syntax --trace-opt harness.cjs ./after.mjs

# deopt: both bundles in one process
node --allow-natives-syntax --trace-deopt ab.cjs
```

## What the captures show

- Both arms return the same sink (`2925254`) on the same inputs, so the comparison is behavior-locked.
- Closures per call for `rerank`: 7 to 1. The one that remains is the `compare` comparator.
- Total closure/context allocations across the six functions: 26 to 2.
- The main function's bytecode grew, 476 to 1856 bytes, because the `map` callback and the `maxSignal` pick closures moved inline. Counting closures is the metric; bytecode length is context, not a win by itself.
- `--trace-opt` shows Maglev then TurboFan on every hot function. `--trace-deopt` on the dual-bundle A/B shows `wrong map` bailouts: the separate arms deoptimize each other, which is why the first 16x result was thrown out and each arm was rerun in its own process.

Regenerate the animations from these files with `node make-gifs.mjs` in the parent directory.
