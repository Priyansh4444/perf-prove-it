# Outcome metrics: field data, lab traces, and the Core Web Vitals

The pipeline references prove *why* a stage costs. This one covers *whether users feel it*. Read it when a render or interaction must be prioritized or reported against user-facing targets. The thresholds and field/lab discipline follow Google/Chrome guidance and Addy Osmani's open performance skill (MIT).

## Core Web Vitals targets

Thresholds apply to field data at the 75th percentile, per form factor.

| metric | good | needs work | poor |
| --- | --- | --- | --- |
| LCP (Largest Contentful Paint) | ≤ 2.5s | ≤ 4.0s | > 4.0s |
| INP (Interaction to Next Paint) | ≤ 200ms | ≤ 500ms | > 500ms |
| CLS (Cumulative Layout Shift) | ≤ 0.1 | ≤ 0.25 | > 0.25 |

## Keep field and lab separate

| evidence | represents | use it for |
| --- | --- | --- |
| CrUX | eligible real Chrome users, rolling 28 days | deciding users have a Core Web Vitals problem |
| first-party RUM | the site's own sessions | segmenting and diagnosing production |
| DevTools/CDP trace | one session under stated conditions | finding the cause |
| Lighthouse | a controlled synthetic navigation | reproducing and guarding regressions |
| one `PerformanceObserver` result | one browser session | a lab observation, not field data |

A single trace or `PerformanceObserver` result is a lab observation. It becomes field data only when measurements from real users are reported and aggregated. Never report a lab delta as a user-facing win; the field window stays pending until enough new user data arrives. Missing CrUX data is **unavailable**, never passing.

## Reconcile lab and field

| field | lab | interpretation |
| --- | --- | --- |
| poor | poor | reproducible; trace and fix the dominant bottleneck |
| poor | good | the local run missed real conditions; segment RUM or test representative devices, routes, cache states, and interactions |
| good | poor | the synthetic case is fragile; do not claim users are currently failing |
| unavailable | any | diagnose with lab data and recommend RUM if production impact matters |

Record the conditions behind every lab number: URL and page state, browser/tool version, viewport, CPU and network throttling, cold or warm cache, auth and experiment state. For a headline lab metric, run at least three equivalent navigations and report the median and range, never a single run.

## INP: the main-thread levers

INP is the worst interaction's latency (input delay + processing + presentation). The lever is keeping the main thread available.

- Break long tasks (> 50ms) so input can run between chunks: `scheduler.yield()` (preferred), `scheduler.postTask()` with priorities, `isInputPending()` to yield only when input waits.
- Move non-essential work out of event handlers (analytics, logging) so the response to the interaction is not delayed.
- `requestIdleCallback` for deferrable, non-urgent work.
- Offload heavy computation to a Worker. Audit third-party scripts; front heavy embeds with a facade.
- The trace shows whether the cost is script or Blink. If it is script, take the unit to the V8 skill.

## CLS

Layout shift comes from media without dimensions, late-loading content, and font swaps.

- Set `width`/`height` (or `aspect-ratio`) on images, video, and iframes.
- Reserve space for content that arrives late.
- Fonts: `font-display: swap` plus `size-adjust` / `ascent-override` to match the fallback metrics, or preload the LCP font.
- View Transitions snapshot the old and new states without a layout shift, so they do not count toward CLS.

Aggregate CLS hides jank: many small shifts, each around 0.008, can still score "good" while the page visibly moves after it is usable. Instrument the Layout Instability API per region and phase and alert on any shift, not on the score (`references/measurement.md`).

## LCP loading levers (adjacent to this skill)

LCP is a loading-path metric. When the trace shows the LCP element discovered late or the document blocked, hand off to the loading checklist rather than the pipeline:

- `fetchpriority="high"` on the LCP image, and no lazy loading on it.
- Preconnect known origins; preload only resources the trace shows discovered late.
- Defer non-critical JS and CSS; ship less JavaScript.
- Avoid `unload` handlers and `Cache-Control: no-store` on HTML, so the page stays bfcache-eligible.

Budgets are guardrails, not proof. Keep a project budget when one exists; starting points are JavaScript < 300 KB compressed, CSS < 100 KB, fonts < 100 KB, total page weight < 1.5 MB.

## Compact report

Start with an evidence table, then separate measured failures, trace-backed causes, source hypotheses, and verification status.

| signal | scope and conditions | baseline | after | source |
| --- | --- | --- | --- | --- |
| LCP | URL, phone, p75/28 days | 3.1s | pending field window | CrUX |
| LCP | URL, mobile lab, cold cache, median of 3 | 3.8s | 2.6s | DevTools trace |
