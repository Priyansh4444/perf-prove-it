# dom-ytsearch worker report: expanding a video result's moments

Date: 2026-09-10. Environment: Chromium 152.0.7977.82 (`/usr/bin/chromium`),
Playwright 1.63 `playwright-core`, Node v26.8.2, Linux x64, headless, viewport
1280×800, `reducedMotion: reduce`, fresh context per round, 3 rounds per arm.

## 1. Repo state (rule 1)

```
$ git -C /home/pronsh/Coding/ytsearch rev-parse HEAD
ac8ea9a22b3364096774494f6b80799476b7199a

$ git -C /home/pronsh/Coding/ytsearch status --short   # recorded before any edit
 M .gitignore
 D AGENTS.md
 D autoresearch/program.md
 D docs/agent-output-budget.md
 D docs/autoresearch.md
 D docs/axiom-agent-guide.md
 D docs/cold-warm-concurrency-costs-2026-07-17.md
 D docs/cost-cutting-audit-2026-07-26.md
 D docs/cost-optimization.md
 D docs/google-production-research.md
 D docs/local-multimodal-embedding-model-plan.md
 D docs/low-resource-semantic-search-2026-07-18.md
 D docs/performance-research.md
 D docs/search-memory-halving-strategy-2026-07-22.md
 D docs/semantic-experiment-2026-07-13.md
 D docs/semantic-search-strategy.md
 D docs/typesense-memory-optimization.md
 D docs/vector-search-and-multimodal-research-2026-07-17.md
 M scripts/fly-publish-raw-generation.sh
 M scripts/reconcile-raw-publication-builder.sh
 M scripts/run-raw-publication-canary.sh
?? .github/ISSUE_TEMPLATE/
?? .github/PULL_REQUEST_TEMPLATE.md
?? scripts/lib/raw-publication-builder-profile.sh
```

The dirty entries above predate this task. The fix adds only
`M src/components/video-result.tsx` and `M src/index.css`; no commit was made.

- Full working-tree diff: `git diff | sha1sum` →
  `a34e01249175dbcee27aae8118354c4f517126ea` (includes the pre-existing dirt).
- Changed-files diff: `git diff -- src/components/video-result.tsx src/index.css | sha1sum` →
  `11f1f1038caf5e80a174d5a4ea7f01b48aa2d83e`.

## 2. Interaction and mode

**Interaction:** click "Show all moments" on a video result card. The card goes
from 3 visible transcript excerpts to all 100, in place, with no navigation.

Path: `src/components/video-result.tsx:226-247` (button) → `expandMoments`
(`:59-84`) fetches `/api/search?…&video_id=…&per_page=100` → `setAllHits` +
`setShowAllMoments(true)` → `visible` memo (`:29`) flips from `slice(0,3)` to the
full list → `For` (`:214`) appends 97 `TranscriptExcerpt` rows (`:296-369`).

**Mode: real app, mocked network (not harness-only).** The app was driven as
shipped: `vite` dev server on `localhost:3000`, with `page.route("**/api/**")`
serving deterministic JSON for `/api/availability`, `/api/youtubers`,
`/api/index-status` and `/api/search`, and `https://i.ytimg.com/**` fulfilled
with a per-video coloured SVG placeholder. Every DOM operation measured is the
real `VideoResult`/`SearchResults` code. Nothing needed credentials, the Rust
API, or the internet; no repo code was extracted.

## 3. Floor target line (skill step 1)

> Expand one onscreen card from 3 to 97 appended transcript rows: 97 insertions,
> 0 geometry reads, 1 style pass over the new subtree, layout bounded so that
> offscreen rows contribute no layout objects; identical order, text, ARIA, and
> rendered pixels.

Before the fix: 2208 layout objects were dirtied and the full 2303-object
document was laid out for the same interaction.

## 4. Pipeline ledger

| Stage | What the interaction does | Identity domain |
| --- | --- | --- |
| DOM | one fetch; +4296 nodes; 97 new rows; 1594 elements in the results area; +0 listeners (Solid delegates clicks) | `hit.id`; rows keyed by object reference in `For` |
| Style | every inserted row invalidates once: `RecalcStyleCount` +13…+16 per arm (unchanged by the fix) | row class list derived from `props.selected`/`bounded` |
| Layout | before: one pass, `dirtyObjects:2208, totalObjects:2303, partialLayout:false`; after: `360/539` + `115/210` | no geometry reads anywhere in the path - these are frame-boundary passes, not forced reflow |
| Paint | before: 9-11 `Paint` events, 8.8-13.8 ms; after: 9-11 events, 3.6-4.7 ms | - |

