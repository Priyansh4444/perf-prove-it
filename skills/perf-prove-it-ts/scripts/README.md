# Tool and rule index

Everything in this directory is dependency-free and runs on the repository under audit. Tests run with `node <script>.test.mjs`.

## Tools

| script | purpose | evidence produced |
| --- | --- | --- |
| `static-audit.mjs` | Source scanner for whole-repository triage. Excludes tests, fixtures, `node_modules`, `dist`, `.repos`, generated output; labels benchmark files separately. | Ranked findings with a stable id, confidence, symbolic work model, candidate floor, next proof, and the enclosing locally-defined function's static call-site count. |
| `census.mjs` | Parses `--print-bytecode` dumps (stdin or files). Baseline table counts closure/context/array/object/regexp construction sites. `--classes` adds opcode cost classes, protocol-op counts, and loop-attributed allocation sites. `--diff before.txt after.txt` prints per-function opcode-class deltas. | Static construction sites, cost-class composition, per-iteration allocation candidates. Not dynamic counts. |
| `compiled-audit.mjs` | Inventory of emitted bundles and source maps; never executes application code. | Emitted paths, function sizes, source-map presence. |
| `tier-check.mjs` | Warms a hot function and reports whether Maglev/TurboFan are reachable on this build. | Machine/build tier capability before any tier claim. |

```sh
node static-audit.mjs --stream src
node static-audit.mjs --include-advisory --max=100 --json src
node static-audit.mjs --dismiss=<id> --reason='<short reason>'   # ledger expires after 24h
node --print-bytecode --print-bytecode-filter='fnName' harness.cjs | node census.mjs --classes
node census.mjs --diff before.txt after.txt
node --allow-natives-syntax tier-check.mjs
```

The scanner keeps a 24h ledger under the OS temp directory (`--cleanup-ledger` removes it). Set `PERF_PROVE_IT_SESSION_ID` when the host has a stable run id.

Ranking counts static call sites of the enclosing function when that function is defined in the scanned roots (`name(` and `this.name(`; not imports or other receivers), lifting a finding by +1/+2/+3 at 1–2/3–9/10+ sites. It is reachability for review order, not runtime frequency: `useState()` and similar framework calls are never counted.

## Scanner rules

Confidence `review` marks rules wired into the default ranked queue. Everything else is advisory and needs `--include-advisory`.

| kind | score | confidence | work model (current -> candidate floor) |
| --- | ---: | --- | --- |
| `parallel-array-growth` | 9 | review | `E x 2 push calls` -> `E x 1 push` holding two logical values |
| `loop-await` | 8 | review | `N` awaited boundaries -> intent-dependent ordering/batching |
| `loop-parse` | 8 | review | `N x P` parse/clone -> one per distinct representation |
| `quadratic-spread-growth` | 8 | review | `1+2+...+(N-1)` copies -> `N` appends with amortized growth |
| `nested-loop` | 7 | advisory | `N x M` visits -> required pairs only |
| `repeated-linear-membership` | 7 | review | `O(N x M)` scans -> `O(N+M)` after one Set |
| `comparator-repeated-work` | 7 | review | `O(N log N)` comparisons, each repeating P parses/searches -> P work per element, then key comparisons |
| `loop-callback` | 6 | advisory | `N x M` callback visits -> required visits without an intermediate |
| `full-sort-then-take` | 6 | advisory | full `O(N log N)` order for 1 or k elements -> linear extremum or partial selection |
| `spread-call` | 5 | advisory | `N` expanded arguments -> direct scan where the API permits |
| `chained-collection-passes` | 5 | advisory | `N x P` passes plus `P-1` intermediates -> one fused pass |
| `existential-filter` | 5 | advisory | `N` predicate calls plus an array to decide existence -> early-exit `some`/`find` |
| `sort-callback` | 4 | advisory | `O(N log N)` comparator calls -> intent-dependent |
| `reactive-allocation` | 4 | review | `R` executions x traversal -> one per changed output |
| `per-call-static-construction` | 3 | advisory | `C` calls x 1 construction -> one per distinct configuration |

Rules and their exact work models live in `static-audit.mjs`; the confidence sets are `actionableKinds` (review) and the remainder (advisory). Keep this table in sync when adding a rule.
