#!/usr/bin/env node
// Static-only audit of emitted JS and sourcemap provenance. It never executes
// application code and therefore cannot claim runtime heat or bytecode.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(file));
    else if (entry.isFile() && (file.endsWith(".js") || file.endsWith(".js.map"))) out.push(file);
  }
  return out;
}

export function auditCompiled(root, terms = []) {
  const results = [];
  for (const file of walk(root)) {
    if (!file.endsWith(".js")) continue;
    const source = fs.readFileSync(file, "utf8");
    const mapFile = `${file}.map`;
    let map = null;
    if (fs.existsSync(mapFile)) {
      try { map = JSON.parse(fs.readFileSync(mapFile, "utf8")); } catch { /* reported as absent */ }
    }
    const matched = terms.filter((term) => source.includes(term));
    if (terms.length > 0 && matched.length === 0) continue;
    results.push({
      file: path.relative(process.cwd(), file),
      bytes: Buffer.byteLength(source),
      sha256: crypto.createHash("sha256").update(source).digest("hex"),
      sourcemap: map ? { sources: map.sources?.length ?? 0, embedded: Array.isArray(map.sourcesContent) } : null,
      matched,
    });
  }
  return results;
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  const root = process.argv[2];
  if (!root) {
    console.error("usage: node compiled-audit.mjs <dist-or-chunk-dir> [term ...]");
    process.exit(2);
  }
  for (const result of auditCompiled(root, process.argv.slice(3))) console.log(JSON.stringify(result));
}
