# Findings: what the method measured, and what surprised it

Real run: a TypeScript ranking engine (`rerank`, 200 candidates per call) in a Convex backend. Before and after the closure and pass fusion cuts. Counts from Ignition bytecode, timings from isolated processes, medians of 5 runs of 100k calls, functions verified at TurboFan, box at load ~2.5. These are numbers from one run on one machine; reproduce before quoting.

## Counts

```text
function    closures before -> after   contexts before -> after
rerank             7 -> 1                      1 -> 1
tokenize           4 -> 0                      1 -> 0
mapAspects         4 -> 0                      1 -> 0
planL0             1 -> 0                      1 -> 0
escalate           5 -> 0                      1 -> 0
```

Temporaries per rerank call: about 204 (one object per candidate plus throwaway arrays) to 3 output arrays. All goldens green, 103 tests passing.

## Outcomes

| Metric | Before | After |
| --- | --- | --- |
| rerank per call, TurboFan | 42.8 µs | 38.9 µs |
| peak RSS per 100k calls | 154 MB | 122 MB |
| total GC time per 100k calls | 58.2 ms | 58.1 ms |
| scavenges per 100k calls | 687 | 1410 |
| rerank bytecode | 476 bytes | 1856 bytes |

## What the surprises mean

**Scavenges doubled and nothing was wrong.** Removing 200 objects per call did not lower scavenge count. The after code preallocates three numeric arrays with `new Array(n)`, which are `HOLEY_DOUBLE_ELEMENTS` after filling and allocate a second backing store during the Smi to Double transition. More, smaller young objects means more, cheaper scavenges. GC time stayed flat and peak RSS fell 21%, so the memory result is a win. Scavenge count alone would have called it a regression.

**The speed win was 9%, not 10x.** TurboFan inlines small callbacks and escape-analyzes allocations that do not escape, so much of the closure cost the census found was already hidden in the hot tier. The cuts still removed real churn and lowered peak memory. The lesson: the census finds churn, and the tier decides what it costs.

**Bytecode grew 476 to 1856 and that is the shape of the win.** The callback bodies moved inline into `rerank`, so the caller got bigger and the anonymous closures went away. Bytecode runs in the cold tier; the growth is a compile-time and cold-start cost, not a per-call one. It is also the positive story: the work moved out of six closures into one readable loop.

**`new Array(n)` is not free, it is a trade.** Verified on Node 26 with `%DebugPrint`:

```text
new Array(3) filled with doubles  -> HOLEY_DOUBLE_ELEMENTS, new backing store on transition
[] with push                      -> PACKED_DOUBLE_ELEMENTS, grows by capacity
new Float64Array(3)               -> FLOAT64ELEMENTS, packed, no holes
```

Preallocation avoids growth copies but is holey. For internal numeric scratch where churn matters, `Float64Array` is the shape with no holes and no transition.

**A 16x win was fake.** The first interleaved A/B reported a 16x speedup for the new arm. `--trace-deopt` showed `wrong map` bailouts: both bundles loaded in one process deoptimized each other. Each arm must run in its own process. The fake number was thrown out and the honest one is the 9% above.

## Heap tooling, verified

```sh
node --heap-prof --heap-prof-dir=. --heap-prof-name=leak.heapprofile app.mjs   # writes .heapprofile
node -e 'require("node:v8").writeHeapSnapshot("./snap.heapsnapshot")'          # writes a snapshot
```

Both were exercised on Node 26 and produce files that open in Chrome DevTools Memory panel. Leak verdicts come from snapshot comparison after `global.gc()`, not from grep. Commands and reading guide: `memory-and-heap.md`.

## How to read a result from this method

1. Counts tell you where churn can happen. They do not tell you speed.
2. Tier evidence tells you what the hot code is. Without it, any timing is suspect.
3. GC time and peak RSS are the memory verdict. Scavenge count is context.
4. Every win shows its price: bytecode bytes, code shape, readability. Put the price in the report and let the user pick.
