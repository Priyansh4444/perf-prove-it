# Presentation kit

Props for a talk about the skills, not a deck to read aloud. The principles come from the Death by PowerPoint article: story over progress report, re-entry points, one deliberate surprise, real technical detail, and slides that give the speaker something to do.

## Files

```
census.html            one-page live demo, keyboard controlled
talk-outline.md        a ten minute script with beats and timings
cards/                 code and evidence cards, SVG and 2x PNG
generate-cards.mjs     regenerates the cards
```

## Open the live demo

```sh
xdg-open census.html
```

Controls: right arrow or space or click for the next scene, left arrow to go back, Home and End to jump. Append `?scene=3` to the URL to start on a given scene, which is useful when setting up a projector.

Scene order: the hook, the before function with its 7 closures, the fused after version, the TurboFan verification, the fake 16x win that the deopt trace killed, and the install line.

## Use the cards

The PNGs are rendered at 2x and sized for a 16:9 screen. If the live demo fails, the cards are the fallback and they double as images for a writeup.

- `rerank-before` and `rerank-after`: the core code change, with the closure counts.
- `census`: all five functions, before and after.
- `trace-opt`: the tier-up lines and no deopts.
- `phantom-16x`: the honesty card. Show it after letting the fake win sit.
- `rust-runs`: the probe change with three runs and the rejected experiments in the talk.

## Regenerate

Edit the snippets and data at the bottom of `generate-cards.mjs`, then:

```sh
node generate-cards.mjs
```

It writes SVG for every card and shells out to `rsvg-convert -z 2` for PNGs. If `rsvg-convert` is missing, the SVGs still render in any browser.

## Design rules

- Same palette as the logo: navy `#0B1220`, cyan for targets, green for proof, slate for the old numbers.
- Monospace for anything the machine says. The UI font never touches code or counters.
- One idea per card. If a card needs a caption, the card is wrong.
- Counts, not confidence: every card carries a number that a reader could reproduce.
