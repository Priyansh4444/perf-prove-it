# rerank() hot-path calibration - report

**Verdict: PASS** (with one repo-level caveat: `Array.from({length:n})` is a hot-path trap; see Costs/Gotchas).

- Function: `rerank` in `convex/engine/rank.ts` (73→)
- Prior work recognized: `11d2ef6` ("engine: fuse rerank loop, hoist closures, precompute lexicon") already fused the three signal passes into one, removed per-signal closures, and inlined phrase/should helpers. This change builds on that; nothing already-optimized was re-done.
- Baseline measured: **0.0848 ms/call** (median of 3 process medians, 200 candidates)
- Optimized measured: **0.0548 ms/call** - **−35.4% latency, 1.55× faster**, ~30 µs saved per query
- Behavior: **bit-identical output** in 3000/3000 differential fuzz cases and all 360 repo tests.
- Repo checkout untouched (`git status` in `/home/pronsh/Coding/xearch` → 0 changes). All writes under `/tmp/swarm-study/rerank-cal/`.

---

## 1. The smallest-steps target derived from the actual code

Reading the post-`11d2ef6` loop, three per-call costs were left on the table, each independently removable without touching the output contract:

1. **`bm25()` was called once per (candidate × matched term)**. `bm25` recomputes `idf = Math.log((totalDocs - df + 0.5)/(df + 0.5) + 1)` every call, but `idf` depends only on `(term, stats)` - constant for the whole `rerank` call. With 200 candidates × ~3 terms this is ~600 `Math.log` calls where ~3-8 suffice. Target: cache idf per distinct term.
2. **`byId: Map<string, Candidate>`** existed only to fetch `createdAt`. It cost one `Map.set` per candidate plus **two `Map.get` per comparator call** in the final `sort` (O(n log n) lookups) and one per dedup step. Target: carry `createdAt` in a parallel indexable array and compare by index.
3. **`fitBonus(xq, c)` was a closure call per candidate**, with xq-invariant sub-expressions (media filter, intent, `phrases.length`, `should.length`) re-evaluated each time. Target: inline it with invariant clauses hoisted.

The scoring formula, normalization, tie-breaks (`localeCompare`), dedup key precedence (`retweetOf → quoted → source → self`), and all constants are unchanged.

## 2. What changed (final patch: `evidence/final.patch`, 65+/41−, one file)

- `idfs: Map<Term, number>` inside `rerank`; first use computes the same `Math.log(...)` expression, later uses multiply the cached value. `bm25()` itself is untouched (still exported/tested); the inline expansion performs the same arithmetic in the same order, so it is bit-identical.
- `rels/engs/auths/createdAts` are preallocated indexable arrays; dedup and sort are **index-based** via `compareIdx(ia, ib)`; `byId` Map deleted entirely.
- `fitBonus` inlined and deleted; invariant clauses hoisted to locals (`mediaFilter`, `intentMedia`, `phrases`, `shouldTerms`, `phraseFit`, `shouldFit`).
- `bm25_k1`, `bm25_b`, `totalDocs`, `avgTokenCount` hoisted out of the loops.

## 3. Raw evidence

### Timing - separate processes, 200-candidate synthetic workload, 3000 warmup + 11×5000 timed calls/process

Command (per arm):
```
node --allow-natives-syntax bench/arm-<arm>.mjs
```
`evidence/timing-baseline.txt` (HEAD, arm from `git worktree` at HEAD):
```
{"medianMsPerCall":0.08542716639999999,"minMsPerCall":0.08434953740000001,"rounds":11,"iters":5000}
{"medianMsPerCall":0.08480034100000003,"minMsPerCall":0.0827661016,"rounds":11,"iters":5000}
{"medianMsPerCall":0.0845157424,"minMsPerCall":0.08292342239999999,"rounds":11,"iters":5000}
```
`evidence/timing-opt.txt` (final optimized, post-oxfmt, post all checks):
```
{"medianMsPerCall":0.05481812099999998,"minMsPerCall":0.053294470000000004,"rounds":11,"iters":5000}
{"medianMsPerCall":0.05423372079999999,"minMsPerCall":0.05343396900000007,"rounds":11,"iters":5000}
{"medianMsPerCall":0.055921776,"minMsPerCall":0.05546709719999999,"rounds":11,"iters":5000}
```
Medians of the three process medians: **0.084800 ms → 0.054818 ms (−35.4%, 1.55×)**. Noise floor: three runs per arm within ±0.8%.

Intermediate experiment (same code shape, preallocation only): six `Array.from({length:n})` ≈ 0.090 ms vs six `new Array(n)` ≈ 0.052 ms - `Array.from` costs roughly 6 µs per 200-element call. `new Array(n)` is banned by `unicorn(no-new-array)`, so the final uses `arr.length = n` (0.0548 ms, within ~2% of the banned variant).

### Engine tier lines

