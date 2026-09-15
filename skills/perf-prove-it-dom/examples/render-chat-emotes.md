# renderChatEmotes: fewer nodes, and a headline that needed a quiet box

Source: the repo's `study/`, chatmost case.
Interaction: rendering a chat feed with emotes.

## Floor and counters

The floor for a feed update is the new messages, not a rebuild of the list. Before, the render built 3,126 nodes; after, 1,050. `UpdateLayoutTree` fell 6.61 to 4.03 ms (the after arm reproduced at 4.20 ms; the before arm was inflated by load). The worker's Paint headline, 11.24 to 4.34 ms, held in 8 of 9 paired rounds but did not reproduce on a quiet box.

## Machine read

```text
Nodes 3126 -> 1050
-> fewer live nodes means smaller style and layout inputs every frame
-> two thirds of the render cost removed at the DOM stage
```

## Trap taught

Durations vary with machine load while counters repeat exactly. The node count reproduced every round; the Paint headline did not. This is why the skill compares counters first and treats durations as medians across rounds. Parity here was exact: text, ARIA, scroll, row rects, and a 6,224-case differential with 0 mismatches.
