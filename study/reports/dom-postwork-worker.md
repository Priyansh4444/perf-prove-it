# postwork reply-tree render: DOM worker report

**Verdict: PASS with a disclosed accessibility cost.** One class attribute on the reply article (`src/components/ReplyTree.tsx:90`) cuts the median post-page layout pass from **94.6 ms to 40.6 ms** and style recalculation from **44.7 ms to 18.4 ms** for a 200-reply, three-level thread. DOM shape, text, ARIA attributes, node counts, and listener counts are identical. Trade: `content-visibility: auto` implies paint/style/layout containment, which (a) removes offscreen replies from the computed accessibility tree until scrolled, and (b) changes glyph rasterization inside contained articles. Both are measured below.

Repo state: HEAD `19dd3fa513704c9fa4e7c3adb5edcd68c23b06de`, clean tree at start. Working tree now carries the one-line fix; nothing committed. `git -C /home/pronsh/Coding/postwork diff | sha1sum` = `37d136c3f5a4f5ba0f438c5a11028694bbd30f85` (diff at the bottom).

## 1. Interaction, mode, floor

Interaction: opening a post page whose reply tree has 200 replies across 3 levels (15 roots, 60 children, 125 grandchildren) and ~40k characters of bodies with inline links/code. The measured unit is that route render: mount `<ReplyTree>` into a `PostPage`-shaped container, run the rendering lifecycle, snapshot.

Mode: **standalone harness**, not the running app. The app cannot start without a backend: `src/lib/convexClient.ts` throws `VITE_CONVEX_URL is not set` at module load, and demo mode still reads through Convex (`.env.local` points at an anonymous local deployment). The harness imports the **real, unmodified components** (`ReplyTree.tsx` and its whole import closure) and replaces only the runtime data modules (`convex/react`, `lib/store`, `lib/session`, `lib/agentTasks`) with stubs through a Vite `resolveId` interceptor. Every DOM operation, class, and child component is the production code path. Fidelity check: the built page renders the same DOM the real `PostPage` renders (`{n} replies` heading + `<ReplyTree>` in a `max-w-3xl` column), with the app's real `index.css` and Inter font.

Floor target line: *open a 200-reply thread with one style pass and one layout pass bounded to the viewport; offscreen replies keep their DOM identity, text, and ARIA but contribute no layout, style, or paint work; zero geometry reads.*

## 2. Pipeline ledger (from the before trace)

Stages touched per interaction, before:

| Stage | Work | Evidence |
| --- | --- | --- |
| DOM | 4,443 elements + 6,085 nodes created/inserted in one React commit; 1,140 listeners | `Nodes +6085`, `JSEventListeners +1140` |
| Style | one recalculation over the whole tree | `UpdateLayoutTree` ×1, `elementCount 5677` |
| Layout | one full-document pass | `Layout` ×1, `dirtyObjects 6808/6808` |
| Paint | viewport-culled | `Paint` ×1, 2.8-5.7 ms |
| Forced layout | none, zero geometry reads | `FunctionCall` 4 events, 1.6 ms; `ScriptDuration 0.7 ms` |

The ledger points at **Layout** (94.6 ms, 39% of a 242.6 ms task) and **Style** (44.7 ms, 18%); script is 0.7 ms, so this is not a V8 problem. Nothing is thrashing (`LayoutCount` is 1); the cost is the *scope* of the single pass over a 34,098 px document. Identity domain: one mounted `ReplyTree`; its per-reply `<article>` elements are the repeated identity unit, and all 200 exist simultaneously in the DOM.

## 3. Fix (stage-ordered, smallest change)

`src/components/ReplyTree.tsx:90`:

```diff
-      <article className="group py-3">
+      <article className="group py-3 [content-visibility:auto] [contain-intrinsic-size:auto_150px]">
```

`content-visibility: auto` removes offscreen articles from layout/style/paint while keeping their DOM nodes and listeners; `contain-intrinsic-size: auto 150px` gives skipped articles a stable placeholder height and remembers their real height once rendered. No JS, no data, no structure change.

## 4. Harness: path and exact commands