Both arms reach Maglev then TurboFan; no deopts observed.
`evidence/tier-baseline.txt`:
```
[marking ... <JSFunction rerank ...> for optimization to MAGLEV, ... reason: hot and stable]
[completed compiling ... rerank ... (target MAGLEV) - took 0.000, 11.037, 0.147 ms]
[marking ... <JSFunction rerank ...> for optimization to TURBOFAN_JS, ... reason: hot and stable]
[completed optimizing ... rerank ... (target TURBOFAN_JS)]
```
`evidence/tier-opt.txt` is identical in shape (MAGLEV → TURBOFAN_JS, no `deoptimizing` lines). Engine: Node v26.8.2 (V8 in Node 26).

### One bytecode line that changed

`node --print-bytecode --print-bytecode-filter=rerank bench/arm-<arm>.mjs` (`evidence/bytecode-baseline.txt`, `bytecode-opt.txt`). Same source position, 299:
```
base @  299 : 66 c8 c7 38       CallProperty0 r49, r50, FBV[56]
opt  @  299 : 1a c1             Star r56
```
The per-candidate `fitBonus(xq, c)` call instruction is gone; what remains is a register move. **What it means:** argument marshalling, a call frame push/pop, and a feedback-vector lookup per candidate no longer happen. **What it bought:** part of the 35% (the other two wins are the idf cache and the index-based dedup/sort). Aggregate static call counts in the filtered listing: `CallProperty0/1/2` = 10/10/7 baseline → 8/9/7 optimized.

### Behavior identical

- Differential fuzz (**baseline arm vs optimized arm in one process**, same seeded generator, JSON-string equality of full output arrays): `evidence` run output `{"checked":3000,"mismatches":0}`. Covered: both sort orders, 0-200 candidates, dedup chains (RT/quote edges), `avgTokenCount=0` (the NaN edge case), media/phrase/should fit combinations, all `parts` fields.
- Full suite, exact command `./node_modules/.bin/vitest run` in the work copy: **Test Files 15 passed (15), Tests 360 passed (360)** (`evidence/full-tests.txt`).
- Focused: `./node_modules/.bin/vitest run tests/plan-rank.test.ts` → **1 passed, 58 passed** (`evidence/plan-rank-tests.txt`), including the rerank permutation/determinism tests.
- `tsc --noEmit` exit 0; `oxlint convex/engine/rank.ts` clean; `oxfmt --check` clean.

### Memory

Not benchmarked. Allocation-count reasoning only: the 200-entry `byId` Map and per-candidate `fitBonus` call are gone; added are four preallocated ≤200-element arrays (three numeric + `createdAts`) and a small per-call `idfs` Map (≤ distinct query terms). Net per-call allocation count is flat-to-lower; no RSS claim is made.

## 4. What the change costs, and how to revert

- **Cost:** ~30 net lines in one file; one duplicated invariant - the BM25 arithmetic now lives both in `bm25()` and inline in `rerank` (required to make the idf cache exact). Any future change to `WEIGHTS.bm25_*` or the BM25 formula must update both; the differential fuzz (and `plan-rank` tests) is the guard. `fitBonus` is gone as a named function (it was private). No API, type, schema, or test changes.
- **Revert:** `git -C <checkout> checkout -- convex/engine/rank.ts` (attached patch is `evidence/final.patch`; final file copy is `evidence/rank.final.ts`). Any revert must be followed by the test command above; the differential fuzz requires the work-copy harness under `/tmp/swarm-study/rerank-cal/bench/`.

## 5. Blockers / friction / what was missing

- **Not blocked.** Everything ran locally; no network needed.
- `pnpm test` / `pnpm exec` fail inside the copied workspace: pnpm triggers a deps-status check that spawns `pnpm install` and exits 1 (`[ERROR] Command failed with exit code 1: ... pnpm.mjs install`). Worked around with `./node_modules/.bin/vitest`. Environment artifact of running outside the original store layout, not a repo bug.
- **No microbench exists in the repo.** The workload harness had to be built from scratch (esbuild bundling two arms against `git worktree` HEAD vs working tree). A committed `rerank` bench (e.g. `bench/rerank.bench.ts` under vitest or a tiny node script) would make regressions visible and drop-calibration routine - currently missing.
- **`oxlint unicorn/no-new-array`** bans `new Array(n)`, and `Array.from({length:n})` is ~6 µs/call on n=200 - a real trap for array preallocation in hot paths. `arr.length = n` is the lint-clean fast form.
- **Time-box:** the 20-minute target was exceeded (~35 min actual) because of harness construction plus one self-inflicted edit mistake that required a `git checkout --` restore and re-application. The final artifact is fully re-verified after every mutation (format included), so the overrun did not invalidate any number.
- The copy of the 8.3 GB checkout (incl. `node_modules`, `.delta` worktrees) took ~48 s; `.delta` worktrees contain stale copies of `rank.ts` and are easy to confuse with the live tree when grepping.
