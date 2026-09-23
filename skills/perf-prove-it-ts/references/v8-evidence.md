# V8 evidence: commands, traps, and looking things up

Construction counts are deterministic for a fixed V8 build, input shape, and harness. Timings are not. Version-stamp every report:

```sh
node -v; node -p "process.versions.v8"; node -p "process.arch"
```

## Harness rules

**Natives need the flag, not necessarily CJS.** `%PrepareFunctionForOptimization` and friends require `--allow-natives-syntax`. Whether they parse in ESM depends on your Node; older releases need a CJS file. Test once on your Node and use whichever works.

**Warm until tier-up is observed, not a fixed count.** Watch `--trace-opt` until the target function reaches its top tier, then start measuring. A fixed number like 12k calls is a superstition that breaks when bytecode size or the V8 version changes.

**Determinism when you need it, never for the headline.** `node --predictable` disables concurrent Sparkplug and concurrent recompilation, runs GC single-threaded, disables the memory reducer, and pins the random seed to `12347`; two `node --predictable -p "Math.random()"` runs print the same value. Use it to make construction counts, tier lines, and deopt sequences repeat while you establish a mechanism. Do not quote its timings as production: removing concurrent marking and compilation changes pauses and tier-up timing. `--predictable-gc-schedule` additionally fixes the semi-space size and shifts the scavenge-per-work rate, so hold it constant across arms. `node --v8-options | grep predictable` prints the exact implications for this build, because they move between releases.

**Stable shapes only.** Calls with different object shapes or input sizes train different maps and pollute feedback. If production sees multiple shapes, benchmark each shape separately and say so.

**Prepare before forcing.** `%OptimizeFunctionOnNextCall` without `%PrepareFunctionForOptimization` first aborts the process, it is not a catchable error:

```text
Error: Function 0x... <JSFunction f (sfi = 0x...)> should be prepared for optimization with
%PrepareFunctionForOptimization before %OptimizeFunctionOnNextCall / %OptimizeMaglevOnNextCall / %OptimizeOsr
# Fatal error ... Check failed: CheckMarkedForManualOptimization
Trace/breakpoint trap (core dumped)
```

**Forced does not mean production.** `%OptimizeFunctionOnNextCall` logs `manually marking ... TURBOFAN_JS`, which proves a compile request, not that the tier is active. Require a `completed optimizing ... (target TURBOFAN_JS)` line or `%ActiveTierIsTurbofan`, and for a production claim an unforced run of the same function with a tier-up line for the exact SFI in the timed loop.

**Never decode `%GetOptimizationStatus` from memory.** The integer is a version-defined bit set. In one measured A/B the old arm reported `41` and the new arm `131073`, and the difference was not self-explanatory. The bit meanings live in `src/runtime/runtime.h` in the V8 tree; read them there, because the enum has shifted between releases. Use `--trace-opt` as the authority, use the integer only as a sanity check, and when it puzzles you open the source that defines the bits.

**One function per bytecode filter.** `--print-bytecode-filter='rerank|tokenize'` matches nothing on current builds. Loop:

```sh
for f in rerank tokenize mapAspects; do
  node --allow-natives-syntax --print-bytecode --print-bytecode-filter="$f" harness.cjs
done
```

## Backend and deopts

```sh
# Tier-up: record what this build does for each hot function
node --allow-natives-syntax --trace-opt harness.cjs 2>&1 | grep -E "rerank|tokenize"

# Why optimized code was discarded
node --allow-natives-syntax --trace-deopt harness.cjs 2>&1 | grep -E "rerank|tokenize"
```

Maglev is a mid tier and can be disabled by flag or skipped by the engine; do not require it. Require that you know which tier ran and quote the lines. If a function stays interpreted after heavy warmup, that is a finding, not a failure.

