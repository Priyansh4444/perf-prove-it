#!/usr/bin/env node
// Static-only audit of emitted JS and sourcemap provenance. It never executes
// application code and therefore cannot claim runtime heat or bytecode.
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

interface SourcemapInfo {
  sources: number;
  embedded: boolean;
}

export interface CompiledResult {
  file: string;
  bytes: number;
  sha256: string;
  sourcemap: SourcemapInfo | null;
  matched: string[];
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(file));
    else if (entry.isFile() && (file.endsWith(".js") || file.endsWith(".js.map"))) out.push(file);
  }
  return out;
}

function lengthOf(value: unknown): number {
  if (typeof value === "string" || typeof value === "function") return value.length;
  if (typeof value === "object" && value !== null && "length" in value && typeof value.length === "number") {
    return value.length;
  }
  return 0;
}

function sourcemapInfo(map: unknown): SourcemapInfo | null {
  if (!map) return null;
  const record = typeof map === "object" ? (map as Record<string, unknown>) : null;
  const sources = record === null ? undefined : record["sources"];
  const sourcesContent = record === null ? undefined : record["sourcesContent"];
  return { sources: lengthOf(sources), embedded: Array.isArray(sourcesContent) };
}

export function auditCompiled(root: string, terms: readonly string[] = []): CompiledResult[] {
  const results: CompiledResult[] = [];
  for (const file of walk(root)) {
    if (!file.endsWith(".js")) continue;
    const source = fs.readFileSync(file, "utf8");
    const mapFile = `${file}.map`;
    let map: unknown = null;
    if (fs.existsSync(mapFile)) {
      try {
        map = JSON.parse(fs.readFileSync(mapFile, "utf8"));
      } catch {
        /* reported as absent */
      }
    }
    const matched = terms.filter((term) => source.includes(term));
    if (terms.length > 0 && matched.length === 0) continue;
    results.push({
      file: path.relative(process.cwd(), file),
      bytes: Buffer.byteLength(source),
      sha256: crypto.createHash("sha256").update(source).digest("hex"),
      sourcemap: sourcemapInfo(map),
      matched,
    });
  }
  return results;
}

export function run(argv: readonly string[]): number {
  const root = argv[0];
  if (root === undefined) {
    process.stderr.write("usage: node compiled-audit.mjs <dist-or-chunk-dir> [term ...]\n");
    return 2;
  }
  for (const result of auditCompiled(root, argv.slice(1))) process.stdout.write(`${JSON.stringify(result)}\n`);
  return 0;
}
