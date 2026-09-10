# Adversarial verification: `decodeEntities` fast-path patch (ytsearch)

Date: 2026-09-10. Verifier session independent of the worker.
Worker artifacts: `/tmp/swarm-study/highlight/{report.md,patch.diff,evidence/,arms/}`.
All verification writes confined to `/tmp/verify-highlight/`. No edits to `/home/pronsh/Coding/ytsearch`.

## Verdict: VERIFIED (core claims independently reproduced; two minor report defects, one overstated cost claim)

| # | Claim | Result |
|---|-------|--------|
| 1 | Checkout not modified | PASS (target files pristine; unrelated pre-existing worktree changes predate session) |
| 2 | Patch applies to fresh copy; matches worker artifact | PASS (byte-identical SHA-256) |
| 3 | Input-class analysis of fast path | DONE (fast path is sound in Chromium; jsdom-only divergence) |
| 4 | Own differential test >= 20k cases | PASS (94,097 checks in Chromium, 0 mismatches; 42 jsdom-only divergences) |
| 5 | Repo utils tests on patched copy | PASS (3/3) |
| 6 | Timing, >=5 runs/arm, separate processes | PASS (40.6x mixed vs claimed 45.4x; entity path 20.4x, no-entity 66.6x) |
| 7 | DOM accounting | PASS (exactly 547 -> 0 innerHTML, 1 -> 0 createElement, both engines) |
| 8 | Cost and revert claims | PARTIAL: +39/-0 correct; bytecode 44 -> 130 (claim 129); exact revert command fails (fallback works) |

## 1. Checkout integrity

```
$ git -C /home/pronsh/Coding/ytsearch status --short
 M .gitignore
 D AGENTS.md
 D autoresearch/program.md
 D docs/... (16 files)
?? .github/ISSUE_TEMPLATE/
?? .github/PULL_REQUEST_TEMPLATE.md
```

`src/utils.ts` is not in the list. `git diff -- src/utils.ts src/utils.test.ts` is empty.
SHA-256 of `src/utils.ts` = `16d5ae4c66cf21b9e1406c4ff3be2671ba1fe06ea70320df3e1d50866e73c8aa`.
The unrelated changes have mtimes 2026-08-20, three weeks before the worker session (2026-09-10 15:43-15:48),
so they are pre-existing and not attributable to the worker. `src/utils.ts` mtime is 2026-08-23 17:43.
The patch was never applied to the checkout.

## 2. Fresh copy + patch application

Copied repo to `/tmp/verify-highlight/repo/` (node_modules symlinked), rewrote only the patch headers to
relative paths (the original `---` header is the absolute checkout path; GNU patch 2.8 refuses absolute
names, see #8), then applied:

```
$ patch -p1 < /tmp/verify-highlight/patch-rel.diff
patching file src/utils.ts
$ sha256sum repo/src/utils.ts arms/patched-utils.ts
953af31f7634b4f960f03bcf16b939e884d63cdd198c3b60bf60f9a3e3d4cdb5  repo/src/utils.ts
953af31f7634b4f960f03bcf16b939e884d63cdd198c3b60bf60f9a3e3d4cdb5  arms/patched-utils.ts
```

Patched copy is byte-identical to the worker's `arms/patched-utils.ts`, and its function region is
identical to `arms/optimized-final.ts` (which in turn is identical to `arms/optimized-nohoist.ts`).

## 3. Fast path: what is decoded manually, what falls back, where the pre-scan could be wrong

`decodeEntities(value)`:
- `firstAmp = value.indexOf("&")`.
- If no `&`: returns `value` unchanged **iff** no `\r` and no `\0` (the two characters the HTML parser
  normalizes when assigned to `textarea.innerHTML`).
- If `&` exists: `decodeKnownEntities` manually decodes **exactly** `&amp; &lt; &gt; &quot; &#39;`
  (exact case, semicolon required) and returns the rebuilt string only if **every** `&` in the string is
  one of those five. Any other `&` (unknown name, uppercase variant, no semicolon, numeric/hex, lone `&`)
  returns `undefined` and falls through to the DOM.
- Any string containing `\r` or `\0` also falls back, entities or not.

Pre-scan correctness, empirically checked in Chromium 151 (the app runtime) and jsdom (test runtime):
- Chromium normalizes only CR -> LF and drops NUL; form feed, vertical tab, BOM, lone surrogates,
  `</textarea>`, comments, and `</script>` are preserved verbatim by `textarea.innerHTML`.
  Both special characters are guarded, so the fast path matches the DOM on every tested input.
- The `</textarea>` RCDATA-truncation hypothesis was tested with 11,488 generated cases in Chromium:
  Chromium (like jsdom) preserves `</textarea>` in `textarea.value`; no mismatch. Hypothesis falsified.
- **jsdom-only divergence**: for strings containing lone surrogates, jsdom's `innerHTML` setter throws
  `Invalid code point ...` in the baseline, while the fast path returns the string. 42/94,097 jsdom
  checks diverge this way (all `base=err:...`; the 40 sampled mismatches are all this class). Chromium
  preserves lone surrogates, so the fast path matches the real browser; this is a jsdom artifact, not a
  production behavior change (arguably more robust). Not in the worker's corpus (its alphabet has no
  lone surrogates).
