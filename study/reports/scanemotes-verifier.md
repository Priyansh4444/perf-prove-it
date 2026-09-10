# Adversarial verification: scanEmotes / ingestMessage perf pass

Verdict: **PARTIAL**

Core claims (closure census 4->0 and 3->0, tests, output identity, ~4x/~2x timing
direction, churn reduction by scavenge count) reproduce. The heap claim as written
(+1.59 MB -> +0.28 MB) is **falsified**: it is not reproducible, and the worker's own
logged optimized run shows +2.63 MB. Three public-API behavior regressions under
non-repo usage (preset `lastIndex`, non-global regex, `u`-flag zero-length regex) are
either under-described or omissions in the report.

Read-only rules honored: no writes under `/home/pronsh/Coding/chatmost`; all artifacts
under `/tmp/verify-scan/`. Checkout was clean before and after.

## Artifacts

- Patched copy: `/tmp/verify-scan/patched/` (patch applied from `evidence/diff.patch`)
- Baseline copy: `/tmp/verify-scan/baseline/`
- Bundles (my own, built from source): `bundles/rel-baseline.cjs`, `bundles/rel-optimized.cjs`
- Harnesses: `harness/census-driver.cjs`, `harness/my-identity.cjs`, `harness/my-bench.cjs`,
  `harness/my-mem.cjs`, `harness/lastindex-probe.cjs`, `harness/nonglobal-probe.cjs`,
  `harness/zero-length-probe.cjs`, `harness/zero-length-debug.cjs`
- Logs: `evidence/`

## 1. Checkout not modified

```
$ git -C /home/pronsh/Coding/chatmost status --short
(empty)
$ git cat-file blob HEAD:web/src/lib/chatIngest.ts | sha256sum
5ec88bf87a95c38dc42a72df4c4e851ee91a6c2d2f2ecd48f65c1d8138a2c6e3
$ sha256sum web/src/lib/chatIngest.ts
5ec88bf87a95c38dc42a72df4c4e851ee91a6c2d2f2ecd48f65c1d8138a2c6e3
```

Clean, unchanged, HEAD blob matches working file.

## 2. Patch application and hashes

```
$ patch -p1 -d /tmp/verify-scan/patched < evidence/diff.patch
patching file src/lib/chatIngest.ts          (exit 0)
```

| file | sha256 |
|---|---|
| checkout / baseline copy | `5ec88bf8...a2c6e3` |
| my patched copy | `1f0278a7...abe9b2a8` |
| worker `work/src/lib/chatIngest.ts` | `1f0278a7...abe9b2a8` |

My patched copy is byte-identical to the worker's patched file.

Bundles: my `rel-*.cjs` differ from the worker's bundles only in esbuild path
comments (0 non-comment diff lines), i.e. the worker's bundles are demonstrably
built from the claimed sources. No stale bundle.

## 3. Bytecode census (my own dumps, installed census script)

Command shape:
`node --print-bytecode --print-bytecode-filter=<fn> harness/census-driver.cjs <bundle>`
piped through `/home/pronsh/.config/opencode/skills/perf-prove-it-ts/scripts/census.mjs`.

| dump | closures | contexts | total |
|---|---|---|---|
| scanEmotes baseline | 3 | 1 | **4** |
| scanEmotes optimized | 0 | 0 | **0** |
| ingestMessage baseline | 2 | 1 | **3** |
| ingestMessage optimized | 0 | 0 | **0** |

Bytecode lengths reproduce the worker's evidence exactly: scan 644 -> 673,
ingest 1311 -> 1255. Running the installed census on the worker's own evidence files
gives the same 4/3/0/0. **3->0 and 4->0 confirmed.**

## 4. Repo tests on the patched copy

Exact command, from `/tmp/verify-scan/repo-patched` (a copy of the repo root plus
patched `web/`):

```
$ bun run test
$ vitest run --config web/vitest.config.ts
Test Files  6 passed (6)
     Tests  62 passed (62)
exit 0
```

Baseline control: same command, 6 files / 62 tests passed. `bun run typecheck`
(`tsc --noEmit -p web`) on the patched copy: exit 0.

## 5. Identity check (my harness, 2,086 messages)

