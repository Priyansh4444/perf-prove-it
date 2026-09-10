# Adversarial verification - rerank() 35.4% speedup claim

**Verdict: PARTIAL.**

The optimization is real, the arms are correct, tests pass, and output is bit-identical on
every input the production caller can produce. But the exact **35.4%** was not reproduced
(my controlled protocol: **34.66%**; worker's own harness on my machine: **33.93-35.04%**),
the report's headline bytecode evidence (@299) is **misattributed**, and there is one real
semantic divergence (duplicate `tweetId`s) the worker never tested, plus a false
"bm25 … tested" claim. Details and all command outputs below.

Environment: Node v26.8.2, 16 cores, 1-min load 4.1-8.1 during timing.
All writes confined to `/tmp/verify-rerank/`; the user checkout was read-only.

---

## 1. Checkout not modified - PASS

```
$ git -C /home/pronsh/Coding/xearch status --short
(empty, exit 0)
$ git -C /home/pronsh/Coding/xearch diff --stat HEAD
(empty)
$ git -C /home/pronsh/Coding/xearch rev-parse HEAD
5e6fdd6dbb518d6be05b348a49c85b8679f5866a
$ sha256sum /home/pronsh/Coding/xearch/convex/engine/rank.ts
e1ffbea11c94060981ae516bc258e2d102ffd7f8ea0e78b21d778a3962a2313b
$ git -C /home/pronsh/Coding/xearch hash-object convex/engine/rank.ts
6cb1ad9f47de9028f390f1d3db9faaa3f5ae7653   # == patch's base blob
```

Also: no stashes, no extra worktrees in the live checkout, `/home/pronsh/Coding/xearch/.delta`
untouched. The live file hash equals the worker's baseline arm file
(`/tmp/swarm-study/rerank-cal/baseline/convex/engine/rank.ts`, sha256 e1ffbea1…), so their
baseline was the pristine HEAD source.

Note: HEAD is detached at `5e6fdd6`, an ancestor of `11d2ef6`'s branch line; `11d2ef6` exists
and `git log --oneline 11d2ef6` shows the commit the report cites. Between `11d2ef6` and HEAD,
`5e6fdd6` changed `new Array(n)` → `Array.from({length:n})` in `rank.ts` (the hot-path trap
the report calls out); the report's framing is consistent with this.

## 2. Fresh copy + patch - PASS

```
$ git clone /home/pronsh/Coding/xearch /tmp/verify-rerank/src
$ git -C src checkout --detach 5e6fdd6
$ sha256sum src/convex/engine/rank.ts          # baseline arm in /tmp/verify-rerank/src
e1ffbea11c94060981ae516bc258e2d102ffd7f8ea0e78b21d778a3962a2313b
$ cp -a src opt && cd opt
$ git apply --check /tmp/swarm-study/rerank-cal/evidence/final.patch
OK
$ git apply /tmp/swarm-study/rerank-cal/evidence/final.patch
$ sha256sum convex/engine/rank.ts              # /tmp/verify-rerank/opt
c541174d868c7cefd2374e4eeddf08dc49c03a1b38417f59db49b9ed18043c2c
$ git apply --stat .../final.patch
 convex/engine/rank.ts | 106 +++++++++++++++++++++++++++++++-------------------
 1 file changed, 65 insertions(+), 41 deletions(-)
```

Patched hash equals the worker's `evidence/rank.final.ts` and their work copy
(c541174d…). Patch touches only `convex/engine/rank.ts`. Net change is **+24 lines**, not
the "~30 net lines" the report states.

## 3. Independent harness + bytecode census - PASS with one misattribution

Harness: my own (`/tmp/verify-rerank/harness/`), bundles built fresh with the repo's esbuild
0.27.0 from my own copies (`entry-base.ts` → `/tmp/verify-rerank/src`, `entry-opt.ts` →
`/tmp/verify-rerank/opt`), `--packages=external`. Source hashes recorded at bundle time
(e1ffbea1 / c541174d). Runtime check of the loaded function:

```
base: fnHash 6911698b0b77…  hasIdfCache=false hasCompareIdx=false hasFitBonus=true
opt : fnHash 324497f01f87…  hasIdfCache=true  hasCompareIdx=true  hasFitBonus=false
```

Census with the installed script against my own `--print-bytecode` dumps
(`/tmp/verify-rerank/evidence/bytecode-{base,opt}.txt`, filter=`rerank`, one block each):

```
$ node .../perf-prove-it-ts/scripts/census.mjs evidence/bytecode-base.txt
function len  closures contexts arr[] obj{} re{}
rerank   1912 1        1        2     6     0
unmapped Create ops: CreateArrayFromIterable

$ node .../census.mjs evidence/bytecode-opt.txt
rerank   2151 1        1        7     3     0
unmapped Create ops: CreateArrayFromIterable
```

Static call counts incl. `.Wide` variants: CallProperty0/1/2 = **10/10/7 (base) → 8/9/7
(opt)** - the report's aggregate numbers are correct (an initial count of mine that omitted
`.Wide` was wrong; corrected here).

