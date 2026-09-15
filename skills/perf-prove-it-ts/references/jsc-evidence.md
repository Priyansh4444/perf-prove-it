# JavaScriptCore evidence: tiers, shapes, and memory

For Bun and Safari. The V8 twin is `v8-evidence.md`. The ideas carry over; the names and numbers do not. JSC renames classes loudly and its defaults move, so version-stamp the engine before you quote it:

```sh
bun -e "console.log(process.versions.bun, process.versions.webkit)"
# process.versions.webkit is the WebKit/JSC commit; bun --revision is Bun's own
```

The WebKit bug template reports the Safari version's WebKit build; a WebKit checkout gives you `jsc` to reproduce option-level behavior. The names below match the WebKit tree these notes were written against. JSC renames classes without ceremony, so if one does not resolve on your build, search the tree instead of guessing from a blog post.

## The four tiers

| Tier | What it is | Where |
| --- | --- | --- |
| LLInt | portable hand-written assembly interpreter; all code starts here | `llint/LowLevelInterpreter64.asm` |
| Baseline JIT | template JIT, one machine stub per bytecode, ICs inline | `jit/JIT.cpp` |
| DFG | speculative SSA optimizer, profile-driven | `dfg/` |
| FTL | high-throughput tier on the B3 backend (LLVM is history) | `ftl/`, `b3/` |

Tier-up is counting, not time. The thresholds are real options with real defaults (`runtime/OptionsList.h`):

| Transition | Option | Default |
| --- | --- | --- |
| LLInt → Baseline | `thresholdForJITAfterWarmUp` | 500 |
| LLInt → Baseline, urgent | `thresholdForJITSoon` | 100 |
| Baseline → DFG | `thresholdForOptimizeAfterWarmUp` | 1000 |
| DFG → FTL | `thresholdForFTLOptimizeAfterWarmUp` | 64000 |
| recompile after OSR exit | `osrExitCountForReoptimization` / `...FromLoop` | 100 / 5 |

Defaults move between releases; confirm them in `runtime/OptionsList.h` on the build you run.

Function entries count 15 per call against the Baseline counter, loops count 1 (`executionCounterIncrementForEntry`, `executionCounterIncrementForLoop`), so a hot loop and a hot call site tier up on very different wall-clock schedules. The DFG threshold is scaled by a fitted bytecode-cost curve and by `1 << retryCount` after a failed recompilation (`bytecode/CodeBlock.cpp`).

Loops OSR at every boundary: LLInt loops enter Baseline on-stack (`_llint_loop_osr`, `llint/LLIntSlowPaths.cpp`), Baseline loops enter DFG/FTL through `operationOptimize` + `prepareOSREntry` (`jit/JITOperations.cpp`, `dfg/DFGOSREntry.cpp`), and DFG loops tier to FTL through `CheckTierUpInLoop` / `CheckTierUpAndOSREnter` (`dfg/DFGSpeculativeJIT64.cpp`). The gate options are `useOSREntryToDFG` / `useOSREntryToFTL`; there is no `useOSR` flag.

Traps: `thresholdForFTLOptimizeAfterWarmUp` moved 100000 → 60000 → 64000 across WebKit history, so a warm-up recipe from a blog is stale by default. `Options::jitPolicyScale` and `forceEagerCompilation` move every threshold at once. Quote the option values from the tree you measured, the way you would quote V8 flag defaults.

## Adding a property that was not there at initialization

This is the JSC answer to the classic hidden-class question, and it is the same shape as V8's with different names:

1. The fast put path misses and the transition table is consulted. An existing transition for the same property is reused (`Structure::addPropertyTransition`, `runtime/Structure.cpp`).
2. Otherwise a new Structure (hidden class) is created, the parent's `StructureTransitionTable` gains one entry, and the property gets the next `PropertyOffset`.
3. The old structure's transition watchpoint fires (`Structure::fireStructureTransitionWatchpoint`). Existing objects never change shape; only new objects created afterwards get the new structure.
4. Inline caches that cached the old shape learn the new case (up to 8 variants), fold to megamorphic, or reset to the slow path via `PropertyInlineCacheClearingWatchpoint::fireInternal` (`bytecode/PropertyInlineCacheClearingWatchpoint.cpp`).
5. DFG/FTL code holding an adaptive structure watchpoint re-arms if the condition is still watchable, otherwise jettisons the CodeBlock and recompiles with backoff (`dfg/DFGAdaptiveStructureWatchpoint.cpp`).
6. Past `s_maxTransitionLength = 128` properties (512 for `PutById` contexts, 4096 on remove/attribute change) the object converts to a dictionary: hashed lookup, no more transitions, and the fast path becomes `addOrReplacePropertyWithoutTransition` (`runtime/Structure.h`, `runtime/JSObjectInlines.h`).

