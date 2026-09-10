# Hot-path speedup: `highlightedParts` / `partsFromTaggedSnippet` / `decodeEntities`

Repo: `/tmp/swarm-study/highlight/repo` -> `/home/pronsh/Coding/ytsearch` (read-only; change delivered as `patch.diff`)
Date: 2026-09-10. Timebox: ~20 min. Engine under test: `node v26.8.2 v8=14.6.202.34-node.28` (each raw log carries an `engine=` line).

## Verdict

**PASS.** Replacing the unconditional DOM decode in `decodeEntities` with a no-DOM fast path is a measured **45.4x** median improvement on a 304-call mixed title/fragment workload (26,165.8 -> 576.5 ns/call, median of 4 medians from separate processes), with **0 / 50,015 behavior mismatches** and both the repo's own test file and a shadow run of the patched file green. The regex/tokenization path was left alone: an A/B test showed the one candidate change there (hoisting the regex) was noise.

## Smallest-steps target derived from the actual code

Read `src/utils.ts:64-107` and the producer, `escape_html` at `crates/youtube_raw_search/src/engine/query_support.rs:1152`:

- `highlightedParts` returns immediately when `highlight` is absent (`utils.ts:69`), so the only hot path is a tagged snippet.
- Every segment of a tagged snippet -- before, marked, after, and the no-mark fallback (`utils.ts:85,89,95,100`) -- goes through `decodeEntities`, which does `entityDecoder.innerHTML = value` on a shared textarea (`utils.ts:103-107`). That is a full HTML parse per segment; DOM accounting below shows ~1.8 parses per call.
- The backend escapes exactly five entities: `&amp; &lt; &gt; &quot; &#39;`. Most segments contain no `&` at all, and no producer emits `\r`/`\0`.
- So the smallest target is an early exit from `decodeEntities`: return the input when it has no `&` (and no `\r`/`\0`, which the HTML parser would normalize), and decode in JS only when every `&` is one of the five backend entities; anything else (numeric refs, legacy names, `&AMP;`, CR, NUL) still goes through the textarea so semantics cannot drift. Nothing else changed; no caching, no API changes.

## Commands and raw outputs

All logs in `/tmp/swarm-study/highlight/evidence/`; harness in `/tmp/swarm-study/highlight/` (`bench.ts` imports the arm via `process.argv[2]`, so **every timing arm ran in its own process**).

Timing (304-call corpus: plain titles, transcript fragments, 0-3 `<mark>` pairs, 12% entity-bearing tokens; 3 warmup rounds; `hrtime.bigint`):

```
$ node bench.ts ./arms/baseline.ts baseline 12          # evidence/bench-final-baseline-{1,2}.txt
arm=baseline median_ns_per_call=36512.3 ...   run2: median_ns_per_call=24742.0
$ node bench.ts ./arms/optimized-final.ts optimized 12  # evidence/bench-final-optimized-{1,2}.txt
arm=optimized median_ns_per_call=602.5 ...    run2: median_ns_per_call=480.1
```

Four separate processes per arm (earlier run pair included): baseline medians
27589.6 / 24450.4 / 36512.3 / 24742.0 ns -> median 26165.8; optimized medians
550.5 / 682.6 / 602.5 / 480.1 ns -> median 576.5. **45.4x**, range 36x-76x depending on process.

Counts before/after (DOM work, same 304 calls; `evidence/dom-accounting-final.txt`):

```
arm=baseline       calls=304 createElement_calls=1 textarea_innerHTML_sets=547
arm=optimized-final calls=304 createElement_calls=0 textarea_innerHTML_sets=0
```

Memory (`node --expose-gc`, 15,200 calls with results retained; `evidence/memory-*.txt`):
`memory_heap_delta_kb=4806.3` (baseline) vs `4476.5` (optimized) -- parity within noise; the change is not a memory optimization.

Tests:

