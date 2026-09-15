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

const review = Confidence.Review;
const advisory = Confidence.Advisory;

const PARSE_PATHS = new Set(["JSON.parse", "JSON.stringify", "structuredClone"]);

const CALLBACK_OPS = new Set(["map", "filter", "reduce", "flatMap", "some", "every", "find"]);

const MUTATORS = new Set(["push", "pop", "shift", "unshift", "splice", "sort", "reverse", "copyWithin", "fill", "set", "add", "delete", "clear"]);

function memberName(path: string): string {
  const index = path.lastIndexOf(".");
  return index === -1 ? path : path.slice(index + 1);
}

function receiverOf(path: string): string | null {
  const index = path.lastIndexOf(".");
  return index === -1 ? null : path.slice(0, index);
}

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
    const parsePath = PARSE_PATHS.has(call.path) || call.path.endsWith(".matchAll");
    if (!parsePath) continue;
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

  for (const assignment of facts.htmlAssignments) {
    if (assignment.loop === null) continue;
    findings.push({
      kind: RuleKind.LoopParse,
      score: 8,
      confidence: review,
      span: assignment.span,
      anchor: assignment.span,
      note: "parse, clone, or serialization work inside a loop",
      currentWork: "N iterations × P parse/clone work",
      candidateFloor: "one P per distinct required representation",
      proof: "count calls and distinct inputs before timing",
    });
  }

  for (let index = 0; index < facts.loops.length; index += 1) {
    const loop = facts.loops[index];
    if (loop === undefined) continue;
    const callbacks = facts.calls.filter((call) => call.loop === index && CALLBACK_OPS.has(memberName(call.path)));
    if (callbacks.length === 0) continue;
    findings.push({
      kind: RuleKind.LoopCallback,
      score: 6,
      confidence: advisory,
      span: loop.span,
      anchor: loop.span,
      note: "collection callback inside a loop",
      currentWork: "N outer × M callback visits plus callback sites",
      candidateFloor: "required visits without an avoidable intermediate",
      proof: "count visits, constructions, and output elements",
    });
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

  for (const spread of facts.arraySpreads) {
    if (spread.source === null) continue;
    const selfSpread = spread.inLoop && spread.target !== null && spread.target === spread.source;
    const reducerSpread = spread.reduceAccumulator !== null;
    if (!selfSpread && !reducerSpread) continue;
    findings.push({
      kind: RuleKind.QuadraticSpreadGrowth,
      score: 8,
      confidence: review,
      span: spread.span,
      anchor: spread.span,
      note: "array rebuilt from its prior contents on each iteration",
      currentWork: "1 + 2 + … + (N−1) prior-element copies and N array allocations",
      candidateFloor: "N appends with amortized growth while preserving order",
      proof: "prove no escaping intermediate array identity and preserve element order; then count copied elements and allocations",
    });
  }

  for (const call of facts.calls) {
    if (call.loop === null) continue;
    if (!call.path.endsWith(".includes") && call.path !== "includes") continue;
    const loop = facts.loops[call.loop];
    if (loop === undefined || loop.bindings.length === 0) continue;
    if (!loop.bindings.some((binding) => call.argumentIdentifiers.includes(binding))) continue;
    const receiver = receiverOf(call.path) ?? "";
    if (/(?:alphabet|charset|digits)/i.test(receiver)) continue;
    const mutated = facts.calls.some(
      (candidate) =>
        receiver !== "" &&
        receiverOf(candidate.path) === receiver &&
        MUTATORS.has(memberName(candidate.path)) &&
        loop.span.start <= candidate.span.start &&
        candidate.span.end <= loop.span.end,
    );
    if (mutated) continue;
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

  for (const chain of facts.chains) {
    findings.push({
      kind: RuleKind.ChainedCollectionPasses,
      score: 5,
      confidence: advisory,
      span: chain.span,
      anchor: chain.span,
      note: "chained filter/map/flatMap passes over one collection",
      currentWork: "N elements × P passes plus P−1 intermediate arrays",
      candidateFloor: "N elements × 1 fused pass when callbacks are pure w.r.t. fusion, else 1 pass per distinct output",
      proof: "prove callbacks are pure with respect to the intermediate: no escaping intermediate identity, no side effects consumed downstream, and preserved order/short-circuit semantics; then count elements and intermediate allocations under a representative workload",
    });
  }

  for (const take of facts.sortTakes) {
    const currentWork = take.kind === "slice0" ? `O(N log N) comparator work plus full ordering to retain first ${take.k ?? "k"}` : "O(N log N) comparator work plus full ordering to retain 1 element (or first k)";
    findings.push({
      kind: RuleKind.FullSortThenTake,
      score: 6,
      confidence: advisory,
      span: take.span,
      anchor: take.span,
      note: "full sort with only the first element(s) consumed",
      currentWork,
      candidateFloor: "N−1 comparisons via one linear extremum scan, or a partial selection when k > 1",
      proof: "prove only the first/k elements are consumed downstream and the comparator extremum matches a linear scan (same tie-breaking); count N and comparator cost",
    });
  }

  for (const entry of facts.existentialFilters) {
    findings.push({
      kind: RuleKind.ExistentialFilter,
      score: 5,
      confidence: advisory,
      span: entry.span,
      anchor: entry.span,
      note: "filter builds an array only to test existence via length",
      currentWork: "N predicate evaluations plus 1 intermediate array of up to N elements to test existence",
      candidateFloor: "up to N predicate evaluations with early exit and zero allocation via some/find",
      proof: "prove the predicate is pure w.r.t. short-circuit (no relied-upon side effects, exceptions equivalent) and length is only compared to 0/1 as matched; count N and predicate cost",
    });
  }

  for (const call of facts.calls) {
    if (!call.inlineComparator) continue;
    findings.push({
      kind: RuleKind.SortCallback,
      score: 4,
      confidence: advisory,
      span: call.span,
      anchor: call.span,
      note: "sort with an inline comparator",
      currentWork: "O(N log N) comparator calls",
      candidateFloor: "Ω(N log N) if total ordering is required; otherwise intent-dependent",
      proof: "verify whether full ordering is required and count comparator/callee work",
    });
  }

  for (const comparator of facts.comparators) {
    findings.push({
      kind: RuleKind.ComparatorRepeatedWork,
      score: 7,
      confidence: review,
      span: comparator.span,
      anchor: comparator.span,
      note: `expensive work repeated inside a sort comparator (${comparator.repeated.join(", ")})`,
      currentWork: "O(N log N) comparator invocations, each repeating P parse or search calls",
      candidateFloor: "P parse/search calls per element before the sort, then O(N log N) key comparisons",
      proof: "hoist the repeated parse or search out of the comparator and preserve its tie-break; then count comparator invocations and repeated calls",
    });
  }

  for (const construction of facts.constructions) {
    if (!construction.staticArgs || construction.function_ === null) continue;
    findings.push({
      kind: RuleKind.PerCallStaticConstruction,
      score: 3,
      confidence: advisory,
      span: construction.span,
      anchor: construction.span,
      note: "possibly reusable construction inside a function body",
      currentWork: "C calls × 1 construction",
      candidateFloor: "1 construction per distinct configuration and required lifetime",
      proof: "prove lifetime/state safety; count constructions and cold-start cost",
    });
  }

  for (const call of facts.calls) {
    if (call.path !== "createEffect" && call.path !== "createMemo") continue;
    const nested = facts.calls.some(
      (candidate) =>
        ["map", "filter", "flatMap"].includes(memberName(candidate.path)) &&
        candidate.span.start >= call.span.start &&
        candidate.span.start <= call.span.start + 300,
    );
    if (!nested) continue;
    findings.push({
      kind: RuleKind.ReactiveAllocation,
      score: 4,
      confidence: review,
      span: call.span,
      anchor: call.span,
      note: "collection allocation syntax inside reactive work",
      currentWork: "R executions × traversal/allocation",
      candidateFloor: "one traversal per changed output, or zero when derivation can be avoided",
      proof: "count executions and allocations under a real interaction",
    });
  }

  const pushesByFunction = new Map<string, Array<{ parent: string; array: string; span: Span }>>();
  for (const push of facts.pushes) {
    if (push.parent === null || push.array === null) continue;
    const key = `${push.function_ ?? -1}`;
    const list = pushesByFunction.get(key) ?? [];
    list.push({ parent: push.parent, array: push.array, span: push.span });
    pushesByFunction.set(key, list);
  }
  for (const list of pushesByFunction.values()) {
    list.sort((a, b) => a.span.start - b.span.start);
    for (let index = 0; index < list.length; index += 1) {
      const first = list[index];
      if (first === undefined) continue;
      const second = list.find((candidate, candidateIndex) => candidateIndex > index && candidate.parent === first.parent && candidate.array !== first.array && candidate.span.start - first.span.end <= 400);
      if (second === undefined) continue;
      findings.push({
        kind: RuleKind.ParallelArrayGrowth,
        score: 9,
        confidence: review,
        span: first.span,
        anchor: first.span,
        note: "related values appended to parallel arrays",
        currentWork: "E × 2 push calls and 2 array identities",
        candidateFloor: "E × 1 push call while retaining 2 logical values",
        proof: "confirm index alignment and lifecycle invariants; then count pushes, array storage, and capacity growth",
      });
      break;
    }
  }

  return findings;
}