The write is not the cost; the shape churn is. Declare every property in the constructor and keep one shape per logical type. If objects legitimately have open-ended keys, a `Map` is honest about it from the start.

## Shapes: Structure and the dictionary cliff

V8 calls it a Map; JSC calls it a Structure. Both are a shape identity for a set of properties, and both have a cliff where fast mode ends.

- Objects name their shape through a 4-byte `StructureID` rather than a full pointer; structures live in a dedicated heap (`runtime/StructureID.h`).
- The transition table starts as one slot and becomes a weak map; the key packs property uid, attributes, and transition kind into one word (`runtime/StructureTransitionTable.h`).
- Dictionary mode is sticky (`hasBeenDictionary`), so a converted object never returns to fast property mode.
- Object literals bulk-check the same budget before adding several properties at once (`runtime/JSObject.cpp`).

## The Butterfly

One pointer into the middle of one allocation. Named properties grow left; indexed payload grows right.

```text
[preCapacity][out-of-line property slots][IndexingHeader] <- butterfly -> [indexed 0, 1, 2 ...]
```

- The butterfly points at the first indexed slot; the `IndexingHeader` sits one slot before it, and out-of-line property slots live below that at negative indices. Property offset 64 is butterfly slot `-1` (`runtime/PropertyOffset.h`, `runtime/IndexingHeader.h`).
- `IndexingHeader` holds `publicLength` / `vectorLength` for arrays, or the typed-array buffer (`runtime/IndexingHeader.h`).
- Inline property slots live in the object cell, not the butterfly. `JSFinalObject` defaults to a 64-byte cell (6 inline slots) and can grow to 512 bytes (62 slots); `JSFinalObject.h` no longer exists, the class is in `runtime/JSObject.h`.
- When inline slots run out, out-of-line storage is allocated: initial capacity 4, doubling, rounded to a power of two (`runtime/Structure.h`).

Why it exists: one allocation can serve both named and indexed storage, growing in both directions, so a `push` or a new property does not need a second pointer or a second allocation for the common case.

## Inline caches and watchpoints

- A site caches up to `Options::maxAccessVariantListSize = 8` access cases before folding to megamorphic (`bytecode/InlineCacheCompiler.cpp`). There is no `maxPolymorphicAccessCases` option; docs citing one are stale.
- The megamorphic fallback caches are real hash tables (`runtime/MegamorphicCache.h`): load and store 2048 primary + 512 secondary, `has` 512/128, getter 256/64. A store entry records the old structure ID, the new structure ID, and the offset, so the shape transition itself is cached on the megamorphic path.
- ICs install structure-transition watchpoints when a case depends on a shape staying stable. Firing resets the stub to the slow path; DFG watchpoints either re-arm or jettison the code block.

## Tagged values and the cage

`JSValue` on 64-bit is NaN-boxed (`runtime/JSCJSValue.h`, `runtime/PureNaN.h`):

```text
Pointer { 0000:PPPP:PPPP:PPPP
         / 0002:****:****:****
Double  {         ...
         \ FFFC:****:****:****
Integer { FFFE:0000:IIII:IIII
```

- Doubles are stored as `bits + 2^49` (`DoubleEncodeOffset`, `JSValueDoubleEncodeOffsetBit = 49`), which keeps every encoded double in the `0x0002..0xFFFC` range; decode subtracts the offset. A raw double would alias the pointer tag.
- Top 16 bits all set (`0xFFFE...`) is the integer tag (`NumberTag`). `false` is `0x06`, `true` `0x07`, `undefined` `0x0a`, `null` `0x02`; bit 1 (`OtherTag`) separates these from real pointers.
- NaNs are canonicalized to `PNaN` on creation because an arbitrary NaN payload would collide with a tag.

