# postwork reply-tree render: independent verification

**Verdict: CONFIRMED WITH CORRECTIONS.** The headline DOM win reproduces: median mount layout
91.3 → 37.5 ms (−59%), style 41.0 → 18.3 ms (−55%), task 255.2 → 130.1 ms (−49%) on a 200-reply,
3-level thread. Parity is exact (structure/text/geometry/listeners). Three disclosed costs are
real but one is understated (AA pixels), and one material cost is undisclosed (the first scroll
re-pays more layout than the mount saved). No interaction is broken.

Verifier harness: `/tmp/opencode/verify-postwork/`
`verify.mjs` (main loop), `supplement.mjs` (scroll passes, focus/click, same-page shot
determinism), `crosscheck-pixels.mjs` (diff of the worker's own evidence PNGs), `build.sh`
(arm builds). Raw results: `out/verify.json`, `out/supplement.json`. Chromium 152.0.7977.82
(`/usr/bin/chromium`), Playwright 1.63 `playwright-core`, Node v26.8.2, headless, viewport
1280x800, fresh context per round, one discarded warmup mount per arm, arms interleaved with
alternating order (before-first on odd rounds, after-first on even), metrics across mount plus
exactly two rAF ticks.

## 1. Arm provenance and hash (falsification attempt 1)

- `git -C /home/pronsh/Coding/postwork diff | sha1sum` = `37d136c3f5a4f5ba0f438c5a11028694bbd30f85`,
  matching the worker's claim. The diff is exactly one line in `src/components/ReplyTree.tsx:90`.
- Working tree was never touched. Before arm: `git archive HEAD` (HEAD
  `19dd3fa513704c9fa4e7c3adb5edcd68c23b06de`) unpacked to
  `/tmp/opencode/verify-postwork/postwork-before`; after arm = that tree + `worker.patch`.
- `postwork-before/src/components/ReplyTree.tsx` sha1 = `306da2510f18…` = `git show HEAD:…`;
  `postwork-after/…` sha1 = `0d5c8998eeff…` = the live working-tree file.
- Built bundles: `dist-before` contains no `content-visibility` string; `dist-after` contains it
  in both JS and generated CSS. The before arm is genuinely pristine HEAD, not a relabeled copy.

## 2. Headline: every round (falsification attempt 2)

Durations in ms. Delta across mount + two rAF ticks.

| Arm | LayoutCount | RecalcStyleCount | LayoutDuration | RecalcStyleDuration | TaskDuration | scrollHeight |
| --- | --- | --- | --- | --- | --- | --- |
| before r1 | 1 | 1 | 95.711 | 56.212 | 269.142 | 34098 |
| before r2 | 1 | 1 | 91.310 | 40.985 | 262.568 | 34098 |
| before r3 | 1 | 1 | 95.353 | 43.769 | 255.202 | 34098 |
| before r4 | 1 | 1 | 57.302 | 34.215 | 163.665 | 34098 |
| before r5 | 1 | 1 | 59.428 | 40.711 | 221.884 | 34098 |
| **before median** | **1** | **1** | **91.310** | **40.985** | **255.202** | **34098** |
| after r1 | 2 | 2 | 35.942 | 15.199 | 114.134 | 35105 |
| after r2 | 2 | 2 | 38.083 | 18.270 | 139.811 | 35105 |
| after r3 | 2 | 2 | 34.666 | 16.185 | 128.204 | 35105 |
| after r4 | 2 | 2 | 50.601 | 25.231 | 180.655 | 35105 |
| after r5 | 2 | 2 | 37.489 | 18.809 | 130.145 | 35105 |
| **after median** | **2** | **2** | **37.489** | **18.270** | **130.145** | **35105** |
| **delta** | | | **−58.9%** | **−55.4%** | **−49.0%** | **+2.95%** |

Worker's claimed medians (94.6/40.6, 44.7/18.4, 242.6/147.9) fall inside my round-to-round spread
and the same direction and magnitude hold. Trace-stage medians match the metric deltas:
trace `Layout` 91.238 → 37.404 ms, trace `UpdateLayoutTree` 40.968 → 18.202 ms, trace `Paint`
4.595 → 2.627 ms. `EventDispatch` 0 → 200 (the `contentvisibilityautostatechange` events); the
after arm runs two scoped lifecycle passes, exactly as reported.

TaskDuration varies most between rounds (163.7-269.1 before, 114.1-180.7 after); layout and
style are the stable discriminators and both reproduce.

## 3. Mechanism (falsification attempt 3: is the win real scoping?)

Trace args, round 1 (my run, matches worker's dumps):

- before `Layout` ×1 `dirtyObjects 6808/6808`; `UpdateLayoutTree` ×1 `elementCount 5677`.
- after `Layout` ×2 `dirtyObjects 485/485` then `398/850`; `UpdateLayoutTree` ×2 `elementCount 522` then `304`.

Offscreen replies genuinely leave layout/style; the win is scope, not measurement noise. Script is
0.7-0.8 ms in both arms, so no V8 confound.

## 4. Parity (falsification attempt 4: visible content)

- `__structure()` hash (tag tree + attributes except class/style + text): identical both arms,
  all rounds, `885acddd1b44…` (worker reported `885acddd…`).
- `__text()` hash identical, `c9778b6b…` (worker: `c9778b6b…`). DOM text is complete in both
  arms at load; `content-visibility` does not remove nodes.
- 4,443 elements, 200 articles, 75 `Replies to` sections, 134 links, 0 iframes in both arms.
- `JSEventListeners` +1,140 and `Nodes` +6,085 in both arms (no leak, no listener loss).
- Subpixel `getBoundingClientRect` of the first 8 articles is byte-identical between arms
  (e.g. article 1 `288.0, 90.3906, 704.0, 257.0469`).
- Screenshots are deterministic per arm: a single top-PNG sha1 across all 5 rounds
  (`23f983a2c12f` before, `fb0a53c1a899` after), same for bottom.

## 5. Corrections

### 5a. AA pixel delta is understated ~3.5x (and measured on the worker's own files)

My top PNGs are byte-identical to the worker's evidence (`final-before-r1-top.png` =
`23f983a2c12f`, `final-after-r1-top.png` = `fb0a53c1a899`). Diffing **the worker's own files**:

- top: **16,033 / 1,024,000 pixels = 1.57%**, max channel delta 206, bbox x 288-948, y 111-773.
- bottom (their pair): **3,865 = 0.38%**, max delta 222.

The report says "≈4,535 (0.44%)" top and "≈760 (0.07%)" bottom. Neither is reproducible; no
threshold on the pixel deltas yields 4,535 (delta ≥ 96 gives 5,364). Within-arm same-page
screenshots diff to 0, so the difference is real text rasterization under `contain: paint`, not
capture noise - just larger than disclosed. Geometry is unchanged, so the claim's
"invisible at 100%" framing survives; the number does not. My own bottom capture differs from the
worker's because the two harnesses end at different scroll offsets after different settle
sequences; the top viewport is the clean comparison.

### 5b. Undisclosed: the first scroll re-pays more than the mount saved

Measured from a settled top state, 10-step scroll to the bottom (main run, 5 rounds, medians):

| Phase | before | after |
| --- | --- | --- |
| mount TaskDuration | 255.2 | 130.1 |
| first scroll-to-bottom LayoutDuration | 0.0 | 73.2 |
| first scroll-to-bottom RecalcStyleDuration | 0.0 | 57.7 |
| first scroll-to-bottom TaskDuration | 85.8 | 280.4 |
| first scroll-to-bottom LayoutCount | 0 | 16 |

Mount + first-scroll task: **341 ms before vs 410 ms after - the after arm is ~20% worse for a
user who mounts the thread and reads to the bottom.** Supplement confirms this is mostly a
one-time reveal cost: second traversal layout 5.7-9.1 ms vs 46.9-79.0 ms on the first, though
every pass still does more task work than the before arm. The worker disclosed the +2.95% scroll
height and the one-time render, but not the re-pay, so the "impact honesty" of the headline is
partial: the fix defers mount work into the first scroll.

### 5c. Accessibility nuance

- Top-of-page AX tree: 5,051 non-ignored of 7,929 → 567 of 921. Worker's numbers reproduce exactly.
- At the bottom after full traversal: **4,875 / 5,051** - scrolling does not restore the whole
  tree; it sorts which near-viewport subset is present. So "absent until scrolled" is right, but
  the tree is windowed at all times, not cumulative.
- Interaction is not broken: `focus()` on the 150th article's reply button succeeds
  (`insideTarget: true`, `focusedInAx: true`, layout cost 0.75-1.03 ms); 60 real Tab presses reach
  article 21 with the focused element in the AX tree; a programmatic click on the deep reply
  button sets `aria-expanded=true` and mounts the composer in both arms. Cost during keyboard
  traversal in the after arm: `LayoutCount +205`, layout +83.6 ms over 60 tabs (supplement tab
  round), vs +8 / 3.9 ms before.
- No `sr-only` alternate render path for replies exists in the source; the excluded computed tree
  is the only AT surface. Actual screen-reader behavior is not testable in this environment; the
  risk is confined to AT discovery/reading of offscreen replies, not to pointer or keyboard use.

## 6. Remaining falsification attempts

- Wrong arm / stale bundle: ruled out via git archive, source hashes, and bundle greps (§1).
- Profiler attached / warmup asymmetry: identical protocol both arms, disabled warmup discarded.
- The excluded replies still exist and function (focus, tab, click) - content isn't removed.
- Real-app fidelity is not verifiable here (no backend); the worker's own limitation applies to
  my run too. I reused the worker's corpus, stubs, and component import graph unchanged except
  for an import alias. The measured DOM hash matches the worker's exactly, so both harnesses
  rendered the same tree.

## 7. Reproduce

```bash
# arm trees already at /tmp/opencode/verify-postwork/{postwork-before,postwork-after}
/tmp/opencode/verify-postwork/build.sh /tmp/opencode/verify-postwork/postwork-before /tmp/opencode/verify-postwork/dist-before
/tmp/opencode/verify-postwork/build.sh /tmp/opencode/verify-postwork/postwork-after  /tmp/opencode/verify-postwork/dist-after
node /tmp/opencode/verify-postwork/verify.mjs --rounds 5
node /tmp/opencode/verify-postwork/supplement.mjs
node /tmp/opencode/verify-postwork/crosscheck-pixels.mjs
```
