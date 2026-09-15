#!/usr/bin/env node
// Static-only audit of emitted JS and sourcemap provenance. It never executes
// application code and therefore cannot claim runtime heat or bytecode.
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { Schema } from "effect";
import { SourcemapSchema } from "./core/schema.mts";

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

function sourcemapInfo(text: string): SourcemapInfo | null {
  try {
    const decoded = Schema.decodeUnknownSync(SourcemapSchema)(JSON.parse(text));
    return {
      sources: Array.isArray(decoded.sources) ? decoded.sources.length : 0,
      embedded: Array.isArray(decoded.sourcesContent),
    };
  } catch {
    return null;
  }
}

export function auditCompiled(root: string, terms: readonly string[] = []): CompiledResult[] {
  const results: CompiledResult[] = [];
  for (const file of walk(root)) {
    if (!file.endsWith(".js")) continue;
    const source = fs.readFileSync(file, "utf8");
    const mapFile = `${file}.map`;
    const map = fs.existsSync(mapFile) ? sourcemapInfo(fs.readFileSync(mapFile, "utf8")) : null;
    const matched = terms.filter((term) => source.includes(term));
    if (terms.length > 0 && matched.length === 0) continue;
    results.push({
      file: path.relative(process.cwd(), file),
      bytes: Buffer.byteLength(source),
      sha256: crypto.createHash("sha256").update(source).digest("hex"),
      sourcemap: map,
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
