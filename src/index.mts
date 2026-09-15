import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";
import { availableParallelism } from "node:os";
import { Effect } from "effect";
import { CLAIM, Confidence, RuleKind, Surface } from "./core/types.mts";
import { extractFacts, type FileFacts, type FunctionFact } from "./scan/facts.mts";
import { runRules, type RawFinding } from "./scan/rules.mts";

const IGNORED_DIRECTORIES = new Set([".git", ".repos", "node_modules", "dist", "build", "coverage", ".next", ".solid", ".svelte-kit", "vendor", "generated", "__generated__", "fixtures"]);
const EXTENSIONS = new Set([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts"]);
const IGNORED_FILE = /(?:^|\.)(?:test|spec|fixture)\.[cm]?[jt]sx?$/;

export interface Finding {
  readonly id: string;
  readonly score: number;
  readonly kind: RuleKind;
  readonly confidence: Confidence;
  readonly file: string;
  readonly line: number;
  readonly excerpt: string;
  readonly note: string;
  readonly currentWork: string;
  readonly candidateFloor: string;
  readonly proof: string;
  readonly enclosingFunction: string | null;
  readonly staticCallSites: number | null;
  readonly rankBoost: number;
  readonly surface: Surface;
}

export interface ScanOptions {
  readonly includeAdvisory?: boolean;
  readonly max?: number;
  readonly concurrency?: number;
  readonly onFinding?: (finding: Finding) => void;
}

export interface ScanResult {
  readonly claim: typeof CLAIM;
  readonly summary: {
    readonly reported: number;
    readonly matched: number;
    readonly advisorySuppressed: number;
    readonly truncated: number;
    readonly files: number;
    readonly backend: "oxc";
    readonly concurrency: number;
    readonly parseErrors: number;
    readonly elapsedMs: number;
  };
  readonly findings: readonly Finding[];
}

interface Prepared {
  readonly file: string;
  readonly source: string;
  readonly facts: FileFacts;
}

async function discover(roots: readonly string[]): Promise<string[]> {
  const files: string[] = [];
  const visit = async (path: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(path, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) {
        if (IGNORED_DIRECTORIES.has(entry.name)) continue;
        await visit(child);
      } else if (entry.isFile() && EXTENSIONS.has(extname(entry.name)) && !IGNORED_FILE.test(entry.name)) {
        files.push(child);
      }
    }
  };
  for (const root of roots) {
    const absolute = resolve(root);
    let info;
    try {
      info = await readdir(absolute, { withFileTypes: true });
    } catch {
      continue;
    }
    if (Array.isArray(info)) await visit(absolute);
    else if (EXTENSIONS.has(extname(absolute))) files.push(absolute);
  }
  return [...new Set(files)].sort();
}

function enclosingFunction(facts: FileFacts, span: { start: number; end: number }): FunctionFact | null {
  let best: FunctionFact | null = null;
  for (const fn of facts.functions) {
    if (fn.body.start <= span.start && span.end <= fn.body.end) {
      if (best === null || fn.body.start >= best.body.start) best = fn;
    }
  }
  let current = best;
  while (current !== null && current.name === null) {
    current = current.parent === null ? null : facts.functions[current.parent] ?? null;
  }
  return current;
}

function buildCallSites(prepared: readonly Prepared[]): Map<string, number> {
  const defined = new Set<string>();
  for (const item of prepared) for (const fn of item.facts.functions) if (fn.name !== null) defined.add(fn.name);
  const counts = new Map<string, number>();
  for (const item of prepared) {
    for (const call of item.facts.calls) {
      const bare = !call.path.includes(".");
      const isThis = call.path.startsWith("this.");
      if (!bare && !isThis) continue;
      const name = isThis ? call.path.slice("this.".length) : call.path;
      if (!defined.has(name)) continue;
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }
  return counts;
}

function buildFinding(item: Prepared, raw: RawFinding, callSites: ReadonlyMap<string, number>, occurrences: Map<string, number>): Finding {
  const file = relative(process.cwd(), item.file) || item.file;
  const anchorText = item.source.slice(raw.anchor.start, raw.anchor.end).replace(/\s+/g, " ").trim();
  const key = `${raw.kind}\0${anchorText}`;
  const occurrence = occurrences.get(key) ?? 0;
  occurrences.set(key, occurrence + 1);
  const id = createHash("sha256").update(`${raw.kind}\0${file}\0${anchorText}\0${occurrence}`).digest("hex").slice(0, 12);
  const owner = enclosingFunction(item.facts, raw.anchor);
  const sites = owner === null || owner.name === null ? null : callSites.get(owner.name) ?? 0;
  const boost = sites === null ? 0 : sites >= 10 ? 3 : sites >= 3 ? 2 : sites >= 1 ? 1 : 0;
  const line = item.source.slice(0, raw.span.start).split("\n").length;
  const excerpt = item.source.slice(raw.span.start, raw.span.end).replace(/\s+/g, " ").trim().slice(0, 160);
  const surface = /(?:^|[/\\])(?:bench|benchmark|benchmarks)(?:[/\\]|$)|\.bench\.[cm]?[jt]sx?$/.test(item.file) ? Surface.Benchmark : Surface.Product;
  return {
    id,
    score: raw.score + boost,
    kind: raw.kind,
    confidence: raw.confidence,
    file,
    line,
    excerpt,
    note: raw.note,
    currentWork: raw.currentWork,
    candidateFloor: raw.candidateFloor,
    proof: raw.proof,
    enclosingFunction: owner?.name ?? null,
    staticCallSites: sites,
    rankBoost: boost,
    surface,
  };
}

export function scanEffect(roots: readonly string[], options: ScanOptions = {}): Effect.Effect<ScanResult> {
  return Effect.gen(function* () {
    const started = Date.now();
    const resolvedRoots = roots.length > 0 ? roots : ["."];
    const files = yield* Effect.tryPromise(() => discover(resolvedRoots));
    const cpu = Math.max(1, Math.min(8, availableParallelism() - 1));
    const concurrency = Math.max(1, options.concurrency ?? cpu);
    const prepared = yield* Effect.forEach(
      files,
      (file) =>
        Effect.tryPromise(async () => {
          const source = await readFile(file, "utf8");
          return { file, source, facts: extractFacts(file, source) } satisfies Prepared;
        }).pipe(Effect.catch(() => Effect.succeed(null))),
      { concurrency },
    );
    const readable = prepared.filter((item): item is Prepared => item !== null);
    const callSites = buildCallSites(readable);
    const all: Finding[] = [];
    let parseErrors = 0;
    for (const item of readable) {
      parseErrors += item.facts.parseErrors;
      const occurrences = new Map<string, number>();
      for (const raw of runRules(item.facts)) all.push(buildFinding(item, raw, callSites, occurrences));
    }
    all.sort((a, b) => b.score - a.score || a.file.localeCompare(b.file) || a.line - b.line || a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
    const reviewed = options.includeAdvisory === true ? all : all.filter((finding) => finding.confidence === Confidence.Review);
    const max = options.max ?? 20;
    const selected = reviewed.slice(0, max);
    if (options.onFinding !== undefined) for (const finding of selected) options.onFinding(finding);
    return {
      claim: CLAIM,
      summary: {
        reported: selected.length,
        matched: all.length,
        advisorySuppressed: all.length - reviewed.length,
        truncated: Math.max(0, reviewed.length - selected.length),
        files: files.length,
        backend: "oxc" as const,
        concurrency,
        parseErrors,
        elapsedMs: Date.now() - started,      },
      findings: selected,
    };
  }).pipe(Effect.orDie);
}

export async function scan(roots: readonly string[], options: ScanOptions = {}): Promise<ScanResult> {
  return Effect.runPromise(scanEffect(roots, options));
}
