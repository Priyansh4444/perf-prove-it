---
name: perf-prove-it-dom
description: "Make browser UI fast with evidence from Blink and the Chrome DevTools Protocol. Use when renders are janky, interactions lag, styles or layout thrash, lists re-render, or DOM work is suspected: pipeline cost classes (DOM, style, layout, paint, composite), forced synchronous layout, CDP Performance metrics (LayoutCount, RecalcStyleCount, durations), trace events, INP and long tasks, DocumentFragment and cloneNode patterns, compositor-only properties, and CSS containment. Triggers: why is my UI slow, jank, layout thrashing, forced reflow, slow render, INP, long task, DOM performance, re-render, expensive CSS, paint cost, check the trace."
license: Apache-2.0
---

# Perf prove it: the browser DOM and Blink

The browser is a pipeline, not a function call. A UI unit costs node mutations, style invalidations, layout work, painted pixels, and composited layers. Count those, understand which stage pays, then remove work from the stage that actually costs.

Never guess which stage is slow from the code alone. A trace says it. The trace is the compiler output of the browser, the same way bytecode is the compiler output of V8.

## The pipeline

Every frame and every DOM mutation moves through stages:

1. DOM. Parse, create, insert, remove, attribute and class changes, event dispatch.
2. Style. Invalidation, selector matching, computed style values.
3. Layout. Box tree construction, sizing, positioning, overflow, fragmentation.
4. PrePaint and Paint. Paint invalidation, property trees, display list, paint chunks.
5. Commit and compositing. Layer list to the compositor, raster, draw. Main-thread work ends at commit. Transform and opacity animations can skip stages 2 to 4 entirely.
6. Presentation. Vsync-aligned draw. Anything after commit is off the main thread.

Read `references/pipeline.md` for what triggers each stage and where it lives in the Blink source.

## Step 0: pick the interaction, then trace it

One interaction at a time: a keypress, a scroll, a route render, a list update. Record it with the DevTools Performance panel or CDP tracing while it runs. Profiles choose the unit. The floor sets the target.

## Step 1: derive the floor

State the minimum the pipeline must do for this interaction, in counts, not vibes:

- Nodes: how many created, inserted, removed, or rebuilt? Can the same result be one mutation batch?
- Reads: how many geometry reads (`offsetWidth`, `getBoundingClientRect`, `getComputedStyle`, `scrollTop`, `clientHeight`)? Each read after a write that invalidated layout forces synchronous layout. Reads before writes are free.
- Style: how many elements get invalidated per change? Does the change touch a class, a layout-triggering property, or a compositor-only property?
- Layout: what is the layout scope of the smallest change? One subtree, one formatting context, or the whole document? Can containment, fixed sizes, or absolute positioning bound it?
- Paint: what area must repaint? Is the change on the compositor (`transform`, `opacity`, `filter`) or does it repaint pixels?
- Retention: does the operation create listeners, timers, observers, or detached nodes that must later be released?
- Identity: what must keep identity across the interaction (DOM nodes, keyed component instances, listeners, focus), and what may be replaced? State it before choosing a fix; a node-reduction fix changes node identity by design, and the parity contract follows from this line.

Write the floor as one target line. Example: "typeahead keystroke over 500 suggestions: one array scan, zero layout reads, one class toggle on a fixed-size list, zero new nodes; identical options, order, and ARIA state."

## Step 2: build the browser harness

Use a real browser and a deterministic page. CDP is the measurement surface.

```js
// playwright-core, system Chromium
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const client = await page.context().newCDPSession(page);
await client.send("Performance.enable");
const before = Object.fromEntries((await client.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]));
// run the interaction
const after = Object.fromEntries((await client.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]));
```

Rules:

- Same browser build, same viewport, same page state, same warmup for both arms. Record the Chromium version.
- Headless is fine for deterministic counters (`Nodes`, `JSEventListeners`, `LayoutCount`, `RecalcStyleCount`). Counters repeat exactly; durations vary up to a factor of two run to run, so compare medians of several rounds, never a single duration. Headed or `--use-angle` may be needed for compositor and raster claims. Say which you used.
- Never compare arms by wall clock alone. Compare counters and trace event counts and durations.
- One page per arm. Two bundles in one page share caches, layers, and style state.

