# Measurement: CDP, traces, and the harness rules

Verified on Chromium 152.0.7977.82, Playwright 1.63, Linux x64. Timings and counters are from that build; re-verify after a browser upgrade.

## Harness

Use Playwright with system Chromium, or raw CDP over a WebSocket.

```js
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();
const client = await context.newCDPSession(page);
await client.send("Performance.enable");
const metrics = async () => Object.fromEntries(
  (await client.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value])
);
const before = await metrics();
await page.evaluate(() => {
  // the interaction, as a real function
});
await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const after = await metrics();
```

Rules:

- Pass a function to `page.evaluate`, never a string. A string is evaluated as an expression, so an arrow function passed as a string is never invoked. Verified on Playwright 1.63 and documented in playwright issue 26851. If a string is unavoidable, wrap it: `"(() => { ... })()"`. A passed function is serialized and runs in the page, so it cannot close over script variables; pass data as arguments: `page.evaluate(fn, arg)`.
- Advance two `requestAnimationFrame` ticks after the interaction and before the `after` snapshot. An idle headless page does not necessarily run the rendering lifecycle, so a structure change alone may not be counted. Two ticks produce exactly one lifecycle pass. Verified: fragment insert then two rAFs showed `LayoutCount: 1` in every round.
- Do not claim "zero layouts" from a snapshot taken without advancing frames. A frame can run during the `getMetrics` round trip: the same no-frame-advance scenario read `LayoutCount: 0` in 8 of 10 rounds and `1` in 2 in one session, 0 of 10 in a quiet session, and 4 of 5 after a 300 ms wait. Frame timing is not under the harness's control. Use the snapshot only to show the tree is dirty, and use the two-rAF protocol for a deterministic count.
- Blink excludes work that runs inside a CDP `Runtime.evaluate` call from `ScriptDuration`: a 500 ms busy loop driven through `page.evaluate` showed `ScriptDuration +0 ms` and `TaskDuration +501 ms`, while the same loop as an in-page `setTimeout` task showed `ScriptDuration +120 ms`. Counters like `LayoutCount` still register from an evaluate; drive the interaction as a page task for script-time claims.
- `Performance.enable` accepts an optional `timeDomain` (`timeTicks` or `threadTicks`). `Performance.setTimeDomain` is deprecated, and the domain must be set before enabling.
- Same Chromium build, viewport, page state, and warmup for both arms. Record `browser.version()`. Discard one warmup round per arm: a fresh browser process pays font shaping and first-layout costs, measured at 2.8x the steady-state layout time.
- One page per arm. Two versions of the code in one page share style caches, layers, and DOM state.
- Disable extensions and background tabs. Fresh context per arm.
- Headless is reliable for `Nodes`, `JSEventListeners`, `LayoutCount`, `RecalcStyleCount`, and heap size, once frames are driven with rAF. Stage durations repeat well enough to compare medians but vary run to run; never compare a single duration. Compositor and raster claims need headed Chromium or explicit flags; say which you used.
- Serve the production bundle, or state that numbers come from a dev build. Dev bundles (React StrictMode, Solid dev `flush`, HMR wrappers) can dominate script numbers even when the claim is about Blink.
- Derive corpus size and caps from the call site, not from the task description. A feed that caps at 80 live messages must be measured at 80, not at a round number.
- For an async interaction (click, fetch, render), wait for a rendered condition first, then advance the two rAF ticks. The two-tick rule alone only fits synchronous interactions.
- Metrics and screenshots are different windows. Take metric deltas at exactly two rAFs; take screenshots after the page has fully settled (fonts, smooth scrolling, animations). With `scroll-behavior: smooth`, settle the scroll explicitly before capturing.
- Screenshots need `animations: "disabled"` and a settled page.
- Stub the data layer, never the render layer. The faithful extraction for a framework component keeps the real components and render functions and replaces only data hooks and backend clients with fixtures; the measured DOM work must be the real code path.
- Playwright 1.63 `page.accessibility.snapshot()` can return nothing on some setups. Fall back to a DOM dump of roles, accessible names, `alt` and `title` attributes.

## Runtime metrics

`Performance.getMetrics` returns `Metric` objects with `name` and `value`. The protocol does not document units or the full key list. Durations are seconds. Read the Chromium performance monitor source when a key's meaning matters, and treat the key set as version-dependent.

Keys observed on Chromium 152 (not exhaustive):

| Key | Meaning |
| --- | --- |
| `Nodes` | live DOM nodes in the renderer |
| `JSEventListeners` | registered event listeners |
| `LayoutObjects` | layout tree objects |
| `LayoutCount` | layouts run, full or partial, including forced ones |
| `RecalcStyleCount` | style recalculation passes |
| `LayoutDuration` | seconds in layout |
| `RecalcStyleDuration` | seconds in style recalculation |
| `ScriptDuration` | seconds in JavaScript |
| `TaskDuration` | seconds in main-thread tasks |
| `JSHeapUsedSize`, `JSHeapTotalSize` | V8 heap bytes |
| `Documents`, `Frames` | document and frame counts |

Delta two snapshots around one interaction plus two rAF ticks. Verified on Chromium 152, medians of three rounds, fresh context each round:

- Read-after-write loop, 500 iterations: `LayoutCount` +500, `RecalcStyleCount` +500, `LayoutDuration` +68.4 ms. Every iteration is a forced synchronous layout; all three rounds matched exactly on counters.
- Fragment insert of 500 nodes, then two rAFs: `LayoutCount` +1, `RecalcStyleCount` +1, `LayoutDuration` +10.6 ms. One lifecycle pass.
- Fragment insert with no frame advance: unreliable to sample, see the harness rules above.

`Nodes` counts text nodes too: 500 divs plus 500 text nodes read as +1000, and the delta wobbles by one across runs. Do not build a claim on a single-node difference.

