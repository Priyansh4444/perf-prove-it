# Benchmark protocol

Read this only when timing, A/B, or a speed claim is requested.

Define the unit, stable input shapes, output sink, and behavior assertion first. Run an A/A control before A/B. Use one process per arm; never load two bundles into one process. Record Node/V8/architecture, machine load, build hash, flags, cold/warm state, and dropped-run rule. Warm until the target tier is observed, then run at least five isolated trials per arm. Report every run, median, spread, and arithmetic. Reject deltas inside A/A noise. Separate construction counts, timing, GC, RSS, and cold-start cost; do not extrapolate scale without measured per-unit arithmetic. A win that does not reproduce on the representative workload is not a win; page-like workloads are often startup-, parse-, or GC-dominated, so grade the change there.
