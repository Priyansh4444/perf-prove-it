# Static-audit cross-file fixture

A small multi-file TypeScript app used to verify that the static-audit call-site census resolves calls across files, and only for functions defined in the codebase.

## Shape

- `src/rank.ts` defines `computeScores`, whose loop contains a `repeated-linear-membership` candidate.
- `src/format.ts` defines `parseConfigs`, whose loop contains a `loop-parse` candidate.
- `src/app.ts` calls `computeScores` three times and `parseConfigs` once.
- `src/jobs.ts` calls `computeScores` three times.
- `src/widget.tsx` calls `computeScores` once, calls `useState` (a framework hook), and is rendered as `<Widget />` in `src/main.tsx`.
- `src/main.tsx` uses JSX, which is not a `Widget(` call.

## Expected

| function | defined in | static call sites | rank boost | score |
| --- | --- | ---: | ---: | ---: |
| `computeScores` | `rank.ts` | 7 | +2 | 9 |
| `parseConfigs` | `format.ts` | 1 | +1 | 9 |
| `Widget` | `widget.tsx` | 0 | 0 | 7 |

`computeScores` is boosted by calls made in `app.ts`, `jobs.ts`, and `widget.tsx`, even though its finding lives in `rank.ts`. `useState` is an import, not a local definition, so it never contributes a call site. `<Widget />` is JSX, not a `Widget(` call, so `Widget` stays at the base rank.

## Run

```sh
node verify.mjs
```

Exit code 0 means every assertion holds.
