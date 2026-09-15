# Arena synthesis: perf-prove-it v1 engine

Arena for the engine architecture of the `perf-prove-it` v1 CLI. Three candidates were framed with distinct directions. Two dropped out with no output. One survived and was cross-judged.

## Base

Candidate 3, **facts database, two phases**: parse once with `oxc-parser`, lower the AST to flat JSON-serializable `FileFacts` in a parallel phase, then run rules as pure folds over the facts, with a cross-file rank join. Kept because the phase split is sound, the parser and Effect v4 surfaces were verified against real declaration files, and the defects found are in extraction and predicates, not in the architecture.

## Dropouts

- Candidate 1 (visitor-first, immutable `CodeModel`): no output.
- Candidate 2 (rule-visitor hybrid, oxlint-style): no output.

Both directions were still evaluated by the judge as ideas to graft, which is why they appear below.

## Grafts applied to the base

1. **AST normalization and `Visitor` dispatch** (from candidate 1). Unwrap `ChainExpression`, `TSNonNullExpression`, `ParenthesizedExpression`, and record `ThisExpression` receivers explicitly. The judge falsified the base sketch on `this.render()` (receiver became `null`) and on optional chains. Accepted.
2. **Derived-context facts** (from candidate 2). Add `ReductionFact { accumulator }`, restrict loop-reference facts to call arguments, and record mutations on every enclosing loop rather than the innermost. The judge showed the flat table could not represent `quadratic-spread-growth`'s accumulator match or `repeated-linear-membership`'s argument-only rule. Accepted.
3. **Pure `scan()` entry point plus the ported 79-case suite** (from candidate 1). The legacy tests call `scan()` directly; parity is only provable through the same seam. Accepted.
4. **Rejected:** a separate immutable `CodeModel` layered over `FileFacts` (duplicates the cacheable model), and running rule logic inside the traversal (destroys rule independence and the cache).

## Falsifications that became requirements

- `parallel-array-growth` needs statement adjacency and a full receiver path (`owner.sources` vs `owner.sourceSlots!`), not a single member name.
- `chained-collection-passes` must count contiguous `filter`/`map`/`flatMap` only; `sort`/`slice`/`at` belong to other rules.
- Chain dedup by span containment over-reaches; independent chains inside a callback must still fire.
- `freeLoopRefs` must scan call arguments only, never the receiver or property name.
- `enclosingFunction` must climb to the nearest named function, not stop at an anonymous arrow.
- Ledger ids must use cwd-relative paths to stay compatible with the legacy tool.
- The cache key must include the parser version and an extractor build hash, and write temp-plus-rename.

## Risks and mitigations

1. **Behavioral drift.** Port all 79 legacy cases into a parity suite, then run a differential old-versus-new scan on a fixed corpus and fail on any new-only finding unless it is allowlisted with a reason.
2. **Cache and ledger correctness.** Key on content hash plus schema version plus parser version plus extractor hash; decode-validate; temp-plus-rename; prune on TTL; relative-path ids.
3. **Effect v4 RC and packaging.** Pin `effect@4.0.0-rc.115`; keep `effect/unstable/cli` imports confined to the CLI module; ship `src/index.mts`; CI runs build, pack, and `npx` from the tarball.

## Verification owed

A packed-tarball run on broken input, optional chains, `this` receivers, and forced copy path; a strict typecheck against the real Effect v4 RC with no v3 imports; parity over all 79 cases; deterministic ids; a 16th dummy rule proving extensibility; and a facts JSON round-trip deep-equal proving no AST or buffer retention.

Full judgment: `/tmp/arena-ppit/candidate-3/architecture.md` (source design). This file is the graft record.
