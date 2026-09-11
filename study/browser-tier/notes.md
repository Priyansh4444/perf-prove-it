# Browser tier checks: verified 2026-09-10

Reproduce with `node study/browser-tier/check.mjs`.

Environment: Chromium 152.0.7977.82 (`/usr/bin/chromium`), Playwright 1.63 `playwright-core`, Node v26.8.2, headless.

Output:

```json
{"args":[],"chromium":"152.0.7977.82","result":{"error":"Error: page.evaluate: SyntaxError: Unexpected token '%'"}}
{"args":["--js-flags=--allow-natives-syntax"],"chromium":"152.0.7977.82","result":{"status":25,"turbofan":false,"maglev":true}}
```

What this proves:

- A page cannot use `%` natives unless the browser is launched with `--js-flags=--allow-natives-syntax`. Without it the page parser rejects the source.
- The evaluate argument must be a string expression so the page parser, not Node, parses the intrinsic. A function argument is serialized but still compiled by the page from its source; the string form is the reliable path.
- `%ActiveTierIsMaglev(f)` and `%ActiveTierIsTurbofan(f)` work in the page and are the readable tier check. After 50,000 warmup calls this build had reached Maglev, not TurboFan, which is the point: warm until the tier you care about shows, and report the tier you saw.
- `%GetOptimizationStatus` returned 25; the integer stays opaque, so do not decode it from memory.

This backs the browser scope note in `skills/perf-prove-it-ts/SKILL.md` Step 2 and the ladder note in `references/v8-evidence.md`.
