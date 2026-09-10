# scanEmotes / ingestMessage perf pass

**Verdict: PASS.** Timing improved, all 62 repo tests green, output digest byte-identical on a
4,000-message corpus and on 18 edge cases. Repo checkout was never written to; all artifacts live
under `/tmp/swarm-study/scanemotes/`.

## Smallest-steps target (derived from the code, not guessed)

Reading `scanEmotes` (web/src/lib/chatIngest.ts:701) and `ingestMessage` (:786) top-down, the
per-message work that is pure overhead, allocation by allocation:

1. `scanEmotes`: `text.matchAll(m.regex)` per matcher (3×/message). Per spec `matchAll` clones
   the global RegExp and allocates an iterator; the clones force a RegExp compile-cache lookup
   per call. Workload is 3 clones + 3 iterators per message, forever.
2. `scanEmotes`: `const priority = {...}` (line 715) allocated per call and captured by the
   `sort` comparator, so every call builds a function context plus three closures (two `sort`
   comparators + the `kept.some` callback at line 719). The `.some` closure is re-created *per
   span*.
3. `ingestMessage`: `bumpTarget` (line 821) is a closure created per message, capturing
   `agg`/`chatter`/`login`; V8 emits `CreateFunctionContext` + `CreateClosure` per call.
4. `ingestMessage`: `[...twitchSpans, ...thirdPartySpans].sort(...)` allocates a third array and
   a fresh comparator per message; `twitchSpans` is local and already mutable.
5. `ingestMessage`: `isEmoteSpam(words)` computed twice per message (lines 840 and 847), and
   `msg.text.trim()` up to three times.
6. `extractWords`: regex literals (`/[^\p{L}\p{N}_]+/u`, `/^\d+$/`) evaluated inside the
   per-token loop; V8 allocates a fresh RegExp object for each literal evaluation.

Smallest target, therefore: **zero per-call allocation in the two hot functions, without moving
a single match or aggregation decision.** Keep semantics exactly: whole-token matching, greedy
longest-span dedupe with 7TV > BTTV tie-break, case handling, stop words, spam heuristics.

## Commands and raw results

Everything ran on a /tmp copy (`work/src`, `work-baseline/src`) with
`node_modules -> /home/pronsh/Coding/chatmost/node_modules`. Bundles built with repo esbuild:
`esbuild src/lib/chatIngest.ts --bundle --platform=node --format=cjs --target=node20 --alias:@=./src`.
Benchmark corpus: 4,000 deterministic messages (mulberry32), ~1,280 emote names across the three
matchers, 16% emote density, 25% with Twitch spans, 4 warmup + 21 measured rounds, fresh
aggregate per round, one process per arm (per skill rule: never A/B in one process).

### Tests (exact command: `./node_modules/.bin/vitest run --config vitest.config.ts`, config copied from repo)

```
tests-baseline.txt:  Test Files  6 passed (6)   Tests  62 passed (62)
tests-optimized.txt: Test Files  6 passed (6)   Tests  62 passed (62)
tsc --noEmit -p tsconfig.json: exit 0
```

### Timing, in separate processes (µs/msg, median over 21 rounds)

```
baseline  scan  21.28 / 21.33 / 22.49  -> median-of-runs 21.33
baseline  ingest 34.71 / 35.99 / 40.20 -> median-of-runs 35.99
optimized scan   5.10 /  5.19 /  7.02  -> median-of-runs  5.19   (~4.1x)
optimized ingest 17.12 / 17.79 / 26.21 -> median-of-runs 17.79   (~2.0x)
```

Raw JSON: `baseline-run{1,2,3}.json`, `optimized-run{1,2,3}.json`, `summary.txt`.
Load was 8.6-9.0 (16 cores) and the third optimized run clearly caught a load spike (7.02/26.21);
the median-of-runs is the honest number. No improvement is claimed per-run beyond what these
numbers show.

### Engine tier (`--allow-natives-syntax --trace-opt --trace-deopt`, engine-{baseline,optimized}.txt)

```
[completed compiling <JSFunction scanEmotes>    (target MAGLEV)]
[completed compiling <JSFunction ingestMessage> (target MAGLEV)]
[completed compiling <JSFunction bumpTarget>    (target TURBOFAN_JS)]
[completed optimizing <JSFunction bumpTarget>   (target TURBOFAN_JS)]
[completed compiling <JSFunction scanEmotes>    (target TURBOFAN_JS)]
[completed optimizing <JSFunction scanEmotes>   (target TURBOFAN_JS)]
[completed compiling <JSFunction ingestMessage> (target TURBOFAN_JS)]
[completed optimizing <JSFunction ingestMessage> (target TURBOFAN_JS)]
```

Both arms reach top tier; **no deopt lines in either arm**.

### Allocation/closure census (`--print-bytecode`, one filter per function)

