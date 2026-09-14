# Transcript expansion: the win that moved to the scroll

Source: the repo's `study/`, ytsearch case.
Interaction: expanding a transcript to 100 rows.

## Floor and counters

The floor for revealing rows is one layout pass over the revealed subtree. `content-visibility: auto` with an intrinsic size on the expanded rows gave `LayoutObjects` 2197 to 449 and layout time 27.4 to 9.9 ms (production build: 12.63 to 4.62 ms).

## Machine read

```text
LayoutObjects 2197 -> 449, one mount pass
-> skipped subtrees are not laid out until revealed
-> the mount got cheap; check the scroll next
```

## Trap taught

The first scroll into the revealed rows re-paid 18 layouts and roughly 46 ms, so the full-scroll total was not the mount win. Containment defers work; it does not delete it. The skill now requires the full cycle: mount plus the first revealing scroll, both halves reported. A second trap from the same case: the worker's offscreen parity screenshots were viewport-clipped strips, so they proved nothing. Parity for skipped content needs force-rendered full-page captures.
