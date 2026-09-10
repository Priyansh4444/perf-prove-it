# V8 evidence: commands, traps, and looking things up

Construction counts are deterministic for a fixed V8 build, input shape, and harness. Timings are not. Version-stamp every report:

```sh
node -v; node -p "process.versions.v8"; node -p "process.arch"
```

## Harness rules

**Natives need the flag, not necessarily CJS.** `%PrepareFunctionForOptimization` and friends require `--allow-natives-syntax`. On Node 26 they parse in ESM; older Node needs a CJS file. Test once on your Node and use whichever works.

**Warm until tier-up is observed, not a fixed count.** Watch `--trace-opt` until the target function reaches its top tier, then start measuring. A fixed number like 12k calls is a superstition that breaks when bytecode size or the V8 version changes.

**Stable shapes only.** Calls with different object shapes or input sizes train different maps and pollute feedback. If production sees multiple shapes, benchmark each shape separately and say so.

**Prepare before forcing.** `%OptimizeFunctionOnNextCall` without `%PrepareFunctionForOptimization` first aborts the process, it is not a catchable error:

```text
Error: Function 0x... <JSFunction f (sfi = 0x...)> should be prepared for optimization with
%PrepareFunctionForOptimization before %OptimizeFunctionOnNextCall / %OptimizeMaglevOnNextCall / %OptimizeOsr
# Fatal error ... Check failed: CheckMarkedForManualOptimization
Trace/breakpoint trap (core dumped)
```

**Forced does not mean production.** `%OptimizeFunctionOnNextCall` logs `manually marking ... TURBOFAN_JS`, which proves a compile request, not that the tier is active. Require a `completed optimizing ... (target TURBOFAN_JS)` line or `%ActiveTierIsTurbofan`, and for a production claim an unforced run of the same function with a tier-up line for the exact SFI in the timed loop.

**Never decode `%GetOptimizationStatus` from memory.** The integer is a version-defined bit set. In the original run the old arm reported `41` and the new arm `131073`, and the difference was not self-explanatory. The bit meanings live in `src/runtime/runtime.h` in the V8 tree; read them there, because the enum has shifted between releases. Use `--trace-opt` as the authority, use the integer only as a sanity check, and when it puzzles you open the source that defines the bits.

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

Real deopt lines and what they meant:

```text
[bailout (kind: deopt-eager, reason: wrong map): ... deoptimizing <JSFunction rerank> ... TURBOFAN_JS]
[bailout (kind: deopt-eager, reason: Insufficient type feedback for generic named access): ... <JSFunction escalate> ...]
```

- `wrong map` means an object's hidden class changed under the compiled code. When two copies of the same module were loaded in one process, objects from bundle A hit code trained on bundle B and the old arm deoptimized. That produced a fake 16x speedup until each arm was run in its own process.
- `Insufficient type feedback for generic named access` means `%OptimizeFunctionOnNextCall` fired before a property access was profiled. Add warmup; it is a harness bug, not a code bug.
- Deopt reason strings are V8 version artifacts. Quote them, do not paraphrase them from memory.

## Reading bytecode without fear

Ignition is a register machine with an accumulator. Twenty-ish ops cover almost every function body:

| Op | Meaning |
| --- | --- |
| `Ldar` / `LdaZero` / `LdaConstant` / `LdaTheHole` | load into accumulator |
| `Star` / `StaCurrentContextSlotNoCell` | store from accumulator |
| `GetNamedProperty` / `SetNamedProperty` | property access, carries feedback slot |
| `CallProperty` / `CallUndefinedReceiver` | calls, carries feedback |
| `CreateClosure [.. <SharedFunctionInfo name>]` | function object constructed when executed |
| `CreateFunctionContext` + `PushContext` | captured scope constructed when executed |
| `CreateEmptyArrayLiteral` / `CreateObjectLiteral` / `CreateRegExpLiteral` | temporary container constructed when executed |
| `JumpIfFalse` / `TestEqualStrict` / `JumpLoop` | control flow |
| `Add` / `Sub` / `Inc` / `Mul` / `Div` | arithmetic |
| `Return` | done |

Map the source to the dump: an arrow function inside a function becomes `CreateClosure`; if it captures locals, you also get `CreateFunctionContext` at the top of the enclosing function. An A/B pair from the run:

```text
rerank (before)  CreateFunctionContext ..., Bytecode length: 476
                 CreateClosure <SharedFunctionInfo compare>      <- 7 closures total
rerank (after)   CreateClosure 1                                 <- only the comparator
```

Opcode names and operand formats move between V8 releases. If a mnemonic is not in this table, look it up, do not guess.

## What the counts do and do not mean

- The census counts static `CreateClosure`, `CreateFunctionContext`, and literal sites in Ignition bytecode. A branch-guarded site is counted even when it rarely executes. For dynamic truth, use `--heap-prof` or a heap snapshot diff.
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

The point is not tourism. In the original run, the agent stopped guessing at a status integer, read what the value meant, switched to `--trace-opt` as the authority, and only then trusted the comparison. When the machine tells you something you do not understand, read the machine's own documentation or source, then come back and rerun.

## Timing without lying

- Check load first: `/proc/loadavg` on Linux, `uptime` or `sysctl -n vm.loadavg` on macOS. On a loaded box report construction counts, not milliseconds.
- One process per arm. Dual-bundle A/B in one process is banned; the arms deopt each other.
- Median of at least 5 runs per arm, same machine, same commit, same load, recorded. Report ns/op with the spread.
- Escape analysis can remove micro-allocations entirely, so a tiny timing delta may be zero. Count constructions instead of believing 0.5%.
- Always assert same-result equivalence on identical inputs in the harness before measuring anything.
