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
- the output metrics: closures 7 to 1, temporaries 204 to 3, bytecode 476 to 1856 bytes, 26 to 2 across six functions

## Record

The layout mounts `<Recorder />`, hidden until hover. Press `Shift+R` to start (screen share permission, then `F11` for fullscreen) and `Shift+S` to stop. It records MP4 with system audio. To turn a recording into a GIF:

```sh
ffmpeg -i recording.mp4 -vf "fps=15,scale=1280:-1:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse" out.gif
```

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
