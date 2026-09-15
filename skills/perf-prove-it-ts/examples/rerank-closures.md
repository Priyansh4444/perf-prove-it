# rerank: seven closures to one, then the calls that remained

Sources: one recorded study (worker and verifier reports retained in the perf-prove-it repository), summarized in `references/patterns.md` and `references/findings.md`.
Unit: `rerank` in a search ranking engine, 200 candidates per call.

## First run: the closures

The original census table for the ranking engine:

```text
function    closures before -> after   contexts before -> after
rerank             7 -> 1                      1 -> 1
tokenize           4 -> 0                      1 -> 0
mapAspects         4 -> 0                      1 -> 0
planL0             1 -> 0                      1 -> 0
escalate           5 -> 0                      1 -> 0
```

Seven closures in `rerank` meant seven function objects built per query, plus one object per candidate and throwaway arrays from three `Math.max(...rows.map(pick))` calls. After the fusion there is one loop, one closure (the comparator), and three output arrays. Bytecode grew 476 to 1856 because the callback bodies moved inline into the caller; that growth is compile time and cold start, not per-call cost.

## Second run: the calls that remained

A later calibration on the already-fused `rerank` found three per-call costs the first pass left behind: `bm25` recomputing `idf` per candidate-term (about 600 `Math.log` calls where 3 to 8 suffice), a `byId` Map kept alive only to fetch `createdAt` (one `set` per candidate, two `get`s per sort comparison), and a `fitBonus` closure call per candidate with loop-invariant sub-expressions inside it.

The verifier's own census on this run:

```text
base: rerank 1912 bytes, closures 1, contexts 1, arr 2, obj 6
opt:  rerank 2151 bytes, closures 1, contexts 1, arr 7, obj 3
```

Static call rollup: `CallProperty0/1/2` 10/10/7 to 8/9/7. The fix caches idf per distinct term, replaces the Map with parallel indexable arrays and an index comparator, and inlines `fitBonus` with invariants hoisted.

## The one line, and the correction

The worker quoted this as the removed `fitBonus` call:

```text
base @  299 : 66 c8 c7 38  CallProperty0 r49, r50, FBV[56]
opt  @  299 : 1a c1        Star r56
```

The verifier extracted the bundle source at that offset and showed `@299` is inside the `for...of` iterator over candidate terms (`GetNamedProperty [next]` and `JumpIfJSReceiver` just before it). The removed call is real but lives elsewhere:

```text
BASE @1085: CallUndefinedReceiver2 r40, r41, r22   (source: "const fit = fitBonus(xq, c);")
```

Attaching meaning to a line requires the source position table, not the offset. The aggregate counts were right; the quoted line was not. This is why the skill demands the source excerpt next to every cited instruction.

## Outcome and identity

Timing, separate processes, 200 candidates: 0.0848 ms to 0.0548 ms per call, 34.7% on the verifier's protocol (the worker's 35.4% did not reproduce exactly). Maglev then TurboFan, no deopts, both arms. Identity holds only for unique ids; duplicate `tweetId`s diverge, and the only production caller builds candidates from Map keys, so the domain excludes them. The report states that boundary instead of claiming bit-identical.