The ladder is Ignition (interpreter), Sparkplug (baseline), Maglev (mid), TurboFan (top). A function climbs while it stays hot, and a deopt drops it back to the interpreter to climb again. V8's tiering budget scales with bytecode size and the feedback the function has collected, which is why a fixed warm-up count is superstition, and OSR can compile a loop mid-execution. In a browser the recipe is the embedder's (see the Commands section of SKILL.md): launch with `--js-flags=--allow-natives-syntax` and read `%ActiveTierIsMaglev` / `%ActiveTierIsTurbofan` in the page, or record DevTools Performance for optimization and deoptimization markers. Node tier lines are not the browser's.

One command checks the tier machinery on this machine before any claim depends on it: `node --allow-natives-syntax "$(command -v perf-prove-it)" tier` warms a hot function, prints `{ turbofan, maglev }` with the build's versions, and exits non-zero if TurboFan was never reached. Maglev reports false once TurboFan is active, so read the two fields separately. `--trace-opt` shows the Maglev line, then `completed compiling ... (target TURBOFAN_JS)`. In a browser, TurboFan is not guaranteed by call count: tier-up depends on the embedder's flags and the interrupt budget, and V8 skips TurboFan under `--no-turbofan`, `--turbo-filter`, efficiency or battery-saver mode, or for functions over the 60 KB bytecode limit, so a warmed hot function can stay Maglev-only; a forced `%OptimizeFunctionOnNextCall` is a compile request, not a tier. Report the tier you observed, not the tier you warmed toward.

Real deopt lines and what they meant:

```text
[bailout (kind: deopt-eager, reason: wrong map): ... deoptimizing <JSFunction rerank> ... TURBOFAN_JS]
[bailout (kind: deopt-eager, reason: Insufficient type feedback for generic named access): ... <JSFunction escalate> ...]
```

- `wrong map` means an object's hidden class changed under the compiled code. When two copies of the same module were loaded in one process, objects from bundle A hit code trained on bundle B and the old arm deoptimized. That produced a fake 16x speedup until each arm was run in its own process.
- `Insufficient type feedback for generic named access` means `%OptimizeFunctionOnNextCall` fired before a property access was profiled. Add warmup; it is a harness bug, not a code bug.
- Deopt reason strings move between releases. Quote them, do not paraphrase them from memory.
- `wrong map` is the eager case: a guard failed. Lazy deopt has no failing check at all. A prototype mutation, a function redefinition, or a map deprecation marks dependent code, and it exits at the next return. Escape-analyzed allocations are rebuilt during the exit, so a lazy deopt can cost more than the guard it replaced. That is the real price of changing an object shape after optimized code has learned it.

## Reading bytecode without fear

Ignition is a register machine with an accumulator: bytecodes name explicit register operands, and most read or write the accumulator implicitly. V8's bytecode list defines a couple hundred opcodes (the exact count moves between releases), but the working set in real function bodies is small:

| Op | Meaning |
| --- | --- |
| `Ldar` / `LdaZero` / `LdaConstant` / `LdaTheHole` | load into accumulator |
| `Star` / `StaCurrentContextSlotNoCell` | store from accumulator |
| `GetNamedProperty` / `SetNamedProperty` | property access, carries a feedback slot |
| `CallProperty` / `CallUndefinedReceiver` | calls, carries a feedback slot |
| `CreateClosure [.. <SharedFunctionInfo name>]` | function object constructed when executed; the operand is a constant-pool index and the dump renders the SharedFunctionInfo it points at |
| `CreateFunctionContext` + `PushContext` | captured scope allocated, then pushed as the current context |
| `CreateEmptyArrayLiteral` / `CreateObjectLiteral` / `CreateRegExpLiteral` | temporary container constructed when executed |
| `JumpIfFalse` / `JumpLoop` | control flow |
| `TestEqualStrict` | a test, not a branch: compares a register with the accumulator and leaves the boolean in the accumulator |
| `Add` / `Sub` / `Inc` / `Mul` / `Div` | arithmetic |
| `Return` | done |

Property, call, and literal ops carry an explicit `FeedbackSlot` operand. Arithmetic and comparisons use an inline `EmbeddedFeedback` byte instead. Both are type-feedback sites, and a site in bytecode is not proof the operation ran.