```
$ cd /home/pronsh/Coding/ytsearch && CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=false ./node_modules/.bin/vitest run src/utils.test.ts
 Test Files  1 passed (1)   Tests  3 passed (3)          # evidence/repo-vitest-utils.txt

$ cd /tmp/swarm-study/highlight && ./node_modules/.bin/vitest run --config vitest.shadow.config.ts
 Test Files  2 passed (2)   Tests  7 passed (7)          # evidence/vitest-shadow.txt
```

The shadow suite has one file running the repo test cases against the benchmarked arm, and one importing **the actual patched repo file** (`arms/patched-utils.ts`, via a symlinked `client-runtime-loader.ts`) plus fallback cases (`&copy;` -> `©`, `&#x27;` -> `'`, `a\rb` -> `a\nb`).

## Behavior identity

1. `arms/baseline.ts` is extracted verbatim from `src/utils.ts` (type at lines 4-7, functions 64-107); a scripted comparison against the source reported no diff other than a trailing blank line.
2. Differential harness (`evidence/differential-final.txt`): 50,015 cases, **0 mismatches**. Cases include all five backend entities, `&AMP;`, `&amp` (no semicolon), `&nbsp;`, `&#x27;`, `&#x2F;`, `&#0;`, `&notanentity;`, bare `&`, CR, NUL, U+FFFD, CJK, and random `<mark>`/`</mark>`/`<MARK>` injections (including 10% fully uppercased snippets).
3. The patched repo file's function region is byte-identical (whitespace-insensitive) to the benchmarked `arms/optimized-final.ts` region.
4. Exact commands to reproduce are in `run-bench.sh`; patch application was verified (`patch` then `cmp` against `arms/patched-utils.ts`).

## Impact and cost

- **Impact:** median 45.4x on the tested workload; 100% of DOM parses eliminated on a corpus whose entity mix matches the backend's (`547 -> 0` innerHTML sets). Worst case should stay modest: a string with an unknown entity pays one `indexOf` + a short `startsWith` chain (~sub-microsecond) before the same DOM parse it always paid. That fallback overhead was not broken out separately.
- **Cost:** `+39` lines (no deletions) in `src/utils.ts`; `decodeEntities` bytecode grows 44 -> 129 bytes because the fast path is inlined ahead of the DOM path. One new module-private helper. No API, type, or call-site changes.
- **Revert:** from the repo root, `patch -R -p0 < /tmp/swarm-study/highlight/patch.diff` (or `git checkout -- src/utils.ts`). The patch was never applied to the checkout.

## One bytecode line that changed

Baseline first instruction of `decodeEntities` (`evidence/bytecode-baseline.txt`):

```
@ 0 : 17 03  LdaCurrentContextSlotNoCell [3]
@ 2 : b8 00  ThrowReferenceErrorIfHole [0:"entityDecoder"]
```

Optimized first instructions (`evidence/bytecode-optimized-final.txt`):

```
@ 0 : 33 03 00 00  GetNamedProperty a0, [0:"indexOf"]
...
@ 16 : 76 f9 00 00  TestEqualStrict r0, EmbeddedFeedback[0x0]
@ 20 : a6 33        JumpIfFalse [51]
```

Meaning: the old entry always loaded the shared `entityDecoder` slot and fell through to `SetNamedProperty innerHTML`; the new entry calls `value.indexOf("&")` first and can `Ldar a0; Return` without ever reaching the DOM. That branch bought the 547 -> 0 DOM parses.

## What got in the way / felt missing

- The regex-hoist candidate first looked like a win (550 vs 854 ns median) but reversed under interleaved A/B runs (752.9/608.3, then 614.1/606.9); it was noise, so it was dropped. Interleaving arms and keeping them in separate processes mattered more than expected.
- The read-only rule means the fix cannot be applied or run through the repo's own `src/utils.test.ts` directly; it is verified via a copy of that test against the patched file plus the differential corpus. If the user applies the patch, re-running `vitest run src/utils.test.ts` is the only missing confirmation.
- Repo package manager is `bun`; the harness used `node` for bytecode access (`--print-bytecode`). Bun 1.4 (JavaScriptCore) was not benchmarked; numbers may differ there but the DOM elimination is engine-independent.
