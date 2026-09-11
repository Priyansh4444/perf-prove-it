# The Blink pipeline: triggers, costs, and where it lives

The pipeline stages and what wakes each one.

## DOM

Triggers: parsing, `createElement`, `cloneNode`, `appendChild`, `insertBefore`, `remove`, attribute and class writes, `textContent`, `innerHTML`, event dispatch.

Cost class: allocation and tree bookkeeping on the main thread. A single insertion is cheap. A thousand insertions into a live tree is a thousand style invalidations plus, if anything reads geometry in between, a thousand layouts.

Source: `third_party/blink/renderer/core/dom/` (`Node`, `Element`, `ContainerNode`, `Document`), parser in `core/html/parser/`, events in `core/events/`.

## Style

Triggers: any invalidation from the DOM stage. Selector matching happens for invalidated elements, then computed style values are produced.

Cost class: invalidation set size times selector complexity. A class toggle invalidates the element and its descendants whose styles depend on it. `:has`, deep descendant selectors, and attribute selectors widen the match. `ComputedStyle` is copy-on-write: unchanged substructures are shared.

Source: `third_party/blink/renderer/core/css/` (`StyleResolver`, `SelectorChecker`, `ElementRuleCollector`, invalidation sets), `core/dom/` for the style invalidation entry points.

## Layout

Triggers: geometry-affecting property changes, DOM insertions or removals, font and image loads, viewport changes.

Cost class: the layout scope of the change. Layout is incremental. A change bounded by fixed sizes or containment reflows a subtree. A change to a table, or a read that forces a full pass, can walk the document.

LayoutNG implements the current system. Lifecycle states live in `core/layout/README.md`: PreLayout, PerformLayout, AfterPerformLayout.

Source: `third_party/blink/renderer/core/layout/` (`LayoutObject`, `LayoutBox`, `LayoutNG`), lifecycle driven by `core/frame/FrameView`.

## PrePaint and Paint

Triggers: paint invalidation from style or layout changes, compositing changes.

Flow: `PrePaintTreeWalk` walks the layout tree, `PaintInvalidator` invalidates the display item clients (layout objects) that will generate different display items, `PaintPropertyTreeBuilder` builds property trees, then paint walks the tree into a display item list, groups it into paint chunks, and commits. The display items themselves are regenerated later, during Paint.

Cost class: the painted area times paint complexity, not the number of elements. A full-screen repaint of simple rectangles can be cheaper than a small repaint of a blur or shadow. Composite-only properties avoid this stage entirely.

Source: `core/paint/` (`PrePaintTreeWalk`, `PaintInvalidator`, `PaintPropertyTreeBuilder`, `PaintLayer`), display lists and property trees in `platform/graphics/paint/`.

## Commit and compositing

Triggers: every main-thread frame that produced changes.

Flow: Blink hands the compositor a `cc::Layer` list plus property trees. `cc` rasterizes, activates the tree, and draws. Animations of `transform` and `opacity` can run entirely on the compositor thread after the first commit.

Cost class: layer count and memory, raster work, and layer overlap. Promoting everything to its own layer costs memory and can make compositing itself the bottleneck.

Source: `cc/` (`Layer`, `LayerTreeHost`, `PictureLayer`), Blink handoff described in `core/paint/README.md`.

## Cost classes for CSS properties

- Layout and paint: `width`, `height`, `top`, `left`, `right`, `bottom`, `margin`, `padding`, `border-width`, `font-size`, `line-height`, `position`, `display`, `float`, `grid-template-*`.
- Paint only: `color`, `background`, `border-color`, `border-radius`, `box-shadow`, `outline`, `visibility`.
- Compositor friendly: `transform`, `opacity`, `filter` (with caveats). These can skip style, layout, and paint on the compositor thread once the element has its own layer or a composited animation.
- Trigger layout reads: `offsetWidth/Height/Top/Left`, `clientWidth/Height/Top/Left`, `scrollWidth/Height/Top/Left`, `getBoundingClientRect`, `range.getClientRects`. A read after a write forces synchronous layout. `getComputedStyle` updates style first and forces layout only for layout-dependent properties.

## Forced synchronous layout

A geometry read after a DOM or style write makes Blink run layout immediately to answer the question. The Chrome documentation calls the result a forced reflow, and repeated forced reflows in one task are layout thrashing. The fix is structural: write, then read, or read everything first and cache it.

Chromium reference: "Forced reflow" in Chrome for Developers performance insights.

## Reading the source

- `source.chromium.org` and `github.com/chromium/chromium` are the same tree. Start at `third_party/blink/renderer/core/README.md`.
- Find a behavior by symbol name first, then read the class and its header comments. Headers in Blink carry design notes.
- Read the commit message that introduced or changed the file. Chromium commit messages carry the rationale and the linked design doc.
- Design docs: "How Blink Works" and the "Life of a Pixel" talk cover the architecture and the pipeline end to end.
- Debugging helpers exist behind Chromium flags and DevTools panels. Prefer reading source over memorizing flags, because flags change.

When a trace surprises you, search the event name in the Chromium tree. The emitter is usually one `TRACE_EVENT` macro away from the code that decides the behavior.
