# Benchmark protocol

Read this only when timing, A/B, or a speed claim is requested.

Define the unit, stable input shapes, output sink, and behavior assertion first. Run an A/A control before A/B. Use one process per arm; never load two bundles into one process. Record Node/V8/architecture, machine load, build hash, flags, cold/warm state, and dropped-run rule. Warm until the target tier is observed, then run at least five isolated trials per arm. Report every run, median, spread, and arithmetic. Reject deltas inside A/A noise. Separate construction counts, timing, GC, RSS, and cold-start cost; do not extrapolate scale without measured per-unit arithmetic. A win that does not reproduce on the representative workload is not a win; page-like workloads are often startup-, parse-, or GC-dominated, so grade the change there.

## Determinism controls

When the question is mechanism rather than production wall clock, remove the concurrency that makes runs differ. `node --predictable` disables concurrent Sparkplug and concurrent recompilation, runs GC single-threaded (which also drops concurrent and parallel marking, sweeping, scavenging, and compaction), disables the memory reducer, and pins the random seed to `12347`. Construction counts, `--trace-opt` and `--trace-deopt` sequences, and A/A ratios then repeat across runs. It is not a production configuration: with concurrent marking and compilation gone, GC pauses and tier-up timing are not what users see. Never present a `--predictable` number as production speed; report the flag with the result and run the production-config arms separately. `--predictable-gc-schedule` goes further and fixes the semi-space size, which changes the scavenge-per-work rate, so apply it to every arm or the allocation rate is not comparable. `node --v8-options | grep predictable` prints the implications for the build in hand, because they move between releases.

For a CI gate rather than a one-off A/B, use a deterministic count and ratchet it down: `references/ratchets.md`.
