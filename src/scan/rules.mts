import { Confidence, RuleKind } from "../core/types.mts";
import type { FileFacts, Span } from "./facts.mts";

export interface RawFinding {
  readonly kind: RuleKind;
  readonly score: number;
  readonly confidence: Confidence;
  readonly span: Span;
  readonly anchor: Span;
  readonly note: string;
  readonly currentWork: string;
  readonly candidateFloor: string;
  readonly proof: string;
}

const PARSE_PATHS = new Set(["JSON.parse", "JSON.stringify", "structuredClone"]);

const review = Confidence.Review;
const advisory = Confidence.Advisory;

export function runRules(facts: FileFacts): RawFinding[] {
  const findings: RawFinding[] = [];

  for (const entry of facts.awaits) {
    if (entry.loop === null) continue;
    findings.push({
      kind: RuleKind.LoopAwait,
      score: 8,
      confidence: review,
      span: entry.span,
      anchor: entry.span,
      note: "awaited work inside a loop",
      currentWork: "N iterations × 1 awaited boundary",
      candidateFloor: "intent-dependent: concurrency, batching, or the same N ordered boundaries",
      proof: "prove ordering/backpressure intent; count boundaries and measure representative latency",
    });
  }

  for (const call of facts.calls) {
    if (call.loop === null) continue;
    const path = call.path;
    if (PARSE_PATHS.has(path) || path.endsWith(".matchAll")) {
      findings.push({
        kind: RuleKind.LoopParse,
        score: 8,
        confidence: review,
        span: call.args,
        anchor: call.args,
        note: "parse, clone, or serialization work inside a loop",
        currentWork: "N iterations × P parse/clone work",
        candidateFloor: "one P per distinct required representation",
        proof: "count calls and distinct inputs before timing",
      });
    }
  }

  for (const loop of facts.loops) {
    if (loop.parent === null) continue;
    findings.push({
      kind: RuleKind.NestedLoop,
      score: 7,
      confidence: advisory,
      span: loop.span,
      anchor: loop.span,
      note: "structurally nested iteration",
      currentWork: "N outer × M inner iterations",
      candidateFloor: "intent-dependent lower bound because pairwise work may be required",
      proof: "derive required pairs from output semantics; then count iterations",
    });
  }

  for (const call of facts.calls) {
    if (call.loop === null) continue;
    if (!call.path.endsWith(".includes") && call.path !== "includes") continue;
    const loop = facts.loops[call.loop];
    if (loop === undefined || loop.binding === null) continue;
    if (!call.argumentIdentifiers.includes(loop.binding)) continue;
    const receiver = call.path === "includes" ? "" : call.path.slice(0, call.path.length - ".includes".length);
    if (/(?:alphabet|charset|digits)/i.test(receiver)) continue;
    findings.push({
      kind: RuleKind.RepeatedLinearMembership,
      score: 7,
      confidence: review,
      span: call.args,
      anchor: call.args,
      note: "linear membership search repeated inside a loop",
      currentWork: "O(N×M) SameValueZero comparisons for N iterations over M candidates",
      candidateFloor: "O(N+M) expected work after one Set construction",
      proof: "preserve SameValueZero semantics; account for Set memory and construction cost, and prefer the scan for small inputs",
    });
  }

  for (const spread of facts.spreads) {
    if (spread.callee !== "Math.max" && spread.callee !== "Math.min") continue;
    findings.push({
      kind: RuleKind.SpreadCall,
      score: 5,
      confidence: advisory,
      span: spread.span,
      anchor: spread.span,
      note: "array expansion into Math.max/min",
      currentWork: "N values expanded into call arguments plus argument-count limits",
      candidateFloor: "N comparisons in a direct scan without an expanded argument list",
      proof: "preserve empty/NaN/signed-zero semantics; count expansion work and test engine argument limits",
    });
  }

  return findings;
}