- Other theoretical divergence: when `document` is undefined the baseline throws and the fast path
  returns for no-`&` strings. Not reachable in the app.

## 4. Independent differential test

Harness: `/tmp/verify-highlight/diff/{differential.ts,cases.ts,browser-diff.mjs}`.
Baseline and patched functions extracted mechanically from the pristine and patched files
(`extract.mjs`; no manual transcription). 47,236 inputs -> 94,097 comparisons (each input checked
through `decodeEntities` directly and through `highlightedParts`); classes included: numeric refs
`&#0;`..`&#0x2ff;` plus 7 large/overflow code points, hex refs (`&#x`, `&#X`), unknown refs, mixed-case
named refs (`&AMP;`, `&Amp;`, `&LT;`, ...), no-semicolon refs, double-encoded (`&amp;amp;`, `&amp;#39;`,
`&#38;amp;`), CR/CRLF/LF/NUL, form feed/VT, lone surrogates/astral, BOM, `</textarea>` bombs,
`<mark>` injections (incl. uppercase and malformed), and 400 many-entity strings up to 5,000 repeats.

Results:
```
jsdom     cases_checked=94097 mismatches=42   (all baseline-throws on lone surrogates)
chromium  cases=47236 checks=94097 mismatches=0   (Chromium 151.0.7922.34)
```

The worker's own harness was also rerun as-is: `differential engine=node v26.8.2 ... cases_checked=50015 mismatches=0`.
No mismatch in either engine on any case the worker tested; no mismatch in Chromium on the broader
corpus. The 42 jsdom divergences are the only behavioral difference found.

## 5. Repo tests on the patched copy

```
$ cd /tmp/verify-highlight/repo && CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=false ./node_modules/.bin/vitest run src/utils.test.ts
 Test Files  1 passed (1)
      Tests  3 passed (3)
```

This closes the gap the worker disclosed: their evidence log `repo-vitest-utils.txt` was produced at
`/home/pronsh/Coding/ytsearch` (the *unpatched* checkout). The patched file itself now passes the repo's
own test file.

## 6. Timing

Protocol: worker's corpus (`corpus.ts` copied unchanged), `bench.ts` with `hrtime.bigint`, 3 warmup
rounds, 12 measured rounds, **separate process per run**, 5 runs per arm interleaved, no `--expose-gc`,
load average sampled per process.