The names above match the V8 tree these notes were written against. Opcode names and operand formats move between releases; if a mnemonic is not in this table, look it up in `src/interpreter/bytecodes.h`, do not guess.

Map the source to the dump: an arrow function inside a function becomes `CreateClosure`; if it captures locals, you also get `CreateFunctionContext` at the top of the enclosing function. An A/B pair from the run:

```text
rerank (before)  CreateFunctionContext ..., Bytecode length: 476
                 CreateClosure <SharedFunctionInfo compare>      <- 7 closures total
rerank (after)   CreateClosure 1                                 <- only the comparator
```

## Shapes and properties

Every object's behavior is decided by its Map (hidden class). The object header points at the Map; the Map points at a DescriptorArray that pairs each property name with its storage location, representation, and attributes. In-object fields live in the object itself, overflow fields in a PropertyArray, and both are fast. Build objects with the same properties in the same order and the transition tree hands back the same Map, so instances stay shape-identical and property-access inline caches stay monomorphic. Different order, dynamic names, or a `delete` between adds and the transition tree forks.

The cliff is dictionary mode. Deleting a fast property normalizes the object to a dictionary, and that is effectively one-way for ordinary objects: dictionary properties are not IC-able. Wide objects normalize too: a hard descriptor cap (`kMaxNumberOfDescriptors`, 1020), a keyed-store-only soft limit far earlier (`fast_properties_soft_limit`, default 12, measured against fields beyond the in-object ones), and once the transition array is full (`kMaxNumberOfTransitions`, 1536) a new add stops recording a transition and gets an unshared map with every field generalized. Design rule: declare every field once, in one order, and never `delete` in a hot path; assign `null` instead.

Numbers are a shape of their own. A field first written with a Smi stores it in place; a later double write generalizes the field, deprecates the Map, and lazily migrates every existing instance. Initialize fields that will hold doubles with `NaN`, never `null` or an integer. Non-extensible objects whose non-last field changes representation used to grow an orphan shape per instance, the React `FiberNode` trap; that cliff was fixed, so treat it as history rather than current behavior. `%DebugPrint` shows the Map and the field representations; check the flag defaults with `node --v8-options | grep <name>`, because they move between releases.

Strings carry a representation too. V8 stores a string as one-byte (Latin-1) or two-byte. One code unit above `0xFF`, an em dash or a curly quote, promotes the whole string to two-byte, and regex matching has separate one-byte and two-byte paths, so every regex over that string runs on the slower one. A single non-Latin-1 character in a large document is enough. Keep hot regex inputs Latin-1 (escape or replace the non-Latin-1 characters, or match a sanitized copy) and read the representation with `%DebugPrint` when a regex is mysteriously slow. External measured case: highlighting a code block whose markdown held one non-Latin-1 character blocked the main thread for about 1 s on the first block and 100 ms on each later pass, and fell to 0.35 s and 40 ms once the hot regex saw one-byte input (Anthropic, Aug 2026).

Indexed properties follow a separate lattice: packed Smi, holey Smi, packed double, holey double, packed object, holey object, then dictionary. Values generalize the kind as they arrive (Smi to double to object) and, except for `Array.prototype.fill`, the kind never narrows or re-packs. `delete` and out-of-bounds writes make it holey; reading past `length` can leave that load site on the slow prototype-walking path; very sparse arrays and indexed properties with custom attributes become dictionary elements. Keep hot numeric data dense and typed; `Float64Array` is packed and transition-free.

A property-access site starts monomorphic, tolerates a bounded number of shapes, then falls back to the per-isolate megamorphic stub cache (`StubCache`: 4096 primary + 1024 secondary slots), where accesses no longer inline. That boundary is a flag default that has moved between releases, so read it off your own build (`node --v8-options | grep max-valid-polymorphic-map-count`), and use `--trace-ic` to see the states and the fold. Maglev and TurboFan escape analysis can erase allocations for objects that do not escape, so shape discipline matters most for the objects that do.