Corpus: 2,000 randomized + explicit edges: empty emote sets (separate matcher set per
message), `LO`/`lo`/`Lo`/`lO`, overlapping `monka`/`monkaS`, CJK/Cyrillic/emoji/combining
marks, lone high/low surrogates, 5,000-char texts (including with surrogate suffix),
word boundaries (`no`, `close`, `OBS`, `1oo7TV`, `xLOx`, `LO_LO`), zero/negative/oversized
Twitch spans, bot logins, empty/whitespace login, 29/30/31-char threshold, month
boundaries. Per-message snapshot hash = `{spans, emptyMatchersSpanCount, words, spam,
fresh-aggregate serialization}`.

```
messages: 2086
per-message hash diffs: 0
aggregateHash baseline : d46b8d7cfd808152f7166db17a00faff2d9e20ab82ed3180215017073367d3ab
aggregateHash optimized: d46b8d7cfd808152f7166db17a00faff2d9e20ab82ed3180215017073367d3ab
aggregate canonical bytes: 630827 (both)
```

Cross-checks: worker's 4,000-message harness digest `b1d40777...0101af` (1,992,889 bytes)
reproduced on both arms with my bundles; worker's `edge-baseline.json` and
`edge-optimized.json` are byte-identical, and re-running their edge driver on my
fresh bundles reproduces their baseline byte-for-byte. **No difference found.**

## 6. Timing (5 processes per arm, alternating)

My corpus (seed 0x5EED42, 4,000 messages, 4 warmup + 15 measured rounds/process),
`/proc/loadavg` range during runs 6.4-7.0 on 16 cores.

```
baseline  scan medians  22.00 20.72 22.02 23.64 21.32  -> median-of-runs 22.00 us/msg
optimized scan medians   5.58  6.85  5.63  7.53  4.80  -> median-of-runs  5.63 us/msg  (3.91x)
baseline  ingest medians 35.74 33.79 38.09 37.46 37.40 -> median-of-runs 37.40 us/msg
optimized ingest medians 18.94 24.62 19.24 27.47 15.69 -> median-of-runs 19.24 us/msg  (1.94x)
```

Span total identical across all runs (10,405). Worker's own medians (21.33/5.19 and
35.99/17.79) give 4.11x/2.02x. My independent corpus gives 3.91x/1.94x. The direction
and magnitude are confirmed; "about 4.1x" is at the optimistic edge of run-to-run noise
(per-pair ratios in my runs span 3.0x-4.4x). Not a falsification, a mild precision
overstatement.

## 7. Heap check - this is where the report breaks

Worker's method (mem.cjs): warm 5,000, `gc()`, record heapUsed, run 100,000 calls with
no GC, record heapUsed; calls the difference "heap delta ... churn proxy". I ran both
the same shape and a stricter retained-growth shape (gc before, 100k calls, gc x3
after).

Worker evidence vs report:

```
gc-baseline.txt  JSON: delta = 1594400  (+1.59 MB)   <- matches report
gc-optimized.txt JSON: delta = 2627624  (+2.63 MB)   <- report claims +0.28 MB
mem-baseline.txt / mem-optimized.txt: 0 bytes (not usable as evidence)
```

