# Study protocol

Purpose: test whether the `perf-prove-it-ts` skill makes agents derive the smallest steps for a
specific function on the spot, produce correct evidence, measure honest impact, disclose
trade-offs, and expose where the skill itself fails. Correctness and impact outrank everything
else. The study also feeds the skill's refinement.

## Cases

Four real functions, one worker each, organic prompts with no mention of a study. Workers could
not modify the user's checkouts; each worked under `/tmp/swarm-study/<case>/` with the repo
symlinked read-only.

| case | repo | function | workload |
| --- | --- | --- | --- |
| rerank-cal | xearch | `rerank`, convex/engine/rank.ts | once per query, up to 200 candidates, BM25 plus engagement, authority, recency, feedback |
| search-sorts | ytsearch | `isSearchSort`, `isAvailableSearchSort`, src/search-sorts.ts | route and URL state parse on every search page load |
| highlight | ytsearch | `highlightedParts`, `partsFromTaggedSnippet`, `decodeEntities`, src/utils.ts | every result title and transcript fragment per render |
| scanemotes | chatmost | `scanEmotes`, `ingestMessage`, web/src/lib/chatIngest.ts | every chat message, regex-heavy, high message rate |

## Verification

Three independent verifiers, one per case except search-sorts, with no edits to any checkout.
Each rebuilt from source, hashed the patched files, reran the repo tests, reran identity checks
with their own generators, reran timing in separate processes, checked the worker's claims
against the worker's own raw logs, and tried to falsify the result with the classic traps:
stale bundle, wrong arm, profiler attached, warmup asymmetry, load spikes, untested edges.

## Rubric (was judge-only during the run)

1. Floor derivation: a per-element or per-call minimal step target derived from the actual code,
   including hidden callee work, guards, and shapes. A quoted checklist does not pass.
2. Evidence correctness: reproducible census numbers, tier lines with forced versus natural
   distinction, exact test command with result, separate-process medians with load, allocation
   claims labeled static or dynamic.
3. Impact honesty: measured delta or stated parity or loss. Losing cuts rejected. No unmeasured
   win.
4. Trade-off and revert: bytecode bytes, source delta, module state, cold-start change, revert
   path.
5. Teaching: pasted changed line, plain meaning, what it bought.
6. Friction: where the skill was ambiguous, wrong, or missing, with the fallback used.

Scoring per criterion: 0 missing, 1 partial, 2 complete.

## Artifacts

`study/reports/` holds the worker and verifier reports as raw evidence.
`study/RESULTS.md` holds the synthesis and the skill changes the study drove.