| Workload | baseline median (ns/call) | patched median (ns/call) | speedup |
|---|---|---|---|
| mixed (worker's 304-call corpus) | 27,347.5 | 674.3 | **40.6x** |
| no-entity (entities stripped) | 26,616.8 | 399.8 | **66.6x** |
| entity-only (all 5 backend entities) | 19,096.3 | 934.1 | **20.4x** |

- Claimed 45.4x (26,165.8 -> 576.5). My run: 40.6x. Same order; difference is load/process variance
  (my loadavg was 5.6-7.0 vs the worker's quieter run). Their median arithmetic (average of the two
  middle values of 4) is correct.
- The speedup is **not** confined to the no-entity fast path: the entity path is still ~20x faster
  because the manual decoder beats a jsdom DOM parse. The no-entity path is the largest contributor.
- Measurement trap worth recording: with `--expose-gc` and `globalThis.gc()` between rounds, the
  baseline rises ~2.7x (78.7us vs 27.3us) while the patched arm is unchanged, inflating a careless
  rerun to ~127x. The worker's protocol had no working `gc()` (no `--expose-gc`), so their numbers are
  internally consistent; my first pass fell into this trap and was discarded.
- Fallback cost (unknown entity). The report says an unknown-entity string pays "one `indexOf` + a
  short `startsWith` chain (~sub-microsecond)". Measured with a trailing `&notanentity;` after K known
  entities: patched vs baseline = 19.5us vs 21.9us (K=10), **67.4us vs 34.7us (K=100, 1.9x slower)**,
  240us vs 176us (K=1000), 1.03ms vs 0.81ms (K=5000). `decodeKnownEntities` decodes the whole string
  and allocates before returning `undefined`, then the DOM parses it again. This is an overstatement,
  though the current backend (`escape_html`) emits only the five known entities, so the fallback is
  unreachable from production data.

## 7. DOM accounting (independent)

Instrumented `document.createElement` and the `HTMLTextAreaElement.prototype.innerHTML` setter in both
engines and ran the 304-item corpus through each arm:

```
jsdom     arm=baseline calls=304 createElement_calls=1 textarea_innerHTML_sets=547
jsdom     arm=patched  calls=304 createElement_calls=0 textarea_innerHTML_sets=0
chromium  arm=baseline calls=304 createElement_calls=1 textarea_innerHTML_sets=547
chromium  arm=patched  calls=304 createElement_calls=0 textarea_innerHTML_sets=0
```

Exactly matches the worker's `dom-accounting-final.txt` (547/1 -> 0/0), in a second engine and with an
independently written instrumentation. 547/304 = 1.8 parses/call, matching the report's ~1.8.

## 8. Cost and revert claims

- **Lines**: my `diff -u` gives `added=39 deleted=0`, file 107 -> 147 lines. Matches "+39 lines (no
  deletions)" exactly.
- **Bytecode**: measured with `node --print-bytecode --print-bytecode-filter=...`:
  baseline `decodeEntities` = 44 bytes; patched `decodeEntities` = **130** bytes (report says 129, off
  by one - version/feedback-vector detail); the new `decodeKnownEntities` helper is a further 251 bytes
  (the report mentions "one new helper" but not its size). Cost claim materially correct.
- **Revert**: the report's exact command
  `patch -R -p0 < /tmp/swarm-study/highlight/patch.diff` **fails as written** on GNU patch 2.8:
  ```
  Ignoring potentially dangerous file name /home/pronsh/Coding/ytsearch/src/utils.ts
  can't find file to patch at input line 3
  ```
  because the `---` header is an absolute path (dry-run leaves the file untouched; verified). The
  report's alternative `git checkout -- src/utils.ts` is correct. With relative headers,
  `patch -R -p1 < patch-rel.diff` restores the original exactly (hash back to `16d5ae4c...`), and
  re-applying restores `953af31f...`.
- **API/type/call-site changes**: none in the diff. Correct.
- Backend claim checked: `escape_html` at `crates/youtube_raw_search/src/engine/query_support.rs:1152`
  escapes exactly `& < > " '`. Correct. It does *not* filter `\r`/`\0` - the report's "no producer emits
  \r/\0" is an upstream-data assumption, but the patch guards both by falling back, so correctness does
  not depend on it.

## Discrepancies and overstatements (complete list)

1. Report's `Tests` section implies the repo's own test file ran green against the change; the logged
   run was against the unpatched checkout. Disclosed later in the report; independently closed here
   (patched copy passes 3/3).
2. Fallback overhead "~sub-microsecond" is wrong for entity-heavy strings with a late unknown entity:
   up to 1.9x slower at K=100, 1.28x at K=5000. Unreachable from the current backend, so low impact.
3. Exact revert command `patch -R -p0 < patch.diff` fails (absolute path rejected by GNU patch 2.8);
   documented alternative works.
4. Bytecode figure 129 vs measured 130; new helper's 251 bytes omitted from the cost statement.
5. jsdom-vs-Chromium divergence on lone surrogates (baseline throws in jsdom, fast path returns) not
   mentioned; Chromium behavior is preserved, so not a production issue.
6. "No producer emits \r/\0" is an assumption, not enforced by `escape_html`.

## Artifacts

- Fresh copy + patch: `/tmp/verify-highlight/repo/`, `/tmp/verify-highlight/patch-rel.diff`, `actual.diff`
- Differential: `diff-output.txt` (jsdom), `browser-diff-output.txt` (Chromium), `browser-probe.txt`
- Tests: `patched-vitest-utils.txt`
- Timing: `timing-{mixed,noentity,entity}.txt`, `loadavg-{before,after}.txt`, `fallback-overhead.txt`
- DOM accounting: `dom-accounting-independent.txt`
- Bytecode/driver: `diff/bytecode-driver.ts`
