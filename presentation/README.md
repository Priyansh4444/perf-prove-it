# Presentation

An [Animotion](https://animotion.pages.dev) deck: Svelte, Reveal.js, and Tailwind, with Shiki and Magic Move for the code animations. The code theme is Vesper.

## Run

```sh
pnpm install
pnpm run dev
```

Open http://localhost:5173. Arrow keys move between slides. Five slides, no captions:

- the before JS code, click to morph it into the after version
- the before bytecode, scrolled to the closures, click to select every `CreateClosure` line
- the after bytecode, with the single remaining closure selected
- `--trace-opt` and `--trace-deopt` side by side, with their lines selected
- the output metrics: closures 7 to 1, temporaries 204 to 3, 26 to 2 across six functions, bytecode 476 to 1856 (inlined callbacks, a compile-time cost), 42.8 to 38.9 µs per cold-start warm rerank call on TurboFan, and peak RSS 154 to 122 MB per 100k calls

## Record the animations

```sh
node record.mjs
```

The script builds the deck, serves it with `vite preview`, and records one clip per slide with Playwright's `recordVideo`. That is the same CDP screencast approach as `puppeteer-screen-recorder` and `playwright-screen-recorder`, without the extra dependency. It drives the deck the way a presenter does, pressing the next key to trigger each Animotion action, then converts every clip to MP4 and GIF with ffmpeg.

Outputs land in `animations/`:

- `01-code.mp4` / `.gif`: the before code morphing into the after version.
- `02-bytecode-before`, `03-bytecode-after`: the dump scrolling and the `CreateClosure` lines lighting up.
- `04-opt-deopt`: the two traces selecting their lines.
- `05-metrics`: the metric numbers.

`CHROME_PATH` overrides the browser, which defaults to `/usr/bin/chromium`.

The interactive `<Recorder />` in the layout is still there for live screen recordings (`Shift+R`).

## Real data

Every line on the slides comes from the run captured in `bytecode/`:

- `rerank-before.txt`, `rerank-after.txt`: full Ignition dumps, 476 and 1856 bytes.
- `census-before.txt`, `census-after.txt`: closures and contexts per call across six hot functions, 26 to 2.
- `opt-after.txt`: `--trace-opt`, Maglev then TurboFan, no deopts.
- `deopt-ab.txt`: `--trace-deopt` from both bundles in one process, the `wrong map` bailouts behind the thrown-out 16x.

`src/lib/data.ts` imports the files with `?raw` and computes the line numbers to select, so the slides cannot drift from the captures. `src/lib/snippets.ts` holds the before and after code excerpts, extracted verbatim from `11d2ef6^` and `11d2ef6`.

## Files

```
src/routes/+page.svelte    the slides
src/lib/data.ts            raw captures and computed line numbers
src/lib/snippets.ts        real before/after code excerpts
src/styles/overrides.css   Vesper code sizing
bytecode/                  raw dumps, the source of truth
static/logo.png            favicon and mark
```

`npm run build` and `npm run preview` produce and serve a static build.