A `LayoutCount` delta near the loop iteration count is thrashing. A `RecalcStyleCount` delta above one for a single class toggle is a widened invalidation.

## Traces

```js
const events = [];
client.on("Tracing.dataCollected", (e) => events.push(...(e.value ?? [])));
const complete = new Promise((resolve) => client.once("Tracing.tracingComplete", resolve));
await client.send("Tracing.start", {
  categories: "devtools.timeline,v8,blink.user_timing",
  transferMode: "ReportEvents",
});
// run exactly one interaction, then two rAF ticks
await client.send("Tracing.end");
await complete;
```

The stream form (`transferMode: "ReturnAsStream"` plus `IO.read`) is the alternative for large traces. Both are in the CDP Tracing domain.

Count events by `name` and sum `dur` (microseconds). Names are emitted with `TRACE_EVENT` macros and change across Chromium versions, so read them from the trace. On Chromium 152 the DevTools timeline is built from events including `ThreadControllerImpl::RunTask`, `FunctionCall`, `EventDispatch`, `ParseHTML`, `UpdateLayoutTree`, `Layout`, `Paint`, `Layerize`, and `HitTest`. `RunTask`, `UpdateLayerTree`, and `CompositeLayers` from older versions did not appear in headless Chromium 152 traces with the recommended categories. Map whatever you find to a stage with `references/pipeline.md`.

What to read:

- `Layout` events and their durations. One per frame is the budget. Many inside one task is forced reflow. Read the event args: `dirtyObjects` and `totalObjects` quantify the scope of the pass. For containment and invalidation changes, `dirtyObjects` and stage durations are better headlines than the raw pass count; a pass count can rise while the work per pass falls.
- `UpdateLayoutTree` events, with their `elementCount` args where present. Many for one class change means the invalidation spread.
- `Paint` and layer-stage events. If `Paint` dominates, the change is not compositor-only, no matter which property you animated.
- A long task event with no layout or paint inside means the cost is script, not Blink. Take the unit to the V8 skill.
- `content-visibility` emits one `contentvisibilityautostatechange` event per section transition. It is a measurable, expected cost of the pattern.
- Do not use `EventDispatch` or `FunctionCall` counts as parity metrics unless you have identified what dispatched. Lazy-image loads and framework wrappers inflate them independently of the interaction.

## Long tasks, event timing, and INP

Long tasks are main-thread tasks of 50 ms or more. Observe them with `PerformanceObserver`:

```js
new PerformanceObserver((list) => {
  for (const entry of list.getEntries()) console.log("longtask", entry.duration, entry.startTime, entry.attribution);
}).observe({ type: "longtask", buffered: true });
```

`buffered: true` is needed to receive entries recorded before observation. The culprit direction is `entry.name` (`self`, `same-origin-descendant`, and similar); each entry's `attribution` array carries `containerType` (`window`, `iframe`, and so on) and the container's name and id.

Interaction latency uses the Event Timing API. Observe `event` entries, set a `durationThreshold` to control volume (default 104 ms, minimum 16 ms), and read `processingStart`, `processingEnd`, `startTime`. `durationThreshold` is silently ignored unless `type: "event"` is used; with `entryTypes` it does not throw, it just has no effect. INP is a high percentile of interaction latency, usually computed by a library such as web-vitals. Attribute a slow interaction to input delay, processing time, or presentation delay before fixing anything.

Other useful entry types: `paint` (FP and FCP), `largest-contentful-paint`, `layout-shift`, `element`, `navigation`, `resource`, `mark`, `measure`. `PerformanceObserver.supportedEntryTypes` lists what the current engine supports.

## Forced reflow detection

Three ways, strongest first:

1. DevTools Performance panel. Select a `Layout` event and read the forced reflow warning with the stack. The Performance insights panel reports forced reflows directly.
2. Trace. A `Layout` event nested inside a `FunctionCall` or `EventDispatch` before the next frame boundary is a synchronous layout. Count them.
3. Code audit. List geometry reads and check whether any can follow a write in the same task. This finds the risk; the trace proves the cost.

Geometry reads include `offsetWidth/Height/Top/Left`, `clientWidth/Height/Top/Left`, `scrollWidth/Height/Top/Left`, `getBoundingClientRect`, `getClientRects`, and `focus()`. `getComputedStyle` always updates style if needed, but forces layout only when the requested property is layout-dependent (`width`, `height`, `top`, and similar); reading `color` from it forced zero layouts in a measured 200-iteration loop while reading `width` forced 180.

## Verification protocol

1. Lock behavior: capture the rendered DOM shape, text, ARIA attributes, and a screenshot for the interaction.
2. Run three rounds per arm, alternating fresh pages. Report every round and the medians for counters and trace durations.
3. Compare counters (`Nodes`, `JSEventListeners`, heap), stage counts (`LayoutCount`, `RecalcStyleCount`), and trace event counts and durations for the stages that ran (`Layout`, `UpdateLayoutTree`, `Paint`, layer-stage events). Use medians; durations vary run to run while counters usually repeat exactly.
4. Compare the screenshot and a11y tree for parity. Raw PNG hashes differ between identical runs (volatile text, capture timing), so run a real pixel diff against a fixed clip, mask known-volatile regions, and report the bounding box and maximum delta, not just equality. To compare content skipped by containment, force-render the skipped subtree before the diff. Antialias-only differences from text-run merges are expected when a fix changes text node structure; zero geometry change plus a small max delta is parity, a hash mismatch is not automatically a failure.
5. Report the Chromium version, viewport, and page state. Counters move with viewport size, fonts, and zoom, so a viewport change invalidates a comparison.

Wall clock is context, not a verdict. A dropped layout pass and a dropped style pass are the evidence.
