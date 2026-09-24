# Runtime matrix

Read this only when evidence may cross runtimes.

Node and Chromium use V8 but different builds and tier policies. Bun uses JavaScriptCore, and so does Safari. Deno may differ in bundling and embedding. A Node bytecode or tier result is not a browser or Bun result. Use Node for deterministic floor/model probes, then rebuild and measure the shipped runtime when the claim is runtime-specific. `--predictable` and `--predictable-gc-schedule` are V8 determinism controls (Chromium passes V8 flags through `--js-flags`); JavaScriptCore has no equivalent, so a deterministic Node probe does not transfer to Bun or Safari.

A desktop app compounds this: Electron is Chromium plus a Node main process in one binary, so it has two engines, two cold starts, and two code-cache domains, the renderer's Blink code cache and the main process's Node module compile cache (`compiled-artifact.md`). A Node probe describes the main process, never renderer startup.

Engine names and tier behavior: `v8-evidence.md`, `jsc-evidence.md`.
