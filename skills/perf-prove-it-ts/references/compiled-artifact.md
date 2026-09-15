# Compiled artifact: TypeScript, JSX, HTML, and V8

Use this route when performance depends on JSX/HTML rendering, a framework transform, or emitted JavaScript. The evidence unit is the artifact that actually runs, not the `.ts` or `.tsx` text. Use whatever compiler and sourcemap format the repository emits.

## Required chain

1. Record repository commit, package, entry point, build command, compiler/bundler versions, target, minification, and feature flags.
2. Build the real package with locked dependencies. A small hand-written proof of concept is permitted as a separately labeled model probe.
3. Locate the exact emitted module/chunk and record a cryptographic hash.
4. Read emitted JavaScript around the target symbol. Confirm whether callbacks, JSX helpers, memo wrappers, parser calls, and allocation sites survived, moved, or were inlined.
5. Run V8 bytecode against that emitted file or a harness importing that exact file. The harness may call the export, but must not reimplement it.
6. Record Node/V8 versions, architecture, flags, bytecode filter, and function/SFI when tiering is discussed.

If the project cannot build, report **compiled-artifact evidence unavailable**. A reduced or equivalent JavaScript probe is a **model probe** only and must be labeled as such, regardless of which model or runner executes the skill.

`npx perf-prove-it compiled <dist> [term ...]` is the static first pass. It records emitted-file hashes, sizes, sourcemap presence, and matching terms without executing the application. Only after this inventory may a separate V8 harness import the exact artifact.

## Rendering accounting

Trace one user-visible update from state change to DOM commit. Separate reducer/projection work, component reconciliation, Markdown/HTML parsing and sanitization, highlighting/layout measurement, DOM mutation, and paint. For `D` streamed updates with response lengths `Lᵢ`, record parser work as `Σ parse(Lᵢ)` unless artifact/runtime evidence demonstrates prefix reuse. Do not infer DOM work from React source or bytecode alone; use a browser profile or DOM mutation counter.

Bytecode proves emitted interpreter instructions and static construction sites. It does not prove TurboFan execution, dynamic allocation, or browser DOM commits. Pair it with tier/deopt, heap, or browser evidence as the claim requires.
