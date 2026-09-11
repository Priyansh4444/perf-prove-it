# DOM verifier: chatmost chat-feed render (`renderChatEmotes`)

Claim under test (from `study/reports/dom-chatmost-worker.md`): fixing `web/src/lib/renderChatEmotes.tsx` in `/home/pronsh/Coding/chatmost` reduces **Nodes 3126 -> 1050 (-66%)**, **UpdateLayoutTree 6.61 -> 4.03 ms**, **Paint 11.24 -> 4.34 ms**, with parity on text/ARIA/screens, diff hash `936b21b030f5c4e6bc749ae043908d590c5c8b00`.

**Verdict: CONFIRMED WITH CORRECTIONS.** Node counts, layout-object counts, semantic/pixel parity, and paired stage-direction reproduce exactly. The named after-arm duration medians are environment-sensitive: I reproduced UpdateLayoutTree after=4.20 ms (claim 4.03) but Paint after=7.06 ms (claim 4.34); before-arm UpdateLayoutTree was 10.44 ms (claim 6.61). The worker's `evidence/raw/` traces are stale and do not back `results-final.json` (correction 1).

Verifier: adversarial pass per `study/PROTOCOL.md` and `skills/perf-prove-it-dom/references/measurement.md`. Date 2026-09-10.

## Identity checks (all pass)

| Check | Result |
| --- | --- |
| `git -C chatmost status --short` | ` M web/src/lib/renderChatEmotes.tsx` only (worker edits untouched) |
| `git -C chatmost diff \| sha1sum` | `936b21b030f5c4e6bc749ae043908d590c5c8b00` = claim; unchanged after all runs/tests |
| Worker's `renderChatEmotes.before.tsx` vs `git show HEAD:...` | byte-identical (sha1 `a0508e7a…`); arm-before is genuinely HEAD |
| My before arm source | fresh `git worktree` at HEAD `ac39dfe` (`/tmp/opencode/chatmost-head/web/src`, sha1 `a0508e7a…`); my after arm = working tree (sha1 `ec2be3da…`) |
| Build equivalence | both arms built by my own vite config; CSS byte-identical (sha1 `bdffe1ce…`), JS differs only by the fix; in-page span count 1417 (before) vs 271 (after) proves each bundle contains its intended implementation |

## Method (independent loop)

- Harness: `/tmp/opencode/verify-chatmost/` - `measure.mjs`, `pixel-diff.mjs`, `diff-edge.mjs`, `differential-entry.tsx`, `differential-run.mjs`, `combine.mjs`, built arms under `serve/`. Corpus/fixtures reused from the worker's harness (allowed); the measurement loop, parity dumps, pixel differ, edge analysis, and differential generator are mine. No worker JSON numbers were reused.
- 3 blocks x (1 warmup discarded + 3 measured) = **9 measured rounds per arm**; fresh browser context per arm per round; alternating arm order; ~2 s per arm-round, ~50 s per 8-round block (screenshot mtimes). Chromium `152.0.7977.82` (`/usr/bin/chromium`), playwright-core 1.63 via `createRequire` from `presentation/package.json`, Node v26.8.2, headless, viewport 1280x800, `loadavg` 3.6-5.5 during runs (16 cores; two unrelated vite servers at up to 200% CPU - duration confound recorded below).
- Mount interaction: 80 messages = the live cap (`web/src/hooks/useTwitchChat.ts:78`), driven through the real `TwitchChatFeed`/`renderChatEmotes`; CDP `Performance.getMetrics` delta around mount + two rAF, plus a `devtools.timeline` trace window over the same interaction. Append: one live message in the same context (secondary).
- Raw per-round artifacts: `results.json`, `results-2.json`, `results-3.json`, `combined.json`, `raw/*.json`, `shots/*.png`.

## All measured rounds (mount / append)