The changed instruction at offset 299 reproduces byte-for-byte against the worker's dumps:

```
base @ 299 : 66 c8 c7 38  CallProperty0 r49, r50, FBV[56]
opt  @ 299 : 1a c1        Star r56
```

**But the report's interpretation of it is wrong.** Extracting the bundle source at the
annotated source position shows base @299 is inside the for-of iterator over `c.tf`:

```
BASE source @2236: "    for (const [term, tf] of c.tf) {\n      rel += bm25(tf, s"
OPT  source @2299: "(const [term, tf] of c.tf) {\n      let idf = idfs.get(term);"
```

The preceding opcodes (`GetNamedProperty …[14:"next"]`, `JumpIfJSReceiver`,
`ThrowIteratorResultNotAnObject`) confirm it is `iterator.next()`. The register move at opt
@299 is just the shifted post-`next()` `Star`. The actual removed `fitBonus` call is a
different instruction:

```
BASE @1085: CallUndefinedReceiver2 r40, r41, r22   (source: "const fit = fitBonus(xq, c);")
BASE @1745: CallUndefinedReceiver2 …               (source: "compare(s, prior)")
OPT  now has CallUndefinedReceiver2 sites for coversAllPhrases, hasAnyTerm, compareIdx
```

So "the fitBonus call is gone" is true in aggregate; attaching that meaning to the @299 line
is not.

Tiering (`--trace-opt --trace-deopt`, `/tmp/verify-rerank/evidence/tier-{base,opt}.txt`): both
arms mark `rerank` MAGLEV then TURBOFAN_JS, no `deoptimizing` lines. Worker's tier claim holds.

## 4. Repo tests on the patched copy - PASS

The repo's own command is `pnpm test` (→ `vitest run`). In a copied workspace plain
`pnpm test` fails before running tests with the same class of pnpm deps-status failure the
worker documented:

```
[ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY] Aborted removal of modules directory due to no TTY
[ERROR] Command failed with exit code 1: … pnpm.mjs install
```

Running the repo's script with pnpm's deps pre-check disabled (after copying
`apps/web/node_modules`, which a git clone lacks):

```
$ cd /tmp/verify-rerank/opt
$ pnpm --config.verify-deps-before-run=false test
 Test Files  15 passed (15)
      Tests  360 passed (360)
exit 0
```

360/360 confirmed (report section 3 claim).

## 5. Differential identity - PASS on reachable inputs; one latent divergence

Method: my own generator; inputs serialized to `cases.json` (NaN/-0/±Infinity encoded), each
arm evaluated **in a separate process**, outputs compared with a recursive `Object.is`
deep-equality (distinguishes NaN from null and -0 from 0 - stronger than the worker's
`JSON.stringify` comparison). 47 handcrafted edges + randomized cases with duplicate ids,
NaN fields, avgTokenCount=0, etc.

```
Run A: 2648 cases (47 edges + 2600 randomized + bench case)
  {"checked":2648,"mismatches":1606}
  classification:
  {"checked":2648,"dupTotal":1885,"uniqueTotal":763,
   "dupMismatch":1606,"uniqueMismatch":0}

Run B (fresh seed, no duplicate ids, no edges):
  3001 cases → {"checked":3001,"mismatches":0}

Worker's own diff bundle, rerun: {"checked":3000,"mismatches":0}
```

