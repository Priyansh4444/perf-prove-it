# search-sorts: an array, an iterator, and a scan become three compares

Source: one recorded study (worker report retained in the perf-prove-it repository; no independent reproduction).
Unit: `isSearchSort` and `isAvailableSearchSort` over 7 fixed sort-name strings.

## The source change

Before: each call built a fresh 7-element array (`[...BASE_SORTS, ...ENGAGEMENT_SORTS]`) and ran a generic linear `includes` over it.

After: one `switch` over the literals. Same signatures, return types, defaults, and option tables. The strings are interned, so Maglev emits a straight `TestEqualStrict` chain with no allocation, no method call, no iterator.

## What the census returned

The census counts closures, so here it is quiet; the evidence is the two dumps side by side:

```text
baseline isSearchSort:  Bytecode length: 78  Register count 6  Frame size 48
switch   isSearchSort:  Bytecode length: 65  Register count 1  Frame size 8
```

Baseline, the allocation and the generic scan:

```text
@   10 : 85             CreateArrayFromIterable
@   22 : bf f4 02 04    GetIterator r5, FBV[2], FBV[4]
@   32 : 66 f6 f5 0f    CallProperty0 r3, r4, [next]
@   67 : 33 f8 06 14    GetNamedProperty r1, [includes]
@   72 : 67 f9 f8 03 16 CallProperty1 r0, r1, a0
```

Switch, only strict compares and boolean returns:

```text
@    2 : 76 03 00 00    TestEqualStrict a0, EmbeddedFeedback[0x0]
@   61 : 11             LdaTrue
@   63 : 12             LdaFalse
```

`CreateArrayFromIterable` built a fresh 7-element array through the iterator protocol on every call; `TestEqualStrict` is a pointer compare against an interned constant. That swap removed the allocation, the iterator calls, and the linear scan in one step.

## Outcome and identity

`isSearchSort` 38.22 to 4.86 ns/op (7.9x), `isAvailableSearchSort` 42.73 to 5.21 ns/op (8.2x), pinned to one P-core, 11 processes per arm. Scavenges per 1M calls: 219 to 220 down to 0 on both functions. Both reach Maglev, neither reaches TurboFan at this size; zero deopts.

Identity: 220,979 differential checks, 0 mismatches. The fuzz caught a real edge before landing: for base sorts with a truthy non-boolean engagement value, the baseline returns the engagement value itself (for example `1`), not `true`, so the switch branches return `engagement || true` and `engagement || false`. Cost disclosed: the sort names now live in three places, and the old constants had to be deleted for the repo's deny-warnings lint.
