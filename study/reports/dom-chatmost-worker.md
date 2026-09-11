# DOM worker: chatmost chat-feed render (`renderChatEmotes`)

Repo: `/home/pronsh/Coding/chatmost` @ `ac39dfecea2b9a6b06cd5187d83dfa69d89090f9`
Repo state before work: clean. After work: `M web/src/lib/renderChatEmotes.tsx` (58 insertions, 40 deletions), **uncommitted**.
Diff hash: `git -C /home/pronsh/Coding/chatmost diff | sha1sum` = `936b21b030f5c4e6bc749ae043908d590c5c8b00`.
Date: 2026-09-10. Engine: Chromium 152.0.7977.82 (`/usr/bin/chromium`), Playwright 1.63 `playwright-core`, Node v26.8.2, Linux x64, headless, viewport 1280×800, fresh browser context per arm per round.

## Verdict

**PASS (DOM/style/paint stage).** Rendering the chat feed with 80 messages (the live cap) drops from **3,126 to 1,050 live nodes** (`LayoutObjects` 3,138 → 1,062, both −66%), **`UpdateLayoutTree` 6.61 → 4.03 ms** (−39%), **`Paint` 11.24 → 4.34 ms** (−61%), **`PrePaint` 3.49 → 1.24 ms** (−64%), **`TaskDuration` 108.0 → 81.1 ms** (−25%), and **`JSHeapUsedSize` +624 KB → +409 KB** (−34%). Layout is ~flat. The change is `renderChatEmotes` coalescing adjacent plain tokens into single text runs instead of wrapping every word and every space in its own `<span>`. Rendered text, images, alts, highlight spans, scroll offsets, and the 62-test suite are unchanged (3,132-case differential: 0 mismatches).

## Chosen interaction and mode

- Case: `renderChatEmotes` at `web/src/lib/renderChatEmotes.tsx:51`, called per message from `web/src/components/TwitchChatFeed.tsx:141`.
- Interaction: **render/mount the chat feed with 80 messages** (the harness calls the same render entry the app uses; the live `useTwitchChat` keeps at most 80: `web/src/hooks/useTwitchChat.ts:78`). Secondary numbers below cover the recurring "new message arrives, whole feed re-renders" cycle from the same runs.
- Mode: **harness**, because the real app cannot be driven deterministically without a backend:
  - live chat needs `wss://irc-ws.chat.twitch.tv` (`web/src/lib/twitchChat.ts:223`),
  - the Game page needs a built streamer archive (server route `/api/archive` + client ingestion) before it renders.
  The harness at `study/harness/dom-chatmost/` mounts the **real `TwitchChatFeed` component and real `renderChatEmotes`/`useEmoteMap`** built with the repo's own Vite + React Compiler config and the repo's Tailwind CSS; the only substitution is `@/lib/streamerContext` → `streamerContextStub.tsx`, which feeds a fixed emote map (40 emotes) instead of the network hook. Arm "before" is built from a verbatim `git show HEAD:web/src/lib/renderChatEmotes.tsx` copy (`renderChatEmotes.before.tsx`, sha1 `a0508e7a…`); arm "after" from the working tree.

## Floor target line

80 messages ≈ 4,152 chars ≈ 1,417 before-spans: render as **one text node per plain run + one `<img>` per emote inside the existing row** (~2-4 nodes/message instead of ~2×tokens+1), one style pass, one layout pass, zero forced layouts; identical text, alts, highlights, ARIA.

## Pipeline ledger (arm "before", mount, round 1)

| Stage | Work measured | Verdict |
| --- | --- | --- |
| DOM | `Nodes` +3,126, `LayoutObjects` +3,138; 1,417 `<span>` + 163 `<img>` + 84 `<div>` + 80 `<strong>`; 1,785 elements total | pays - one span+text node per token; the −2,076 measured nodes are these spans and their text nodes |
| Style | `RecalcStyleCount` +5, 3 `UpdateLayoutTree` events, 6.6 ms | pays - invalidation walks 1,417 inline boxes |
| Layout | 1 `Layout` event, 28.5 ms; `LayoutCount` +2 (one is the auto-scroll `scrollHeight` read + frame lifecycle) | floor: one pass, incremental already |
| PrePaint/Paint | 2 `PrePaint` (3.5 ms) + 2 `Paint` (11.2 ms) | pays - display list built for every token box |
| Commit/composite | no `UpdateLayerTree`/`CompositeLayers` in headless trace | not measured here |

Identity domain: message id (`key={m.id}`); `emoteMap` is `useMemo`-stable. Calls per interaction: 80 × `renderChatEmotes` → one React element per token before the fix.

## Fix (smallest change, DOM stage first)

`renderChatEmotes` now accumulates plain tokens into a string buffer and flushes it as a single text child around emotes/highlight spans (`renderChatEmotes.tsx:59-122`). Same img element, same highlight span, same outer span, same lookup order. No call-site, API, or type change.

## Before/after counters - all rounds

Mount (interaction under test), deltas around mount + two rAF ticks, fresh context each:

| Arm | Round | Nodes | LayoutObjects | RecalcStyleCount | ScriptDuration | TaskDuration | LayoutDuration | JSHeap delta |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| before | 1 | 3126 | 3138 | 5 | 25.33 ms | 123.65 ms | 55.18 ms | 639,624 B |
| before | 2 | 3126 | 3138 | 5 | 27.27 ms | 108.02 ms | 32.80 ms | 611,752 B |
| before | 3 | 3126 | 3138 | 5 | 19.81 ms | 81.47 ms | 32.04 ms | 623,732 B |
| before | **median** | **3126** | **3138** | **5** | **25.33 ms** | **108.02 ms** | **32.80 ms** | **623,732 B** |
| after | 1 | 1050 | 1062 | 5 | 14.76 ms | 63.29 ms | 27.74 ms | 414,980 B |
| after | 2 | 1050 | 1062 | 4 | 20.94 ms | 81.12 ms | 30.70 ms | 394,596 B |
| after | 3 | 1050 | 1062 | 5 | 30.32 ms | 84.18 ms | 26.60 ms | 409,200 B |
| after | **median** | **1050** | **1062** | **5** | **20.94 ms** | **81.12 ms** | **27.74 ms** | **409,200 B** |

Append one live message to the 80-message feed (secondary; same run, snapshot after the mount screenshot so it is screenshot-free):

| Arm | Round | Nodes | LayoutObjects | LayoutCount | ScriptDuration | TaskDuration | LayoutDuration |
| --- | --- | --- | --- | --- | --- | --- | --- |
| before | 1 | 49 | 51 | 1 | 10.96 ms | 27.39 ms | 1.28 ms |
| before | 2 | 49 | 51 | 1 | 15.90 ms | 51.92 ms | 2.22 ms |
| before | 3 | 49 | 51 | 1 | 9.58 ms | 26.51 ms | 1.17 ms |
| before | **median** | **49** | **51** | **1** | **10.96 ms** | **27.39 ms** | **1.28 ms** |
| after | 1 | 30 | 32 | 2 | 6.24 ms | 22.71 ms | 1.45 ms |
| after | 2 | 30 | 32 | 1 | 8.00 ms | 22.25 ms | 1.36 ms |
| after | 3 | 30 | 32 | 1 | 8.93 ms | 23.56 ms | 1.22 ms |
| after | **median** | **30** | **32** | **1** | **8.00 ms** | **22.71 ms** | **1.36 ms** |

(`Nodes` on append is "appended row − dropped row" (all other rows are reused); the same message pair is appended/dropped in both arms, so the stable 49 → 30 delta is the per-row node-cost difference for that pair. No leak: row count is 80 before and after every append, and repeated appends stay bounded.)

## Trace deltas (medians of 3; counts/duration on main thread)

Mount:

| Event | before | after |
| --- | --- | --- |
| `Layout` | 1 / 28.54 ms | 1 / 25.81 ms |
| `UpdateLayoutTree` | 3 / 6.61 ms | 3 / 4.03 ms |
| `Paint` | 2 / 11.24 ms | 2 / 4.34 ms |
| `PrePaint` | 2 / 3.49 ms | 1 / 1.24 ms |

Append:

| Event | before | after |
| --- | --- | --- |
| `Layout` | 1 / 1.25 ms | 1 / 1.33 ms |
| `UpdateLayoutTree` | 3 / 1.04 ms | 4 / 1.05 ms |
| `Paint` | 2 / 9.85 ms | 2 / 9.08 ms |
| `PrePaint` | 3 / 2.89 ms | 3 / 1.96 ms |

Append paint is dominated by the visible-area repaint after scroll-to-bottom (identical pixels), so it does not move. `FunctionCall`/`EventDispatch` counts are **not** comparable across arms: the extra events are lazy-`<img>` `load` dispatches that land inside or outside the short trace window depending on decode timing (verified from raw traces in `evidence/raw/`).

## Behavior parity

- Mount and append capture: `textContent` identical (4,152 chars), `innerText` identical (4,405 chars), `imgCount` 163 = 163, `imgAlts` identical arrays, `scrollTop`/`scrollHeight` identical (1830/2038), `aria-label`/`role` counts both 0. Element count 1,785 → 639; span count 1,417 → 271 (the removed spans are the per-token wrappers; the remaining spans are row skeletons, vote badges, highlight spans).
- Screenshots are stable across all 3 rounds per arm (mount sha1 `5eb8772258…` ×3 before, `c98c4682ba…` ×3 after; append likewise). Cross-arm diff: 1,174 px (mount) / 1,323 px (append) of 1,024,000 = **0.11-0.13%**, max channel Δ122, mean 0.038-0.040, all confined to glyph-edge antialiasing (bbox x393-613, y68-255); the side-by-side crop `evidence/screens/diff-mount-side.png` is visually identical, and merging text runs changes glyph subpixel positions by <1px, so a zero-pixel diff is not achievable for this fix.
- Differential: 3,132 cases (30 edge strings × Map/Record/no-map/matchedToken variants + 3,000 fuzz strings over emote names, case variants, whitespace, `< > & " '`, emoji), rendered through `react-dom/server` with both arms; normalized text/img-attributes/highlight-span signature: **0 mismatches** (`evidence/differential.json`).
- Repo gates: `tsc --noEmit -p web` pass, `eslint web/src/lib/renderChatEmotes.tsx` pass, `vitest run` 62/62 pass.
- Security: no `innerHTML`; text stays React-escaped; `img src` only from the emote map.