All 1606 mismatches are explained by duplicate `tweetId`s. Minimal repro
`edge:dup-tweetId-diff-keys` (2 candidates, same `tweetId:"dup"`, different `createdAt` and
`sourceTweetId`, sort=latest): baseline returns 1 element, patched returns 2.

Mechanism, verified against the source: baseline built `byId: Map<tweetId, Candidate>`
(last write wins) and used it both for dedup-key selection and `createdAt` lookup, so all
scored entries sharing a `tweetId` compare with the *last* candidate's `createdAt`/chain
edges. The patch reads `createdAts[i]` and `candidates[i]` for the entry's own index. With
unique ids these are identical (proven by the 3764 unique-id cases); with duplicates they
diverge in dedup keys, dedup winner, and ordering.

Reachability: `convex/search.ts:151` builds candidates from `[...matches.keys()]` (a `Map`
keyed by Convex doc `_id`) and slices to `RERANK_CANDIDATES`, so duplicates cannot occur
through the app's only caller. This is a latent behavior change to the exported function,
untested by the worker's fuzz (their `chainId(i)` is unique by construction), not a live
regression. "Bit-identical output" is therefore true on the caller-reachable domain and
overstated as a blanket statement.

Covered edge cases that matched exactly (unique ids): empty candidates, one candidate,
all-zero scores (z=1e-9 normalization), NaN scores from `avgTokenCount=0`/NaN fields,
±Infinity feedback/tf, `tf=-0.3` hitting the `denom===0` branch, missing dfs, `totalDocs=0`
and `-1`, future `createdAt`, feedback clamping, media filter/intent-media, phrase/should
fit combinations, dedup precedence and chains, self-RT, 200-candidate all-same-key collapse,
score ties with `localeCompare`.

## 6. Timing - PARTIAL (33.9-35.0% vs claimed 35.4%)

My protocol: separate processes, 6 per arm, interleaved and alternating order, identical
warmup (3000) and 11×5000 timed iterations; `/proc/loadavg` recorded before every process
(`/tmp/verify-rerank/evidence/timing/`), 1-min load 6.3-8.1.

```
base per-process medians: 0.083243 0.083575 0.084198 0.084278 0.084963 0.085438
  median-of-medians 0.084238 ms
opt  per-process medians: 0.054144 0.054262 0.054982 0.055094 0.055216 0.055469
  median-of-medians 0.055038 ms
→ reduction 34.66%, speedup 1.531×   (claim: 35.4%)
```

Worker's own bundles rerun on my machine, 3× each, two batches:

```
batch A (load 4.1-4.4): base medians 0.083275 0.082975 0.082580 → 0.082975
                        opt  medians 0.055236 0.054826 0.054423 → 0.054826
                        → 33.93%
batch B (load 4.2-5.4): base medians 0.084494 0.084458 0.084100 → 0.084458
                        opt  medians 0.055540 0.054867 0.054581 → 0.054867
                        → 35.04%
```

