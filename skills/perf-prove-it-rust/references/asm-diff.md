# asm diff: generate it, read it, close the gap

## Generating

```sh
# annotated source + asm interleaved, demangled (best default)
cargo asm --release --intel --rust crate::function

# no cargo-show-asm? emit everything
cargo rustc --release -- --emit asm
find target/release/deps -name '*.s' | head

# or disassemble the real binary with symbols
objdump -d --demangle --no-show-raw-insn target/release/binary | less

# isolated snippet, exact flags; use the machine's target
# https://rust.godbolt.org  -> rustc -C opt-level=3 -C target-cpu=native
```

Pin the exact build first: `[profile.release]` settings change codegen. Note `codegen-units`, `lto`, `panic`, `target-cpu`, and whether the crate was compiled as a dependency or locally. An asm diff across two different profiles is meaningless.

## Reading it

Twenty instructions carry almost every function: `mov` (loads/stores), `lea` (address math), `add/sub/imul`, `cmp/test` + `j*` (branches), `call`/`ret`, `push/pop` (save/restore), `vmov*/vadd*/vmul*/vfmadd*` (SIMD), `lock`-prefixed ops (atomics). Intel syntax: `dst, src`.

Read for the ideal, not line by line perfection:

1. Is the loop body recognizable as the algorithm? Contiguous `vmovupd`/`vfmadd` over a pointer that increments by the vector width is the good case.
2. How many branches per iteration? A bounds check plus a panic call is the classic extra.
3. Are the loads/stores aligned and contiguous, or strided with address math per element?
4. Did the expected helper call stay a call? Calls kill register allocation and vectorization.

## Common Rust codegen surprises

- **Iterator chains often compile to the same loop as an index loop.** Do not rewrite on faith; check both asm. The original `collect_visible_videos` fix worked because it removed whole algorithm stages, not because a `for` loop beats `.iter()`.
- **Bounds checks survive when the compiler cannot prove the index is in range.** `for x in &v[..]` is clean; `v[i]` inside another loop usually is not. `chunks_exact(8)` plus `zip` often gets both safety and vectorization. `get_unchecked` is a last resort with a written proof.
- **`Vec` growth in a hot loop** shows as `call ...::grow` / `realloc` between your arithmetic. `with_capacity` and reused buffers remove it.
- **Enum/`Option` returns** add a discriminant branch at every use site. If the hot path always expects one variant, restructure so the fast path has no variant test (split types, or hoist the match out of the loop).
- **Integer division** is a multiply-shift sequence plus edge fixups; hoist it or switch to shifts where valid.
- **Small functions may or may not inline.** Test with `#[inline(always)]`, and keep `#[inline(never)]` controls so you know what the call was costing.
- **`target-cpu=native`** enables AVX2/AVX-512/FMA and is not portable. If you use it, ship it as a separate build or use runtime feature detection (`is_x86_feature_detected!` + `#[target_feature]`) and say which one the benchmark used.
- **Thin LTO is not automatically faster.** In one workspace it increased both artifact size and clean build time (13.78 s to 44.20 s) with larger binaries, and was rejected. Measure it.
- **Do not benchmark `build.rs`-style noise or debug builds.** `--release`, and check that debug assertions are off.
- **PGO and BOLT** are real wins for branchy service code, but they are a build-pipeline change; propose them with numbers, do not smuggle them into a micro-optimization.

## The report shape

```text
function: collect_visible_videos
ideal:    one pass per page, early-exit distinct count, no full grouping until final page
asm:      grouping/sort calls reachable only from the final-page branch; probe is a borrowed HashSet loop
counts:   wall 166.96 -> 71.60 ms (2.33x, three same-process runs), exact final video-ID order asserted
machine:  <machine.sh header>
rejected: caching normalized strings (0.520 -> 0.540 ms/round); index-map grouping (0.681 ms)
```
