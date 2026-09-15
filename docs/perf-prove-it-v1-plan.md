# perf-prove-it v1 plan

Turn the four perf-prove-it-ts scripts into one published TypeScript CLI, `perf-prove-it`, and make the skill thin. `npx perf-prove-it` audits. `npx perf-prove-it install` drops the skill for the agent. The engine parses with `oxc-parser`, lowers files to facts, and runs rules as pure folds under Effect v4. PRs in order. P1 engine and audit. P2 remaining commands. P3 install and the thin skill. P4 build and publish. P5 the self-audit report.

## How to read this

One box is one unit of work. Every box names the evidence that checks it. Check a box only when its evidence exists, a file, a log line, a screenshot, a test run, or a SHA. The body is a how-to. The appendices explain and record.

The program runs `workflow/playbooks/multi-phase-plan.md` for authoring and `workflow/playbooks/autonomous-run.md` for execution.

Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

**Skip, with reason.** The plan checker in `workflow/scripts/check-plan.mjs` requires ten screenshot lanes on `grok-4.6-fast-xhigh`, a specific model, and a review video per PR. This program is a CLI and a library, not a UI. Its live surface is the terminal, and the real proof is a differential run against the legacy scanner. The live blocks below use ten concrete CLI scenarios each, run at the PR head, with captured stdout instead of screenshots, and the review gate applies only to PRs that change the skill text a human reads.

## Program checklist

### Arm the program

- [ ] State the plan and the arena record to the operator, then stop. Start on the explicit go.
- [ ] Re-read `docs/perf-prove-it-v1-arena.md` and the legacy tool before each phase.
- [ ] Keep the legacy scripts runnable until P1 lands its parity suite. Delete them only in P4.

### Spawn owners

- [ ] One writer per worktree. P1 has three disjoint writers, `src/scan/**`, `src/cli.mts` plus `src/format/**`, and `test/**`.
- [ ] P2 depends on P1. P3 depends on P1. P4 depends on P1 and P2.
- [ ] P5 depends on P1 and reads the new `src/**`.

### PR mechanics, for every PR

- [ ] Branch from `feat/perf-perf-it-cli`, which stacks on `feat/static-perf-doctor`.
- [ ] Run `npm run typecheck`, `npm test`, and `npm run build` before the push.
- [ ] No force-push. No dependency bumps outside the plan.

### Verdict and merge, for every PR

- [ ] At the head SHA, run the unit block, the live block, and the perf block.
- [ ] An independent verifier agent, different model family, reproduces the live block and the perf block from the tarball.
- [ ] Merge only when every box passes and the parity diff is clean or allowlisted with a reason.

### Boot recipe, for every live scenario

- [ ] `npm run build`.
- [ ] `npm pack` and install the tarball into a clean temporary directory.
- [ ] Run the scenario with `npx perf-prove-it` from that directory.
- [ ] Capture stdout and the exit code to `/tmp/ppit-live/<scenario>.txt`.

## Port the engine and the audit command (P1)

**Depends on.** None.

**Files.**

- [ ] Create `src/core/types.mts`, `src/core/errors.mts`.
- [ ] Create `src/scan/parse.mts`, `src/scan/walk.mts`, `src/scan/extract.mts`, `src/scan/facts.mts`, `src/scan/rank.mts`, `src/scan/ledger.mts`, `src/scan/rules/*.mts` (15 files).
- [ ] Create `src/index.mts`, `src/cli.mts`, `src/format/*.mts`.
- [ ] Create `test/parity.test.mts`, `test/rules.test.mts`.
- [ ] Edit `package.json`, `tsconfig.json`, add `tsdown.config.mts`.

**Build.**

- [ ] One oxc pass per file lowers the AST to `FileFacts`, normalizing optional chains, non-null assertions, parenthesized expressions, and `this` receivers.
- [ ] All 15 rules run as pure folds over facts, with the derived-context grafts from the arena record.
- [ ] `scan()` in `src/index.mts` is pure and is the parity seam.
- [ ] The CLI exposes `perf-prove-it` with `audit` as the root command.

**You see.**

- [ ] `npx perf-prove-it --json <fixture>` prints `claim`, `summary`, `findings` with the same shape as the legacy tool.
- [ ] The legacy 79 cases pass against the new `scan()`.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `test/parity.test.mts` runs the preserved legacy suite at `test/legacy/static-audit.test.mjs` against the new CLI. Run `npm test`.
- [ ] `test/rules.test.mts` feeds hand-written `FileFacts` fixtures to each rule without parsing. Run `npm test`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten scenarios at the PR head, per the boot recipe, stdout captured instead of screenshots.