| arm | block-round | Nodes | ULTree c/ms | Paint c/ms | Layout c/ms | PrePaint c/ms | Script ms | Task ms | Heap B | ap.Nodes | ap.UL ms | ap.Paint ms |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| before | b1-r1 | 3126 | 2/9.878 | 2/13.007 | 1/30.569 | 2/3.560 | 29.90 | 111.95 | 591056 | 49 | 1.64 | 17.12 |
| before | b1-r2 | 3126 | 3/10.440 | 2/7.442 | 1/22.382 | 2/2.180 | 32.36 | 98.96 | 607692 | 49 | 0.89 | 8.52 |
| before | b1-r3 | 3126 | 2/10.955 | 2/11.501 | 1/34.244 | 2/3.962 | 35.33 | 122.20 | 620156 | 49 | 0.71 | 12.37 |
| before | b2-r1 | 3126 | 3/9.280 | 2/13.716 | 1/30.695 | 1/4.512 | 38.34 | 121.27 | 591064 | 49 | 1.74 | 25.43 |
| before | b2-r2 | 3126 | 2/10.743 | 2/12.270 | 1/28.455 | 2/4.240 | 35.82 | 115.99 | 607248 | 49 | 1.19 | 18.42 |
| before | b2-r3 | 3126 | 3/10.786 | 2/11.920 | 1/30.832 | 1/3.790 | 27.04 | 108.59 | 621328 | 49 | 0.95 | 13.35 |
| before | b3-r1 | 3126 | 4/7.017 | 2/11.864 | 1/32.964 | 2/4.333 | 29.85 | 114.32 | 625592 | 49 | 1.22 | 17.92 |
| before | b3-r2 | 3126 | 3/9.275 | 2/7.046 | 1/21.253 | 2/2.154 | 23.13 | 83.74 | 594248 | 49 | 0.77 | 9.12 |
| before | b3-r3 | 3126 | 3/11.735 | 2/15.007 | 1/28.949 | 1/4.852 | 48.91 | 138.27 | 604380 | 49 | 0.89 | 11.62 |
| before | **median** | **3126** | **3/10.440** | **2/11.920** | **1/30.569** | **2/3.962** | **32.36** | **114.32** | **607248** | **49** | **0.95** | **13.35** |
| after | b1-r1 | 1050 | 3/8.126 | 2/7.055 | 1/30.820 | 2/2.281 | 28.13 | 99.48 | 417600 | 30 | 0.59 | 5.80 |
| after | b1-r2 | 1050 | 3/4.199 | 2/4.579 | 2/31.109 | 2/2.331 | 19.45 | 75.35 | 384524 | 30 | 0.87 | 6.11 |
| after | b1-r3 | 1050 | 3/3.879 | 2/9.629 | 1/30.248 | 2/2.878 | 19.13 | 88.84 | 396124 | 30 | 1.28 | 12.88 |
| after | b2-r1 | 1050 | 2/4.154 | 2/4.144 | 1/18.060 | 2/1.223 | 19.08 | 60.61 | 401008 | 30 | 1.20 | 11.28 |
| after | b2-r2 | 1050 | 3/4.969 | 2/7.093 | 2/29.249 | 1/1.976 | 22.59 | 82.28 | 404432 | 30 | 0.91 | 5.85 |
| after | b2-r3 | 1050 | 3/6.307 | 2/7.313 | 1/32.749 | 2/2.415 | 32.28 | 100.02 | 409240 | 30 | 0.91 | 5.68 |
| after | b3-r1 | 1050 | 3/5.041 | 2/5.313 | 1/24.124 | 2/1.561 | 23.83 | 75.57 | 404412 | 30 | 1.56 | 15.42 |
| after | b3-r2 | 1050 | 2/3.869 | 2/7.139 | 2/33.164 | 2/3.817 | 18.84 | 80.70 | 398872 | 30 | 1.48 | 14.92 |
| after | b3-r3 | 1050 | 3/3.982 | 2/3.979 | 1/21.987 | 2/1.235 | 22.37 | 79.49 | 403016 | 30 | 1.04 | 10.21 |
| after | **median** | **1050** | **3/4.199** | **2/7.055** | **1/30.248** | **2/2.281** | **22.37** | **80.70** | **403016** | **30** | **1.04** | **10.21** |

