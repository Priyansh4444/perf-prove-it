# The work ledger: derive the floor from the code in front of you

Step 1 of the skill. A ledger row is one operation the function performs, priced per invocation and ranked by removability. Rows come from reading the body and opening every call it makes. The pattern table at the end is a lookup for shapes already understood, not a method.

## Pass A: open every call

For each call, answer: what does this line execute per outer invocation, and what does the callee do per invocation? A call site hides work in proportion to what the callee does, not to how short the line is. Platform calls count: `innerHTML`, `matchAll`, `JSON.parse`, `structuredClone`, `Intl`, `fetch`, `await`.

Study calibration, four real wins and the work each call site hid:

- `entityDecoder.innerHTML = value` inside `decodeEntities` hid a full HTML parse per segment, 547 parses for 304 calls. The source line is one assignment. Opening the callee did nothing; opening the platform did. Read the sink, not only the source.
- `text.matchAll(m.regex)` inside `scanEmotes` hid a global-regex clone, an iterator allocation, and a compile-cache lookup per matcher, 3 clones per message. An `exec` loop removed all three.
- `[...BASE_SORTS, ...ENGAGEMENT_SORTS].includes(x)` inside `isSearchSort` hid `CreateArrayFromIterable`, an iterator protocol walk, and a linear `includes` over 7 interned strings. The floor is one guard plus one dispatch: a `switch` on interned strings is a pointer compare.
- `bm25(tf, dfs.get(term) ?? 0, totalDocs, tokenCount, avgTokenCount)` per (candidate, term) hid `Math.log((totalDocs - df + 0.5)/(df + 0.5) + 1)` recomputed up to 600 times per query where 3 to 8 distinct terms exist. The callee is one line; the work is per invocation.

Rules that fall out:

- A call whose result depends on a subset of its arguments, with the rest loop-invariant, is doing repeat work. Split the invariant part from the varying part.
- A call that hides a parse, a clone, a compile, or a collection rebuild is heavyweight even when the callee is one line. Price the callee body, not the call site.
- Preserve arithmetic order when extracting or caching. A hoisted idf must multiply the same cached value the original computed, in the same order, or identity can drift.

## Pass B: guards and data shape

Every branch has a hot side. Price only the side the real inputs take, and record which side that is.

- Read the callers to learn the real shape mix. `highlightedParts` returns early when `highlight` is absent, so only the tagged-snippet path is hot. `decodeEntities` sees mostly strings with no `&`, so the no-entity path is the floor's hot side.
- A guard that filters work (return early, skip a parse) is the cheapest win in the function. A guard that only labels data is not.
- A guard can also be the identity boundary. The first `isSearchSort` rewrite returned `true` for base sorts where the original returned the truthy `engagement` argument (`1`, `"yes"`). The fix branches as `engagement || true` and `engagement || false` to keep `Object.is` identity on every runtime value, not just the typed domain.
- Probe guard sides with adversarial values before optimizing across them: `undefined`, `null`, `NaN`, `-0`, `""`, `0`, lone surrogates, prototype-key strings.
- Cost is shape-specific. The same values in a `Map` and in an indexable array are different work. Benchmark the shapes production sees and say when only one shape was tested.

## Pass C: invariants

Three levels, checked in order:

1. Per element, invariant across elements: compute before the loop. `fitBonus(xq, c)` re-evaluated `xq`-derived clauses (media filter, intent, `phrases.length`, `should.length`) per candidate. Hoist those, inline the rest.
2. Per call, invariant at module load: static vocabularies, compiled matchers, `Intl` formatters, regex literals. Parse once, and disclose the cold-start and memory price.
3. Module-level mutable state: a shared regex or cache carries `lastIndex` or lifetime semantics. The scan rewrite resets `lastIndex` and is safe only because the function is synchronous and no caller leaves a non-zero `lastIndex`. State the invariant that makes the hoist safe, not just the hoist.

Preallocation trade, measured on Node 26/V8 14.6: `new Array(n)` filled with doubles is `HOLEY_DOUBLE_ELEMENTS` and allocates a second backing store on the Smi to Double transition; `Float64Array` is packed and transition-free; `Array.from({length:n})` costs about 6 microseconds per 200-element call; `arr.length = n` pays the same transition and is chosen only when a lint rule bans `new Array(n)`. Pick per row, stamp the build, and disclose which.

## Pass D: data structures as work

A data structure choice is a work choice. Read the access pattern and count it per call.