Harness: `/home/pronsh/Coding/perf-prove-it/study/harness/dom-postwork/` (`node_modules` is a symlink to postwork's). `measure.mjs` serves each arm's built bundle over a local HTTP port, drives Chromium via `playwright-core` (resolved from `presentation/package.json`), and records CDP `Performance.getMetrics`, a `devtools.timeline` trace, DOM structure/text hashes, the CDP accessibility tree, and screenshots.

```bash
cd /home/pronsh/Coding/perf-prove-it/study/harness/dom-postwork

# arm bundles (pristine source, then working tree with the fix)
OUT_DIR=dist-before node /home/pronsh/Coding/postwork/node_modules/vite/bin/vite.js build
OUT_DIR=dist-after  node /home/pronsh/Coding/postwork/node_modules/vite/bin/vite.js build

# final run: 5 interleaved rounds, fresh context per arm, one discarded warmup mount per arm
node measure.mjs --before dist-before --after dist-after --rounds 5 --tag final
```

Environment: Chromium 152.0.7977.82 (`/usr/bin/chromium`), Playwright 1.63 `playwright-core`, Node v26.8.2, headless, viewport 1280x800, fresh context per round. Metrics are deltas across the mount plus exactly two rAF ticks. Screenshots are taken after the page settles (5 extra rAF pairs), because the metric window and the visual-parity window are not the same thing.

## 5. Counters, every round

Delta across mount + two rAF ticks. Durations in ms. Fresh context each round; arms interleaved `before, after` per round after a discarded warmup mount each.

| Arm | LayoutCount | RecalcStyleCount | LayoutDuration | RecalcStyleDuration | trace Layout | trace UpdateLayoutTree | trace Paint | EventDispatch | TaskDuration | scrollHeight |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| before r1 | 1 | 1 | 101.0 | 44.5 | 100.97 | 44.44 | 4.91 | 0 | 243.6 | 34098 |
| before r2 | 1 | 1 | 70.8 | 44.7 | 70.72 | 44.65 | 3.08 | 0 | 203.9 | 34098 |
| before r3 | 1 | 1 | 94.6 | 80.8 | 94.57 | 80.76 | 5.68 | 0 | 294.8 | 34098 |
| before r4 | 1 | 1 | 95.5 | 58.9 | 95.41 | 58.91 | 5.32 | 0 | 242.6 | 34098 |
| before r5 | 1 | 1 | 71.7 | 42.4 | 71.56 | 42.43 | 2.84 | 0 | 221.9 | 34098 |
| **before median** | **1** | **1** | **94.63** | **44.67** | **94.57** | **44.65** | **4.91** | **0** | **242.59** | **34098** |
| after r1 | 2 | 2 | 40.6 | 18.4 | 40.52 | 18.38 | 2.48 | 200 | 166.7 | 35105 |
| after r2 | 2 | 2 | 47.5 | 15.6 | 47.40 | 15.54 | 2.21 | 200 | 147.8 | 35105 |
| after r3 | 2 | 2 | 57.6 | 23.4 | 57.45 | 23.34 | 3.78 | 200 | 192.0 | 35105 |
| after r4 | 2 | 2 | 34.1 | 18.3 | 34.03 | 18.25 | 2.39 | 200 | 138.3 | 35105 |
| after r5 | 2 | 2 | 33.0 | 19.3 | 32.94 | 19.32 | 1.54 | 200 | 118.8 | 35105 |
| **after median** | **2** | **2** | **40.61** | **18.40** | **40.52** | **18.38** | **2.39** | **200** | **147.85** | **35105** |

Medians: layout −57.1%, style −58.8%, total task −39.1%, paint −51%. `Nodes +6085`, `JSEventListeners +1140`, `JSHeapUsedSize` and `elements 4443` are identical in both arms. A pre-fix standalone run (`evidence/before-standalone.json`, measured before the repo was touched) also showed `LayoutCount 1` with 216.5/98.0/86.8 ms layout.

The after arm runs **two** scoped lifecycle passes instead of one full pass: the first lays out what is near the viewport, and the relevance state change triggers a second, smaller pass. Two cheap bounded passes beat one full-document pass: 40.6 ms vs 94.6 ms.

## 6. Trace evidence (mechanism)

`evidence/trace-args-before.txt`:

```
Layout            count 1  beginData {"dirtyObjects":6808,"totalObjects":6808}
UpdateLayoutTree  count 1  elementCount 5677
EventDispatch     count 0
```

`evidence/trace-args-after.txt`:

```
Layout            count 2  beginData {"dirtyObjects":485,"totalObjects":485}
                           beginData {"dirtyObjects":398,"totalObjects":850}
UpdateLayoutTree  count 2  elementCount 522
                           elementCount 304
EventDispatch     count 201  pagereveal x1, contentvisibilityautostatechange x200 (0.36-0.78 ms total)
```

Before, every one of the 6,808 layout objects and 5,677 styled elements was work the route render had to do. After, layout dirty-set is ~880 objects across the two passes and style touches ~826 elements; offscreen replies never enter the box tree. The 200 `contentvisibilityautostatechange` events are the cost of the mechanism, 0.36-0.78 ms. The durations in these two dumps are from a separate traced probe with extra tracing overhead; the verdict numbers are §5.

## 7. Behavior parity

- **DOM shape, text, ARIA**: `__structure()` (tag tree + all attributes except class/style + text) hashes `885acddd…` in both arms, all rounds; text hash `c9778b6b…`; 4,443 elements, 200 articles, 75 reply sections, 134 links, 0 iframes. Only difference: the article `class` attribute (the fix). `Nodes`/`JSEventListeners` deltas identical, so no leak.
- **Geometry**: subpixel `getBoundingClientRect` of the first 8 articles is byte-identical between arms (`evidence` repro: `debug-rects.mjs`), e.g. first article `top 90.39, height 257.05` in both.
- **Screenshots**: 5/5 rounds deterministic per arm. Viewport-top PNGs differ by ≈4,535 pixels of 1,024,000 (0.44%); bottom-after-scroll by ≈760 (0.07%). A banded shift analysis finds geometry aligned; the residual is glyph anti-aliasing. Variant isolation: `content-visibility:auto` alone, `contain:layout paint style` alone, and the full fix all produce the **same** raster hash (`fb0a53c1a899…`) while pristine is `23f983a2c12f…`, so the raster delta is containment's paint behavior, not the placeholder or the skip logic.
- **Accessibility tree** (CDP `Accessibility.getFullAXTree`, top of page): before 5,051 non-ignored nodes of 7,929; after 567 of 921. This is the real cost: skipped offscreen replies are absent from the computed tree until they become relevant (scrolled/focused). The DOM still carries every reply and all `aria-label`s, so AT that reads the DOM directly is unaffected; Chrome's virtualized tree is.

## 8. Trade, checks, revert

- Impact: layout 94.6 → 40.6 ms, style 44.7 → 18.4 ms, task 242.6 → 147.9 ms on a 200-reply thread. Linear in reply count: the larger the thread, the larger the win.
- Cost 1 (accessibility): offscreen replies leave the computed AX tree until relevant. For a read-everything flow this is a downgrade; for the route render it turns all-at-once layout into visible-only work. User decides.
- Cost 2 (raster): text inside contained articles anti-aliases differently while layout geometry is unchanged. Measured at 0.44% of viewport pixels; invisible at 100% but present.
- Cost 3 (scroll): until offscreen articles are rendered once, estimated document height is 35,105 px vs 34,098 px real (+2.9%) and the scrollbar adjusts as content is revealed; `contain-intrinsic-size: auto` remembers real heights afterward.
- Security: className-only change; no `innerHTML`, no new input surface.
- Checks on the edited tree: `bun run typecheck` exit 0, `bun run lint` exit 0, `bun run format:check` exit 0.
- Revert: `git -C /home/pronsh/Coding/postwork checkout -- src/components/ReplyTree.tsx` (one line; diff hash `37d136c3f5a4f5ba0f438c5a11028694bbd30f85`).

## 9. One machine read

`Layout beginData.dirtyObjects 6808/6808` → `Layout dirtyObjects 485/485 then 398/850`; `UpdateLayoutTree elementCount 5677` → `522 then 304`.
Blink used to size every offscreen reply because all 200 sat in the box tree; with `content-visibility: auto` it drops offscreen articles out of layout and style entirely and pays only for the viewport, which is where the 54 ms of median layout went.

## 10. Remaining spikes / what would reopen

- The after arm's second lifecycle pass (34% of the after layout time) is relevance settling. If a future Chromium changes relevance margins or event scheduling, re-run `--rounds 5 --tag final`.
- The AX-tree cost disappears only if containment is dropped or the app virtualizes with AT-aware reveal. If accessibility becomes a requirement for the thread view, this fix should be revisited (e.g. `content-visibility: auto` only on deep subtrees, or a screen-reader-only render path).
- Numbers are version-, font-, and viewport-locked. Re-verify after any Chromium/font/viewport change.

## 11. Skill friction

- **Framework extraction is unspecified.** The skill's "build a browser harness" assumes direct DOM operations. For React the only faithful path was a Vite `resolveId` interceptor that stubs backend hooks while importing the real components; that recipe (and the rule "stub the data layer, never the render layer") is worth adding to `references/measurement.md`.
- **Metric window vs screenshot window.** The skill says two rAF ticks and "screenshots need a settled page" but doesn't say they are different windows. Here the after arm is still settling at two rAFs, so the first screenshot pass produced false pixel differences. I split them: metrics at exactly two rAFs, screenshots after settle. Make that explicit.
- **"Same pixels where pixels matter" collides with containment.** `contain: paint` changes text rasterization with zero geometry change; patterns.md §7 presents `content-visibility`/`contain` without warning about this. Add the raster caveat and the variant-isolation method used here.
- **`identity domain` is not defined** anywhere in the skill or references, though task prompts ask for it. A one-sentence definition (per-interaction repeated identity: component instance, node, key) would remove the guesswork.
- **Trace event list is incomplete for modern features.** `EventDispatch` for `contentvisibilityautostatechange` is a measurable, expected event of this pattern and is not in the reference list of names.
- **Cold-start warmup.** One lifecycle in a fresh browser process pays font-shaping caches; in the first interleaved run without a warmup, `before r1` was 177.7 ms against a `before` median of 63.4 ms (2.8x) purely from being the process's first layout. The harness rules say "same warmup for both arms" but not "discard a warmup round"; make it a checklist item.