Warmup rounds (discarded), mount: before `b1 3126/10.777/11.756`, `b2 3126/13.723/7.269`, `b3 3126/6.818/9.014` (ULTree ms/Paint ms); after `b1 1050/4.620/4.275`, `b2 1050/3.959/4.944`, `b3 1050/5.935/7.323`. Counters repeat exactly; the first before-mount script/task is 1.5-2x steady (e.g. Task 144 vs 114 ms), which is why the worker discards warmups too.

## Claim vs verifier

| Metric (mount) | Claim before -> after | Verifier median (n=9) | Read |
| --- | --- | --- | --- |
| Nodes | 3126 -> 1050 (-66%) | 3126 -> 1050 (-66.4%) | exact, every round |
| LayoutObjects | 3138 -> 1062 | 3138 -> 1062 (-66.2%) | exact |
| UpdateLayoutTree | 3 ev / 6.61 -> 3 ev / 4.03 ms | 3 / 10.44 -> 3 / 4.20 ms | after matches; before inflated here; 9/9 paired rounds after<before; reduction -60% (claim -39%) |
| Paint | 2 ev / 11.24 -> 2 ev / 4.34 ms | 2 / 11.92 -> 2 / 7.06 ms | before matches; **after not reproduced** (my min 3.98); 8/9 paired rounds after<before; reduction -41% (claim -61%) |
| PrePaint | 3.49 -> 1.24 | 3.96 -> 2.28 | direction confirmed, after higher than claim |
| Layout | 28.54 -> 25.81 ("flat") | 30.57 -> 30.25 | flat confirmed |
| TaskDuration | 108.0 -> 81.1 (-25%) | 114.3 -> 80.7 (-29%) | confirmed |
| JSHeapUsedSize | +623,732 -> +409,200 (-34%) | +607,248 -> +403,016 (-34%) | confirmed |
| JSEventListeners | +326 -> +326 mount, +6 append | +326/+326, +6/+6 | identical both arms |
| Append Nodes | 49 -> 30 | 49 -> 30 every round | confirmed |
| Append UpdateLayoutTree | 1.04 -> 1.05 ("flat") | 0.95 -> 1.04 | flat |
| Append Paint | 9.85 -> 9.08 ("does not move") | 13.35 -> 10.21 | noisy/confounded (see correction 4) |
| ScriptDuration (not headline) | - | 32.36 -> 22.37 ms | down, no moved work |

## Parity evidence (independent)

