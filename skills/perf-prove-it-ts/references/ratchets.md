# Ratchets: make a benchmark a gate

Read this when a win must stay won, or when CI needs a number that cannot flake.

A benchmark has two jobs: move a metric you control in the lab, and guard it in CI with a number that only goes down. A benchmark that does neither is a demo. The count is the gate; the clock is context.

## Correlation gate

A counter earns its place only if it provably tracks wall clock or a field metric. Run both on the same benchmark: the count under a deterministic tool, the timing under plain Node with the JIT warm. If the count moves and the clock does not, or the count is flaky, throw the benchmark out rather than let an agent climb the wrong hill. Two external paths that passed the gate (Anthropic, Aug 2026; not this project's runs):

| hot path | rewrite | Ir | wall | speedup |
| --- | --- | --- | --- | --- |
| message-tree assembly | resolve each message ID once, not three times | -48% | -78% | 4.6x |
| status-line scanner | cheap first-character check before the regex | -31% | -44% | 1.8x |

Counts ran under Valgrind with `node --predictable`; timings ran under plain `node` with the JIT warm.

## Counts that repeat

CPU instructions are the strongest gate for a pure-JS hot path. One run, no statistics:

```sh
valgrind --tool=callgrind --callgrind-out-file=/tmp/cg.out node --predictable bench.cjs
callgrind_annotate --auto=yes /tmp/cg.out | head -40   # Ir per function
```

`Ir` (instruction reads) is deterministic for a fixed build, input, and harness, so one run is the comparison. Check the total, or the target function's share, into the repository as a baseline. Valgrind is Linux and macOS; `npx perf-prove-it machine` reports whether it is installed. On a machine without it, use precise coverage call counts, or run the count in a container.

Deterministic counters, strongest first, per runtime:

- Native: `perf stat` instruction counts, or `iai-callgrind` for a stable CI gate (`perf-prove-it-rust`).
- Pure JS: Callgrind `Ir` under `node --predictable`.
- JS without Valgrind: V8 precise coverage function call counts (`NODE_V8_COVERAGE=dir`, then read the JSON; or CDP `Profiler.takePreciseCoverage`). Counts calls, not instructions.
- Browser: React commits per interaction, style recalculations, layout passes, DOM mutations (`perf-prove-it-dom`, `references/measurement.md`).
- Wall clock: context only, too noisy for a gate.

## The ratchet

1. Pick the count and prove it correlates (above).
2. Check the baseline into the repo, next to the benchmark.
3. CI fails any change that raises it.
4. A scheduled job lowers the ceiling whenever the count drops, so the floor only moves one way.

Ratchet the paths that carry the workload, not every function. A ratchet that does not track user latency is a tax on unrelated changes.

## Scope and traps

- Valgrind serializes execution and disables the JIT, so `Ir` is a work counter, not a speed prediction. Keep the production-config timing run separate.
- Keep `--predictable` on every arm of a count comparison; it pins the random seed and removes GC and compile concurrency (`benchmark-protocol.md`).
- A count can be deterministic and still wrong: if the harness reimplements the function instead of importing the artifact, the ratchet guards the wrong code (`compiled-artifact.md`).
- The count does not replace the behavior assertion. Same outputs on the same inputs first, then the count, then the clock.

## Keep finding things to measure

Every counter that passes the gate adds a path an agent can improve and a guardrail that keeps it. The highest-leverage move is not a bigger optimization; it is one more thing that can be measured and ratcheted.
