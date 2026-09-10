# Presentation

A [Slidev](https://sli.dev) deck. Slidev is the dev-standard slides tool, and it ships Shiki Magic Move, the library behind the click-to-morph code transitions here.

## Run it

```sh
cd presentation
npm install
npm run dev
```

Space or right arrow advances. On "The code" and "Counted before and after", the first click morphs the block: before into after, then the census numbers move.

```sh
npm run build     # static site in dist/
npm run export    # PDF or PNGs, needs playwright-chromium
```

For export, install the browser once: `npm i -D playwright-chromium`.

## Slides

1. Cover
2. The code, before. Click morphs it into the after version.
3. The actual bytecode, trimmed from `--print-bytecode`, with the `CreateClosure` line called out.
4. The closure census before and after. Click morphs the table.
5. Opt: `--trace-opt` tiering, Maglev then TurboFan, no deopts.
6. Deopt: the `wrong map` bailout that killed a fake 16x A/B result.
7. What it bought, in counts.
8. Close, with the install line.

## Static cards

`cards/` still holds the code and evidence cards as SVG and 2x PNG, for when you want images instead of a live deck. Regenerate them after editing the snippets:

```sh
node generate-cards.mjs
```

## Files

```
slides.md            the deck source
package.json         slidev scripts and dependencies
style.css            dark palette to match the logo
uno.config.ts        blocklist so bytecode brackets are not parsed as CSS classes
cards/               generated SVG and PNG cards
generate-cards.mjs   card generator
talk-outline.md      a ten minute talk script built on the presentation rules
```