## 5. Harness and exact run command

Harness: `/home/pronsh/Coding/perf-prove-it/study/harness/dom-ytsearch/`
(`measure.mjs`, `fixtures.mjs`, `pixel-diff.mjs`, `dump-region.mjs`,
`diff-histogram.mjs`, `probe-pixels.mjs`, `crop.mjs`).

```sh
# terminal 1
cd /home/pronsh/Coding/ytsearch && ./node_modules/.bin/vite --port 3000 --strictPort

# terminal 2 - one arm per command; 30 cards / 100 moments corpus
cd /home/pronsh/Coding/perf-prove-it/study/harness/dom-ytsearch
node measure.mjs --arm before --interaction expand   # writes results-before-expand.json + PNGs
node measure.mjs --arm after  --interaction expand   # same setup, fresh context/round
node measure.mjs --arm before --interaction mount    # context: render a 30-video page
node measure.mjs --arm after  --interaction mount

# parity
node pixel-diff.mjs visible-before-expand-r{1,2,3}.png visible-after-expand-r{1,2,3}.png
node pixel-diff.mjs revealed-before-expand-r{1,2,3}.png revealed-after-expand-r{1,2,3}.png
```

`measure.mjs` snapshots CDP `Performance.getMetrics`, traces
`devtools.timeline,v8,blink.user_timing`, advances two rAF ticks after the
render, then captures a DOM digest, a viewport clip from the card top down
(excludes the volatile request-ms header), and a `revealed` band after forcing
`content-visibility: visible` so skipped rows can be pixel-compared.

## 6. Counters around the interaction - all rounds, medians

`show all moments`, 3 → 100 rows. Each row is one independent run.

| Metric | before r1 | r2 | r3 | median | after r1 | r2 | r3 | median |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Nodes | +4296 | +4296 | +4296 | +4296 | +4296 | +4296 | +4296 | +4296 |
| JSEventListeners | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| LayoutObjects | 2197 | 2197 | 2197 | **2197** | 449 | 449 | 449 | **449** |
| LayoutCount | 2 | 2 | 2 | **2** | 3 | 3 | 3 | **3** |
| RecalcStyleCount | 15 | 14 | 13 | **14** | 13 | 16 | 15 | **15** |
| LayoutDuration (ms) | 28.055 | 17.083 | 27.359 | **27.359** | 9.914 | 7.238 | 10.559 | **9.914** |
| RecalcStyleDuration (ms) | 13.949 | 8.998 | 13.535 | **13.535** | 7.114 | 6.373 | 8.697 | **7.114** |
| ScriptDuration (ms) | 66.9 | 41.6 | 61.3 | **61.3** | 64.4 | 44.3 | 62.7 | **62.7** |
| TaskDuration (ms) | 164.7 | 108.9 | 153.4 | **153.4** | 124.9 | 99.9 | 130.8 | **124.9** |
| JSHeapUsedSize (B) | 2 628 636 | 3 196 352 | 3 239 036 | **3 196 352** | 3 161 664 | 3 286 744 | 3 207 892 | **3 207 892** |
| wall (context only, ms) | 225 | 156 | 189 | 189 | 175 | 144 | 173 | 173 |

Headline: `LayoutObjects` −80% (2197 → 449), `LayoutDuration` −64%
(27.4 → 9.9 ms), `RecalcStyleDuration` −47% (13.5 → 7.1 ms). `Nodes`,
`JSEventListeners` and heap are unchanged.

**Context arm - rendering a page of 30 results (`mount`, no regression):**

| Metric | before median | after median |
| --- | ---: | ---: |
| Nodes | +5550 | +5550 |
| JSEventListeners | +15 | +15 |
| LayoutObjects | 517 | 517 |
| LayoutCount | 4 | 4 |
| LayoutDuration (ms) | 27.049 | 21.402 |
| RecalcStyleCount | 12 | 12 |