Observations: the patched arm is extremely stable (0.05414-0.05554 ms across all runs, and
the worker's recorded opt median 0.054818 reproduces as 0.054826 with their own bundle);
the baseline arm is load-sensitive (0.08258-0.08544 ms). The claimed 35.4% sits at the top of
that noise band. **My controlled measurement falls 0.74 pp short (34.66%); the worker's own
harness gives 33.9-35.0% on rerun. It is not exactly reproducible, but the ~35% figure is
defensible within run-to-run baseline variance.** Opt absolute value reproduces exactly;
the reported baseline absolute (0.084800) was not reproduced at comparable load (I got
0.08298-0.08446), which is where the extra ~1 pp comes from.

## 7. Classic falsifiers - all ruled out, except the duplicate-id edge

- **Wrong arm:** ruled out. Bundles built from hashed sources; runtime
  `rerank.toString()` hashes/markers differ correctly; my independent numbers reproduce
  worker's per-arm numbers.
- **Stale bundle:** ruled out. My bundles freshly built; worker's opt bundle reproduces
  their recorded opt median almost exactly on my machine.
- **Profiler during timing:** none (no `--prof`/`--cpu-prof` in any timing command; trace
  runs were separate).
- **Warmup differences:** none; identical warmup both arms, and `--trace-opt` shows both
  reach TURBOFAN with zero deopts.
- **Load spike favoring one arm:** controlled by interleaving/alternating; all 12 of my
  processes show the same split with no crossover. The residual uncertainty is baseline
  load sensitivity (above), which affects the size of the *claimed* gain, not its direction.
- **Untested behavior edges:** empty/one/all-zero/NaN etc. all match; duplicate `tweetId`s
  diverge (section 5). The worker's fuzz could not generate duplicates.

## 8. Report's cost/revert claims vs the patch

- **65+/41−, one file:** true; net **+24** lines (report says "~30 net lines" - loose).
- **`bm25()` untouched:** true (first hunk starts at line 79; `bm25` is lines 60-71; the
  body is textually identical between arms; inline arithmetic matches
  `Math.log((totalDocs-df+0.5)/(df+0.5)+1)` and the same `denom` expression/order).
- **"bm25() … still exported/tested": false on "tested".** Repo-wide grep finds no `bm25`
  reference outside `rank.ts` and `tests/plan-rank.test.ts` imports only
  `rerank, WEIGHTS, Candidate`. It remains exported, but nothing calls or tests it now.
- **`fitBonus` inlined/deleted, was private, no other references:** true.
- **No API/type/schema/test changes:** true (single file).
- **Revert `git checkout -- convex/engine/rank.ts`:** verified in a scratch copy - applied
  (c541174d…) → revert → e1ffbea1… (base). Same procedure works from the patch
  (`git apply` then checkout).
- **`oxfmt --check` / `oxlint` clean on patched file:** verified (`All matched files use the
  correct format`, `oxlint` silent).
- **`unicorn/no-new-array` bans `new Array(n)`:** verified - oxlint errors on a scratch file
  despite the rule not being listed explicitly (plugin correctness category).
- **`Array.from({length:n})` ≈ 6 µs/200-elem call:** no log exists in `evidence/`, but my
  independent allocation microbench is consistent and larger: six 200-element arrays cost
  34.9 µs/call via `Array.from`, 1.09 µs via `arr.length=n`, 0.65 µs via `new Array` -
  matching the report's ~35 µs `Array.from` gap in the full call.
- **Memory:** explicitly not benchmarked; no claim to falsify.
- **Tier lines / Node version:** confirmed (Node v26.8.2; MAGLEV→TURBOFAN, no deopts).

## Discrepancies and overstatements (summary)

1. **35.4% is not exactly reproduced.** Measured 34.66% (controlled, interleaved) and
   33.93-35.04% (worker's own harness). The patched absolute time reproduces exactly; the
   baseline absolute doesn't, and baseline is load-sensitive. Overstated by ~0.4-1.5 pp.
2. **The "@299 = fitBonus call" bytecode evidence is misattributed.** @299 is the `for…of`
   iterator `next()` call; the removed `fitBonus` call is `CallUndefinedReceiver2` @1085.
   The aggregate call-count numbers (10/10/7 → 8/9/7) are correct.
3. **"bm25() … still tested" is false.** No reference or test outside `rank.ts`; after the
   inline it is dead exported code with a duplicated formula.
4. **"Bit-identical output" is domain-conditional.** Zero mismatches on 3764 unique-id cases
   (plus the worker's 3000), but duplicate `tweetId`s change dedup keys/winner/order. Not
   reachable via `search.ts`, but not tested or documented by the worker.
5. Minor: "~30 net lines" is actually +24; their differential harness used
   `JSON.stringify` equality (cannot distinguish NaN edge cases), though my stronger
   `Object.is` deep-equality check still found zero mismatches on unique ids.

Evidence inventory: `/tmp/verify-rerank/evidence/` (bytecode dumps, census outputs, tier
traces, test log, timing runs + loads + stats, diff results, differential analysis).
Harness: `/tmp/verify-rerank/harness/` (generator, separate-process runners, comparator,
timing protocol). No user checkout was modified.