- `byId: Map<string, Candidate>` built only to fetch `createdAt`: one `set` per candidate and two `get` calls per comparison inside `sort`, so O(n log n) lookups for a value already in hand. Carry a parallel array and compare by index.
- Dedup via `array.includes` inside a loop is O(n^2) membership. A `Set` plus one output array is one pass.
- Repeated `map` chains over the same collection are one fused loop when the passes share an input and the intermediate is never read.
- When values are internal numbers and indexing is the pattern, typed arrays win. When membership is over a fixed constant set, a `switch` on interned strings wins. When ordering is the output, compare indices, not objects.

## Probe what reading cannot price

Counts, not timers. Discovery probes never appear in the timing harness.

- Sink counter: wrap the platform setter (`HTMLTextAreaElement.prototype.innerHTML`, `document.createElement`, a network client) and count invocations per outer call.
- Callee counter: wrap the imported function and record calls per outer call plus the number of distinct argument values it sees. Wrapping can block inlining; discovery only.
- Allocation evidence: census for static `Create` sites (Step 4), `--heap-prof` object counts for dynamic truth. A no-GC `heapUsed` delta is churn, not retained.
- Guard counter: run separate corpora per shape and count hot-side hits.
- Iterator and compile sites: bytecode shows `CreateArrayFromIterable`, `GetIterator`, `CreateRegExpLiteral`, `CreateClosure` at the offset of the source expression.

## Identity on the reachable domain

Identity is a claim about the inputs the callers can produce, not about the typed signature. Do this before editing, because it bounds what the optimization must preserve.

1. List every caller of the function. Derive the domain: value ranges, uniqueness invariants, sizes, object shapes.
2. List adversarial edges inside the domain: duplicates, empty, single, NaN, `-0`, Infinity, overlong, lone surrogates, prototype keys, non-boolean truthy values.
3. Note edges outside the domain and why they are unreachable. The `rerank` rewrite was identical on 3764 unique-id cases and diverged on duplicate `tweetId`s; the only caller builds candidates from Map keys, so duplicates cannot occur. Both halves are the claim.
4. Differential fuzz: extract both arms mechanically, run each in its own process, compare recursively with `Object.is` so NaN and `-0` cannot hide. Include the real corpus, the adversarial edges, and randomized cases.
5. Write the claim: "identical on <domain>; diverges on <edge>; unreachable because <caller invariant>. <n> checks, <m> mismatches." Never write "bit-identical" without the domain.

Calibration from the study, where reports outran the code:

- `rerank`: "bit-identical" was true only on unique ids. Duplicate ids change dedup keys, winner, and order.
- `isSearchSort`: the first fuzz caught 6 mismatches on truthy non-boolean `engagement`.
- `decodeEntities`: lone surrogates diverge between jsdom (throws) and Chromium (preserves). The fast path matched Chromium, the production engine.
- `scanEmotes`: the reported heap "+0.28 MB" contradicted the worker's own log (`+2.63 MB`). Churn was real; retained was about zero in both arms.
- `rerank` bytecode: the quoted line at offset 299 was the `for` iterator `next()`, not the removed `fitBonus` call. Tie every line to the source expression it compiles, and compare by pasted source excerpt, never by offset across arms.

## Patterns with measured costs

Patterns, not an order. Apply one only when Step 1 found the matching shape, and predict its count change first.

| gap | change | measured cost or trap |
| --- | --- | --- |
| per-record closure (`.some`, `.every`, `.map`, comparator) | module-level loop or hoisted function | bytecode grows: `rerank` 476 to 1856 bytes, cold-tier cost only |
| repeated pass over the same data | fuse into one loop | intermediates and the second traversal disappear |
| spread into Set union | one Set plus one output array | per-call array and iterator |
| per-call default or predicate | hoist to module scope | none; keep a pure helper exported if tests read it |
| static lookup built per call | build once at module load | serverless and edge pay it per cold start; weigh and disclose |
| numeric scratch | `arr.length = n` then fill, or `Float64Array` | `new Array(n)` filled with doubles is `HOLEY_DOUBLE_ELEMENTS` and pays a second backing store; `Array.from({length:n})` costs about 6 us per 200-element call; `arr.length = n` pays the same transition and is chosen only when a lint rule bans `new Array(n)`; `Float64Array` is packed with no transition |
| linear membership over interned strings | `switch` or `Set` | switch beat object lookup by about 4x and `Set` by 1.3 ns on the second call site; object lookup was worst |
| pure callee recomputed on fewer inputs | cache by the input it depends on | duplicates a formula; name the invariant that keeps the cache honest |
| `matchAll` clone per call | shared `exec` loop with explicit `lastIndex` reset | shared mutable `lastIndex`: a hand-written non-global regex or a zero-length `u` match can hang |
| unconditional parse or decode | early return for an input class that cannot need it | fallback can be slower when the unknown arrives late: 1.9x at K=100 unknown entities; name the reachable input mix |