- [ ] Lane 1. Audit the six-file cross-file fixture. Save `cross-file.txt`. Pass when `computeScores` reports 7 call sites and rank plus 2.
- [ ] Lane 2. Audit a file with a regex literal containing `target(`. Save `regex-phantom.txt`. Pass when `target` has 0 call sites.
- [ ] Lane 3. Audit `for await` with `JSON.parse`. Save `for-await.txt`. Pass when `loop-parse` names the enclosing function.
- [ ] Lane 4. Audit a file with a line comment between chained calls. Save `comment-chain.txt`. Pass when `chained-collection-passes` fires.
- [ ] Lane 5. Audit a syntactically broken file. Save `broken.txt`. Pass when exit is 0 and `parseErrors` is greater than 0.
- [ ] Lane 6. Audit with `--json` and with `--stream`. Save `formats.txt`. Pass when both parse and the finding ids are equal.
- [ ] Lane 7. Dismiss an id, rescan. Save `ledger.txt`. Pass when the id is absent and the ledger path is printed.
- [ ] Lane 8. Audit with `--concurrency=1` and with the default. Save `concurrency.txt`. Pass when the finding sets are identical.
- [ ] Lane 9. Audit a `.tsx` file with JSX text containing code-like strings. Save `jsx.txt`. Pass when no phantom finding appears.
- [ ] Lane 10. Audit a TypeScript file with generics, overloads, and typed arrows. Save `typed.txt`. Pass when every finding names the correct function.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Wall time and peak RSS to scan the vendored `t3code/packages` tree.
- [ ] Probe. `npm run build`, then time `node dist/cli.mjs --json .repos/t3code/packages` at trunk and at the head, interleaved, five runs each.
- [ ] Baseline. Record the pre-CLI baseline once, before the legacy scripts were deleted, and keep it in the perf notes.
- [ ] Rule. Fail if the new median is more than twice the legacy median, or if any file's findings disappear without an allowlist entry.

**Review gate.** None. P1 is not review-gated.

**Merge.**

- [ ] Independent verifier reproduces lanes 1 to 10 and the perf rule from the packed tarball.
- [ ] Squash-merge P1 into `feat/perf-prove-it-cli`.

## Port the remaining commands (P2)

**Depends on.** P1.

**Files.**

- [ ] Create `src/census/{parse,classes}.mts`, `src/compiled/inventory.mts`, `src/tier/probe.mts`, `src/machine/fingerprint.mts`, `src/commands/*.mts`.
- [ ] Edit `src/cli.mts`.
- [ ] Port `test/census.test.mts`, `test/compiled-audit.test.mts`.

**Build.**

- [ ] `census`, `compiled`, `tier`, and `machine` run with the legacy flags and exit codes.
- [ ] `tier` re-executes under `node --allow-natives-syntax` when needed.

**You see.**

- [ ] `npx perf-prove-it census <dump>` prints the same table as the legacy script.
- [ ] `npx perf-prove-it compiled <dir>` prints one NDJSON line per emitted `.js`.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Port the 40 census checks and the compiled-audit check. Run `npm test`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten scenarios at the PR head, per the boot recipe, stdout captured instead of screenshots.

- [ ] Lane 1. Census a saved bytecode dump. Save `census-dump.txt`. Pass when the closure column matches the legacy output.
- [ ] Lane 2. Census `--classes`. Save `census-classes.txt`. Pass when all seven cost classes print.
- [ ] Lane 3. Census `--diff`. Save `census-diff.txt`. Pass when per-function deltas print and JSON mode matches.
- [ ] Lane 4. Census with no arguments, dump on stdin. Save `census-stdin.txt`. Pass when the table prints.
- [ ] Lane 5. Census a malformed dump. Save `census-bad.txt`. Pass when exit is 1 and no crash.
- [ ] Lane 6. Compiled inventory of a fixture dist. Save `compiled.txt`. Pass when bytes and sha256 match a hand value.
- [ ] Lane 7. Tier probe with natives on. Save `tier.txt`. Pass when one JSON line prints with the tier booleans.
- [ ] Lane 8. Tier probe with natives off. Save `tier-off.txt`. Pass when it exits non-zero and does not crash.
- [ ] Lane 9. Machine fingerprint. Save `machine.txt`. Pass when node, v8, and arch are present.
- [ ] Lane 10. Every command with `--json`. Save `commands-json.txt`. Pass when each output parses.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Census parse time on a 5 MB bytecode dump.
- [ ] Probe. Interleave legacy and new, five runs each.
- [ ] Baseline. Record the legacy median first.
- [ ] Rule. Fail if the new median is more than 1.5 times the legacy median.

**Review gate.** None. P2 is not review-gated.

**Merge.**

- [ ] Independent verifier reproduces all ten lanes.
- [ ] Squash-merge P2.

## Thin the skill and add install (P3)

**Depends on.** P1.

**Files.**

