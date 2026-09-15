# ReplyTree: the same deferral, plus an accessibility price

Source: the repo's `study/`, postwork case.
Interaction: rendering a 200-reply, 3-level reply tree.

## Floor and counters

`LayoutDuration` 94.6 to 40.6 ms, `RecalcStyleDuration` 44.7 to 18.4 ms, `TaskDuration` 242.6 to 147.9 ms. The trace args confirm the scope change: layout `dirtyObjects` 6808 to 485 plus 398.

## Machine read

```text
dirtyObjects 6808 -> 485 + 398
-> the layout pass touches one subtree instead of the document
-> containment bounded the scope as designed
```

## Trap taught

Two corrections landed on this case. First, the stated pixel difference was 0.44%; the verifier measured 1.57%. Pixel claims need the method (fixed clip, forced render, bounding box, max delta), not a headline percentage. Second, the first scroll re-paid 73 ms of layout, and mount plus scroll-to-bottom ran about 20% worse than before. Third, offscreen replies left the computed accessibility tree until scrolled (5,051 to 567 non-ignored nodes). A containment win has three prices until proven otherwise: the deferred scroll, the pixels, and the accessibility tree.
