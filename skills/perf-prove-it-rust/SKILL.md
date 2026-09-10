---
name: perf-prove-it-rust
description: "Make Rust fast on the machine it will actually run on, with proof instead of profiles. Use when asked to optimize Rust, parallelize it, cut allocations or cache misses, or verify what the compiler emitted: ideal instruction-sequence design, asm diffs (cargo asm / objdump / Godbolt), deterministic instruction counts (iai-callgrind), perf counters, bounds-check and allocation removal, SIMD/target features, thread scaling, false sharing, and NUMA. Triggers: optimize this Rust, make this loop faster, check the assembly, asm diff, why is this slow, benchmark this, criterion, parallelize this, rayon, cache misses, false sharing, thread scaling."
license: MIT
---

# Perf prove it: Rust on your machine

A good optimizer does not stare at profiles. They work out the shortest instruction sequence the problem allows, write it, then check the machine's real instructions against that target until the gap is closed or explained.

Rust makes this easy: the assembly is one command away. Twenty-ish instructions cover most function bodies. Stop being scared of it.

## The general method

This is the skill behind the skill, and it works the same in every language:

1. Establish the floor. For the function, write down the minimum the machine must do: bytes moved, loads, stores, arithmetic, branches per element, allocations per call. That number is the target, not a guess.
2. Make the source read like those operations. If the code hides work (a clone, an allocation, an iterator chain with side effects), the machine still pays for it, and you cannot see it without the assembly.
3. Get the compiler's real output and diff it against the floor. Every extra instruction gets an explanation or gets removed.
4. Close what the design allows, document the rest. Some distance from the floor is physics (cache, memory bandwidth, latency), some is the compiler, some is structure. Naming which is which is part of the job.
5. Treat measurement as a habit, not a phase. Keep a count visible while you work. Optimizing once a quarter from memory is a different, weaker skill.

When reading the machine, three questions explain most results:

- Data movement. Does the working set fit L1/L2/L3 or stream from DRAM? Are the accesses contiguous?
- Instruction flow. How many branches per element, are they predictable, does the hot loop stay in the instruction cache?
- Execution throughput. Which units run the operations, and is the bottleneck arithmetic, load/store, or branches?

## Step 0: profile the machine before the code

Performance claims are machine claims. Run `scripts/machine.sh` (or the same commands) and keep the output for the final report:

- CPU model, physical cores vs logical CPUs, P-core/E-core split on hybrid parts
- L1/L2/L3 sizes, NUMA nodes
- governor/boost state, current load (`/proc/loadavg`)
- toolchain (`rustc -Vv`), target triple, available counters (`perf stat true`)

A benchmark without this header is not reproducible.

## Step 1: write the ideal

For one function at a time, state the target in instructions and memory traffic per element:

- Loads, stores, arithmetic, compares, branches per element
- Data layout: struct of arrays or array of structs? Does the access pattern match the layout?
- How many passes over the data? Can they fuse?
- Allocations per call: which are outputs, which are avoidable (reuse buffers, `with_capacity`, arenas)?
- Can the branch disappear (sort, bucket, branchless select, lookup table)?
- Is it vectorizable in principle (`std::arch`, `std::simd`, autovectorization)?
- Where does the parallelism live? What fraction is serial (Amdahl), and what is the unit of work per thread?

Example: "sum of squares over `&[f64]`: 1 load, 1 fmul, 1 fadd, 1 compare, 1 branch per element; 4 lanes with AVX2; no allocation." That is the thing you verify against, not `perf top`.

## Step 2: generate the real assembly

```sh
cargo install cargo-show-asm      # if missing
cargo asm --release --intel --rust crate_name::function   # annotated, demangled
```

No cargo-show-asm? Emit asm directly or disassemble the binary:

```sh
cargo rustc --release -- --emit asm
objdump -d --demangle target/release/binary | less
```

Godbolt (rust.godbolt.org) for isolated snippets, with `-C opt-level=3` and the same target as the machine.

Diff against the ideal. What to look for:

- Bounds checks: panic-branch blocks around indexing (`cmp`/`ja` leading to a panic call). Fix by iterating slices, `chunks_exact`, `zip`, `get(..)` with a single checked split, or `unsafe` only with a proof written down.
- Calls where you expected inline: small helpers behind a module boundary may not inline. `#[inline]`, `#[inline(always)]` for tiny hot helpers, or verify with `#[inline(never)]` as a control.
- Scalar loops where vectorization was expected: check aliasing, iterator shapes, and target features (`-C target-cpu=native` is a different binary for a different machine; say so).
- Repeated loads/stores, spills, `Option`/enum branches that block the fast path, integer division (compiles to a long multiply sequence), locks or atomics in a loop.

