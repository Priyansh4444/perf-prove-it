# DOM primitives: verified 2026-09-10

Reproduce with `node study/dom-primitives/verify.mjs`. Writes `results.json`. Three rounds per scenario, fresh context each run.

Environment: Chromium 152.0.7977.82 (system `/usr/bin/chromium`), Playwright 1.63 `playwright-core`, Node v26.8.2, Linux x64, headless, viewport 1280x800.

## Scenario results (median of 3)

| Scenario | LayoutCount | RecalcStyleCount | LayoutDuration | RecalcStyleDuration | Nodes |
| --- | --- | --- | --- | --- | --- |
| 500x (append + `offsetWidth` read) | 500 | 500 | 68.4 ms | 5.6 ms | 1000 |
| 500-node fragment insert, no frame advance | 0 | 0 | 0 | 0 | 1001 |
| 500-node fragment insert + two rAF ticks | 1 | 1 | 10.6 ms | 1.6 ms | 1001 |

Every round within a scenario matched exactly on counters. Rounds only varied in duration.

What this proves:

- A geometry read after a write forces one synchronous layout pass. 500 iterations, 500 layouts, 500 style recalcs. This is the thrash signature to detect, and it needs a completed interaction to prove, not a code read.
- A structure change alone schedules work; whether it runs before your next `getMetrics` is a race with the frame loop. The no-frame-advance scenario read 0 layouts in the 3 recorded rounds, then 0 in 10 of 10 quiet rounds, 2 in 10 in a loaded session, and 4 of 5 after a 300 ms wait. Only the two-rAF protocol is deterministic. Treat a no-advance zero as "scheduled, likely not yet run", never as "zero layouts".
- Two `requestAnimationFrame` ticks drive exactly one lifecycle pass in headless Chromium. One snapshot before and after that pair isolates one pass.
- `Nodes` counts text nodes too: 500 divs plus 500 text nodes. The delta wobbles by one across runs; do not build a claim on a single-node difference.

## page.evaluate traps (verified)

| Call | Result |
| --- | --- |
| `page.evaluate("() => { globalThis.__ran = true; return 42; }")` | returns `undefined`, `__ran` stays unset |
| `page.evaluate(() => { ... })` | runs, returns normally |
| `page.evaluate(() => ... NODES ..., NODES)` | `ReferenceError: NODES is not defined` |

- A string argument is evaluated as an expression. An arrow function string is never invoked. Wrap it if a string is unavoidable: `"(() => { ... })()"`. (Playwright 1.63; matches playwright issue 26851.)
- A passed function is serialized and runs in the page, so it cannot close over script variables. Pass arguments: `page.evaluate(fn, arg)`.

## Invalidates on

- Any Chromium version change. The counters and frame timing move with the rendering pipeline.
- Viewport, zoom, font state. Lock all three between arms.

These results back the protocol in `skills/perf-prove-it-dom/references/measurement.md`.
