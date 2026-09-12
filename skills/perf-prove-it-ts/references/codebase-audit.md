# Static codebase audit

Use this route when the user names a repository, package, or subsystem rather than one function. The output is a ranked queue for investigation, not a performance verdict.

## Map execution surfaces

Read structural files first: package scripts, workspace config, framework config, server/client entry points, workers, scheduled jobs, public handlers, and benchmarks. Exclude generated output, dependencies, fixtures, snapshots, `.repos/`, and vendored code. Benchmarks establish workload intent and measurement conventions; label findings inside benchmark code separately so they are not mistaken for product candidates. Keep tests as behavioral evidence, even though the scanner excludes test files from candidate output by default.

Partition candidates by workload because frequency is not comparable across them: startup/build; request, mutation, or job; per-record loop; render/reactive recomputation; and background polling, streams, or callbacks.

## Run deterministic triage

Run `node scripts/static-audit.mjs <source roots...>`. Review high-scoring hits in source. Delete false positives caused by cold code, bounded collections, build-time execution, or unreachable paths. Merge hits from one enclosing function. Add manually found algorithmic work the scanner cannot recognize: repeated database calls, N+1 RPCs, serialization boundaries, redundant parsing, bad query indexes, and inappropriate data structures.

## Rank reviewed candidates

Use ordinal evidence, not invented precision:

| dimension | 0 | 1 | 2 |
| --- | --- | --- | --- |
| repetition | once/unknown | per request/render | nested or per element |
| work | trivial | allocation/traversal | parse/I/O/sort/serialization |
| reachability | unclear | reachable entry | representative workload observed |
| removability | contract-bound | reducible | deletable/hoistable |
| risk | cross-boundary | local with edges | local and behavior-locked |

Order by higher repetition, work, reachability, and removability; use lower risk as the tie-breaker. Preserve the dimension values so another model can reproduce the order.

## Promote evidence

For each top candidate:

1. Trace callers to an entry point and name the reachable input shape.
2. Choose the smallest frequency probe: a call counter, CPU profile, framework interaction trace, or query log.
3. If frequency is material, switch to `references/discovery.md`.
4. Investigate and land candidates independently.

If runtime execution is unavailable, stop at a static audit. State what was inspected and excluded, which claims remain unmeasured, and the exact probe needed next.

## Scanner interpretation

Each rule returns a process record: syntax evidence, a symbolic current-work model, a candidate floor, and the next proof needed. It does not guess a speedup.

`parallel-array-growth` is calibrated against Solid's packed-subscription-edge change. When one owner appends related values to parallel arrays, it reports `E × 2 push calls` versus a candidate floor of `E × 1 push call` while preserving two logical values. It does not claim half the element storage or half the growth allocations: JavaScript capacity policy is runtime-defined and must be measured.

Other rules report conservative syntax leads: nested loops, callback or parse syntax near loops, serial `await` near loops, inline sort comparators, iterable spreads into calls, reusable construction inside functions, and collection callbacks inside Solid reactive primitives.

These are not diagnoses. `await` can preserve ordering or backpressure; callbacks can be optimized away; constructed collections can escape; reactive work can be cold; and nested loops over bounded inputs can be cheap.

For nested scans, derive the aggregate bound before ranking. If each inner scan consumes a disjoint segment and the outer cursor never revisits elements, total work is `O(N)`, not `O(N²)`. Lower or remove the finding unless expensive work remains per visited element.
