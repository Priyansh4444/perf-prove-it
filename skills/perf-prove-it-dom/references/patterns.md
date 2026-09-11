# DOM patterns with their costs and traps

Effects are workload-specific. The harness decides. Each entry names what the change removes from the pipeline and the trap that makes the naive version wrong.

## 1. Batch inserts

Before: `container.appendChild(node)` inside a loop over 500 items. Each append invalidates style, and any geometry read between iterations forces layout.

After: build into a `DocumentFragment`, or use a `template` plus `cloneNode(true)`, then append once.

Buys: fewer live-tree mutations and one insertion notification, instead of one per item. Measured on Chromium 152: 500 plain `appendChild` calls with no interleaved reads already coalesce into `LayoutCount 1` and `RecalcStyleCount 1`, the same as the fragment arm; only the read-interleaved loop hit 500. Scope the buy to the script and invalidation side, and to loops that read, rather than to the layout pass. Traps: `DocumentFragment` children move on insert, so keep a reference to the fragment only if you still need it. `cloneNode(true)` copies listeners only when they were registered via attributes, not via `addEventListener`.

## 2. `innerHTML` once, never in a loop

Before: `container.innerHTML += html` per item. Every write reparses the accumulated string, destroys the existing nodes, and drops their references and listeners.

After: build the full string once and set `innerHTML` once, or build nodes with `createElement`/`cloneNode`.

Buys: one parse and one tree replacement instead of N. Traps: `innerHTML` never preserves JS references, listener registrations, or interaction state inside the replaced subtree. `innerHTML` on untrusted input is an injection. If references must survive, use nodes, not HTML.

## 3. `textContent` over `innerText`

Before: `el.innerText = value` in a hot path.

After: `el.textContent = value`.

Buys: little on the setter side; measured 300-element writes cost 1.6 to 3.3 ms with `innerText` and 1.6 to 2.5 ms with `textContent`, zero forced layouts either way. The real cost is the `innerText` getter: after a style write it forced 200 layouts in 200 iterations, while the `textContent` getter forced zero. Reach for `textContent` when reading, and avoid reading `innerText` in a hot path. Traps: `innerText` also rewrites newlines as `<br>` (`a\nb` renders as `a<br>b`), so switching can change rendered output. Check the rendered result, not just the property.

## 4. Read before write, or cache

Before:

```js
for (const box of boxes) {
  const width = box.offsetWidth;
  box.style.width = width + 10 + "px";
}
```

Every read follows the previous write, so every iteration forces synchronous layout.

After: collect the widths first, then write. Or compute from data already in hand and never read geometry.

Buys: one layout pass instead of one per item. Traps: layout reads are not always obvious. `getBoundingClientRect`, `scrollTop`, `clientHeight`, `focus()`, and `getClientRects` count. Measured on Chromium 152: in a 200-iteration read-after-write loop, `offsetWidth`, `getClientRects`, and `focus()` each forced about 180 to 200 layouts, `getComputedStyle().width` forced 180, but `getComputedStyle().color` forced zero while still recalculating style every time; `getComputedStyle` forces layout only for layout-dependent properties. Adjacent writes can be batched by the browser until a read or a frame boundary.

## 5. Classes over inline styles

Before: setting several inline style properties per element per state.

After: one class toggle.

Buys: fewer mutation calls and one invalidation entry point per element. Measured on Chromium 152: 5 inline property writes per element over 500 elements coalesced into `RecalcStyleCount 1`, the same as the class-toggle arm; the measurable difference was script time (19 ms versus 6 ms), not the number of style passes. Traps: a class toggle can invalidate the entire dependent subtree (one ancestor class change invalidated 500 descendants in the same experiment), so prefer narrow selectors and derive the class set from state instead of hand-setting it from many call sites.

## 6. Compositor-only animation

Before: animating `left`, `top`, `width`, `height`, `margin`, or `background-position`.

After: animate `transform` and `opacity`. If layout position matters, set the final geometry with layout properties once and animate `translate` from there.

Buys: for CSS transitions and keyframe animations of these properties, style, layout, and paint stop running after promotion. Measured on Chromium 152: a CSS keyframe transform animation ran with `LayoutCount 0` and only 3 `UpdateLayoutTree` events, while a JavaScript rAF loop writing `transform` 30 times still paid 30 style recalculations and 30 `UpdateLayoutTree` events per 30 frames (Paint 2 to 3 events, zero with `will-change`), and the same loop writing `left` paid 30 layouts and about 610 Paint events. JavaScript per-frame writes still pay style and commit; only the paint and layout stages are avoided. Traps: `filter`, `backdrop-filter`, and huge layers still cost raster. `will-change: transform` forces a layer; add it only for the animated element and remove it when the animation ends. Text inside a transformed layer can rasterize once and look blurry when scaled.

## 7. Contain work

Before: a change inside a component reflows or repaints the whole page.

After: `contain: layout paint style` on the component root, `content-visibility: auto` for offscreen sections, fixed sizes where the layout allows.

Buys: a bounded layout or paint scope. Measured on Chromium 152 with 60 sections of 200 nodes, `content-visibility: auto` cut initial layout from 161 ms to 15 ms. Deferred cost: containment moves work from mount to the first scroll that reveals the skipped content, and the moved work does not disappear. Measured in the ytsearch and postwork cases, the first scroll into contained content re-paid 18 layouts or 73 ms of layout in one interaction, enough that the mount-plus-scroll total was worse than before in both cases. Always measure mount plus the first revealing scroll and report both; a containment win that has not been scrolled through is not proved. Traps: `contain` changes layout and paint semantics. It can break overflow, sticky, or percentage sizing if the boundary is wrong. `contain: paint` also changes text rasterization with zero geometry change, and contained rows can snap inner 1px borders on fractional offsets; isolate each property variant and diff pixels before shipping. `content-visibility: auto` also removes offscreen content from the accessibility tree and find-in-page until it scrolls near the viewport: the same experiment dropped the a11y tree from 36,241 to 4,282 nodes and made section 50 unfindable. Expect one `contentvisibilityautostatechange` event per section transition. Verify screenshots (with the skipped subtrees force-rendered), a11y output, and scroll behavior, not just counters.

## 8. Event delegation

Before: `addEventListener` on hundreds of rows, re-registered on every render.

After: one listener on the container, dispatching by target.

Buys: fewer listeners, less memory, survives row recycling without re-registration. Traps: reimplementing `stopPropagation`, focus behavior, and event ordering is easy to get wrong. Keep the delegated handler's behavior identical to the per-node handlers, and check keyboard and touch as well as mouse.

## 9. Recycle rows in lists

Before: destroy and rebuild every row on update.

After: keep a fixed pool of rows and update text and classes in place.

Buys: no DOM churn, no listener churn, stable layout. Traps: recycled rows need their state reset explicitly, including attributes and any transient classes. Check the rendered result after sorting and filtering, not just on append.

## 10. Layers are a budget

Before: `will-change` or a 3D transform on every list item.

After: promote only what animates, and remove the hint when idle.

Buys: fewer layers, less GPU memory, less compositing work. Traps: layer promotion can make a page slower when everything is promoted because compositing cost grows with overlap and memory. Count layers and memory after the change. The "Layers" panel and CDP trace both expose them.
