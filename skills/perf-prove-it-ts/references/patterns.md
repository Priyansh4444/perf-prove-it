# Patterns that survived a real bytecode census

Source: a V8 run over the ranking engine of a TypeScript search service (Convex backend). Six hot functions, all goldens green, 103 tests passing after the change. Numbers come from Ignition bytecode, not timers.

## The census that started it

```text
function    length  closures  contexts  emptyArr  objLit
rerank         476         7         1         1       1
tokenize      1635         4         1         1       1
mapAspects     560         4         1         0       0
planL0         127         1         1         0       1
escalate       569         5         1         0       0
uniqueTerms    314         0         0         1       0
```

After the change:

```text
function    closures  contexts
rerank             1         1     (the comparator, once)
tokenize           0         0
mapAspects         0         0
planL0             0         0
uniqueTerms        0         0
escalate           0         0
```

`--trace-opt` showed Maglev then TurboFan on every function, no deopts, before and after.

## 1. Fuse the passes, delete the per-candidate array

Before: `map` built one object per candidate, then three `Math.max(...rows.map(pick))` calls each built a throwaway array.

```ts
const raw = candidates.map((c) => {
  let rel = 0;
  for (const [term, tf] of c.tf) rel += bm25(tf, stats.dfs.get(term) ?? 0, stats.totalDocs, c.tokenCount, stats.avgTokenCount);
  const eng = Math.log1p(WEIGHTS.w_like * c.likeCount + /* ... */);
  return { rel, eng, auth: Math.max(0, c.authorAuthority) };
});
const z = {
  rel: maxSignal(raw, (r) => r.rel),
  eng: maxSignal(raw, (r) => r.eng),
  auth: maxSignal(raw, (r) => r.auth),
};
```

After: one loop, values and maxima together, no intermediate objects.

```ts
const rels: number[] = new Array(candidates.length);
const engs: number[] = new Array(candidates.length);
const auths: number[] = new Array(candidates.length);
let zRel = 1e-9, zEng = 1e-9, zAuth = 1e-9;
for (let i = 0; i < candidates.length; i++) {
  const c = candidates[i]!;
  let rel = 0;
  for (const [term, tf] of c.tf) rel += bm25(tf, stats.dfs.get(term) ?? 0, stats.totalDocs, c.tokenCount, stats.avgTokenCount);
  const eng = Math.log1p(WEIGHTS.w_like * c.likeCount + /* ... */);
  const auth = Math.max(0, c.authorAuthority);
  rels[i] = rel; engs[i] = eng; auths[i] = auth;
  if (rel > zRel) zRel = rel;
  if (eng > zEng) zEng = eng;
  if (auth > zAuth) zAuth = auth;
}
```

Per call: 7 closures and a 200-object `raw` array plus four throwaway arrays became 1 closure and 3 output arrays. The three maxima are free because the loop already walked every candidate.

## 2. A dedupe helper, used for two different things

Old call site that only wanted the count:

```ts
uniqueTerms(...).length
```

The helper built a deduped array, then the caller threw it away. A `Set` answers the question directly:

```ts
const protectedTerms = new Set<Term>();
for (const t of xq.aspects) protectedTerms.add(t);
for (const t of phraseTerms(xq)) protectedTerms.add(t);
// later: if (xq.must.includes(gate.term) && !protectedTerms.has(gate.term))
```

Membership becomes `has` instead of `includes`, and there is no union array. Keep a named `uniqueTerms` where an actual array is the output.

## 3. Hoist per-call closures and predicates

`tokenize` allocated a `push` emitter, `replace` callbacks, and character predicates on every call. Module scope holds them once:

```ts
function pushToken(tokens: Token[], value: string): void { /* ... */ }
const isCjkChar = (ch: string): boolean => /* ... */;
const isEmojiChar = (ch: string): boolean => /* ... */;
```

One subtlety: the URL strip was two `replace` passes, each allocating. A single scan that keeps the URL only when a length check says it matters removed a closure and a pass.

## 4. Parse static data once, not per query

Aspects are fixed vocabulary. The lexicon entries were parsed inside the per-request path and rebuilt on every call. Move the parse to module load:

```ts
const ASPECT_ENTRIES: Array<[Term, { strong: string[]; weak: string[] }]> = buildAspectEntries();
```

Bytecode shows the difference as `CreateClosure`/`CreateObjectLiteral` disappearing from the request-time function entirely.

## What the timings actually said

On a box at load ~4, timing was noise. The honest parts that survived:

- `escalate` 387 ns/call new vs 443 ns/call old (isolated leg, separate processes).
- `planL0` at parity, 748 vs 732 ns, inside the noise band. Do not claim that.
- The first interleaved old-vs-new run reported a 16x win for the new code. `--trace-deopt` showed `wrong map` bailouts on the old arm: loading both bundles in one process made them deoptimize each other. The 16x was thrown out.

Report example: "closures per call 7 to 1, contexts 1 to 1, 200-object intermediate array gone; timing directionally better but within noise on this machine."

## Leak audit result

One repo-wide pass over `addEventListener|setInterval|setTimeout` and module-level caches:

- Dashboard buttons attach listeners once at init, re-render uses `innerHTML`. Clean.
- A per-call sleep closure in the collector was hoisted.
- Per-request caches are request-scoped and die with the response. Clean.

State one of these verdicts per site, not "memory looks fine".