## Harness and exact run commands

Harness: `/home/pronsh/Coding/perf-prove-it/study/harness/dom-chatmost/`

```bash
H=/home/pronsh/Coding/perf-prove-it/study/harness/dom-chatmost
$H/run.sh build-before      # HARNESS_ARM=before -> HEAD copy of renderChatEmotes
$H/run.sh build-after       # working tree
$H/run.sh measure final 3   # serves evidence/serve on :8017, CDP metrics + traces, writes evidence/results-final.json
node $H/differential.mjs    # before/after semantic differential (3,132 cases)
node $H/compare-screens.mjs evidence/screens/before-r1-mount.png evidence/screens/after-r1-mount.png
```

Raw evidence: `evidence/results-final.json` (all rounds), `evidence/differential.json`, `evidence/screens/*-mount.png` / `*-append.png`, `evidence/raw/before-r1-*.json` (full trace events), `evidence/serve/` (both built arms).

## Trade-off and revert

- Trade: messages with no emotes now render as a single text node (plus the wrapper span) instead of one span per word/space. Any consumer that walks child `<span>`s of a message would see text nodes; none exists in the repo (`grep` found no such dependence), and the visible text, emote imgs, highlight spans, and hit targets are unchanged. `Nodes`/`LayoutObjects` −66%, heap −34%; no new layers or listeners (`JSEventListeners` identical: +326 mount, +6 append).
- Revert (one line): `git -C /home/pronsh/Coding/chatmost checkout -- web/src/lib/renderChatEmotes.tsx`

## One machine read

```text
mount trace: before UpdateLayoutTree:3/6.605ms Paint:2/11.239ms -> after UpdateLayoutTree:3/4.030ms Paint:2/4.341ms
-> Blink recalculated style and built a display list for 1,417 inline token boxes; with the spans gone it does the same passes for 271 boxes.
-> 3,126 -> 1,050 live nodes and 11.2 -> 4.3 ms of main-thread paint per feed render.
```

## Remaining spikes and what would reopen them

- Append still costs ~8 ms script + ~23 ms task because the whole 80-message list re-renders on every new message: `[...messages].reverse()` re-creates the child array and the React Compiler cannot keep per-row memo caches across the index shift. Reopen with a memoized row (stable order, key-based) - different change, different report.
- Mount `Layout` ~26 ms is text shaping/line breaking, not node count; a node reduction will not move it. Reopen if the corpus font or message length changes.
- Headless traces show no `CompositeLayers`/`UpdateLayerTree`; compositor/raster claims need headed Chromium per the skill.

## Skill friction

1. **Parity definition conflicts with the intended fix class.** The skill demands "same rendered DOM shape" in Step 5, but patterns #1/#2 (and any node-reduction fix) change shape by definition. Parity here had to be defined as rendered text + element semantics + pixels. Suggest the skill state the parity contract per fix class: node-reduction ⇒ text/ARIA/pixels, not identical node tree.
2. **Corpus size must come from the code, not the prompt.** The task example said "500 messages"; the app caps live messages at 80 (`useTwitchChat.ts:78`). A 500-message corpus would have overstated the in-app win. The skill should say to derive corpus size and caps from the call site.
3. **`Performance.getMetrics` before a trace window can absorb a lifecycle pass** between the snapshot and `Tracing.start` (mount `LayoutDuration` metric exceeded the trace `Layout` sum by up to 2×, e.g. 55.2 ms vs 49.6 ms). The trace window is the trustworthy stage measure; measurement.md should say so.
4. **Screenshot determinism with `scroll-smooth`** is not covered. The feed's auto-scroll effect leaves smooth scrolling mid-flight, so an early screenshot differs between rounds. The harness needed an explicit scroll-settle rAF loop before `page.screenshot`.
5. **Cross-arm pixel identity is unattainable for text-run merges.** Independent text nodes vs inline spans shift glyph subpixel positions, producing ~0.1% antialias-only pixel diff. The skill should tell workers to report bbox/max-delta, not just sha equality, or the report reads as a parity failure.
6. **Playwright 1.63 `page.accessibility.snapshot()` returned nothing** in this setup; the a11y parity step needs a fallback (innerText + alt/title list, or a DOM ARIA dump).
7. Version-dependent trace names: this build emitted `EventDispatch` from lazy-image `load`, not from a user event, which made `EventDispatch`/`FunctionCall` counts useless as parity metrics. The skill already warns names move; add "do not treat EventDispatch count as a comparison metric unless you have identified the dispatches".
