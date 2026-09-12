#!/usr/bin/env node
import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const extensions = new Set([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts"]);
const ignored = new Set([".git", ".repos", "node_modules", "dist", "build", "coverage", ".next", ".solid", ".svelte-kit", "vendor", "generated", "__generated__", "fixtures"]);
const ignoredFile = /(?:^|\.)(?:test|spec|fixture)\.[cm]?[jt]sx?$/;

function filesUnder(path) {
  const absolute = resolve(path);
  const stat = statSync(absolute);
  if (stat.isFile()) return extensions.has(extname(absolute)) ? [absolute] : [];
  const files = [];
  for (const entry of readdirSync(absolute, { withFileTypes: true })) {
    if (entry.isDirectory() && ignored.has(entry.name)) continue;
    const child = join(absolute, entry.name);
    if (entry.isDirectory()) files.push(...filesUnder(child));
    else if (entry.isFile() && extensions.has(extname(entry.name)) && !ignoredFile.test(entry.name)) files.push(child);
  }
  return files;
}

const rules = [
  ["parallel-array-growth", 9, /\b([A-Za-z_$][\w$\.]*)\.([A-Za-z_$][\w$]*)!?\.push\s*\([^;]+;\s*\1\.([A-Za-z_$][\w$]*)!?\.push\s*\(/, "related values appended to parallel arrays", "E × 2 push calls and 2 array identities", "E × 1 push call while retaining 2 logical values", "confirm index alignment and lifecycle invariants; then count pushes, array storage, and capacity growth"],
  ["loop-await", 8, /\b(?:for|while)\b[\s\S]{0,240}\bawait\b/, "possible serial async work in a loop", "N iterations × 1 awaited boundary", "intent-dependent: concurrency, batching, or the same N ordered boundaries", "prove ordering/backpressure intent; count boundaries and measure representative latency"],
  ["loop-parse", 8, /\b(?:for|while)\b[\s\S]{0,240}\b(?:JSON\.(?:parse|stringify)|structuredClone|matchAll|innerHTML)\b/, "parse, clone, or serialization syntax near a loop", "N iterations × P parse/clone work", "one P per distinct required representation", "count calls and distinct inputs before timing"],
  ["nested-loop", 7, /\b(?:for|while)\b[\s\S]{0,240}\b(?:for|while)\b/, "possible multiplicative iteration", "N outer × M inner iterations", "intent-dependent lower bound", "derive required pairs from output semantics; then count iterations"],
  ["loop-callback", 6, /\b(?:for|while)\b[\s\S]{0,240}\.(?:map|filter|reduce|flatMap|some|every|find)\s*\(/, "collection callback syntax near a loop", "N outer × M callback visits plus callback sites", "required visits without an avoidable intermediate", "count visits, constructions, and output elements"],
  ["spread-call", 5, /\b[A-Za-z_$][\w$\.]*\s*\([^\n)]*\.\.\./, "iterable expansion into a call", "N values expanded into call arguments", "N required values without a throwaway argument list when the API permits", "inspect bytecode for iterable/copy work and test argument limits"],
  ["sort-callback", 4, /\.sort\s*\(\s*(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/, "sort with an inline comparator", "O(N log N) comparator calls", "Ω(N log N) if total ordering is required; otherwise intent-dependent", "verify whether full ordering is required and count comparator/callee work"],
  ["reactive-allocation", 4, /\b(?:createEffect|createMemo)\s*\([\s\S]{0,300}\.(?:map|filter|flatMap)\s*\(/, "collection allocation syntax inside reactive work", "R executions × traversal/allocation", "one traversal per changed output, or zero when derivation can be avoided", "count executions and allocations under a real interaction"],
  ["per-call-static-construction", 3, /(?:=>|function\b)[\s\S]{0,400}\bnew\s+(?:Intl\.[A-Za-z]+|Map|Set|RegExp)\s*\(/, "possibly reusable construction inside a function", "C calls × 1 construction", "1 construction per distinct configuration and required lifetime", "prove lifetime/state safety; count constructions and cold-start cost"],
];

function maskNonCode(source) {
  let state = "code";
  let escaped = false;
  let masked = "";
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    const next = source[index + 1];
    if (state === "code") {
      if (char === "/" && next === "/") state = "line-comment";
      else if (char === "/" && next === "*") state = "block-comment";
      else if (char === '"' || char === "'" || char === "`") {
        state = char;
        escaped = false;
        masked += " ";
        continue;
      }
      else {
        masked += char;
        continue;
      }
    }
    masked += char === "\n" ? "\n" : " ";
    if (state === "line-comment" && char === "\n") state = "code";
    else if (state === "block-comment" && char === "*" && next === "/") {
      masked += " ";
      index += 1;
      state = "code";
    } else if ((state === '"' || state === "'" || state === "`") && !escaped && char === state) state = "code";
    escaped = char === "\\" && !escaped;
    if (char !== "\\") escaped = false;
  }
  return masked;
}

export function scan(roots = ["."]) {
  const findings = [];
  for (const file of [...new Set(roots.flatMap(filesUnder))].sort()) {
    const source = readFileSync(file, "utf8");
    const searchable = maskNonCode(source);
    for (const [kind, score, pattern, note, currentWork, candidateFloor, proof] of rules) {
      const matcher = new RegExp(pattern.source, `${pattern.flags}g`);
      for (const match of searchable.matchAll(matcher)) {
        findings.push({
          score,
          kind,
          file: relative(process.cwd(), file) || file,
          line: source.slice(0, match.index).split("\n").length,
          excerpt: source.slice(match.index, match.index + match[0].length).replace(/\s+/g, " ").slice(0, 160),
          note,
          currentWork,
          candidateFloor,
          proof,
          surface: /(?:^|[/\\])(?:bench|benchmark|benchmarks)(?:[/\\]|$)|\.bench\.[cm]?[jt]sx?$/.test(file) ? "benchmark" : "product",
        });
      }
    }
  }
  return findings.sort((a, b) => b.score - a.score || a.file.localeCompare(b.file) || a.line - b.line || a.kind.localeCompare(b.kind));
}

function main(argv) {
  const json = argv.includes("--json");
  const roots = argv.filter((arg) => arg !== "--json");
  const findings = scan(roots.length ? roots : ["."]);
  if (json) console.log(JSON.stringify({ claim: "static candidates, not measured hot paths", findings }, null, 2));
  else {
    console.log("Static candidates, not measured hot paths\n");
    for (const item of findings) console.log(`${item.score}\t${item.kind}\t${item.surface}\t${item.file}:${item.line}\n  evidence: ${item.excerpt}\n  current:  ${item.currentWork}\n  floor:    ${item.candidateFloor}\n  prove:    ${item.proof}`);
    console.log(`\n${findings.length} candidate(s). Review source and establish runtime frequency before editing.`);
  }
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