The collapsed render path is byte-identical in DOM/counters because the row rule
only applies while the list is expanded (`bounded={showAllMoments()}`).

## 7. Trace deltas - all rounds

`Layout` events (count / ms) and their `beginData`:

```
before r1  Layout 26.820ms  dirtyObjects 2208  totalObjects 2303  partialLayout false
           UpdateLayoutTree 9.677ms
before r2  Layout 16.126ms  dirtyObjects 2208  totalObjects 2303  partialLayout false
           UpdateLayoutTree 5.709ms
before r3  Layout 26.117ms  dirtyObjects 2208  totalObjects 2303  partialLayout false
           UpdateLayoutTree 9.722ms

after  r1  Layout 5.802ms  dirtyObjects 360  totalObjects 539  partialLayout false
           Layout 3.085ms  dirtyObjects 115  totalObjects 210  partialLayout false
           UpdateLayoutTree 10/6.198ms total
after  r2  Layout 3.641ms  dirtyObjects 360  totalObjects 539  partialLayout false
           Layout 2.012ms  dirtyObjects 115  totalObjects 210  partialLayout false
           UpdateLayoutTree 13/5.802ms total
after  r3  Layout 5.864ms  dirtyObjects 360  totalObjects 539  partialLayout false
           Layout 3.164ms  dirtyObjects 115  totalObjects 210  partialLayout false
           UpdateLayoutTree 12/7.696ms total
```

Aggregate trace, medians of 3:

| Event | before count / ms | after count / ms |
| --- | ---: | ---: |
| `Layout` | 2 / 27.282 | 3 / 9.846 |
| `UpdateLayoutTree` | 11 / 13.090 | 12 / 6.198 |
| `Paint` | 9 / 12.766 | 9 / 4.592 |
| `PrePaint` | 22 / 5.607 | 23 / 2.420 |
| `EventDispatch` | 20 / 4.939 | 120 / 7.702 |

The extra `EventDispatch` entries are 100 `contentvisibilityautostatechange`
events (no listeners registered; ~2-3 ms total including the click stream).
No `Layout` event is nested inside a script task; `partialLayout:false` on every
pass. No forced synchronous layout exists in this path before or after.

**Machine read:**

```text
before: Layout 26.8ms {"dirtyObjects":2208,"totalObjects":2303}
after:  Layout 5.8ms {"dirtyObjects":360,"totalObjects":539} + 3.1ms {"dirtyObjects":115}
-> content-visibility:auto let Blink skip style/layout/paint inside the 97 offscreen
   excerpts, so the same append dirtied 475 objects instead of 2208
-> layout 27.4 -> 9.9ms, paint 12.8 -> 4.6ms at identical DOM, text, ARIA and revealed pixels.
```

## 8. Parity evidence

- **DOM shape/text/ARIA:** structural outline digest identical in every round and
  both arms: `2b587c5710b5d607…`; 1594 elements; 100 rows; section headers
  `Videos · 1 on current page`; feedback buttons `aria-label`/`aria-pressed`
  identical. (`results-*-expand.json` → `rounds[].dom`.)
- **Visible region (1280×522 clip from card top):** within-arm diff 0 px;
  cross-arm 686 px every time - a deterministic 1-device-pixel offset of the
  1px divider on the "not useful" feedback button, bbox `x1191 y171 39×335`,
  0.1027% of the region. Cause: paint-offset snapping inside the contained row
  whose top is fractional (400.5px); it survives extra frames and a forced
  relayout/repaint, so it is steady-state, not a stale frame. This is the fix's
  one disclosed pixel cost.
- **Revealed region (force `content-visibility: visible`, then compare rows 5+
  that are offscreen in the measured state):** **0 px difference in all 15
  before/after pairs** - every skipped row's content is pixel-identical when
  rendered. This also confirms the 6rem intrinsic estimate does not corrupt the
  rendered result.
- **Scroll extent:** `document.documentElement.scrollHeight` = 11218 in both the
  contained and uncontained states (probes `scrollfixed`/`scrollplain`), so the
  intrinsic estimate did not change the scrollbar extent in the settle state.
- Screenshots and JSON evidence live in `study/harness/dom-ytsearch/`
  (`results-before-expand.json`, `results-after-expand.json`, `visible-*.png`,
  `revealed-*.png`, `pixdiff-*.png`).

