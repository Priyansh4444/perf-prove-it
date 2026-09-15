import { Schema } from "effect";

export const FindingOutputSchema = Schema.Struct({
  id: Schema.String,
  score: Schema.Number,
  kind: Schema.String,
  confidence: Schema.String,
  file: Schema.String,
  line: Schema.Number,
  excerpt: Schema.String,
  note: Schema.String,
  currentWork: Schema.String,
  candidateFloor: Schema.String,
  proof: Schema.String,
  enclosingFunction: Schema.Union([Schema.String, Schema.Null]),
  staticCallSites: Schema.Union([Schema.Number, Schema.Null]),
  rankBoost: Schema.Number,
  surface: Schema.String,
});

export const ScanOutputSchema = Schema.Struct({
  claim: Schema.String,
  summary: Schema.Unknown,
  findings: Schema.Array(FindingOutputSchema),
});

export const SourcemapSchema = Schema.Struct({
  sources: Schema.optional(Schema.Unknown),
  sourcesContent: Schema.optional(Schema.Unknown),
});

export const LedgerEntrySchema = Schema.Struct({
  id: Schema.optional(Schema.String),
});

export interface FindingOutput extends Schema.Schema.Type<typeof FindingOutputSchema> {}
export interface ScanOutput extends Schema.Schema.Type<typeof ScanOutputSchema> {}
