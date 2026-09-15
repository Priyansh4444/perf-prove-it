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

The scanner also reports three advisory structural leads: `chained-collection-passes` (`N elements × P passes plus P−1 intermediate arrays` versus one fused pass), `full-sort-then-take` (`O(N log N)` comparator work to retain 1 element or the first k versus `N−1` comparisons via one linear extremum scan, or a partial selection when k > 1), and `existential-filter` (`N` predicate evaluations plus one intermediate array to decide existence versus short-circuiting `some`/`find` with no allocation). Each carries its proof obligation: fusion purity with no escaping intermediate identity and preserved order/short-circuit semantics; first/k-only consumption with the comparator extremum matching a linear scan (same tie-breaking); and length compared only against 0/1, never consumed as a count. Known intentional misses stay with human triage: cross-statement takes like `const t = [...v].sort(...); t[0]`, same-receiver cross-statement fusion, and bare-truthy length.

`comparator-repeated-work` is a review-confidence rule: it resolves the comparator body of `sort`/`toSorted` and reports repeated `Date.parse`, `compareDateTimeStrings`, `parseTimestamp`, `.find`, `Intl` construction, or `structuredClone` inside it (`O(N log N)` invocations, each repeating P calls). This was the largest measured win in the T3 Code harvest: `retainMessagesAfterRevert` at 14.7x and `hubCredits` at 21x, both by hoisting a parse out of the comparator. It is intraprocedural: a parse hidden behind a called helper (for example `orderReset(account)` inside a comparator) is not detected and needs human triage. Hoisting a pure parse is behavior-preserving, but preserve the tie-break order exactly; keyed comparisons must match the original comparator on ties.

Ranking counts static call sites. A finding inside a function that is itself defined in the scanned code is raised by +1, +2, or +3 rank points when that function has 1–2, 3–9, or 10+ call sites (`name(` or `this.name(`) across the scanned roots. The census is lexical: imports, framework hooks, and calls on other receivers are never counted, so `useState()` or `useMemo()` cannot raise a rank, and a frequently-called local helper ranks above a rarely-called one. Interface and overload signatures are not call sites. It counts where a function appears to be called, not how often it runs; it reorders review and never substitutes for the frequency rung of the evidence ladder.

The census resolves names, not identities: same-named functions in different files or classes merge their counts, aliased imports and re-exports are not followed, and calls written as `fn<T>()`, `fn?.()`, `(fn)()`, or inside a template-literal `${}` interpolation are not seen. The scanner is not a parser: a `/` in a context where a regex and a division are both plausible (after `>`, or a bare `}`) is decided by a heuristic, and a regex literal can therefore mask a line. Treat the count as an ordinal hint, not an exact call graph.

For nested scans, derive the aggregate bound before ranking. If each inner scan consumes a disjoint segment and the outer cursor never revisits elements, total work is `O(N)`, not `O(N²)`. Lower or remove the finding unless expensive work remains per visited element.
