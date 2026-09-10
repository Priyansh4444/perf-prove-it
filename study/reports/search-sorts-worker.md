# search-sorts: hot-path optimization report

**Verdict: PASS** - `isSearchSort` 38.22 → 4.86 ns/op (7.9x), `isAvailableSearchSort` 42.73 → 5.21 ns/op (8.2x), allocation eliminated (219-220 → 0 scavenges per 1M calls), behavior proven identical on 220,979 differential checks. No loss measured. Checkout left untouched (`git status --porcelain -- src/search-sorts.ts src/search-sorts.test.ts` empty).

Artifacts: `evidence/search-sorts.optimized.ts` (final patch source), `evidence/change.diff`, raw logs in `evidence/`.

---

## 1. Smallest-steps target derived from the actual code

The two hot functions do two avoidable things per call:

1. `isSearchSort` builds a fresh 7-element array per call: `[...BASE_SORTS, ...ENGAGEMENT_SORTS]`, then calls generic `Array.prototype.includes` (linear scan, iterator/`length` protocol at the bytecode level).
2. `isAvailableSearchSort` calls `isSearchSort` and then conditionally does a second linear `includes` over `ENGAGEMENT_SORTS`.

The domain is 7 fixed string constants, so the floor is one guard plus one interned-string dispatch. The smallest step that reaches that floor: replace each body with a single `switch` over the literals, leaving signatures, return types, defaults, `searchSortOptions`, and `searchSortLabel` untouched. Switch wins over the alternatives (details in §5), and because the strings are interned, Maglev emits a straight `TestEqualStrict` chain with no allocation, no method call, no iterator.

Target derived from the code, not guessed: 7 constants → dispatch; measured floor ~4.7-5.3 ns across three independent designs (switch / Set / Map), i.e. remaining time is call overhead, not search.

## 2. Commands and raw outputs

All commands run under `/tmp/swarm-study/search-sorts/` (checkout read-only, symlinked as `repo/`). Benchmarks pinned to P-core 2 (`taskset -c 2`), Node v26.8.2, Intel Core Ultra 7 255H, governor `powersave`.

### Timing - medians per arm, separate processes

`evidence/bench.mjs` imported one arm per process, 300k calls/batch x 15 batches, median of in-process batches; 11 separate processes per arm, interleaved; summary = median of the 11 process medians. Mixed input pool: 60% base sorts, 30% engagement sorts, 10% invalid, plus `undefined`.

```
arm-a-baseline isSearchSort              n=11 min 38.00 grand-median 38.22 max 39.60
arm-a-baseline isAvailableSearchSort     n=11 min 42.13 grand-median 42.73 max 43.67
arm-c-switch isSearchSort                n=11 min  4.74 grand-median  4.86 max  4.96
arm-c-switch isAvailableSearchSort       n=11 min  5.17 grand-median  5.21 max  5.30

isSearchSort           38.22 -> 4.86 ns/op = 87.3% faster, 7.9x
isAvailableSearchSort  42.73 -> 5.21 ns/op = 87.8% faster, 8.2x
```

Raw: `evidence/timing-final-pinned.jsonl`, `evidence/timing-final-pinned-summary.txt`. (Unpinned runs were bimodal, 6 vs 10 ns, from P/E-core migration; pinning removed that. Pinned sweep: `evidence/timing-pinned.jsonl`.)

### Counts / bytecode before and after

`node --print-bytecode --print-bytecode-filter=<fn>` on each arm (`evidence/bytecode-*.txt`):

```
baseline isSearchSort:  Bytecode length: 78  Register count 6  Frame size 48
switch   isSearchSort:  Bytecode length: 65  Register count 1  Frame size 8
```

Baseline contains the allocation and generic scan:

```
@   10 : 85             CreateArrayFromIterable
@   22 : bf f4 02 04    GetIterator r5, FBV[2], FBV[4]
@   32 : 66 f6 f5 0f    CallProperty0 r3, r4, [next]
@   67 : 33 f8 06 14    GetNamedProperty r1, [includes]
@   72 : 67 f9 f8 03 16 CallProperty1 r0, r1, a0
```

Switch contains only strict compares and boolean returns:

```
@    2 : 76 03 00 00    TestEqualStrict a0, EmbeddedFeedback[0x0]
@   61 : 11             LdaTrue
@   63 : 12             LdaFalse
```

### Engine tier lines

`node --trace-opt --trace-deopt` (`evidence/trace-opt.out`, `trace-full-*.out`):

```
baseline: [completed compiling <JSFunction isSearchSort> (target MAGLEV) - took 0.000, 0.608, 0.009 ms]
switch:   [completed compiling <JSFunction isSearchSort> (target MAGLEV) - took 0.000, 0.110, 0.001 ms]
baseline: isAvailableSearchSort (target MAGLEV) - 0.473 ms
switch:   isAvailableSearchSort (target MAGLEV) - 0.142 ms
```

