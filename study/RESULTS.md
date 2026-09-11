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

## DOM study (perf-prove-it-dom)

Three DOM workers on real apps, three adversarial verifiers, plus three reviewers that attacked the skill's own Blink and CDP claims before any case ran.

| case | worker claim | verified outcome | verdict |
| --- | --- | --- | --- |
| `renderChatEmotes` (chatmost) | Nodes 3126 to 1050, UpdateLayoutTree 6.61 to 4.03 ms, Paint 11.24 to 4.34 ms | Nodes and LayoutObjects reproduced exactly every round; after-arm UpdateLayoutTree matches (4.20 ms), before was inflated by load; Paint reduction held in 8 of 9 paired rounds but the after-arm headline was not reproduced on a quiet box. Parity exact: text, ARIA, scroll, row rects, 6,224-case differential with 0 mismatches. | VERIFIED with corrections |
| transcript expansion (ytsearch) | `content-visibility` on 100 rows: LayoutObjects 2197 to 449, LayoutDuration 27.4 to 9.9 ms, Paint 12.8 to 4.6 ms | Counters exact in dev and prod; durations load-dependent (prod: 12.63 to 4.62 ms layout). Deferred cost found: the first scroll re-pays 18 layouts and roughly 46 ms, so the full-scroll total is not the mount win. The worker's offscreen parity screenshots were viewport-clipped and invalid. | VERIFIED with corrections; the win is mount-scoped |
| ReplyTree (postwork) | LayoutDuration 94.6 to 40.6 ms, RecalcStyleDuration 44.7 to 18.4 ms, TaskDuration 242.6 to 147.9 ms | Medians sat inside the verifier's round spread; trace args matched exactly (dirtyObjects 6808 to 485+398). The AA delta was understated (1.57%, not 0.44%); the first scroll re-pays 73 ms of layout; mount plus scroll-to-bottom task is about 20% worse than before. Focus and click into contained replies still work; the a11y tree is windowed at all times. | VERIFIED with corrections |

### What the DOM verification caught

1. Deferred work. Both containment cases looked better at mount and paid the layout back on the first revealing scroll. The skill now requires full-cycle measurement (mount plus the first revealing scroll) and `patterns.md` carries the measured re-payment.
2. Overstated headline numbers. The chatmost Paint after-arm and the postwork AA percentage were not reproducible. Pixel claims now need the method (fixed clip, forced render, bounding box, max delta), not a headline percentage.
3. Invalid parity evidence. The ytsearch offscreen parity captures were viewport-clipped strips. Parity for contained content needs force-rendered full-page captures.
4. Stale evidence. The chatmost `evidence/raw/` traces came from a pilot run and did not match the worker's final results; the verifier rebuilt from HEAD and reproduced the counters exactly.

### Corrections from the adversarial reviewers

- `pipeline.md`: `SelectorMatcher` is actually `SelectorChecker` plus `ElementRuleCollector`; `PaintInvalidator` invalidates display-item clients and the items regenerate during Paint; `getComputedStyle` forces layout only for layout-dependent properties.
- `measurement.md`: the tracing stream arrives on `tracingComplete`, not the `Tracing.end` response; a no-frame-advance `LayoutCount` of zero is a race; Chromium 152 headless emits `ThreadControllerImpl::RunTask` and `Layerize` and no `CompositeLayers`; `ScriptDuration` excludes work inside CDP evaluate; the longtask culprit is `entry.name` with `attribution[].containerType`; `durationThreshold` is silently ignored without `type: "event"`; durations are not deterministic, so compare medians.
- `patterns.md`: the batch-insert buy is scoped to read-interleaved loops; the `innerText` cost is the getter plus its newline-to-`<br>` output change; class and inline-style writes both coalesce to one recalculation, so the buy is script volume; compositor-only skipping holds for CSS animations, not JavaScript per-frame writes; containment carries a11y, raster, and deferred-cost traps.

The DOM skill ships with runnable primitive proofs in `study/dom-primitives/` and the three case harnesses in `study/harness/`.

## Browser tier follow-up (perf-prove-it-ts)

A gap question ("does the TS skill know how its win behaves in the browser?") produced a verified recipe and three skill changes:

- `study/browser-tier/` proves that in-page tier checks need `--js-flags=--allow-natives-syntax` (without it the page throws) and that `%ActiveTierIsMaglev` / `%ActiveTierIsTurbofan` work; 50,000 warmup calls on Chromium 152 reached Maglev, not TurboFan.
- `SKILL.md` Step 2 now carries the browser harness and says a Node tier line is not a browser tier line.
- Step 1 gained an avoidance question before the ledger, and the report now requires the target-runtime tier plus a plain-language explanation of the optimizer ladder (Ignition, Sparkplug, Maglev, TurboFan, and deopt as a reset).

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
