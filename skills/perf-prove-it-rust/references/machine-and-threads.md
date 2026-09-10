# Machine and threads: measure on the box you own

Every number in a report is a property of the program plus the machine. Record the machine with `scripts/machine.sh` first, then design threads and memory around it.

## Read the machine header

- **Physical cores vs logical CPUs.** `nproc` counts logical CPUs. For compute-bound work, one thread per physical core is the default; SMT helps memory-bound code and can hurt AVX-heavy code. Compute physical cores with `lscpu -p=CPU,CORE | grep -v '^#' | cut -d, -f2 | sort -u | wc -l`.
- **Hybrid parts (P-cores + E-cores).** On Intel Arrow Lake / Alder Lake class CPUs, `lscpu` lists one "core" entry per CPU even when the topology differs. Check `/sys/devices/system/cpu/cpu*/topology/core_type` (or `coretemp`/`turbostat`) before assuming all cores are equal. A range like `taskset -c 0-5` can pin to P-cores only.
- **Cache sizes matter more than clock.** L1d per core, L2 per cluster, L3 shared. A working set that fits L2 behaves nothing like one that streams from DRAM. `lscpu` prints all three; write them into the report when the change is memory-relevant.
- **Governor and boost.** `powersave` vs `performance`, and boost on/off, swing results more than most code changes. `scripts/machine.sh` prints both. If the box is on `powersave`, either benchmark both or say so.
- **Load.** `/proc/loadavg` first. Load 4 on 16 CPUs means every wall-clock number has a wind in it.

## Counter commands

```sh
# pinned to physical cores 0-5, count what the CPU did
taskset -c 0-5 perf stat -e instructions,cycles,branch-misses,cache-misses,LLC-load-misses \
  ./target/release/bench

# where cache lines are contended across threads
perf c2c record ./target/release/bench
perf c2c report
```

How to read them:

- **Instructions retired** is deterministic enough for A/B on the same binary and machine. This is the Rust equivalent of the bytecode census: count first, time second.
- **IPC (instructions/cycles)** dropping after a change means the change hurt memory or branches even if instructions went down.
- **Cache-miss rate and LLC misses** tell you whether a layout change moved the working set.
- **Branch misses** explain divergent-loop costs; branchless code or sorting can help.

## Thread scaling protocol

1. Write the serial version and measure it. One thread is the baseline, not an embarrassment.
2. Parallelize with a unit of work that is large enough to amortize scheduling (thousands of elements per task, not one).
3. Measure T1, T2, T4, ... up to physical cores, same binary, pinned ranges, 5 runs each.
4. Report speedup and efficiency:

```text
threads  time(ms)  speedup  efficiency
1        412       1.00x    -
2        214       1.93x    96%
4        110       3.75x    94%
8        62        6.65x    83%
```

Efficiency under ~60% means the bottleneck is serial work, memory bandwidth, or contention. Find which before adding threads. If doubling threads does nothing, suspect the memory system, not the scheduler.

## False sharing

Per-thread counters that land on the same 64-byte cache line make the cores fight over the line. The code looks parallel and runs like a mutex.

```rust
#[repr(align(64))]
struct Padded<T>(T);

struct Counters {
    per_thread: Vec<Padded<u64>>,   // one cache line each
}
```

Diagnose with `perf c2c report` (look for high `HITM` on a line shared by several CPUs). Fix by padding, by accumulating in a local variable and merging at the end, or by sharding the output so each thread owns a distinct region.

## NUMA

`ls /sys/devices/system/node/` and `numactl -H`. If there is one node, ignore all of this. With more:

- First touch decides placement: initialize memory on the node that will use it.
- Per-node pools or `numactl --membind=N` for allocations.
- Working within one node beats perfect scheduling on a shared dataset.

## Reporting

Template (fill with measured values, never sample values):

```text
machine: <model>, <physical> physical / <logical> logical CPUs, <L3> L3, governor <governor>, load <load>
toolchain: rustc <version>, target <triple>
method: taskset -c <cores>, 5 runs, min/median; instructions via perf stat
before: <time> median, <instructions> instructions
after:  <time> median, <instructions> instructions
threads: <N>/<physical>, efficiency <pct>
rejected: <experiment> (<why>, with numbers)
```