```
bytecode-ingest-baseline.txt : 3 CreateClosure/CreateFunctionContext ops
bytecode-ingest-optimized.txt: 0
bytecode-scan-baseline.txt   : 4 (incl. CreateFunctionContextWithCells for `priority`)
bytecode-scan-optimized.txt  : 0
```

### Memory churn (`--trace-gc --expose-gc`, 100,000 ingestMessage calls, fresh aggregate per call)

```
scavenges:  baseline 381  ->  optimized 316   (-17%)
heap delta after the run (no intervening GC): +1.59 MB -> +0.28 MB
mark-compact: 1 each (startup, unrelated)
```

Raw: `gc-baseline.txt`, `gc-optimized.txt`, `mem-*.txt`. Treat heap delta as an allocation-churn
proxy, not a retained-memory claim - nothing is retained either way.

### Behavior identity

- **Corpus digest**: canonicalized aggregate (all targets/users/perChatter/urls, chatters,
  timelines, longest candidates) hashed with sha256 on both arms, in separate processes:
  both `b1d4077768ef8204ce176a39d7cbff3b3b3155d1b775cb6afb818228210101af` (1,992,889 bytes).
- **Edge cases** (`edge.cjs`, 18 inputs: empty string, whitespace, `!`, empty emote sets,
  `LO`/`lo`, overlapping `monka monkaS`, unicode/CJK names, emoji, lone surrogate, 5,000-char
  text, word boundaries, command messages): serialized spans+words+aggregate **byte-identical**
  (`diff -q` clean, 2,233 bytes).
- **Golden tests**: the repo's own 62 tests pass on the modified copy (same tests pass on a
  pristine copy).

## The bytecode line that changed

Baseline `ingestMessage`, evidence/bytecode-ingest-baseline.txt:313:

```
983211 S> ... @  820 : 8b 25 01 02  CreateClosure [37:0x0aabb4eada59 <SharedFunctionInfo bumpTarget>], FBV[1], #2
```

It means V8 allocated a JSFunction (plus its captured context) for `bumpTarget` on every single
message. It is absent from the optimized bytecode (0 closures), alongside scanEmotes's
`GetNamedProperty [4:"matchAll"]` → `[5:"exec"]` and the removal of
`CreateFunctionContextWithCells`. What it bought: no per-message closure/context allocation in
either hot function, and it is part of the measured 2.0x ingest / 4.1x scan throughput.

## What the change costs and how to revert

- **One file, no API change.** `evidence/diff.patch` is the complete change (178 diff lines);
  no exported signature, wire format, ranking or cache version changed. `bumpTarget` stays
  module-private.
- **Mutable RegExp `lastIndex`.** `scanEmotes` resets `lastIndex` before each matcher and exec
  clears it on no-match. Safe only because the function is synchronous with no `await` inside;
  if someone later makes it async or reentrant, this must be revisited. The original `matchAll`
  left the shared regex untouched.
- **Zero-length-match handling is explicit** (`re.lastIndex++`) for the empty-emote-set fallback
  regex. With the `u` flag this advances by one UTF-16 unit rather than one code point; it can
  only matter at lone surrogates and only for matchers that produce zero-length matches, whose
  spans are discarded either way (covered by the edge corpus).
- **`isEmoteSpam` de-duplication assumes purity** - true today (no mutation inside).
- **Revert**: restore the original file (checkout copy is untouched:
  `/home/pronsh/Coding/chatmost/web/src/lib/chatIngest.ts`) or apply `evidence/diff.patch -R`.
  Nothing outside `/tmp/swarm-study/scanemotes/` was modified.

## Friction / what was missing

- The repo is a symlink to a read-only checkout, so tests must run from a /tmp copy. Vitest
  couldn't resolve `vitest/config` until `node_modules` was symlinked, and the copied
  `tsconfig.json` needed `tsconfig.node.json` next to it; both are harness setup, not product
  issues.
- Machine load (~9 on 16 cores) makes single-run timings untrustworthy; 3 process runs +
  medians was the mitigation, and one optimized run is visibly contaminated by a load spike.
  The closure census and digest are load-independent.
- `--print-bytecode-filter` also prints esbuild's `__export` wrapper SFI, so counts include one
  extra wrapper entry; it is present in both arms and does not affect the delta.
- No blockers encountered.

## Evidence index

```
evidence/diff.patch                    complete change vs. checkout
evidence/tests-{baseline,optimized}.txt
evidence/{baseline,optimized}-run{1,2,3}.json
evidence/{baseline,optimized}-timing.txt
evidence/summary.txt
evidence/bytecode-{ingest,scan}-{baseline,optimized}.txt
evidence/engine-{baseline,optimized}.txt
evidence/gc-{baseline,optimized}.txt, mem-{baseline,optimized}.txt
evidence/edge-{baseline,optimized}.json
work/  modified working copy  ·  work-baseline/  pristine copy  ·  bundles/  CJS bundles
bench.cjs · census.cjs · mem.cjs · edge.cjs  (harnesses)
```
