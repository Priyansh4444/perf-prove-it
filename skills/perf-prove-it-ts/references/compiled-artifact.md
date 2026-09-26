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

## Cold start and code cache

Recompiling a large main process or server bundle from source on every start is startup work that no per-call benchmark sees. Precompile a V8 code cache and ship it. Node has `NODE_COMPILE_CACHE=dir` (add `NODE_COMPILE_CACHE_PORTABLE=1` to move the cache between machines) or `module.enableCompileCache()`; when the cache is served, the module graph is deserialized instead of parsed and compiled. Measure cold start with and without the cache and ratchet it separately from steady-state work.

Desktop apps have two cache domains, one per engine. In Electron:

- Main process (Node): the module compile cache above, for the shell's own CommonJS/ESM modules. Confirm the API on your Electron version, because it bundles its own Node.
- Renderer (Blink): the session's V8 code cache, stored under `Code Cache` in the user data folder by default and settable with `ses.setCodeCachePath(path)`. Code cache is enabled only for `http(s)` URLs by default; register a custom protocol with `codeCache: true` and `standard: true` to cache its scripts. This caches the app's and V8's own script compilation, not the main-process shell.

Both caches are keyed on the V8 build and flags and are invalidated by an Electron, Chromium, or Node upgrade, so re-verify after one and expect a slower first start. The cache trades disk and a version-fragile artifact for startup time. Report cold start as its own journey, separate from per-call work.

### Bun compiled executables: bytecode, layout, and JIT policy

Bun has no module compile cache; it has one artifact. `bun build --compile` embeds the bundled modules and the Bun runtime, and with `--bytecode` it also embeds JavaScriptCore bytecode, moving parse work from every start to build time.

`--bytecode-order` is profile-guided layout on top of that. `--bytecode` writes every function's bytecode; the profile decides which of them sit closest to the front of the file, so a cold start reads and decodes less of itself:

```sh
# 1. build once without the profile
bun build --compile --bytecode ./cli.ts --outfile myapp
# 2. run it the way users do; the profile is written on exit
BUN_BYTECODE_ORDER_OUT=myapp.order ./myapp --help
# 3. rebuild with the profile
bun build --compile --bytecode --bytecode-order=myapp.order ./cli.ts --outfile myapp
```

The profile stores a hash of each function's syntax, not names, positions, or source, so it keeps applying as other code changes, works across `--target`s, and leaves builds reproducible. Functions whose syntax changed are placed right after the recorded ones. Pass several profiles for several startup paths, the most common first (`--bytecode-order=interactive.order,oneshot.order`); `%p` in the output name becomes the process id, and `Worker` threads are recorded too. `bytecodeOrderStats()` from `bun:jsc` reports how many loaded functions the profile covered (`hot`) versus missed (`cold`); a growing `cold` share means it is time to record again.

`--compile-jit-policy <n>` scales JavaScriptCore's tier-up thresholds at startup so code that only runs once stays in the interpreter instead of paying for a JIT it never reuses; the app restores `Bun.unsafe.setJITPolicy(1)` once it is interactive. The default scale is `1`. `--bytecode-depth N` bounds how deep compilation goes at the cost of parsing nested functions at first call.

Bun reports one large CLI going from 1.0s to 0.53s and 40 MB less memory at startup; treat that as upstream's number, not yours. Measure cold start as its own journey on the shipped binary: hash the artifact, drop the page cache, run the same command repeatedly, and report the profile's hot/cold coverage beside the timing. The embedded bytecode is JavaScriptCore bytecode frozen at build time, so the V8 `--print-bytecode` census and `npx perf-prove-it census` do not describe it. Use `bytecodeOrderStats()` and a cold-start harness.
