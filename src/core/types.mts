import type { Effect } from "effect";

export const FACTS_SCHEMA_VERSION = 3;
export const CLAIM = "static candidates, not measured hot paths" as const;
export type Claim = typeof CLAIM;

export interface Span {
  readonly start: number;
  readonly end: number;
}

export enum RuleKind {
  ParallelArrayGrowth = "parallel-array-growth",
  SpreadCall = "spread-call",
  SortCallback = "sort-callback",
  ReactiveAllocation = "reactive-allocation",
  LoopAwait = "loop-await",
  LoopParse = "loop-parse",
  NestedLoop = "nested-loop",
  LoopCallback = "loop-callback",
  QuadraticSpreadGrowth = "quadratic-spread-growth",
  RepeatedLinearMembership = "repeated-linear-membership",
  PerCallStaticConstruction = "per-call-static-construction",
  ChainedCollectionPasses = "chained-collection-passes",
  FullSortThenTake = "full-sort-then-take",
  ExistentialFilter = "existential-filter",
  ComparatorRepeatedWork = "comparator-repeated-work",
}

export enum Confidence {
  Review = "review",
  Advisory = "advisory",
}

export enum Backend {
  OxcRawTransfer = "oxc-raw-transfer",
  OxcCopy = "oxc-copy",
  Unsupported = "unsupported",
}

export enum OutputFormat {
  Pretty = "pretty",
  Json = "json",
  Ndjson = "ndjson",
}

export enum FailOn {
  None = "none",
  Review = "review",
  Advisory = "advisory",
}

export enum Surface {
  Product = "product",
  Benchmark = "benchmark",
}

export enum DeclarationKind {
  Function = "function",
  Class = "class",
  Variable = "variable",
  Method = "method",
}

export enum LoopKind {
  For = "for",
  ForOf = "for-of",
  ForIn = "for-in",
  While = "while",
  DoWhile = "do-while",
}

export enum ChainOp {
  Filter = "filter",
  Map = "map",
  FlatMap = "flatMap",
  Reduce = "reduce",
  Sort = "sort",
  ToSorted = "toSorted",
  At = "at",
  Slice = "slice",
  Length = "length",
  Includes = "includes",
  Find = "find",
  Some = "some",
  Every = "every",
}

export enum SpreadOrigin {
  CallArgs = "call-args",
  ArrayLiteral = "array-literal",
}

export enum ConstructionKind {
  Intl = "intl",
  RegExp = "regexp",
  StructuredClone = "structured-clone",
  JsonParse = "json-parse",
  JsonStringify = "json-stringify",
  MatchAll = "match-all",
  InnerHtml = "inner-html",
}

export enum ComparatorMethod {
  Sort = "sort",
  ToSorted = "toSorted",
}

export interface FunctionFact {
  readonly name: string | null;
  readonly body: Span;
  readonly params: readonly string[];
  readonly parent: number | null;
  readonly declaration: number | null;
  readonly isArrow: boolean;
}

export interface DeclarationFact {
  readonly name: string;
  readonly kind: DeclarationKind;
  readonly span: Span;
  readonly exported: boolean;
  readonly functionIndex: number | null;
}

export interface CalleeFact {
  readonly kind: "identifier" | "member";
  readonly name: string;
  readonly receiver: string | null;
  readonly optional: boolean;
}

export interface CallFact {
  readonly callee: CalleeFact;
  readonly span: Span;
  readonly args: Span;
  readonly statement: Span | null;
  readonly functionIndex: number | null;
  readonly loopIndex: number | null;
  readonly freeLoopRefs: readonly number[];
}

export interface AwaitFact {
  readonly span: Span;
  readonly functionIndex: number | null;
  readonly loopIndex: number | null;
}

export interface LoopFact {
  readonly kind: LoopKind;
  readonly span: Span;
  readonly body: Span;
  readonly parent: number | null;
  readonly bindings: readonly string[];
  readonly mutatedReceivers: readonly string[];
}

export interface ChainLinkFact {
  readonly op: ChainOp;
  readonly span: Span;
  readonly optional: boolean;
}

export interface LengthComparisonFact {
  readonly op: string;
  readonly rhs: string;
}

export interface TakeFact {
  readonly op: "index0" | "at0" | "slice0";
  readonly k: string | null;
}

export interface ChainFact {
  readonly head: string | null;
  readonly links: readonly ChainLinkFact[];
  readonly span: Span;
  readonly functionIndex: number | null;
  readonly loopIndex: number | null;
  readonly freeLoopRefs: readonly number[];
  readonly take: TakeFact | null;
  readonly lengthComparison: LengthComparisonFact | null;
}

