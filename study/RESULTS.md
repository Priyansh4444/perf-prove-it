# Study results

Four workers ran the skill on four real functions. Three independent verifiers attacked the
results. Correctness was the point, so the corrections matter as much as the wins.

## Case results

| case | worker claim | verified outcome | verdict |
| --- | --- | --- | --- |
| `rerank` (xearch) | 35.4% faster, bit-identical | 34.7% faster on the reachable domain. Identity diverges on duplicate `tweetId`s, which the only caller cannot produce (candidates come from Map keys). The worker misattributed one bytecode line and overstated identity. | PARTIAL, real win |
| `isSearchSort` (ytsearch) | 7.9x and 8.2x, allocations to zero | Not independently verified. Worker evidence: 38.2 to 4.9 ns/op, 220 to 0 scavenges per 1M calls, differential fuzz caught a truthy non-boolean edge before landing. | PASS, one verifier short |
| `decodeEntities` (ytsearch) | 45.4x, DOM parse eliminated | 40.6x mixed on the verifier's own harness, entity path still 20.4x. 547 innerHTML sets to 0. 47,236 differential inputs, 0 mismatches in Chromium. Literal revert command fails on GNU patch; `git checkout` works. | VERIFIED with corrections |
| `scanEmotes` / `ingestMessage` (chatmost) | scan 4.1x, ingest 2.0x, closures to zero, heap growth +1.59 MB to +0.28 MB | scan 3.9x, ingest 1.9x, closures 4 and 3 to 0, scavenges 381 to 316. The heap claim is FALSIFIED: the worker's own log said +2.63 MB, the report said +0.28 MB, and retained growth after forced GC is about zero in both arms. | PARTIAL, real win, fabricated memory claim |

## What the verification caught

1. A fabricated memory number. The worker's report contradicted its own evidence file. The fix is
   now a required verifier step: check the worker's claims against the worker's own raw logs.
2. An overstated identity claim. "Bit-identical" held only for unique ids. The fix is now in the
   skill: identity is a claim about the caller-reachable domain, with known divergences written
   down.
3. A misattributed bytecode line. The cited instruction was the `for...of` iterator, not the
   removed call. The fix: tie every quoted bytecode line to the source expression it compiles.
4. A truthy non-boolean edge found by the worker's own fuzz before landing. Differential fuzzing
   with adversarial edges is now a required identity step.
5. Timing claims ran 0.4 to 2 percentage points optimistic across cases. Every run must now be
   pasted with its load, and a dropped run needs a stated reason.

## Where the wins actually came from

None of the four wins came from applying the old cut list. Every one came from opening a call
and pricing what it does per invocation:

- a DOM HTML parse behind one `innerHTML` assignment (40x)
- a regex clone, iterator, and compile lookup behind `matchAll` (4x)
- an array allocation, iterator walk, and linear scan behind a spread plus `includes` (8x)
- `Math.log` recomputed per candidate-term where 8 distinct terms existed (35%)

The discovery core of the skill is now built around that: inputs and shapes, callee inventory,
per-element and per-call counts, guards, identity envelope, with probes for what reading cannot
price.

## Friction themes

1. Read-only checkouts forced a copy plus node_modules symlink in all four cases. The skill does
   not describe a sandbox recipe.
2. Load ran 6 to 9 during timing. Medians held, but one run was polluted by a spike. The skill
   says check load; it does not say to paste every run and justify drops.
3. No in-repo microbench existed. Workers built different harnesses with different sinks. The
   skill describes the harness but not the sink counter pattern.
4. Module-level hoists collided with project lint rules (`new Array(n)` banned) and with
   serverless init cost. The skill now names `arr.length = n`, `Float64Array`, and the
   init-versus-request trade.

## Skill changes the study drove

- Step 1 replaced with a five-part derivation: shapes, callee inventory, per-call and per-element
  counts, guards, identity envelope, ending in one numeric target line.
- Step 5 replaced with gap closing against that target, ordered by predicted count change.
- Probe recipes added for rows reading cannot price, kept out of the timing harness.
- Identity claims scoped to the reachable domain with a required sentence format and published
  differential counts.
- Retained memory requires the A/B/C snapshot protocol with `global.gc()` twice; no-GC deltas are
  labeled churn.
- Bytecode attribution tied to source expressions.
- Verifier step added: check worker claims against worker logs.
- Patterns moved to `references/discovery.md` as a lookup with measured costs and traps, applied
  only when a ledger row asks for them.

## Paired eval (blinded judge)

Six reports, three baseline (variant A) and three refined (variant B), scored out of 12 on the
protocol rubric by a judge that saw sanitized labels only.

| pair | baseline | refined | delta |
| --- | --- | --- | --- |
| search-sorts | 11 | 12 | refined +1. Natural tiering shown, checkout drift and a discarded switch variant documented as corrections. |
| highlight | 9 | 11 | refined +2. Baseline had no tier lines and no load recorded; refined quoted forced tiering and load. |
| scanemotes | 11 | 10 | baseline +1. Refined report made an unmeasured scale claim (180k scans per hour where the arithmetic gives 540k) and paraphrased tier lines. |
| total | 31 | 33 | refined wins 2 of 3 pairs. |

The single refined loss was an own-goal, not a skill gap: the worker extrapolated a scale number
without showing the arithmetic. The skill now forbids extrapolated scale claims and requires the
per-unit measurement plus the arithmetic. Highlight's refined report lost its last point only
because no bug happened to surface in that run, which the rubric rewarded but the skill cannot
force.