Both reach Maglev; neither tiered to TurboFan in Node 26 for this size. Zero deopts of either function (the single `deoptimiz` line is an OSR bailout of the bench harness's `oneBatch`). Compile cost dropped ~5x as a side effect.

### Exact test command and result

Run in an isolated work copy (`work/`, `node_modules` symlinked, vitest `cacheDir` overridden so nothing writes into the checkout):

```
$ ./node_modules/.bin/vitest run --config vitest.search-sorts.config.ts
 Test Files  1 passed (1)
      Tests  2 passed (2)
   Duration  336ms (transform 61ms, setup 0ms, import 90ms, tests 9ms, environment 0ms)
$ ./node_modules/.bin/tsc --noEmit -p tsconfig.json        -> TSC OK
$ ./node_modules/.bin/oxlint --type-aware --import-plugin --deny-warnings src/search-sorts.ts -> LINT OK
```

Raw: `evidence/vitest-search-sorts.out`. Note: the repo's own config requires jsdom/solid setup; the work copy uses a minimal config with the same vitest 4.1.11 and test file, because running in the checkout was forbidden.

### Memory

1M calls, 1MB semi-space, `--trace-gc` scavenge lines (`evidence/memory-final.out`):

```
a-baseline isSearchSort: 219 scavenges
a-baseline isAvailableSearchSort: 220 scavenges
c-switch   isSearchSort: 0 scavenges
c-switch   isAvailableSearchSort: 0 scavenges
```

Default-heap delta after 1M calls: baseline 926,480 B vs switch 20,088 B (`isSearchSort`); 63,960 B vs 21,464 B (`isAvailable`). Baseline's true allocation (~7-element array/call) mostly shows up as GC pressure, hence scavenge count is the load-bearing number.

## 3. How behavior identity was proved

Differential fuzz of the real TypeScript modules through Bun (Bun supports `import.meta.env`; plain Node does not). `evidence/fuzz-parity.ts` imports the untouched original (`work/src/search-sorts-baseline.ts`) and the optimized module and compares with `Object.is`:

- 20,089 value inputs: all 7 valid names, case/whitespace/mutation variants, dangerous keys (`__proto__`, `constructor`, `toString`, …), empty/unicode/NUL, 20k seeded random strings, and non-strings (`undefined`, `null`, numbers, `NaN`, `Infinity`, `true/false`, `BigInt`, `Symbol`, `{}`, `[]`, `new String`, `Object.create(null)`, function) - no coercion possible because of the guard.
- 11 engagement variants per input: `true, false, 0, 1, "", "yes", null, undefined, NaN`, plus the one-argument default path.

```
{"inputs":20089,"checks":220979,"mismatches":0,"status":"IDENTICAL"}
```

The first fuzz run caught 6 real mismatches (`evidence/fuzz-parity.out`): for base sorts with a truthy **non-boolean** engagement, baseline `engagement || !includes(...)` returns the engagement value itself (e.g. `1`), not `true`. The fix is still a one-expression switch branch: base sorts return `engagement || true`, engagement sorts return `engagement || false` - `Object.is`-identical to baseline for every runtime value, not just the typed `boolean` domain. Plus the pre-existing vitest suite (2/2), `tsc`, and `oxlint --deny-warnings` all pass on the final file.

## 4. Measured impact, cost, and revert

- Impact: 7.9x / 8.2x throughput at the function level; zero allocation on both (baseline 219-220 scavenges/1M → 0); smaller bytecode (78→65 bytes, frame 48→8), faster Maglev compile (0.608→0.110 ms). No loss measured on correctness, types, lint, or the other exports.
- Cost: the switch repeats the 7 sort names, so the file now lists them in three places (`searchSortOptions`, `isSearchSort`, `isAvailableSearchSort`). Adding a new sort still needs the options table plus both switches. The old `BASE_SORTS`/`ENGAGEMENT_SORTS` constants became dead and were deleted - required, because `oxlint ... --deny-warnings` (the repo's CI gate) flags unused vars. Deleting them is not a behavior cost (nothing else read them) but it is the reason the diff is more than a two-line body swap. Alternative `Map` design keeps a single source of truth at 5.31 / 6.28 ns - 1.3 ns/call slower on `isAvailableSearchSort`; switch chosen per the "as fast as they can be" brief.
- Revert: `git -C /home/pronsh/Coding/ytsearch checkout -- src/search-sorts.ts` (checkout is untouched, so this is a no-op until the patch is applied). The patch to apply is `evidence/search-sorts.optimized.ts`; `evidence/change.diff` is the exact hunk. Full rollback = delete the work/evidence dirs.

## 5. Arm comparison (why switch)

Pinned 9-round sweep, median of process medians (`evidence/timing-pinned-summary.txt`):

```
                         isSearchSort   isAvailableSearchSort
baseline (spread+includes)   38.26            42.63
Set.has                       4.71             6.27
switch                        4.84             4.99
Map<string,"base"|"engagement"> 5.31           6.28
object lookup                18.0             20.7
```

Set is 0.13 ns faster standalone; switch is 1.28 ns faster on the route-parsing function (`src/search-route.ts:39` calls `isAvailableSearchSort`), so switch wins overall. A mixed Set+switch design was rejected as a maintainability trap for <0.2 ns.

## 6. One bytecode line that changed

`@ 10 : 85 CreateArrayFromIterable` → `@ 2 : 76 03 00 00 TestEqualStrict a0, EmbeddedFeedback[0x0]`.

`CreateArrayFromIterable` materialized a new 7-element array via the iterator protocol on every call (plus `GetIterator`/`CallProperty0`/`CallProperty1 includes`); `TestEqualStrict` is a pointer-equality compare against an interned string constant. That swap removed the allocation, the iterator calls, and the linear scan in one step - and is where the ~33 ns/call and 220 scavenges/1M calls went.

## 7. Friction / what felt missing

- The checkout is a symlink to a read-only tree; `import.meta.env` meant plain Node could not import the real TS module, so benchmarks use hand-kept `.mjs` mirrors of each arm and parity uses Bun (which resolves `import.meta.env`). A repo-provided microbench harness (or `vite-node`) would remove the mirror-drift risk.
- Unpinned timings were bimodal (P-core vs E-core). Only `taskset` produced stable numbers; that should be standard for this machine.
- No allocation counter is exposed by Node; scavenge counts under a 1MB semi-space are a proxy, not exact bytes/call.
- The repo's `deny-warnings` lint combined with the switch design forced deleting the two constants; a data-driven lookup keeps them but costs ~1.3 ns on the hot route function. Worth a conscious owner decision if sort membership ever becomes dynamic.
