---
name: perf-prove-it-dom
description: "Make browser UI fast with evidence from Blink and the Chrome DevTools Protocol. Use when renders are janky, interactions lag, styles or layout thrash, lists re-render, or DOM work is suspected: pipeline cost classes (DOM, style, layout, paint, composite), forced synchronous layout, CDP Performance metrics (LayoutCount, RecalcStyleCount, durations), trace events, INP and long tasks, DocumentFragment and cloneNode patterns, compositor-only properties, and CSS containment. Triggers: why is my UI slow, jank, layout thrashing, forced reflow, slow render, INP, long task, DOM performance, re-render, expensive CSS, paint cost, check the trace."
license: Apache-2.0
---

# Perf prove it: the browser DOM and Blink

The browser is a pipeline, not a function call. A UI unit costs node mutations, style invalidations, layout work, painted pixels, and composited layers. Count the work the interaction must do, then remove it from the stage that actually pays.

Never guess which stage is slow from the code alone. A trace says it. The trace is the compiler output of the browser, the same way bytecode is the compiler output of V8.

Profiles choose the unit. They are for discovery, never for the target. The floor comes from counting what the interaction requires, then you do not stop until the gap is closed or explained.

## Route

Read only the matching reference.

- Pipeline stages, what triggers each, and the Blink source map: `references/pipeline.md`.
- CDP harness, metrics, traces, long tasks and INP, allocation rate, forced-reflow detection, verification protocol: `references/measurement.md`.
- Before/after patterns with measured effects and traps: `references/patterns.md`.
- Worked cases from real studies, with counters and machine reads: `examples/`.

## Loop

1. Pick one interaction (a keypress, scroll, route render, list update) and record it with the DevTools Performance panel or CDP tracing.
2. Derive the floor in counts: nodes, geometry reads, invalidated elements, layout scope, paint area, retention, and what must keep identity.
3. Build the harness: a real browser, a deterministic page, one page per arm, a discarded warmup, and the recorded Chromium version.
4. Measure counters and traces. Pair pass counts with their scope args (`dirtyObjects`, `totalObjects`) and durations; a pass count can rise while the work per pass falls.
5. Close the gap by the stage that pays. Make one change and re-measure; containment and virtualization defer work, so also measure the first scroll that reveals it.
6. Prove behavior, metric, cycle, trace, and memory parity, then report the trade and the revert.

## Read the implementation when the pipeline surprises you

The source is public. When a cost does not match the docs, read Blink itself. These paths are inside the Chromium tree, not files in this skill.

- `source.chromium.org` and `github.com/chromium/chromium` are the same tree. Start at `third_party/blink/renderer/core/README.md`, which maps the four core stages.
- `core/dom/` is the DOM tree, `core/css/` the style engine, `core/layout/` layout, `core/paint/` paint and property trees. `cc/` is the compositor; `core/paint/README.md` describes the commit handoff to `cc::Layer`.
- Find a behavior by symbol first, then read the class and its header comments; Blink headers carry the design notes. Read the commit that changed the file for the rationale and the linked design doc.
- If a trace event name confuses you, search it in the tree. The emitter is usually one `TRACE_EVENT` macro away from the code that decides the behavior.
- Prefer reading source over memorizing flags, because flags change.

Quoting the implementation in the report is the equivalent of pasting bytecode: it turns an opinion about CSS into a fact about Blink. The full stage-and-source map lives in `references/pipeline.md`.

## Evidence provenance gate

Never call a reduced page, hand-written DOM snippet, or equivalent harness the application's render output. Label it **model probe**. For JSX/TSX or templated HTML, record the source commit, real build command and versions, emitted JS/chunk path and hash, browser version, and trace command. Inspect the emitted JavaScript before attributing work to a component. A model probe can form a hypothesis; only the shipped artifact plus a browser trace can prove render, DOM, layout, paint, or allocation claims.

## Hard gates

- No UI performance claim from wall clock alone. Counters and trace events are the verdict.
- No arm comparison from the same page. Separate pages, same state, discarded warmup.
- No parity snapshot taken without advancing two `requestAnimationFrame` ticks.
- No behavior change hidden in a render change. Same-node fixes keep the DOM shape; node-reduction fixes are parity on rendered text, ARIA semantics, scroll and event behavior, and pixels with a measured diff.
- No `innerHTML` on untrusted input.
- No promoted-layer or `will-change` advice without counting layers and memory.
- No "faster" verdict without the before and after trace pasted in.
- No readability cost hidden. Name the added JS or CSS complexity next to the counters and let the user decide.

## Report

1. The floor target line, the interaction, and the counter deltas for both arms with the Chromium version.
2. Trace evidence: event counts and durations pasted, before and after.
3. Behavior proof: the parity contract for the fix class, with a screenshot or a11y comparison, same events, same DOM shape.
4. The trade: DOM size, layer count or memory, accessibility impact, security, and the revert.
5. One machine read: paste the trace event or counter, one plain sentence for what Blink did, and what it bought this interaction.
6. Remaining spikes and what would reopen them.

## References

- `references/pipeline.md`: the stages, triggers, cost classes, and the Blink source map.
- `references/measurement.md`: CDP commands, trace workflow, metric keys, forced reflow detection, harness rules.
- `references/patterns.md`: before and after DOM patterns with measured effects and traps.
- `examples/`: three worked cases with floors, counters, machine reads, and the traps they taught.
