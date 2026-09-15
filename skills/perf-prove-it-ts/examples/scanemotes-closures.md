# scanemotes: clones, iterators, and per-message closures

Sources: one recorded study (worker report, corrected by the verifier report, retained in the perf-prove-it repository).
Units: `scanEmotes` and `ingestMessage` in a chat ingest path, per message.

## The source change

The ledger, allocation by allocation:

1. `text.matchAll(m.regex)` ran 3 times per message. Per spec `matchAll` clones the global RegExp and allocates an iterator, and each clone forces a RegExp compile-cache lookup. Replaced with one `exec` loop over a shared regex whose `lastIndex` is reset first.
2. A `priority` object was allocated per call and captured by the `sort` comparator, so every call built a function context plus three closures (two sort comparators and the `kept.some` callback, which was recreated per span).
3. `bumpTarget` was a closure created per message, capturing three variables.
4. `[...twitchSpans, ...thirdPartySpans].sort(...)` allocated a third array plus a fresh comparator; the local array was already mutable.
5. `isEmoteSpam(words)` ran twice per message; `msg.text.trim()` ran up to three times.
6. Regex literals inside the per-token loop allocated a fresh RegExp object per evaluation.

## What the census returned

The verifier ran the installed census on its own dumps:

```text
scanEmotes baseline: 3 closures, 1 context (total 4)
scanEmotes optimized: 0 closures, 0 contexts (total 0)
ingestMessage baseline: 2 closures, 1 context (total 3)
ingestMessage optimized: 0 closures, 0 contexts (total 0)
```

Bytecode lengths reproduce exactly: scan 644 to 673, ingest 1311 to 1255. Note the optimized scan function is longer: fewer allocations does not always mean shorter bytecode.

The one line that changed, from the worker's dump:

```text
983211 S> ... @  820 : 8b 25 01 02  CreateClosure [37:... <SharedFunctionInfo bumpTarget>], FBV[1], #2
```

V8 built a function object plus its captured scope for `bumpTarget` on every message. Absent from the optimized dump, along with the `GetNamedProperty [matchAll]` path and `CreateFunctionContextWithCells`. TurboFan on every hot function, both arms.

## Outcome and identity

Timing, separate processes, per message: scan 21.33 to 5.19 µs (4.1x worker, 3.91x verifier), ingest 35.99 to 17.79 µs (2.0x worker, 1.94x verifier). The headline ratios sit at the optimistic edge of run noise; direction and magnitude confirmed. Scavenges per 100k calls: 381 to 316. All 62 repo tests green; output digest byte-identical on a 4,000-message corpus plus edges.

## What the verifier corrected

- The heap claim as written (+1.59 MB to +0.28 MB) is falsified. The worker's own optimized log said +2.63 MB, and five forced-GC trials show no retained growth either way. The surviving claim is the scavenge rate. This case is why the skill now says a no-GC heap delta is churn, never retained.
- Shared mutable `lastIndex` is safe only because no caller leaves a non-zero `lastIndex` on a matcher and the function is synchronous; preset `lastIndex`, non-global regexes, and `u`-flag zero-length matches diverge or hang outside the reachable domain, and the report now says so.
