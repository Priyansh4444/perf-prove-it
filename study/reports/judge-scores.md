# Judge study — report scores

Rubric (0 = missing, 1 = partial, 2 = complete): **1** floor derivation, **2** evidence correctness, **3** impact honesty, **4** trade-off and revert, **5** teaching, **6** friction and correction. Total out of 12.

| Report | 1 Floor | 2 Evidence | 3 Impact | 4 Trade-off | 5 Teaching | 6 Friction | **Total** | One-line justification |
|---|---|---|---|---|---|---|---|---|
| report-1.md | 2 | 1 | 2 | 1 | 2 | 1 | **9** | Floor is derived from the real call path with measured DOM-parse counts (547→0) and a losing regex-hoist candidate is rejected, but there are no tier lines and no load recorded, module-state/init cost is unaddressed, and no bug was found or fixed. |
| report-2.md | 2 | 2 | 2 | 2 | 2 | 2 | **12** | Complete across the rubric: per-call array/scan floor from the code, natural tier lines, scavenge counts plus load recorded, module-eval init cost, and a naive-switch candidate caught (17,691 mismatches) and corrected, with current-HEAD near-parity disclosed. |
| report-3.md | 2 | 1 | 1 | 2 | 2 | 2 | **10** | Strong trie floor, exhaustive equivalence proof, and two self-found bugs fixed, but load is not recorded and tier lines are paraphrased, and its "180,000 scans/hour" scale claim contradicts its own 3-matcher description (should be 540,000). |
| report-4.md | 2 | 1 | 2 | 2 | 2 | 2 | **11** | Pinned 11-process medians, bytecode/frame deltas, full four-arm comparison, and a fuzz-found truthy-`engagement` bug fixed; loses a point because load is not recorded and tier lines do not state forced versus natural tiering. |
| report-5.md | 2 | 2 | 2 | 2 | 2 | 1 | **11** | Broadest evidence (jsdom + Chromium, ~40k equivalence cases, load recorded, explicitly forced TurboFan tiering, full suite/tsc/lint), but no bug was found or fixed and the "only allocation removed" claim is bytecode-inferred without a static/dynamic label. |
| report-6.md | 2 | 2 | 2 | 2 | 2 | 1 | **11** | Allocation-by-allocation floor, closure census (3/4→0), digest identity in separate processes, and honest load-spike handling; the gap is a friction section that reports no bug and no wrong step, only setup fixes. |

## Strongest

1. **report-2.md (12)** — the only report complete on every criterion. What separates it: criterion 2 (tier lines show natural `reason: hot and stable` tiering, timing medians come from separate processes with load 6.8–13.5 recorded, scavenge counts are reproducible) and criterion 6 (the checkout drift and the discarded switch variant are both documented as corrections, not just obstacles).
2. **report-4.md (11)** — second on the strength of criterion 6: its first fuzz run found six real mismatches and the fix is shown. It ties reports 5 and 6 on total; it wins the tiebreak because 5 and 6 have no found-and-fixed bug, while report 4 also quantifies the full arm comparison (switch/Set/Map/object) and labels scavenges as a proxy rather than exact bytes. Reports 5 and 6 are one point back at 11, held back only by criterion 6.

## Weakest

1. **report-1.md (9)** — separated from the pack by criteria 2 and 4: no tier lines at all and no load recorded in the evidence, and the trade-off section omits module state and cold-start/init cost. It shares criterion 6 weakness (no bug found or fixed) with reports 5 and 6, but those reports make up the points on evidence and trade-off.
2. **report-3.md (10)** — separated by criteria 2 and 3: no load recorded, tier lines paraphrased rather than quoted (forced versus natural not distinguished), and the arithmetic error below docked impact honesty. Its criterion 6 is among the best (two trie bugs found and fixed), which keeps it above report 1.

## Flags: claims not supported by the report's own evidence

- **report-3.md (flagged):** "At 3,000 messages/min that is 180,000 regex-alternation scans/hour" is inconsistent with its own description of `scanEmotes` running 3 matchers per message (3,000 × 60 × 3 = 540,000/hour). This is an unmeasured scale-up claim and the basis for the criterion 3 deduction. Its measured counts (32,087 fuzz checks, 64,768 fold checks, 66,361 spans both arms) and timing medians are internally consistent. The "both arms emitted the same `spans_check 66361`" statement is made in prose; the quoted optimized JSON does not show that field (raw file is referenced).
- **report-1.md (minor flag):** "both the repo's own test file and a shadow run of the patched file green" overstates what ran — the repo test file ran against the unpatched checkout; only the shadow suite imported the patched file. The later section clarifies this, so it is a framing issue, not a fabricated result.
- **report-5.md (minor flag):** "the only allocation removed is the per-call regex" is inferred from bytecode, not measured, and is not labeled static; the report itself says byte size was not measured. The 74x/83x headline is produced under explicitly labeled forced (manual) TurboFan marking, so the ratio is comparable across arms but is not a natural-tiering claim.
- No unsupported claims found in **report-2.md**, **report-4.md**, or **report-6.md**; each discloses its weak spots (current-HEAD parity, scavenge proxy, load spike) rather than hiding them.
