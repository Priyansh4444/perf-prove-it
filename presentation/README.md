# Real output

Captured from the search engine at PR #10 (`11d2ef6` and its parent). No hand-editing.

## GIFs, Vesper theme

- `gifs/rerank-before.gif`: the seven real `CreateClosure` lines in `rerank`, one per callback.
- `gifs/rerank-after.gif`: the single remaining closure. Callbacks moved inline, so the function's own bytecode grew from 476 to 1856 bytes.
- `gifs/opt-tier-up.gif`: real `--trace-opt`, Maglev then TurboFan on every hot function, no deopt lines.
- `gifs/deopt-wrong-map.gif`: real `--trace-deopt` with both bundles in one process. The `wrong map` bailouts are why the first 16x A/B result was thrown out.

## Raw captures

`bytecode/` holds the full dumps the GIFs are cut from:

- `rerank-before.txt`, `rerank-after.txt`: complete Ignition bytecode.
- `census-before.txt`, `census-after.txt`: closures and contexts per call across six hot functions. 26 to 2.
- `opt-after.txt`: tier-up trace.
- `deopt-ab.txt`: deopt trace from the dual-bundle A/B.

Each dump was produced by bundling the engine at that commit and running `node --allow-natives-syntax --print-bytecode` against the real harness.
