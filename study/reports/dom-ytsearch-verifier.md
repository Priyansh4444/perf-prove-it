# dom-ytsearch verifier report: `content-visibility` on expanded transcript rows

Date: 2026-09-10. Verdict: **confirmed with corrections**.

Environment: Chromium 152.0.7977.82 (`/usr/bin/chromium`), Playwright 1.63
`playwright-core` via `/home/pronsh/Coding/perf-prove-it/presentation/package.json`,
Node v26.8.2, Linux x64, Intel Core Ultra 7 255H (16 threads), headless,
viewport 1280x800, `reducedMotion: reduce`, deviceScaleFactor 1, fresh browser
context per round, wait-for-rendered-condition then exactly two rAF ticks.
Bundle mode: **dev server** for the headline table (the worker's harness mode),
plus a **production bundle** spot check. No checkout or stash in the working
tree; the before arm is a `git archive HEAD` extraction.

## 1. Repo lock and hash falsification

- HEAD `ac8ea9a22b3364096774494f6b80799476b7199a`.
- `git diff -- src/components/video-result.tsx src/index.css | sha1sum` =
  `11f1f1038caf5e80a174d5a4ea7f01b48aa2d83e` - matches the worker's claim.
- `git diff | sha1sum` = `a34e01249175dbcee27aae8118354c4f517126ea` - matches.
- Before arm extracted with `git archive HEAD` to
  `/tmp/opencode/verify-ytsearch/ytsearch-head`: `video-result.tsx`
  `e4a93c5f973721dd48a0d7d9aae16690a0144c1b`, `index.css`
  `b12b8d75f88b76329abb44e0d1ef1a8d830b2c64` - identical to `git show HEAD:`
  blobs. Zero `moment-row` occurrences; the served page has no `.moment-row`
  elements and computes `content-visibility: visible` before and after the
  click.
- After arm is the worker's working tree: `video-result.tsx`
  `403c48cd5c7c68be1f4a94f7e2edfedb4ff06735`, `index.css`
  `6fb93b526884e2f2d3ea81228ce3a2da29cbd139`. Pre-click `momentRows: 0`,
  `contentVisibility: visible`; post-click `momentRows: 100`,
  `contentVisibility: auto`, `containIntrinsicSize: auto 96px`.
- Worker raw logs cross-checked: `results-{before,after}-expand.json` in the
  worker harness reproduce every median quoted in section 6 of the worker
  report (LayoutObjects 2197/449, LayoutCount 2/3, LayoutDuration
  28.055/17.083/27.359 vs 9.914/7.238/10.559, Paint 12.766/8.81/13.818 vs
  3.59/4.658/4.592, DOM digest `2b587c5710b5…`). No transcription drift found.

## 2. Harness (verifier-owned)

`/tmp/opencode/verify-ytsearch/`

- `measure.mjs` - own CDP loop: routes (reusing the worker's API fixtures),
  warm chunk, click `Show all moments`, wait for 100 rendered feedback
  buttons, two rAFs, `Performance.getMetrics` delta + `devtools.timeline` trace,
  screenshots, DOM parity dump, then a separate context for the scroll probe.
- `analyze.mjs`, `analyze-prod.mjs` - medians and per-round tables.
- `canvasdiff.mjs` - exact integer pixel diff via Chromium canvas (count, bbox,
  max channel delta, per-column counts). ImageMagick's `compare -metric AE`
  reported a fractional 138.4 for the same pair; the canvas count 686 is the
  correct absolute pixel count and matches the worker.
- `fullpage.mjs` - full-document (1280x11218) captures for real offscreen parity.
- `scrollshot.mjs` - step-scroll to `scrollY 2400`, viewport captures
  contained/forced.
- `pixdiff.sh`, `probe-element.mjs`, `debug.mjs`, `trace-debug.mjs`.

Servers: dev 3101 = HEAD archive, dev 3102 = worker tree. Production:
`vite build` of the HEAD archive (`dist-head`) and of the same archive with the
two worker files copied in (`dist-after`; built file hashes match the worker
files), previewed on 3201/3202. Fixtures come from the worker harness; all
numbers below come from the verifier's own runs.

## 3. Interaction results - dev bundle

One warmup round discarded per arm, 3 measured rounds per arm, fresh context
each. Dev run A before-arm sessions varied with machine load; the canonical
paired session is shown here, run A is noted below.

Expand (click → 100 rows → 2 rAFs), dev, per round:

| arm | round | wall ms | Nodes | LayoutObjects | LayoutCount | RecalcStyleCount | LayoutDuration ms | RecalcStyleDuration ms | Paint (trace) | UpdateLayoutTree | Layout events (dur/dirty) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- | --- |
| before | 2 | 111 | +4296 | 2197 | 2 | 12 | 8.545 | 4.399 | 9 / 6.364 ms | 11 / 4.238 ms | 0.53/20, 7.99/2208 |
| before | 3 | 127 | +4296 | 2197 | 2 | 12 | 9.449 | 4.689 | 9 / 4.667 ms | 11 / 4.488 ms | 0.57/20, 8.85/2208 |
| before | 4 | 177 | +4296 | 2197 | 2 | 12 | 10.725 | 6.974 | 9 / 5.819 ms | 11 / 6.843 ms | 1.70/20, 8.97/2208 |
| after | 2 | 113 | +4296 | 449 | 3 | 13 | 5.125 | 3.535 | 9 / 2.145 ms | 12 / 3.330 ms | 0.53/20, 1.50/115, 3.05/360 |
| after | 3 | 111 | +4296 | 449 | 3 | 13 | 4.724 | 3.372 | 9 / 2.239 ms | 12 / 3.225 ms | 0.61/20, 1.33/115, 2.76/360 |
| after | 4 | 143 | +4296 | 449 | 3 | 13 | 4.032 | 3.050 | 9 / 1.773 ms | 12 / 2.896 ms | 0.62/20, 1.10/115, 2.29/360 |

Medians and change:

| metric | before | after | change |
| --- | ---: | ---: | ---: |
| LayoutObjects | 2197 | 449 | **-79.6%** |
| LayoutCount | 2 | 3 | +1 |
| RecalcStyleCount | 12 | 13 | +1 |
| LayoutDuration | 9.449 | 4.724 | -50.0% |
| RecalcStyleDuration | 4.689 | 3.372 | -28.1% |
| Paint durMs | 5.819 | 2.145 | -63.1% |
| UpdateLayoutTree durMs | 4.488 | 3.225 | -28.1% |
| Nodes | +4296 | +4296 | 0 |
| JSEventListeners | 0 | 0 | 0 |
| dirtyObjects summed | 2228 | 495 | -77.8% |
| EventDispatch count | 20 | 120 | +100 (all `contentvisibilityautostatechange`) |

Dev run A (earlier session, before arm only, same harness): LayoutDuration
17.677 / 17.241 / 28.354, RecalcStyleDuration 10.814 / 10.078 / 14.467, Paint
13/12.938, 13/11.522, 11/13.795. The worker's before-arm rounds (28.055 /
17.083 / 27.359) sit inside this spread; the after arm was stable across my
sessions (4.0-10.6 ms layout). Durations are load-dependent; counters are not.

## 4. Production bundle spot check

Same loop, `VERIFY_PROD=1` (no dev chunk warmup), 1 warmup + 3 measured rounds.
The after bundle contains `.moment-row { content-visibility: auto; … }`; the
before bundle contains zero `moment-row`.

| arm | round | LayoutObjects | LayoutCount | LayoutDuration ms | RecalcStyleDuration ms | Paint (trace) | ScriptDuration ms |
| --- | ---: | ---: | ---: | ---: | ---: | --- | ---: |
| before | 2 | 2197 | 2 | 15.668 | 7.774 | 9 / 6.490 ms | 27.321 |
| before | 3 | 2197 | 2 | 12.626 | 5.708 | 9 / 6.112 ms | 20.463 |
| before | 4 | 2197 | 2 | 9.140 | 5.520 | 9 / 5.911 ms | 52.059 |
| after | 2 | 449 | 3 | 4.623 | 3.033 | 7 / 1.753 ms | 19.917 |
| after | 3 | 449 | 3 | 5.270 | 3.376 | 9 / 2.920 ms | 28.062 |
| after | 4 | 449 | 3 | 4.474 | 3.395 | 9 / 2.021 ms | 22.361 |

Prod medians: LayoutDuration **12.626 → 4.623 ms (-63.4%)**, RecalcStyleDuration
**5.708 → 3.376 ms (-40.9%)**, Paint **6.112 → 2.021 ms (-66.9%)**,
LayoutObjects **-79.6%**, LayoutCount **2 → 3**, Layout events
[20/174, 2208/2303] → [20/174, 115/210, 360/539]. The claimed -64% layout
reduction reproduces on the production bundle; the other duration deltas are
machine/load dependent.

## 5. Parity

- **DOM text**: `article.textContent` SHA-256 identical across arms in every
  round (dev and prod), 100 rows, 1 article, section header
  `Videos · 1 on current page` equal.
- **ARIA**: full `[aria-label]` / `aria-pressed` / `title` dump of the card
  identical across arms (202 entries, dev and prod); `Mark moment useful` /
  `Mark moment not useful` labels and pressed states unchanged.
- **Geometry**: first-row boxes identical (`row top 400.5 h 98`, feedback
  column `top 401.5 w 40 h 96`, `border-inline-start: 1px solid rgb(37,37,37)`);
  `scrollHeight` 11218 in both arms contained and forced, every round.
- **Pixels, visible region** (1280x522 from card top): cross-arm diff is
  exactly **686 px, 0.1027%, bbox 39x335+1191+171, maxDelta 155** in all dev
  and prod rounds; identical after two extra rAFs (steady state); within-arm
  visible-vs-late is 0 px both arms. Injecting
  `* { content-visibility: visible !important }` into the after arm brings the
  visible diff to **0 px** - containment is the sole cause.
- **Pixels, all offscreen rows** (the worker's evidence does not actually cover
  these; their `revealed-*.png` files are 1280x122 viewport-clipped strips of
  page y 678-800 despite the requested y=678 h=1200 region): my full-document
  captures (1280x11218) of before-forced vs after-forced differ by **0 px**
  outside the volatile `N ms request` header strip (124 px, maxDelta 155,
  x1071-1086 y187-197); top band (0-178) and rows band (225-11218) are both
  0 px. So the conclusion "skipped rows render identically" holds, but only the
  verifier's evidence establishes it.
- **Pixels, scrolled state**: at `scrollY 2400` (step-scrolled through the
  contained rows), before vs after-forced is 0 px; before vs after-contained is
  1417 px, all inside the same feedback-divider columns, bbox 39x744+1191+47.
  Row tops/heights at that offset are identical across arms
  (`-1.5, 104.5, …`, 98 px each).
- **`innerText` differs** (before 14772 chars vs after 2676): `innerText`
  reflects rendered text, so content skipped by `content-visibility: auto` is
  excluded. `textContent` and ARIA are identical; this is spec behavior, but
  it is a DOM-API-visible change worth knowing.

## 6. Deferred work - scroll into the contained rows (falsification attempt)

After expanding, the page was step-scrolled to the bottom (18 steps, two rAFs
each) in a fresh context, measuring the scroll window separately.

| probe | before | after |
| --- | ---: | ---: |
| dev scroll LayoutCount | 0 | 18 |
| dev scroll LayoutDuration | 0 ms | 33.856 / 46.112 / 52.882 ms (median 46.112) |
| dev scroll Paint | 62 / 68.096 ms | 247 / 27.045 ms |
| dev scroll RecalcStyleDuration | 11.229 ms | 19.906 ms |
| prod scroll LayoutCount | 0 | 18 |
| prod scroll LayoutDuration | 0 ms | 37.731 / 47.513 / 47.334 ms (median 47.334) |
| prod scroll Paint | 68.949 ms | 25.438 ms |
| scroll dirtyObjects (after) | 0 | 2201 |
| `contentvisibilityautostatechange` during scroll | 0 | 167 |

Combined expand + full scroll-through, layout: dev before 9.45 + 0 = 9.45 ms
vs after 4.72 + 46.11 = **50.83 ms**; prod 12.63 vs **51.95 ms**. The
interaction win is therefore **deferral**: a user who scrolls through all 97
rows re-pays more total layout than the uncontained arm (in 18 partial passes),
while scroll paint is cheaper (dev 68.1 → 27.0 ms; prod 68.9 → 25.4 ms). The
claim's numbers are interaction-scoped and correct as such; "Blink skips
layout inside the offscreen excerpts" should read "defers it until they scroll
in".

## 7. Corrections to the worker report

1. **Duration magnitudes are overstated for a fast dev session.** The claimed
   -64% / -47% / -64% reproduce on the production bundle (-63.4% / -40.9% /
   -66.9%) and against run A's slower before arm, but the paired dev session
   on this machine gives -50.0% / -28.1% / -63.1% (9.449→4.724, 4.689→3.372,
   5.819→2.145 ms). Counters (LayoutObjects, LayoutCount, dirty scope, Paint
   count 9→9) reproduce exactly in every run; do not treat the worker's
   absolute before-arm seconds as a stable baseline.
2. **The scroll re-pay is undisclosed.** The worker's "content-visibility let
   Blink skip style/layout/paint inside the 97 offscreen excerpts" and the
   floor target "offscreen rows contribute no layout objects" hold at
   interaction time only. Scrolling the list to the bottom pays 18 layouts /
   ~46-47 ms and 2201 dirtied objects; total layout across expand+scroll is
   ~5x the old arm. Add this to the trade-off list.
3. **The revealed-pixel parity evidence is invalid as captured.** The worker's
   `revealed-before-expand-r{1,2,3}.png` and `revealed-after-expand-r{1,2,3}.png`
   are 1280x122 viewport-clipped strips (page y 678-800), so the 15-pair
   "0 px" result never covered offscreen rows. Re-established here with
   full-document captures (0 px outside the volatile request-time strip).
4. **The 1px snap is per-row, not a single 686 px spot.** It reappears on every
   contained row that renders: the scrolled viewport diff is 1417 px in the
   same divider columns (bbox 39x744+1191+47), and the full-page render shows
   the x1190 column affected over 8064 px. It is deterministic and
   containment-caused (0 px when forced visible), but its disclosure should
   say "each contained row's feedback divider", not one divider.
5. **`layoutCount 2 → 3` is real and cheap**: the extra passes are partial
   (115/210 and 360/539 dirtied objects, 1.1-3.2 ms each) replacing one
   full-document pass (2208/2303). Total dirty objects fall 2228 → 495.
6. **`innerText` no longer contains skipped rows' text** (2676 vs 14772 chars).
   `textContent`/ARIA parity is exact; if any feature or test reads
   `innerText`, this will change behavior.
7. Minor: worker element count 1594 vs my dev 1593 / prod 1598 (harness
   timing/injected dev styles); equal across arms within a session, so not a
   parity concern.

## 8. Verdict

**Confirmed with corrections.** The structural claim reproduces exactly and
deterministically on both bundle modes: LayoutObjects 2197 → 449 (-79.6%),
LayoutCount 2 → 3, dirty scope 2228 → 495, 100
`contentvisibilityautostatechange` events, and a deterministic containment-
caused 1px feedback-divider snap (686 px in the first viewport, recurring per
rendered row). Directional duration reductions hold in every round; the
production bundle gives -63.4% layout, -40.9% recalc-style, -66.9% paint,
matching the claimed percentages, while a lightly loaded dev session gives
-50% / -28% / -63%. DOM text, ARIA, geometry, scroll extent and revealed
pixels are at parity. The significant correction: the win is largely deferral -
scrolling the contained rows into view re-pays 18 layout passes (~46-47 ms),
so the full-scroll total layout exceeds the uncontained arm even though scroll
paint is cheaper.

Artifacts: `/tmp/opencode/verify-ytsearch/` (`measure.mjs`, `analyze.mjs`,
`analyze-prod.mjs`, `canvasdiff.mjs`, `fullpage.mjs`, `scrollshot.mjs`,
`out/analysis.txt`, `out/analysis-prod.txt`, `out/summary.json`,
`out/{before,after,prod-before,prod-after}/*.png|json`).