GIGACage (`Source/bmalloc/bmalloc/Gigacage.h`) is address-space isolation, not tagging: one `Primitive` cage with a 64 GB budget on desktop and 16 GB on iOS and 32-bit. Accesses are masked to the cage base, and an out-of-bounds index lands in the cage or its protected runway instead of another heap. An older two-cage layout (primitive + JSValue) is history. Typed heaps are `IsoSubspace`: one GC subspace per cell type with its own block directory (`heap/IsoSubspace.h`); `heap/IsoHeap.h` no longer exists.

## Memory packing and JIT memory

- GC blocks are `max(16 KB, page)` (`heap/MarkedBlock.h`). Size classes step by 16 bytes below `preciseCutoff = 80`, then grow geometrically (`Options::sizeClassProgression = 1.4`); large cells below `preciseAllocationCutoff = 100000` bytes become `PreciseAllocation`s (`heap/MarkedSpace.*`, `runtime/OptionsList.h`).
- JIT code lives in one executable pool per process, refcounted per code block (`jit/ExecutableAllocator.cpp`). Fixed pool sizes: x86_64 1 GB, arm64 128 MB (512 MB with jump islands), other 32 MB. `Options::jitMemoryReservationSize` defaults to 0 and overrides the pool size.
- The pool is an address reservation committed as code is generated, so it is a ceiling, not resident memory. When the last reference to a code block drops, the pages are decommitted, and optionally zeroed (`zeroExecutableMemoryOnFree`).
- Disabling tiers is measurable: `useJIT=false` calls `disableAllJITOptions()`, so Baseline/DFG/FTL and the executable pool go away; `useDFGJIT` / `useFTLJIT` gate individual tiers.

## V8 vs JSC, side by side

| Thing | V8 | JavaScriptCore |
| --- | --- | --- |
| hidden class | Map | Structure (4-byte `StructureID` on 64-bit) |
| property storage | in-object slots + `PropertyArray` | inline slots + Butterfly (negative offsets) |
| inline slots | map-defined | 6 default, 62 max |
| IC | feedback vector + handler table | `PropertyInlineCache` + watchpoints |
| polymorphic limit | 10 maps (was 4; read the flag on your build) | 8 variants, then megamorphic |
| dictionary cliff | 1020 descriptors; 12 keyed-store soft limit | 128 adds / 512 `PutById` / 4096 removes |
| value tagging | Smi low bit; 32-bit compressed pointers, 4 GiB cage | NaN boxing with `2^49` double offset; 64 GB Primitive cage |
| tiers | Ignition, Sparkplug, Maglev, TurboFan | LLInt, Baseline, DFG, FTL |
| tier-up trigger | interrupt budget ∝ bytecode length | execution counters + profile coverage |
| top-tier backend | TurboFan / Turboshaft | B3 |

## Gotchas

- `StructureStubInfo` was renamed to `PropertyInlineCache`. `InlineCacheHandler` is a separate extracted class, not an alias, and `InlineCache.h` does not exist.
- Absent symbols that older material cites: `useOSR`, `osrThreshold`, `maxPolymorphicAccessCases`, `maxInlineStorageCapacity`, `heap/IsoHeap.h`, `heap/GIGACage.h`, `runtime/JSFinalObject.h`.
- `FTLLowerDFGToLLVM.cpp` is gone; the FTL lowers to B3 (`ftl/FTLLowerDFGToB3.cpp`).
- `sizeClassProgression` is an option (`runtime/OptionsList.h`), not a `MarkedSpace` constant.
- The dual GIGACage (primitive + JSValue) is older lore. One Primitive cage remains, 64 GB on desktop.

Sources: `github.com/WebKit/WebKit` under `Source/JavaScriptCore/` and `Source/bmalloc/bmalloc/`; the tier list is also stated verbatim in `webkit.org/blog/9329`, the FTL ladder in `webkit.org/blog/3362`, and the B3 handoff in `webkit.org/blog/5852`.
