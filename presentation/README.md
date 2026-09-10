# Presentation

Everything here is generated from the real run: the code at PR #10 of the search engine, the bytecode V8 produced for it, and the opt and deopt traces. Code and output use the Vesper theme.

## Output GIFs

`gifs/` holds the animated terminal outputs, all from captured runs:

- `rerank-before.gif`: the seven `CreateClosure` lines in `rerank`, one per callback.
- `rerank-after.gif`: the single remaining closure, and the note that the callbacks moved inline.
- `opt-tier-up.gif`: Maglev then TurboFan on every hot function, no deopt lines.
- `deopt-wrong-map.gif`: the `wrong map` bailouts from running both bundles in one process, the reason the 16x A/B was thrown out.

Regenerate all of them with:

```sh
node make-gifs.mjs
```

Pipeline: Shiki (`vesper`) colors the real text, chromium screenshots each reveal frame, ImageMagick assembles the GIF.

## Real captures

`bytecode/` holds the raw dumps and the harness that produced them, plus reproduction steps in `bytecode/README.md`. The code excerpts in `code/` are extracted verbatim from git at `11d2ef6^` and `11d2ef6`.

## Deck

```sh
npm install
npm run dev
```

Slidev deck. `setup/shiki.ts` pins the code theme to Vesper, and the slides import the capture files directly with `<<< @/bytecode/...`, so the deck cannot drift from the real output. The GIFs are embedded on their own slides.

```sh
npm run build     # static site in dist/
npm run export    # PDF or PNGs, needs playwright-chromium
```

## Files

```
slides.md            the deck, imports the real captures
setup/shiki.ts       vesper theme for code
style.css            slide chrome
uno.config.ts        blocklist so bytecode brackets are not parsed as CSS
gifs/                output GIFs
make-gifs.mjs        regenerates the GIFs
bytecode/            raw dumps, harness, reproduction notes
code/                verbatim before/after excerpts from git
talk-outline.md      a ten minute talk script
```