## 9. The fix

```diff
 src/components/video-result.tsx
 +                  bounded={showAllMoments()}
 ...
 +  // Only the expanded list is long enough for offscreen excerpts to justify
 +  // content-visibility; collapsed cards keep their exact previous render path.
 +  bounded?: boolean;
 ...
-      class={`grid min-w-0 max-w-full grid-cols-[minmax(0,1fr)_auto] items-stretch border bg-vesper-bg transition-colors ${
+      class={`${
+        props.bounded ? "moment-row " : ""
+      }grid min-w-0 max-w-full grid-cols-[minmax(0,1fr)_auto] items-stretch border bg-vesper-bg transition-colors ${
```

```diff
 src/index.css
+.moment-row {
+  content-visibility: auto;
+  contain-intrinsic-size: auto 6rem;
+}
```

Rejected variants (measured, 1 round each, not shipped):

| Variant | LayoutObjects | LayoutDuration | Pixels vs before |
| --- | ---: | ---: | --- |
| row containment, unconditional | 449 | ~10 ms | 686 px + mount LayoutCount 4→5 |
| containment moved to the text cell | 1289 | ~30 ms (5 passes) | 0 px |
| row containment, `auto 98px` estimate | 449 | ~13 ms | 686 px |
| forced relayout/repaint of contained rows | - | - | 686 px (not transient) |

Repo gates on the final tree: `vitest run` 22 files / 116 tests pass;
`tsc --noEmit` clean; `oxfmt --check` clean; `oxlint --type-aware
--import-plugin --deny-warnings` clean on both files.

Revert (one line): `git -C /home/pronsh/Coding/ytsearch checkout -- src/components/video-result.tsx src/index.css`

## 10. Trade-off, cost, and remaining spikes

- Wins: `LayoutObjects` −80%, `LayoutDuration` −64%, `RecalcStyleDuration` −47%,
  `Paint` −64%. Trade: `LayoutCount` 2 → 3 (relevance resolution for the
  contained rows costs one extra pass; total layout time still falls 2.8×), 100
  `contentvisibilityautostatechange` dispatches (~2-3 ms), and the disclosed
  1px divider paint snap (686 px, 0.10% of the measured region; DOM/text/ARIA
  and revealed pixels unchanged).
- `ScriptDuration` (41-66 ms) is dominated by the Solid dev bundle's `flush`
  (74-113 ms `FunctionCall` in dev deps). That is V8/renderer work, not Blink;
  a production-build measurement is the follow-up for script.
- The mount flow is unchanged; the card-level `content-visibility` already
  bounds it (LayoutObjects 517 both arms).
- Re-check the 1px containment snap and the `contentvisibilityautostatechange`
  event stream on the next Chromium upgrade.

## 11. Skill friction

- **Async interactions need a settle rule.** `measurement.md` says "run the
  interaction, then two rAF ticks". Here the interaction is click → fetch →
  render, so the correct protocol is wait-for-rendered-condition + two rAF ticks.
  The docs only describe synchronous interactions.
- **Screenshot parity has no tolerance or method.** The skill says "compare
  screenshots", but raw hashes differ between *identical* runs (volatile
  request-ms text, capture timing). Needed: a volatile-region clip, real
  pixel-diff, and a force-render reveal to compare content skipped by
  containment. Both techniques are reusable and worth a line in the references.
- **LayoutCount is the wrong headline for containment.** "One is healthy, a
  count near the loop count is thrashing" made 2 → 3 look like a regression even
  though `LayoutDuration` fell 2.8× and `dirtyObjects` fell from 2208 to 475.
  The skill should rank `dirtyObjects`/`totalObjects` and stage duration above
  raw pass count.
- **`content-visibility`'s paint-snapping cost is missing from `patterns.md`.**
  Pattern 7 recommends containment without warning that contained rows can snap
  inner 1px borders on fractional offsets, or that 100
  `contentvisibilityautostatechange` events appear.
- **Dev vs production bundle.** Script numbers came from a Vite dev build where
  Solid's dev bundle `flush` dominates; the skill should require stating the
  bundle mode for any script claim even when the claim is about Blink.
- The required report format (worker prompt, step 7) is not the skill's own
  "The report" list; both are workable but have different section orders.