export interface SpreadFact {
  readonly origin: SpreadOrigin;
  readonly source: string | null;
  readonly target: string | null;
  readonly selfReferential: boolean;
  readonly inReducer: boolean;
  readonly span: Span;
  readonly functionIndex: number | null;
  readonly loopIndex: number | null;
}

export interface ConstructionFact {
  readonly kind: ConstructionKind;
  readonly name: string;
  readonly staticArgs: boolean;
  readonly span: Span;
  readonly functionIndex: number | null;
  readonly loopIndex: number | null;
}

export interface ComparatorFact {
  readonly method: ComparatorMethod;
  readonly span: Span;
  readonly body: Span;
  readonly inline: boolean;
  readonly functionIndex: number;
  readonly calls: readonly number[];
}

export interface LiteralFact {
  readonly kind: "string" | "regexp" | "template" | "number";
  readonly span: Span;
}

export interface CommentFact {
  readonly kind: "line" | "block";
  readonly span: Span;
  readonly text: string;
}

export interface ImportBindingFact {
  readonly imported: string;
  readonly local: string;
}

export interface ImportFact {
  readonly source: string;
  readonly bindings: readonly ImportBindingFact[];
  readonly namespaceLocal: string | null;
  readonly defaultLocal: string | null;
  readonly span: Span;
}

export interface ParseErrorFact {
  readonly message: string;
  readonly span: Span | null;
}

export interface FileFacts {
  readonly schema: number;
  readonly file: string;
  readonly hash: string;
  readonly bytes: number;
  readonly backend: Backend;
  readonly parseErrors: readonly ParseErrorFact[];
  readonly functions: readonly FunctionFact[];
  readonly declarations: readonly DeclarationFact[];
  readonly calls: readonly CallFact[];
  readonly awaits: readonly AwaitFact[];
  readonly loops: readonly LoopFact[];
  readonly chains: readonly ChainFact[];
  readonly spreads: readonly SpreadFact[];
  readonly constructions: readonly ConstructionFact[];
  readonly comparators: readonly ComparatorFact[];
  readonly literals: readonly LiteralFact[];
  readonly comments: readonly CommentFact[];
  readonly imports: readonly ImportFact[];
}

export interface DeclarationRef {
  readonly file: string;
  readonly index: number;
}

export interface FactDatabase {
  readonly files: readonly FileFacts[];
  readonly byFile: ReadonlyMap<string, FileFacts>;
  readonly declarations: readonly DeclarationRef[];
}

export interface WorkModel {
  readonly note: string;
  readonly currentWork: string;
  readonly candidateFloor: string;
  readonly proof: string;
}

export interface RawFinding {
  readonly kind: RuleKind;
  readonly file: string;
  readonly span: Span;
  readonly anchor: Span;
  readonly metrics: Readonly<Record<string, number | string>>;
  readonly score?: number | undefined;
  readonly confidence?: Confidence | undefined;
  readonly work?: WorkModel | undefined;
}

export interface RankedFinding extends RawFinding {
  readonly score: number;
  readonly enclosingFunction: string | null;
  readonly staticCallSites: number | null;
  readonly rankBoost: number;
}

export interface Finding extends RankedFinding {
  readonly id: string;
  readonly line: number;
  readonly excerpt: string;
  readonly surface: Surface;
  readonly confidence: Confidence;
  readonly work: WorkModel;
}

export interface RuleContext {
  readonly database: FactDatabase;
  readonly callSites: ReadonlyMap<string, number>;
}

export interface Rule {
  readonly kind: RuleKind;
  readonly confidence: Confidence;
  readonly score: number;
  readonly work: WorkModel;
  readonly run: (
    facts: FileFacts,
    ctx: RuleContext,
  ) => Effect.Effect<readonly RawFinding[], never>;
}

export interface ScanSummary {
  readonly reported: number;
  readonly matched: number;
  readonly advisorySuppressed: number;
  readonly truncated: number;
  readonly dismissed: number;
  readonly files: number;
  readonly facts: number;
  readonly parseErrors: number;
  readonly cacheHits: number;
  readonly cacheMisses: number;
  readonly backends: Readonly<Record<Backend, number>>;
  readonly elapsedMs: number;
}

export interface ScanResult {
  readonly claim: Claim;
  readonly summary: ScanSummary;
  readonly findings: readonly Finding[];
}