- [ ] Create `src/commands/install.mts`, `src/install/skills.mts`.
- [ ] Edit `skills/perf-prove-it-ts/SKILL.md`, `skills/perf-prove-it-rust/SKILL.md`, `skills/perf-prove-it-dom/SKILL.md`, and every reference that names a script path.
- [ ] Delete `skills/perf-prove-it-ts/scripts/` in P4 after parity.

**Build.**

- [ ] `SKILL.md` becomes a router that runs the CLI and reads its output. No script paths remain in the skill.
- [ ] `install` copies the bundled skill into the agent skill directories, or prints it with `--print`.

**You see.**

- [ ] `npx perf-prove-it install --print` prints the skill bundle and a manifest.
- [ ] `rg "scripts/" skills/` returns no hits.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] A test asserts every reference named in each `SKILL.md` exists in the package, and that no skill file mentions a `.mjs` script. Run `npm test`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten scenarios at the PR head, per the boot recipe, stdout captured instead of screenshots.

- [ ] Lane 1. `install --print`. Save `install-print.txt`. Pass when the manifest lists every skill file.
- [ ] Lane 2. `install --dir=<tmp>`. Save `install-dir.txt`. Pass when the files land and the tree matches the manifest.
- [ ] Lane 3. `install` with a second run. Save `install-idempotent.txt`. Pass when no file is rewritten needlessly.
- [ ] Lane 4. A fresh agent checkout that reads only `SKILL.md` and runs the CLI. Save `thin-skill.txt`. Pass when it produces a JSON report.
- [ ] Lane 5. `SKILL.md` grep for script paths. Save `no-scripts.txt`. Pass when zero hits.
- [ ] Lane 6. `--agent=opencode`. Save `agent-opencode.txt`. Pass when the directory is the opencode skill dir.
- [ ] Lane 7. `--agent=claude`. Save `agent-claude.txt`. Pass when the directory is the claude skill dir.
- [ ] Lane 8. Install with an unknown agent. Save `agent-unknown.txt`. Pass when exit is 2 and the message lists choices.
- [ ] Lane 9. The reference docs still resolve after the rewrite. Save `refs.txt`. Pass when every relative link resolves.
- [ ] Lane 10. `npx perf-prove-it audit` immediately after `install`. Save `audit-after-install.txt`. Pass when the audit runs and the skill exists.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Skill token size as characters across `skills/**`.
- [ ] Probe. `wc -c` over the skill tree before and after.
- [ ] Baseline. Record the pre-rewrite total first.
- [ ] Rule. Fail if the total grows; the point is a thinner skill.

**Review gate.** The operator reviews the new `SKILL.md` text before merge.

- [ ] Post the final `SKILL.md` and the install manifest in chat.
- [ ] Wait for the operator's click.

**Merge.**

- [ ] Independent verifier reproduces all ten lanes and the token rule.
- [ ] Squash-merge P3.

## Build and publish (P4)

**Depends on.** P1 and P2.

**Files.**

- [ ] Edit `package.json`, `tsdown.config.mts`, add `.github/workflows/ci.yml`, `LICENSE` check, `CHANGELOG.md`.
- [ ] Delete `skills/perf-prove-it-ts/scripts/` and the old root test command.

**Build.**

- [ ] `npm run build` emits `dist/cli.mjs`, `dist/index.mjs`, and declaration files, with `oxc-parser` external.
- [ ] `npm pack` produces a tarball with `dist`, `skills`, `README.md`, `LICENSE`, and no study or evidence files.

**You see.**

- [ ] `npm pack` then `npx perf-prove-it --version` from a clean directory prints the version.
- [ ] The tarball contains no `.mjs` file under `skills/`.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] CI runs typecheck, test, build, pack, and a tarball smoke run. Run `npm run ci`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten scenarios at the PR head, per the boot recipe, stdout captured instead of screenshots.

- [ ] Lane 1. Fresh `npm i <tarball>` and run audit. Save `tarball-audit.txt`. Pass when a report prints.
- [ ] Lane 2. Fresh install on a machine without `typescript`. Save `no-parser.txt`. Pass when the audit still runs on oxc alone.
- [ ] Lane 3. `npm pack --dry-run`. Save `pack-list.txt`. Pass when only intended paths are listed.
- [ ] Lane 4. Check the tarball for study paths. Save `pack-clean.txt`. Pass when zero hits.
- [ ] Lane 5. `npx perf-prove-it --help`. Save `help.txt`. Pass when all six commands are listed.
- [ ] Lane 6. Legacy script deleted, parity suite still green. Save `post-delete.txt`. Pass when `npm test` is green.
- [ ] Lane 7. Node below engines range. Save `engines.txt`. Pass when npm refuses cleanly.
- [ ] Lane 8. Install on Linux x64. Save `platform-linux.txt`. Pass when the native binding resolves.
- [ ] Lane 9. Install with the WASM fallback forced. Save `platform-wasm.txt`. Pass when parsing still works.
- [ ] Lane 10. `perf-prove-it audit --fail-on=review` on a clean fixture. Save `fail-on.txt`. Pass when exit is 0.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Cold `npx` time from install to first report.
- [ ] Probe. Time five cold runs in a fresh cache directory.
- [ ] Baseline. Record the legacy `npx`-less `node static-audit.mjs` time first.
- [ ] Rule. Fail if cold start exceeds ten seconds on the vendor tree.