My 5 trials (same call pattern as worker's mem.cjs):

```
baseline  churn MB: 3.73 1.56 0.89 2.33 2.76  median 2.33   retained KB median -46.1
optimized churn MB: 3.62 2.41 2.19 3.58 3.00  median 3.00   retained KB median -48.0
scavenges during 100k window: baseline 357, optimized 294   (totals 381 / 316)
```

Findings:

- The reported **+1.59 MB -> +0.28 MB is not reproducible**. The no-GC heap delta is a
  phase-of-scavenge artifact (it can swing by a whole nursery either way); my median
  shows no reduction, and the worker's own optimized log contradicts the report.
- The reliable signal, **scavenge count 381 -> 316 (-17%)**, reproduced exactly
  (my totals: 381 and 316; in-window 357 vs 294). Allocation churn did drop.
- Strict retained growth under forced GC is ~0 (negative, -46/-48 KB, noise) in both
  arms. Nothing is retained either way; the task's phrasing "heap retained growth
  reduced from +1.59 MB to +0.28 MB" is doubly wrong (not retained, not reproduced).
- Method difference from worker: I added a forced-GC retained measurement and repeated
  the churn measurement 5x per arm instead of once. Worker's own report already caveats
  the metric as a churn proxy; the number they printed is still wrong vs their evidence.

## 8. Classic falsifiers

| falsifier | result |
|---|---|
| shared RegExp `lastIndex` | Reset before each matcher, left at 0; safe for all repo call sites. But preset `lastIndex` diverges: baseline honors it, optimized ignores it (see below). |
| stale bundle | Ruled out: my source-built bundles = worker bundles modulo path comments; patched file hash identical. |
| warmup | Both arms warmed identically in every timing harness; both reach TurboFan (my own `--trace-opt` logs). |
| load spikes | 6.4-7.0 (16 cores) across my runs; medians used; one worker optimized run was spike-contaminated (7.02/26.21) and they used median-of-runs. |
| untested edges | Worker's 18 edges are real but don't exercise custom-matcher semantics; my 2,086-message corpus does not either problem because it uses `buildMatchers` output. |

Additional probes (public API, not reachable from repo call sites):

1. **Preset `lastIndex`**: `matchers[0].regex.lastIndex = 5`, text `"LO lo LO"`.
   baseline -> `[[6,"LO"]]`, lastIndex stays 5; optimized -> `[[0,"LO"],[3,"lo"],[6,"LO"]]`,
   lastIndex 0. The report mentions the mutable-`lastIndex` cost but attributes safety to
   synchronicity; the real safety argument is that no caller ever leaves a non-zero
   `lastIndex` on a matcher.
2. **Non-global regex matcher**: baseline throws
   `TypeError: String.prototype.matchAll called with a non-global RegExp argument`;
   optimized spins forever (killed at 3s, exit 124). Not mentioned in the report.
3. **Zero-length match with `u` flag**: custom matcher `/(?:^)|(.)/gu` on `U+1F600`.
   baseline -> `[]`; optimized -> **hang** (V8 clamps a `lastIndex` that falls inside a
   surrogate pair back to 0, so `re.lastIndex++` never advances). The report's claim that
   zero-length/`u` mismatch "can only matter at lone surrogates ... whose spans are
   discarded either way (covered by the edge corpus)" is overstated: a matcher that
   yields both zero-length and non-empty matches makes it a hang, and the edge corpus
   only exercises `buildMatchers` output. For the actual built-in fallback
   `/(?!x)/g` there is no `u` flag, so `lastIndex++` matches `matchAll` exactly - the
   production path is safe.

Engine tier: both arms reach TurboFan for `scanEmotes`, `ingestMessage`, `bumpTarget`.
My `--trace-opt --trace-deopt` run shows 4 bailout/deopt lines per arm, all in
`compareBoth`, an anonymous function, and `isEmoteSpam` (wrong map), symmetric across
arms; no deopts in the changed functions. Worker's "no deopt lines in either arm" is
true for their narrower run but is an absolute phrasing that my broader driver does not
reproduce.

## 9. Cost and revert claims vs the patch

- One file, 178 patch lines: true. Only `web/src/lib/chatIngest.ts` touched.
- No exported signature changed: true (diff only adds module-private `SPAN_PRIORITY`,
  `byLengthDesc`, `byStart`, `WORD_SPLIT`, `DIGITS_ONLY`, `bumpTarget` and edits bodies).
- `bumpTarget` module-private: true, `grep 'export.*bumpTarget'` empty in patched file.
- `evidence/diff.patch -R` restores baseline: verified, reverse-applied copy hashes back
  to `5ec88bf8...`; checkout was never written.
- Cost section omissions: the non-global-regex hang and the `u`-flag zero-length hang;
  the `lastIndex` safety rationale (fresh matcher state, not mere synchronicity).

## Discrepancies / overstatements

1. **Heap delta +0.28 MB optimized (report) vs +2.63 MB in the worker's own
   `gc-optimized.txt`; my 5 trials show no reliable reduction.** Falsified as stated.
   Real claim that survives: scavenges 381 -> 316.
2. Timing "4.1x / 2.0x" vs independent 3.91x / 1.94x (worker's own medians do give
   4.11x / 2.02x, so this is corpus/noise sensitivity, not fabrication).
3. "Spans are discarded either way" for zero-length `u` matchers: false in general
   (hang demonstrated); true only for the built-in fallback regex, which has no `u`.
4. "No deopt lines in either arm": true in their logs, but broader driver shows
   `isEmoteSpam` wrong-map deopt in both arms (symmetric, doesn't change the verdict).
5. `mem-baseline.txt` / `mem-optimized.txt` are empty; the report cites them as raw
   evidence for numbers they do not contain.
6. Report's own caveat "not a retained-memory claim" is honest, but the task framing
   ("retained growth") and the printed numbers don't match the logged run.

## Bottom line

Performance, closure-elimination, behavior-identity, and test claims hold under
independent reproduction. The heap claim as stated does not. Residual risk is confined
to misuse of the exported `scanEmotes` with hand-written matchers; no repo call site can
reach the divergent paths.