## Step 3: measure with counters and traces

Runtime counters tell you how many times a stage ran. Traces tell you why.

```js
const complete = new Promise((resolve) => client.once("Tracing.tracingComplete", resolve));
await client.send("Tracing.start", { categories: "devtools.timeline,v8,blink.user_timing", transferMode: "ReturnAsStream" });
// run the interaction
await client.send("Tracing.end"); // the response carries no data
const { stream } = await complete; // the stream arrives on the tracingComplete event
// IO.read the stream, then count events by name and sum durations
```

Read:

- `LayoutCount`, `RecalcStyleCount` deltas: how many layout and style passes the interaction caused. One is healthy. A count near the number of loop iterations is thrashing. For containment and invalidation changes, pair the count with the trace's `dirtyObjects` and `totalObjects` args and the stage durations: a pass count can rise while the work per pass falls, and the scope measures are the better headline.
- `LayoutDuration`, `RecalcStyleDuration` deltas: the time inside those passes.
- `ScriptDuration`, `TaskDuration`: how much of the work is script versus browser stages. Blink excludes work that runs inside a CDP `Runtime.evaluate` call from `ScriptDuration`, so drive the interaction as a page task (a dispatched event, an in-page `setTimeout`, or real input) before trusting `ScriptDuration`.
- `Nodes` and `JSEventListeners` before and after: growth the interaction leaves behind. For churn, count `MinorGC` and `MajorGC` events in a trace over one interaction; that is the allocation rate. A `JSHeapUsedSize` delta at one moment depends on when GC ran, so it is context, not a result.
- Trace events: count `Layout`, `UpdateLayoutTree`, `Paint`, `ParseHTML`, `EventDispatch`, `FunctionCall`. Event names move between versions: on Chromium 152 headless the task event reads `ThreadControllerImpl::RunTask`, the layer-tree stage emits `Layerize`, and `CompositeLayers` does not appear. Read them from the trace, do not assume.
- Long tasks and INP from `PerformanceObserver` where the interaction is user-facing.

Full commands and the metric key list: `references/measurement.md`.

Forced synchronous layout is the most common DOM cost. It happens when a geometry read follows a DOM or style write. Find it with the DevTools forced reflow insight, or by counting `Layout` trace events that fall inside a script task while `LayoutCount` grows faster than frames.

## Step 4: close the gap by stage

Order by the stage that pays, not by habit.

DOM:

- Build detached: `DocumentFragment` or `template` plus `cloneNode`, then one insertion. Blink already coalesces the style and layout pass for a loop with no interleaved reads, so the measured buy is fewer live-tree mutations and less script and invalidation bookkeeping; measure the script side too.
- Prefer `textContent` for text. The `innerText` getter reads style and layout, and its setter rewrites newlines as `<br>`, so switching can change rendered output. `innerHTML` reparses and replaces existing nodes, which drops references and listeners, so use it once to set a whole subtree, never in a loop.
- Batch writes, then batch reads. Never read geometry inside the write loop. If reads must interleave, cache the values before the writes.
- Replace manual listeners with event delegation where many similar nodes attach handlers.

Style:

- Toggle classes, not per-property inline styles. Inline style writes also coalesce into one recalculation, so the measured buy is fewer mutation calls and one invalidation entry point; a class change can invalidate the whole dependent subtree, so keep the class set small and derived from state.
- Animate `transform` and `opacity` only. CSS transitions and keyframe animations of these properties skip style, layout, and paint after promotion. JavaScript that writes a transform every frame still pays style recalculation and commit each frame; only the paint and layout stages are avoided.
- Keep selectors shallow and bounded. `:has`, deep descendant, and attribute selectors raise match cost across invalidated subtrees.
- `contain: layout paint style`, `content-visibility: auto`, and `will-change` where they bound work. `content-visibility: auto` removes offscreen content from the accessibility tree and find-in-page until it scrolls near the viewport; use it where that trade is acceptable. `will-change` costs a layer and memory, so use it per animated element and remove it when idle.

Layout:

- Bound the scope. Fixed sizes, `contain`, and isolated subtrees keep one change from reflowing the document. Containment and virtualization defer work to the first scroll that reveals the skipped content: measure that scroll too, because the deferred layout is paid there and the mount-plus-scroll total can be worse.
- Avoid tables for large dynamic data. Table layout has global dependencies.
- Keep the DOM order stable in virtual lists. Reordering nodes forces layout; recycling a fixed pool does not.