- **Text/ARIA/geometry dump** (`captureParity`, every measured round): `textContent` identical 4,152 chars, `innerText` identical 4,405 chars, 163 imgs with identical `alt`/`title`, 9 highlight spans with identical text, 0 `role`/`aria-*` attributes on both arms, `scrollTop`/`scrollHeight` identical (1830/2038), row bounding-rect max delta **0.00 px**, img max delta **0.20 px**, highlight max delta **0.06 px**. Element count 1785 -> 639 and span count 1417 -> 271 - the intended deletion, exactly as the worker reported.
- **Own pixel diff** (own `pixel-diff.mjs`, canvas decode): within-arm mount and append screenshots are pixel-identical across all rounds (diff 0); cross-arm in every paired round: mount **1,174 px / 1,024,000 = 0.115%**, max channel delta **122**, mean 0.038, bbox x393-613 y68-255; append **1,323 px = 0.129%**, max 122, mean 0.040, bbox x393-727 y66-255. These match the worker's numbers exactly. Volatile regions: the append row carries a `Date.now()` timestamp; all appends in each run fell inside one wall-clock minute, so it did not contribute; across longer gaps the timestamp text would differ and must be masked.
- **Edge-confinement check** (own `diff-edge.mjs`): 1,174/1,174 mount and 1,322/1,323 append differing pixels lie on local glyph-edge gradients (max gradient among off-edge pixels: 0 mount, 15 append); no structural/geometry block differences. Antialias-only per the skill's parity definition.
- **Own semantic differential** (`differential-run.mjs`, 51 edge strings x 24 map/matchedToken combos + 5,000 fuzz strings = **6,224 checks, 0 mismatches**), comparing both real implementations through `react-dom/server` with wrapper spans canonicalized; raw HTML differs, proving distinct implementations were compared. The worker's `differential.json` (3,132/0) is consistent.
- **Repo gates** (worker-touched tree): `tsc --noEmit -p web` exit 0; `eslint web/src/lib/renderChatEmotes.tsx` exit 0; `vitest run` 62/62 pass.
- **No moved work**: script, task, heap, layout objects and listener counts all decrease or stay equal on mount and append; the fix adds no observer/containment/listener; parity shows semantics unchanged.

## Corrections

1. **Worker `evidence/raw/` is stale and does not back `results-final.json`.** r1 numbers disagree (before mount ULTree `3 events/6.536 ms` raw vs `2/6.267` results; after append Paint `2/9.912 ms` raw vs `4/10.952` results; more EventDispatch/FunctionCall counts differ). Raw mtimes (16:59:24-27) precede the final run's screenshots/results (16:59:46-55), and the harness writes raw *after* screenshots, so those files are from an earlier (pilot) run. The report's medians do match `results-final.json`, but quoting `raw/before-r1-*.json` as full trace events for the final rounds is wrong.
2. **Only r1 screenshots were retained** (`evidence/screens/` has mount+append for r1 only); the "sha1 x3 identical" stability claim is supported by the hashes recorded in `results-final.json` and by my own pixel-identical within-arm runs, but the r2/r3 PNGs themselves are absent.
3. **Duration headlines are environment-sensitive.** On this loaded box (loadavg 3.6-5.5, unrelated vite processes), before-arm UpdateLayoutTree ran 10.44 ms (claim 6.61) and after-arm Paint ran 7.06 ms (claim 4.34; my best round 3.98). Every structural metric, the node delta, and the paired direction reproduce; the quoted percentages are not the ones measured here (ULTree -60%, Paint -41%). Recommend quoting counters plus paired direction, or rerunning quiet.
4. **Append Paint "does not move" is better stated as "not reliably comparable."** Random lazy-`<img>` `load` dispatches (identified by `EventDispatch` args `data.type=load`, 0-118 per trace window, occurring in both arms) land inside or outside the window; my append Paint medians are 13.35 -> 10.21 ms with 2 Paint events in every round. The worker disclosed this confound for FunctionCall/EventDispatch; the append flat claim is not reproduced as flat, though there is no regression.
5. Minor: `RecalcStyleCount` metric reads 4 (before median) vs 5 (after) here while the trace shows 2-4 style passes both arms - the metric is noisy; the worker's 5/5 is inside that noise. `JSEventListeners` +326 mount / +6 append confirmed identical.

## Artifacts

- This report: `study/reports/dom-chatmost-verifier.md`
- Harness: `/tmp/opencode/verify-chatmost/` (`measure.mjs`, `pixel-diff.mjs`, `diff-edge.mjs`, `differential-run.mjs`, `combine.mjs`, `results.json`, `results-2.json`, `results-3.json`, `combined.json`, `raw/`, `shots/`, `serve/`)
- Before-arm worktree: `/tmp/opencode/chatmost-head` at `ac39dfe`
- Logs: `gates-tsc.log`, `gates-eslint.log`, `gates-vitest.log`, `full.log`, `full-2.log`, `full-3.log`