## Step 3: count, then time

Deterministic first:

```sh
# instruction counts and cache behavior; CI-grade, wall-clock free
cargo install iai-callgrind-runner   # plus the iai-callgrind dev-dependency
cargo bench --bench <name>           # iai-callgrind reports instructions, cache misses
```

Wall clock second, and only pinned:

```sh
taskset -c 2-9 perf stat -e instructions,cycles,branch-misses,cache-misses,LLC-load-misses \
  ./target/release/bench 2>&1
```

- Repeat at least 5 times, report min and median, not one run.
- Criterion (or Divan) for in-repo benches, with `std::hint::black_box` so the optimizer cannot delete the work.
- `perf record`/flamegraphs are allowed only to confirm which function is hot after you have thought about the target. They are not the target.
- Absolute time is machine state. Instructions retired and cache misses move far less between runs. Prefer them for A/B.

## Step 4: threads and caches on this machine

Parallelism is a design decision, not a `rayon::par_iter()` decoration.

- Thread count: physical cores, not logical CPUs. `lscpu -p=CPU,CORE,SOCKET`; on hybrid Intel parts check whether E-cores help your workload (often they do for memory-bound, they do not for AVX-512-bound).
- Scaling proof: measure 1 thread and N threads of the same binary. Report speedup and efficiency (`speedup/N`). If efficiency drops below ~60%, find the serial fraction or the contention before adding more threads.
- False sharing: per-thread counters adjacent in memory destroy throughput. Pad to 64 bytes or use per-thread local accumulation merged at the end. Diagnostic: `perf c2c record` then `perf c2c report`.
- Work units: one task per chunk of thousands of elements, not per element. Tune chunk size by measuring, not by intuition. Work stealing (rayon) helps when chunk times vary.
- NUMA: allocate and first-touch on the node that uses the data (`numactl --membind`, per-node pools). One node in `/sys/devices/system/node/` means stop thinking about it.
- Data movement: keep hot loops descending over contiguous memory; avoid `Vec` growth inside the loop; reuse output buffers across calls; prefer `sort_unstable` when stability is not required.

## Step 5: prove it

- Same outputs on same inputs (unit tests, property tests, golden files). An optimization that changes behavior is a rewrite.
- Before/after numbers from the same machine in the same session, with the machine header above.
- Rejected experiments listed with their numbers. "Tried X, it was slower because Y" is a valid and useful result.
- No `unsafe` for speed unless the invariant is written next to the block and tested.
- Leave the remaining spikes documented in code comments or a perf record file, on purpose, for the next engineer.

## Work in verified units

Never optimize a codebase in one diff. Optimize one unit at a time: one function, one loop, one pass. Each unit gets a sandbox, a behavior lock, and its own evidence.

1. Slice. Pick one hot function. If it is too tangled to sandbox in isolation, that tangle is the first finding.
2. Sandbox it. Put the unit in a bench or a scratch binary with a shared input generator. Keep the old and new versions as separate functions in separate binaries when codegen or cache state matters, and never let a neighboring test contaminate the A/B.
3. Write the ideal sibling. In the same sandbox, write a small standalone function that does the job with the fewest operations. It is the reference you compare both the old and the new code against. Designing the sibling is usually where the real insight lands.
4. Lock behavior first. Capture golden outputs for the unit, or property-test it, before editing anything. After every change the sandbox must produce identical outputs on identical inputs, and the repo tests must stay green. Same results, same ordering, same errors, same wire shape.
5. Verify incrementally. One change, one evidence run, one ledger row: function, before and after counts, behavior check, verdict. Do not stack three changes and then try to explain the result.
6. Fan out with subagents. For a codebase, one subagent per unit. Each subagent gets the function and its callers, the sandbox contract (inputs, invariants, edge cases), and must return: ideal op count, real assembly, the gap, a patch, and the pasted evidence. A subagent that cannot show the evidence returns "needs review", not "done".
7. Add a verifier. One subagent produces the patch with evidence. A second subagent reruns the sandbox, the counters, and the full test suite to confirm the claimed numbers and the identical behavior. The verifier does not edit code.
8. Integrate in order. Land verified units one at a time, rerun the full suite after each, so any regression points at exactly one unit.

## Non-negotiables

- No benchmark on an unpinned, loaded machine presented as truth. Print the load.
- No "faster" verdict without either instruction counts or an asm diff pasted in.
- No profile-driven local minimum presented as the optimum when the ideal was never written down.

## References

- `references/asm-diff.md`: commands, annotated asm reading, common Rust codegen surprises.
- `references/machine-and-threads.md`: machine census, thread scaling protocol, false sharing, counters.
- `scripts/machine.sh`: one-shot machine header for benchmark reports.
