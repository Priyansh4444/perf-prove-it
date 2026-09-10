# Memory and heap: proof, not vibes

## Scavenging: good or bad?

Neither. Scavenging is V8's young generation copying collector. It exists to reclaim short-lived garbage cheaply, and its copying runs on worker threads during a short stop-the-world pause. Judge it by what it costs, not by how often it runs.

Scavenging is good when:

- Total GC time stays flat or falls.
- Max pause stays inside the latency budget.
- Peak RSS falls or holds.
- Short-lived allocations die in the young generation instead of being promoted.

Scavenging is bad when:

- GC time rises with the same useful work.
- Pauses spike into p99.
- Objects that should die young get promoted to old space, causing major GCs later.
- The count is high only because the code allocates garbage it does not need.

The count of scavenges tracks how many bytes were allocated into the young semi-space, not how healthy the program is. Our own run is the proof: removing six closures per call raised scavenges from 687 to 1410 per 100k calls while total GC time stayed flat at ~58 ms and peak RSS fell 21%. That is neutral behavior, not a regression. Report GC time and peak RSS as the verdict; mention scavenge count as context.

## Metrics that matter

| Metric | How to read it | Source |
| --- | --- | --- |
| Total GC time | The real cost of churn | `--trace-gc`, PerformanceObserver |
| Max pause | Latency risk | `--trace-gc`, PerformanceObserver |
| Major-GC count and time | Promotion pressure | `--trace-gc` lines tagged `Mark-Compact` |
| Peak RSS | User-visible footprint | `process.resourceUsage().maxRSS`, `/usr/bin/time -v` |
| Heap used after `global.gc()` | Retained size, leak check | `process.memoryUsage().heapUsed` |
| Retained size per object | Leak proof | heap snapshots |

## GC traces

```sh
node --trace-gc app.mjs
node --trace-gc-nvp app.mjs   # one JSON object per collection after "GC: "
```

Count collections and total pause from the output, and keep the workload fixed between arms. For a process under test, a GC observer gives the same numbers without parsing:

```js
const { PerformanceObserver } = require('node:perf_hooks');
const gc = { count: 0, ms: 0 };
new PerformanceObserver((list) => {
  for (const e of list.getEntries()) {
    gc.count += 1;
    gc.ms += e.duration;
  }
}).observe({ entryTypes: ['gc'] });
```

Disable the observer for speed measurements; it adds work per collection.

## Allocation profiles

```sh
node --heap-prof --heap-prof-dir=/tmp/v8bench app.mjs
node --heap-prof-interval=65536 --heap-prof app.mjs   # finer sampling, more overhead
```

Open the `.heapprofile` in Chrome DevTools under Memory > Load. The profile attributes sampled allocations to stacks. Use it when the census counts a closure statically and you need to know whether it actually runs.

## Heap snapshots

```sh
node --heapsnapshot-signal=SIGUSR2 app.mjs
node --heapsnapshot-near-heap-limit=3 app.mjs
```

```js
const v8 = require('node:v8');
v8.writeHeapSnapshot('/tmp/v8bench/after.heapsnapshot');
```

Open `.heapsnapshot` in Chrome DevTools under Memory > Load. How to read:

- Shallow size is the object itself. Retained size is everything that dies when it dies. Leaks are retained size.
- Sort by retained size, then use the Retainers panel and the Distance column to find what is holding the object.
- The Comparison view is the fastest path: snapshot A, run the workload N times, `global.gc()`, snapshot B, compare. Look at the delta in `(string)`, `(closure)`, `(array)`, and your own class names.

## Leak proof protocol

1. Run the workload once or twice to warm caches. Lazy compilation in the first pass is not a leak.
2. With `node --expose-gc`, call `global.gc()` twice and wait until `process.memoryUsage().heapUsed` stabilizes, then snapshot A.
3. Run the suspicious cycle N times, for example 10k requests, 1k renders, or 100 reconnects.
4. `global.gc()` twice, snapshot B.
5. Run N more cycles, `global.gc()` twice, snapshot C. A cache fill plateaus; a leak scales with N. Declare a leak only when retained growth scales from A to B to C.
6. Freeze the workload, inputs, flags, and build for all snapshots, and record them.
7. Confirm the retainer path for each growth site, then write one verdict per site with the snapshot numbers.

## Where closures actually leak

- `addEventListener` on persistent nodes, especially on every render.
- Timers capturing large scopes, `setInterval` never cleared.
- Per-call closures stored into module-level caches.
- Unbounded `Map`/`Set` caches with no eviction or TTL.
- Event emitters with listeners added per request and never removed.
- Detached `ArrayBuffer`s still referenced by closures.
- Worker, stream, or queue buffers that grow faster than they drain.

Grep for these as triage, then prove each with the protocol above. "Looks bounded" is not a verdict.

## Elements kinds, measured

`node --allow-natives-syntax -e '... %DebugPrint(a)'` prints the elements kind. Verified on Node 26:

```text
new Array(3) filled with doubles  -> FixedDoubleArray[3]  HOLEY_DOUBLE_ELEMENTS
[] with push                      -> FixedDoubleArray[n]  PACKED_DOUBLE_ELEMENTS (geometric capacity)
new Float64Array(3) filled        -> FLOAT64ELEMENTS
arr.length = 3 then fill           -> HOLEY_SMI to HOLEY_DOUBLE, same backing-store transition as new Array(3)
```

Preallocation avoids growth copies but starts holey and pays a backing-store allocation when the kind transitions from Smi to Double while filling. For internal numeric scratch where churn matters, `Float64Array` avoids both. `arr.length = n` is chosen for lint compatibility, not speed. `--trace-elements-transitions` prints transitions but is noisy; prefer `%DebugPrint` on a known object.

## Do not measure with instruments attached

Heap profilers and snapshots slow the process and change allocation behavior. Profile to find a site, then measure the fix without the profiler attached. Same rule as CPU profiling: the instrument picks the unit, the harness measures the change.
