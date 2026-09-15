# Static-audit evaluator: Solid packed subscription edges

Evaluator: [solidjs/solid#3358](https://github.com/solidjs/solid/pull/3358), base `main` versus head `perf/packed-subscription-edges`, checked 2026-09-12.

## Expected process

The analyzer should find the removable representation cost without claiming the code is hot or predicting a percentage speedup.

Intent recovered from the PR and code: each subscription edge side must retain two logical values, the counterparty and reciprocal slot, with index alignment preserved through duplicate reads, swap-removal, updates, and disposal.

Current base work at `signal.ts:1325`:

```text
E appended edges × 2 push calls
2 logical values per edge side
2 array identities and owner properties
runtime-defined capacity growth for each array
```

Candidate floor under the packed representation:

```text
E appended edges × 1 two-argument push call
2 logical values per edge side (unchanged)
1 array identity and owner property
runtime-defined capacity growth, not assumed to halve
```

## Static result

Command:

```sh
node skills/perf-prove-it-ts/scripts/static-audit.mjs --json /tmp/perf-prove-solid-eval/before.ts
node skills/perf-prove-it-ts/scripts/static-audit.mjs --json /tmp/perf-prove-solid-eval/after.ts
```

The base emitted `parallel-array-growth` for adjacent `Listener.sources.push(this)` and `Listener.sourceSlots!.push(sSlot)`. The PR head emitted no `parallel-array-growth` finding. The rule requested proof of alignment/lifecycle invariants plus push, storage, and capacity measurements; it made no timing claim.

## Runtime evidence belongs after the prediction

The PR supplies the next rungs independently: repository tests and differential lifecycle cases for behavior, bytecode showing two property pushes becoming one `CallProperty2`, and isolated benchmark runs. Those results judge whether the predicted mechanism mattered; they do not retroactively justify the prediction.

This evaluator is reduced to a before/packed fixture in `scripts/static-audit.test.mjs`, so the discovery and disappearance of the finding are checked on every tool test.