Paint and composite:

- Small paint area: animate a compositor-only property, or repaint a small layer, not a full-screen subtree.
- Avoid stacking many overlapping promoted layers. Each layer costs memory and compositing work.
- `backface-visibility: hidden` and 3D transforms promote, but only promote what animates.

Take every win you can prove and disclose its cost. There is no readability exemption here; the user decides.

## Step 5: prove it again

- Behavior parity, by fix class. For a same-node fix (class toggle, containment, style change), the DOM shape is identical. For a node-reduction fix (fragment, recycling, node reuse), node identity changes by design: parity is rendered text, ARIA semantics, scroll behavior, event behavior, and pixels with a measured pixel diff, not an identical node tree. State which contract applies before measuring.
- Metric parity: paste the counter deltas for both arms from separate pages. Report the Chromium version.
- Cycle parity: measure the whole interaction cycle, not only initial render. If the fix defers work (containment, virtualization, lazy construction), find where the deferred work is paid: scroll into it, trigger it, and report both halves. A fix that is cheaper at mount and more expensive on first scroll has moved the cost, not removed it.
- Trace parity: paste the event counts and durations. A layout count that drops from 500 to 2 is a real win regardless of wall clock.
- Memory parity: `Nodes` and `JSEventListeners` must not grow per interaction. For churn, compare `MinorGC` and `MajorGC` counts per interaction; for retained growth, call `HeapProfiler.collectGarbage` before comparing heap size.
- Security: `innerHTML` with untrusted data is not an optimization. If the change uses it, prove the input is trusted or sanitized.
- Report the trade: layer memory, DOM size, framework coupling, accessibility, and the revert.

## Step 6: read the implementation when the pipeline surprises you

The source is public. Read it when a cost does not match the docs.

- `source.chromium.org` and `github.com/chromium/chromium` are the same tree. Search a symbol, read the class, read the commit message that changed it.
- `third_party/blink/renderer/core/README.md` maps the four core stages.
- `third_party/blink/renderer/core/dom/` is the DOM tree, `core/css/` the style engine, `core/layout/` layout, `core/paint/` paint and property trees.
- `cc/` is the compositor. `third_party/blink/renderer/core/paint/README.md` describes the commit handoff to `cc::Layer`.
- If a trace event name confuses you, search it in the Chromium tree. The event name and the code that emits it often sit in the same file.

Quoting the implementation in the report is the equivalent of pasting bytecode. It turns an opinion about CSS into a fact about Blink.

## Teach while you prove

Every report ends with one machine read, the same way the V8 skill does:

```text
<trace event or counter pasted>
-> <one plain sentence for what Blink did>
-> <what it bought in this interaction>
```

Examples: one `UpdateLayoutTree` instead of 500 after switching to a class toggle. `CompositeLayers` only, no `Paint`, after moving an animation to `transform`. The user should finish each unit knowing one more thing about the browser.

## The report

1. The floor target line, the interaction, and the counter deltas for both arms with the Chromium version.
2. Trace evidence: event counts and durations pasted, before and after.
3. Behavior proof: screenshots or a11y tree comparison, same events, same DOM shape.
4. The trade: DOM size, layer count or memory, accessibility impact, security, and the revert.
5. One machine read.
6. Remaining spikes and what would reopen them.

## Non-negotiables

- No UI performance claim from wall clock alone. Counters and trace events are the verdict.
- No arm comparison from the same page. Separate pages, same state.
- No behavior change hidden in a render change. Apply the parity contract for the fix class: identical DOM for same-node fixes; rendered text, semantics, and measured pixels for node-reduction fixes.
- No `innerHTML` on untrusted input.
- No promoted-layer or `will-change` advice without counting layers and memory.
- No "faster" verdict without the before and after trace pasted in.

## References

- `references/pipeline.md`: the stages, triggers, cost classes, and the Blink source map.
- `references/measurement.md`: CDP commands, trace workflow, metric keys, forced reflow detection, harness rules.
- `references/patterns.md`: before and after DOM patterns with measured effects and traps.
