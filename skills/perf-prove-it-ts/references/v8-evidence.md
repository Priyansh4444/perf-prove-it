# V8 evidence: commands, traps, and looking things up

Everything here produces deterministic output. If two runs disagree, the harness is wrong, not the metric.

## Harness rules

**CJS or bust for natives.** `%PrepareFunctionForOptimization` etc. do not parse in ESM files. Bundle the real code to `engine.mjs` (esbuild), import it dynamically from `harness.cjs`, and run with `--allow-natives-syntax`.

**Warm with stable shapes.** ~12k calls over the same object shapes and input sizes. A call with a different shape trains a different map and pollutes feedback.

**Prepare before forcing.** `%OptimizeFunctionOnNextCall` without `%PrepareFunctionForOptimization` first errors:

```text
Function ... should be prepared for optimization with %PrepareFunctionForOptimization before
%OptimizeFunctionOnNextCall / %OptimizeMaglevOnNextCall / %OptimizeOsr
```

**Never decode `%GetOptimizationStatus` from memory.** The integer is a bit set defined in V8's runtime source. In the original run, the old arm reported `41` and the new arm `131073`, and the difference was not self-explanatory. Use `--trace-opt` output as the authority for tiering; use the status integer only as a sanity check, and when it puzzles you, open the source or docs that define the bits instead of guessing. That is the moment to look it up, not hand-wave.

**One function per bytecode filter.** `--print-bytecode-filter='rerank|tokenize'` matches nothing. Loop:

```sh
for f in rerank tokenize mapAspects; do
  node --allow-natives-syntax --print-bytecode --print-bytecode-filter="$f" harness.cjs
done
```

## Backend and deopts

```sh
# Tier-up: every hot function should reach TURBOFAN_JS
node --allow-natives-syntax --trace-opt harness.cjs 2>&1 | grep -E "rerank|tokenize"

# Why optimized code was discarded
node --allow-natives-syntax --trace-deopt harness.cjs 2>&1 | grep -E "rerank|tokenize"
```

Real deopt lines from a run, and what they meant:

```text
[bailout (kind: deopt-eager, reason: wrong map): ... deoptimizing <JSFunction rerank> ... TURBOFAN_JS]
[bailout (kind: deopt-eager, reason: Insufficient type feedback for generic named access): ... <JSFunction escalate> ...]
```

- `wrong map` means an object's hidden class changed under the compiled code. When two copies of the same module were loaded in one process, objects from bundle A hit code trained on bundle B and the old arm deoptimized. That produced a fake 16x speedup until each arm was run in its own process.
- `Insufficient type feedback for generic named access` means `%OptimizeFunctionOnNextCall` fired before a property access was profiled. Add more warmup or `%PrepareFunctionForOptimization`; it is a harness bug, not a code bug.

## Reading bytecode without fear

Ignition is a register machine with an accumulator. Twenty-ish ops cover almost every function body:

| Op | Meaning |
| --- | --- |
| `Ldar` / `LdaZero` / `LdaConstant` / `LdaTheHole` | load into accumulator |
| `Star` / `StaCurrentContextSlot` | store from accumulator |
| `GetNamedProperty` / `SetNamedProperty` | property access, carries feedback slot |
| `CallProperty` / `CallUndefinedReceiver` | calls, carries feedback |
| `CreateClosure [.. <SharedFunctionInfo name>]` | function object allocated at runtime |
| `CreateFunctionContext` + `PushContext` | captured scope allocated at runtime |
| `CreateEmptyArrayLiteral` / `CreateObjectLiteral` | temporary container allocated at runtime |
| `JumpIfFalse` / `TestEqualStrict` / `JumpLoop` | control flow |
| `Add` / `Sub` / `Inc` / `Mul` / `Div` | arithmetic |
| `Return` | done |

Map the source to the dump: an arrow function inside a function becomes `CreateClosure`; if it captures locals, you also get `CreateFunctionContext` at the top of the enclosing function. An A/B pair from the run:

```text
rerank (before)  CreateFunctionContext ..., Bytecode length: 476
                 CreateClosure <SharedFunctionInfo compare>      <- 7 closures total
rerank (after)   CreateClosure 1                                 <- only the comparator
```

`CreateClosure` is the line to grep for. Everything else is context.

## When the dump or the reason makes no sense

Go to the source. Do not guess from memory.

- Opcodes: `v8/src/interpreter/bytecodes.h` (Chromium googlesource, `v8/v8` repo). Each op has its operand format and semantics.
- Runtime test functions (`%GetOptimizationStatus`, `%PrepareFunctionForOptimization`): `v8/src/runtime/runtime-test.cc`; the status bits are declared in the same tree.
- Tiering and Maglev/TurboFan behavior: V8 blog posts and `v8/src/compiler` for the pipeline stages.
- Flag meanings: `node --v8-options | grep <name>` prints each flag and default.

The point is not tourism. In the original run, the agent stopped guessing at a status integer, read what the value meant, switched to `--trace-opt` as the authority, and only then trusted the comparison. That is the habit this skill encodes: when the machine tells you something you do not understand, read the machine's own documentation or source, then come back and rerun.

## Timing without lying

- Check `/proc/loadavg` first. On a box at load ~4, report construction counts, not milliseconds.
- Dual-bundle A/B in one process is banned. Separate processes per arm.
- Escape analysis can remove micro-allocations entirely, so a tiny timing delta may be zero. Count `CreateClosure`/`CreateArrayLiteral` constructions instead of believing 0.5%.
- Always assert same-result equivalence on identical inputs in the harness before measuring anything.