## What the counts do and do not mean

- The census counts static `CreateClosure`, `CreateFunctionContext`, and literal sites in Ignition bytecode. A branch-guarded site is counted even when it rarely executes. For dynamic truth, use `--heap-prof` or a heap snapshot diff.
- For dynamic call counts, V8 precise coverage (`NODE_V8_COVERAGE=dir`, then read the JSON, or CDP `Profiler.takePreciseCoverage`) reports how many times each function ran. It is deterministic for a fixed harness and is a usable CI ratchet; `ratchets.md` covers the gate.
- TurboFan inlines small callbacks and escape-analyzes allocations that do not escape. The hot tier can erase exactly what the census counted, so a closure count is a churn signal, not a speed prediction.
- Allocation folding combines consecutive allocations into one bump-pointer allocation. Object counts do not map linearly to allocation cost.
- Inlining callback bodies into the caller grows that function's bytecode. Bytecode is the cold tier, so the growth is a compile-time and cold-start cost, but large functions are also less likely to be inlined into their own callers.
- Dynamic allocation evidence and scavenger interpretation live in `memory-and-heap.md`.

## When the dump or the reason makes no sense

Go to the source. Do not guess from memory.

- Opcodes: `v8/src/interpreter/bytecodes.h` (Chromium googlesource, `v8/v8` repo). Each op has its operand format and semantics.
- Runtime test functions (`%GetOptimizationStatus`, `%PrepareFunctionForOptimization`): `v8/src/runtime/runtime-test.cc`; the status bits are declared in the same tree.
- Tiering and Maglev/TurboFan behavior: V8 blog posts and `v8/src/compiler` for the pipeline stages.
- Flag meanings: `node --v8-options | grep <name>` prints each flag and default.

The point is not tourism. In one recorded debugging session, the agent stopped guessing at a status integer, read what the value meant, switched to `--trace-opt` as the authority, and only then trusted the comparison. When the machine tells you something you do not understand, read the machine's own documentation or source, then come back and rerun.

## When JS frames look flat

A JS CPU profile cannot see time spent in builtins, C++ runtime functions, or the GC. Two ways to expose it:

```sh
node --prof app.mjs && node --prof-process isolate-*.log   # [JavaScript], [C++], and a GC bucket in [Summary]
```

In a browser or `d8`, Runtime Call Stats (the `v8.runtime_stats` trace category, or `d8 --runtime-call-stats`) attributes time to builtins and runtime functions. If the profile is flat but the wall clock is not, the cost is below the JS frames; these two find it.

## Timing without lying

- Check load first: `/proc/loadavg` on Linux, `uptime` or `sysctl -n vm.loadavg` on macOS. On a loaded box report construction counts, not milliseconds.
- One process per arm. Dual-bundle A/B in one process is banned; the arms deopt each other.
- Median of at least 5 runs per arm, same machine, same commit, same load, recorded. Report ns/op with the spread.
- Escape analysis can remove micro-allocations entirely, so a tiny timing delta may be zero. Count constructions instead of believing 0.5%.
- Always assert same-result equivalence on identical inputs in the harness before measuring anything.

## Sources

Prose background for this file, in reading order: `v8.dev/blog/fast-properties` (Maps, descriptor arrays, in-object vs fast vs slow properties, elements kinds), `v8.dev/blog/elements-kinds` (the lattice and its traps), `v8.dev/blog/react-cliff` (field representation changes and the `FiberNode` orphan-shape trap), `v8.dev/blog/mutable-heap-number` (in-place mutable HeapNumber slots: no per-store re-boxing), `v8.dev/blog/sparkplug` and `v8.dev/blog/maglev` (the baseline and mid tiers), and the in-tree `docs/runtime/tiering.md` (the interrupt budget). A course-style introduction with the IC states drawn out: `stanza.dev/courses/javascript-performance-internals/v8-engine/javascript-performance-internals-hidden-classes`. Treat its "2 to 4 maps" boundary as older-build lore and read the real boundary off your own `--v8-options`.