**Review gate.** None. P4 is not review-gated.

**Merge.**

- [ ] Independent verifier reproduces all ten lanes from the registry tarball.
- [ ] Squash-merge P4.

## Self-audit and report (P5)

**Depends on.** P1.

**Files.**

- [ ] Create `study/perf-prove-it-self-audit/README.md`, `REPORT.md`, and the raw tool output under `study/perf-prove-it-self-audit/raw/`.

**Build.**

- [ ] Run the ported skill on the new `src/**` and follow its loop for the top candidates.
- [ ] Write the report with the floor, the measured mechanism, the impact, and the costs.

**You see.**

- [ ] `REPORT.md` states the candidates found, which were real, and which were zero.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Any change the report recommends lands with its own test in `test/`. Run `npm test`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten scenarios at the PR head, per the boot recipe, stdout captured instead of screenshots.

- [ ] Lane 1. Run the audit on `src/scan`. Save `scan-audit.txt`. Pass when the output is a ranked queue.
- [ ] Lane 2. Bytecode census of one hot function. Save `self-census.txt`. Pass when closures are counted.
- [ ] Lane 3. Tier check on the parse loop. Save `self-tier.txt`. Pass when the tier booleans print.
- [ ] Lane 4. A/B a candidate from the report. Save `self-ab.txt`. Pass when the delta beats the A/A band.
- [ ] Lane 5. Re-run the report's commands. Save `reproduce.txt`. Pass when every number matches.
- [ ] Lane 6. Confirm the report's zero results. Save `zeros.txt`. Pass when the report says zero where the tool said zero.
- [ ] Lane 7. Confirm no predicted win was left unmeasured. Save `unmeasured.txt`. Pass when the list is empty or explicitly deferred.
- [ ] Lane 8. Cross-check one finding against a manual count. Save `manual.txt`. Pass when the counts agree.
- [ ] Lane 9. `REPORT.md` links resolve. Save `links.txt`. Pass when zero broken links.
- [ ] Lane 10. Re-run after the recommended change. Save `after.txt`. Pass when the change's test is green.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. The report's headline delta for the one accepted candidate.
- [ ] Probe. Isolated A/B in separate processes, at least five runs per arm.
- [ ] Baseline. Record the A/A band first.
- [ ] Rule. Fail if any published number sits inside the A/A band.

**Review gate.** The operator reviews the report before merge.

- [ ] Post the report's summary and the raw evidence paths in chat.
- [ ] Wait for the operator's click.

**Merge.**

- [ ] Independent verifier reproduces the headline number.
- [ ] Squash-merge P5.

## Close the program

- [ ] Every box above is checked with its evidence.
- [ ] Reply to the operator with the command inventory, the parity result, the perf numbers, and the report path.

## Appendix A. Prototype evidence

The Effect v4 and oxc-parser surfaces were verified before the plan. `effect@4.0.0-rc.115` with `effect/unstable/cli` runs a two-subcommand CLI with `Command.run` and bounded `Effect.forEach`. `oxc-parser@0.150.0` parses `.ts/.tsx/.js/.jsx/.mts/.cts`, returns comments as offsets, returns syntax errors instead of throwing, and its raw-transfer path is about 1.8 times faster than TypeScript 5.9 `createSourceFile`. Evidence paths are recorded in the arena record.

## Appendix B. Alternatives rejected

Rules over retained ASTs, because raw-transfer ASTs pin transferred buffers and serialize poorly. A SQLite fact store, because the data is read once and the joins are span and name predicates. Tree-sitter or ast-grep queries, because they add a second parser and untyped query strings. A separate immutable model layer over `FileFacts`, because it duplicates the cacheable model.

## Appendix C. Risks

Behavioral drift, watched by P1's parity suite and the perf rule's allowlist. Cache and ledger correctness, watched by P1's cache key and the ledger lanes. Effect v4 RC churn, watched by confining the unstable imports to the CLI module and pinning the version. Native binding availability, watched by P4's platform lanes.

## Appendix D. Links and reading list

`docs/perf-prove-it-v1-arena.md` for the design record. The oxc-parser and Effect v4 declaration files for the API surface. The legacy `static-audit.mjs` and its test for the behavior contract.
