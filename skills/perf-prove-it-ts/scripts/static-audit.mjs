#!/usr/bin/env node
import { appendFileSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
const extensions = new Set([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts"]);
const ignored = new Set([".git", ".repos", "node_modules", "dist", "build", "coverage", ".next", ".solid", ".svelte-kit", "vendor", "generated", "__generated__", "fixtures"]);
const ignoredFile = /(?:^|\.)(?:test|spec|fixture)\.[cm]?[jt]sx?$/;
const actionableKinds = new Set([
  "parallel-array-growth",
  "loop-await",
  "loop-parse",
  "reactive-allocation",
  "quadratic-spread-growth",
  "repeated-linear-membership",
  "comparator-repeated-work",
]);
const ledgerBase = join(tmpdir(), "perf-prove-it");

function sessionKey() {
  // Host-agnostic: CI/agents may provide one stable run id; otherwise keep
  // decisions scoped to this parent process and let the TTL remove them.
  return (process.env.PERF_PROVE_IT_SESSION_ID || `ppid-${process.ppid}`).replace(/[^A-Za-z0-9_.-]/g, "_");
}

function ledgerPath() {
  return join(ledgerBase, sessionKey(), "dismissed.jsonl");
}

function pruneLedgers(maxAgeMs = 24 * 60 * 60 * 1000) {
  if (!statSafe(ledgerBase)) return;
  const cutoff = Date.now() - maxAgeMs;
  for (const entry of readdirSync(ledgerBase, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = join(ledgerBase, entry.name);
    if (statSync(dir).mtimeMs < cutoff) rmSync(dir, { recursive: true, force: true });
  }
}

function statSafe(path) {
  try { return statSync(path); } catch { return null; }
}

function dismissedIds() {
  const file = ledgerPath();
  if (!statSafe(file)) return new Set();
  return new Set(readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line).id));
}

function findingId(kind, file, anchor, occurrence) {
  return createHash("sha256").update(`${kind}\0${file}\0${anchor}\0${occurrence}`).digest("hex").slice(0, 12);
}

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
  ["spread-call", 5, /\bMath\.(?:max|min)\s*\(\s*\.\.\.\s*[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\s*\)/, "array expansion into Math.max/min", "N values expanded into call arguments plus argument-count limits", "N comparisons in a direct scan without an expanded argument list", "preserve empty/NaN/signed-zero semantics; count expansion work and test engine argument limits"],
  ["sort-callback", 4, /\.sort\s*\(\s*(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/, "sort with an inline comparator", "O(N log N) comparator calls", "Ω(N log N) if total ordering is required; otherwise intent-dependent", "verify whether full ordering is required and count comparator/callee work"],
  ["reactive-allocation", 4, /\b(?:createEffect|createMemo)\s*\([\s\S]{0,300}\.(?:map|filter|flatMap)\s*\(/, "collection allocation syntax inside reactive work", "R executions × traversal/allocation", "one traversal per changed output, or zero when derivation can be avoided", "count executions and allocations under a real interaction"],
];

const structuralRules = {
  "loop-await": [8, "awaited work inside a loop", "N iterations × 1 awaited boundary", "intent-dependent: concurrency, batching, or the same N ordered boundaries", "prove ordering/backpressure intent; count boundaries and measure representative latency"],
  "loop-parse": [8, "parse, clone, or serialization work inside a loop", "N iterations × P parse/clone work", "one P per distinct required representation", "count calls and distinct inputs before timing"],
  "nested-loop": [7, "structurally nested iteration", "N outer × M inner iterations", "intent-dependent lower bound because pairwise work may be required", "derive required pairs from output semantics; then count iterations"],
  "loop-callback": [6, "collection callback inside a loop", "N outer × M callback visits plus callback sites", "required visits without an avoidable intermediate", "count visits, constructions, and output elements"],
  "quadratic-spread-growth": [8, "array rebuilt from its prior contents on each iteration", "1 + 2 + … + (N−1) prior-element copies and N array allocations", "N appends with amortized growth while preserving order", "prove no escaping intermediate array identity and preserve element order; then count copied elements and allocations"],
  "repeated-linear-membership": [7, "linear membership search repeated inside a loop", "O(N×M) SameValueZero comparisons for N iterations over M candidates", "O(N+M) expected work after one Set construction", "preserve SameValueZero semantics; account for Set memory and construction cost, and prefer the scan for small inputs"],
  "per-call-static-construction": [3, "possibly reusable construction inside a function body", "C calls × 1 construction", "1 construction per distinct configuration and required lifetime", "prove lifetime/state safety; count constructions and cold-start cost"],
  "chained-collection-passes": [5, "chained filter/map/flatMap passes over one collection", "N elements × P passes plus P−1 intermediate arrays", "N elements × 1 fused pass when callbacks are pure w.r.t. fusion, else 1 pass per distinct output", "prove callbacks are pure with respect to the intermediate: no escaping intermediate identity, no side effects consumed downstream, and preserved order/short-circuit semantics; then count elements and intermediate allocations under a representative workload"],
  "full-sort-then-take": [6, "full sort with only the first element(s) consumed", "O(N log N) comparator work plus full ordering to retain 1 element (or first k)", "N−1 comparisons via one linear extremum scan, or a partial selection when k > 1", "prove only the first/k elements are consumed downstream and the comparator extremum matches a linear scan (same tie-breaking); count N and comparator cost"],
  "existential-filter": [5, "filter builds an array only to test existence via length", "N predicate evaluations plus 1 intermediate array of up to N elements to test existence", "up to N predicate evaluations with early exit and zero allocation via some/find", "prove the predicate is pure w.r.t. short-circuit (no relied-upon side effects, exceptions equivalent) and length is only compared to 0/1 as matched; count N and predicate cost"],
  "comparator-repeated-work": [7, "expensive work repeated inside a sort comparator", "O(N log N) comparator invocations, each repeating P parse or search calls", "P parse/search calls per element before the sort, then O(N log N) key comparisons", "hoist the repeated parse or search out of the comparator and preserve its tie-break; then count comparator invocations and repeated calls"],
};

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
      } else {
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

function lexicalIndex(masked) {
  const pairs = new Map();
  const reversePairs = new Map();
  const stacks = { "(": [], "[": [], "{": [] };
  const closes = { ")": "(", "]": "[", "}": "{" };
  for (let index = 0; index < masked.length; index++) {
    const char = masked[index];
    if (stacks[char]) stacks[char].push(index);
    else if (closes[char]) {
      const open = stacks[closes[char]].pop();
      if (open !== undefined) {
        pairs.set(open, index);
        reversePairs.set(index, open);
      }
    }
  }
  return { pairs, reversePairs };
}

function skipSpace(masked, index) {
  while (index < masked.length && /\s/.test(masked[index])) index += 1;
  return index;
}

function wordAt(masked, index) {
  return masked.slice(index).match(/^([A-Za-z_$][\w$]*)/)?.[1] ?? "";
}

function statementEnd(masked, index, pairs) {
  index = skipSpace(masked, index);
  if (masked[index] === "{") return (pairs.get(index) ?? masked.length - 1) + 1;
  const word = wordAt(masked, index);
  if (["for", "while", "with", "switch", "catch"].includes(word)) {
    const open = skipSpace(masked, index + word.length);
    if (masked[open] === "(" && pairs.has(open)) return statementEnd(masked, pairs.get(open) + 1, pairs);
  }
  if (word === "if") {
    const open = skipSpace(masked, index + 2);
    if (masked[open] === "(" && pairs.has(open)) {
      let end = statementEnd(masked, pairs.get(open) + 1, pairs);
      const otherwise = skipSpace(masked, end);
      if (wordAt(masked, otherwise) === "else") end = statementEnd(masked, otherwise + 4, pairs);
      return end;
    }
  }
  if (word === "do") {
    const bodyEnd = statementEnd(masked, index + 2, pairs);
    const whileAt = skipSpace(masked, bodyEnd);
    if (wordAt(masked, whileAt) === "while") {
      const open = skipSpace(masked, whileAt + 5);
      if (masked[open] === "(" && pairs.has(open)) return skipSpace(masked, pairs.get(open) + 1) + (masked[skipSpace(masked, pairs.get(open) + 1)] === ";" ? 1 : 0);
    }
    return bodyEnd;
  }
  let round = 0;
  let square = 0;
  for (let cursor = index; cursor < masked.length; cursor++) {
    const char = masked[cursor];
    if (char === "(") round += 1;
    else if (char === ")") {
      if (round === 0) return cursor;
      round -= 1;
    } else if (char === "[") square += 1;
    else if (char === "]") square -= 1;
    else if (char === "{" && round === 0 && square === 0) cursor = pairs.get(cursor) ?? cursor;
    else if (char === ";" && round === 0 && square === 0) return cursor + 1;
    else if (char === "}" && round === 0 && square === 0) return cursor;
  }
  return masked.length;
}

function bindingNames(text) {
  return new Set([...text.matchAll(/\b[A-Za-z_$][\w$]*\b/g)].map((match) => match[0]).filter((name) => !["const", "let", "var", "of", "in", "await"].includes(name)));
}

function topLevelIndex(masked, start, end, pairs, predicate) {
  for (let index = start; index < end; index++) {
    const close = pairs.get(index);
    if (close !== undefined && close < end) {
      index = close;
      continue;
    }
    if (predicate(index)) return index;
  }
  return -1;
}

function splitTopLevel(masked, start, end, pairs, delimiter) {
  const ranges = [];
  let rangeStart = start;
  for (let index = start; index < end; index++) {
    const close = pairs.get(index);
    if (close !== undefined && close < end) {
      index = close;
      continue;
    }
    if (masked[index] === delimiter) {
      ranges.push([rangeStart, index]);
      rangeStart = index + 1;
    }
  }
  ranges.push([rangeStart, end]);
  return ranges;
}

function addBindingPattern(masked, start, end, pairs, bindings) {
  start = skipSpace(masked, start);
  while (end > start && /\s/.test(masked[end - 1])) end -= 1;
  if (masked.slice(start, start + 3) === "...") start = skipSpace(masked, start + 3);
  if (masked[start] === "[" && pairs.get(start) < end) {
    for (const [partStart, partEnd] of splitTopLevel(masked, start + 1, pairs.get(start), pairs, ",")) {
      const equals = topLevelIndex(masked, partStart, partEnd, pairs, (index) => masked[index] === "=");
      addBindingPattern(masked, partStart, equals < 0 ? partEnd : equals, pairs, bindings);
    }
    return;
  }
  if (masked[start] === "{" && pairs.get(start) < end) {
    for (const [partStart, partEnd] of splitTopLevel(masked, start + 1, pairs.get(start), pairs, ",")) {
      const colon = topLevelIndex(masked, partStart, partEnd, pairs, (index) => masked[index] === ":");
      const valueStart = colon < 0 ? partStart : colon + 1;
      const equals = topLevelIndex(masked, valueStart, partEnd, pairs, (index) => masked[index] === "=");
      addBindingPattern(masked, valueStart, equals < 0 ? partEnd : equals, pairs, bindings);
    }
    return;
  }
  const identifier = masked.slice(start, end).match(/^[A-Za-z_$][\w$]*/)?.[0];
  if (identifier) bindings.add(identifier);
}

function loopBindingNames(masked, start, end, pairs) {
  const bindings = new Set();
  start = skipSpace(masked, start);
  if (wordAt(masked, start) === "await") start = skipSpace(masked, start + 5);
  const declaration = wordAt(masked, start);
  if (!["const", "let", "var"].includes(declaration)) return bindings;
  start = skipSpace(masked, start + declaration.length);
  const separator = topLevelIndex(masked, start, end, pairs, (index) => {
    if (masked[index] === ";") return true;
    const word = wordAt(masked, index);
    return (word === "of" || word === "in") && (index === start || !/[\w$]/.test(masked[index - 1]));
  });
  const declarationEnd = separator < 0 ? end : separator;
  for (const [partStart, partEnd] of splitTopLevel(masked, start, declarationEnd, pairs, ",")) {
    const equals = topLevelIndex(masked, partStart, partEnd, pairs, (index) => masked[index] === "=");
    addBindingPattern(masked, partStart, equals < 0 ? partEnd : equals, pairs, bindings);
  }
  return bindings;
}

function loopRegions(masked, pairs) {
  const loops = [];
  const doWhileKeywords = new Set();
  for (const match of masked.matchAll(/\b(?:for|while|do)\b/g)) {
    const kind = match[0];
    const loopStart = match.index;
    if (kind === "while" && doWhileKeywords.has(loopStart)) continue;
    if (kind === "do") {
      const statementStart = skipSpace(masked, loopStart + 2);
      const statementFinish = statementEnd(masked, statementStart, pairs);
      const whileAt = skipSpace(masked, statementFinish);
      if (wordAt(masked, whileAt) !== "while") continue;
      doWhileKeywords.add(whileAt);
      const braced = masked[statementStart] === "{" && pairs.has(statementStart);
      loops.push({ loopStart, statementEnd: statementEnd(masked, loopStart, pairs), start: braced ? statementStart + 1 : statementStart, end: braced ? pairs.get(statementStart) : statementFinish, bindings: new Set(), parentLoop: null });
      continue;
    }
    const open = skipSpace(masked, loopStart + kind.length);
    if (masked[open] !== "(" || !pairs.has(open)) continue;
    const close = pairs.get(open);
    const statementStart = skipSpace(masked, close + 1);
    const statementFinish = statementEnd(masked, statementStart, pairs);
    const braced = masked[statementStart] === "{" && pairs.has(statementStart);
    loops.push({
      loopStart,
      statementEnd: statementFinish,
      start: braced ? statementStart + 1 : statementStart,
      end: braced ? pairs.get(statementStart) : statementFinish,
      bindings: loopBindingNames(masked, open + 1, close, pairs),
      parentLoop: null,
    });
  }
  loops.sort((a, b) => a.loopStart - b.loopStart || b.statementEnd - a.statementEnd);
  for (const loop of loops) {
    loop.parentLoop = loops
      .filter((candidate) => candidate !== loop && candidate.start <= loop.loopStart && loop.statementEnd <= candidate.end)
      .sort((a, b) => b.start - a.start)[0] ?? null;
  }
  return loops;
}

function functionRegions(masked, pairs, reversePairs) {
  const regions = [];
  for (const match of masked.matchAll(/\bfunction\b/g)) {
    const openParams = masked.indexOf("(", match.index + match[0].length);
    if (openParams < 0 || !pairs.has(openParams)) continue;
    const closeParams = pairs.get(openParams);
    const openBody = skipSpace(masked, closeParams + 1);
    if (masked[openBody] === "{" && pairs.has(openBody)) regions.push({ start: openBody + 1, end: pairs.get(openBody), bindings: bindingNames(masked.slice(openParams + 1, closeParams)), parentLoop: null });
  }
  for (const match of masked.matchAll(/=>/g)) {
    const openBody = skipSpace(masked, match.index + 2);
    if (masked[openBody] !== "{" || !pairs.has(openBody)) continue;
    let paramsEnd = match.index;
    while (paramsEnd > 0 && /\s/.test(masked[paramsEnd - 1])) paramsEnd -= 1;
    let paramsStart = paramsEnd;
    if (masked[paramsEnd - 1] === ")" && reversePairs.has(paramsEnd - 1)) paramsStart = reversePairs.get(paramsEnd - 1) + 1;
    else while (paramsStart > 0 && /[\w$]/.test(masked[paramsStart - 1])) paramsStart -= 1;
    regions.push({ start: openBody + 1, end: pairs.get(openBody), bindings: bindingNames(masked.slice(paramsStart, paramsEnd)), parentLoop: null });
  }
  for (const [openParams, closeParams] of pairs) {
    if (masked[openParams] !== "(") continue;
    const openBody = skipSpace(masked, closeParams + 1);
    if (masked[openBody] !== "{" || !pairs.has(openBody)) continue;
    let nameEnd = openParams;
    while (nameEnd > 0 && /\s/.test(masked[nameEnd - 1])) nameEnd -= 1;
    let nameStart = nameEnd;
    while (nameStart > 0 && /[\w$]/.test(masked[nameStart - 1])) nameStart -= 1;
    const name = masked.slice(nameStart, nameEnd);
    if (!name || ["if", "for", "while", "switch", "catch", "with"].includes(name)) continue;
    regions.push({ start: openBody + 1, end: pairs.get(openBody), bindings: bindingNames(masked.slice(openParams + 1, closeParams)), parentLoop: null });
  }
  return regions;
}

function reducerRegions(masked, pairs) {
  const regions = [];
  for (const match of masked.matchAll(/\.reduce\s*\(/g)) {
    const open = masked.indexOf("(", match.index);
    const close = pairs.get(open);
    if (close === undefined) continue;
    const argumentStart = skipSpace(masked, open + 1);
    const arrow = masked.indexOf("=>", argumentStart);
    if (arrow < 0 || arrow > close) continue;
    const params = masked.slice(argumentStart, arrow).replace(/^\s*\(|\)\s*$/g, "");
    const accumulator = params.match(/[A-Za-z_$][\w$]*/)?.[0];
    if (!accumulator) continue;
    const bodyStart = skipSpace(masked, arrow + 2);
    if (masked[bodyStart] === "{" && pairs.has(bodyStart)) regions.push({ start: bodyStart + 1, end: pairs.get(bodyStart), bindings: new Set([accumulator]), parentLoop: null, accumulator });
    else regions.push({ start: bodyStart, end: close, bindings: new Set([accumulator]), parentLoop: null, accumulator });
  }
  return regions;
}

function containingRegion(regions, start, end = start) {
  return regions.filter((region) => region.start <= start && end <= region.end).sort((a, b) => b.start - a.start)[0] ?? null;
}

function nextChainLink(masked, close) {
  let j = skipSpace(masked, close + 1);
  if (masked[j] === "?" && masked[j + 1] === ".") j += 2;
  else if (masked[j] === ".") j += 1;
  else return null;
  const name = wordAt(masked, j);
  return name ? { name, nameStart: j } : null;
}

function escapedRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function receiverMutated(masked, loop, receiver) {
  const escaped = escapedRegExp(receiver);
  const mutation = new RegExp(`(?:\\b${escaped}\\s*(?:=|\\+=|-=|\\*=|/=|%=|\\+\\+|--)|\\b${escaped}\\.(?:push|pop|shift|unshift|splice|sort|reverse|copyWithin|fill|set|add|delete|clear)\\s*\\()`);
  return mutation.test(masked.slice(loop.start, loop.end));
}

function argumentReferencesLoopBinding(masked, start, end, loop) {
  const bindings = new Set();
  for (let region = loop; region; region = region.parentLoop) {
    for (const binding of region.bindings) bindings.add(binding);
  }
  for (const match of masked.slice(start, end).matchAll(/\b[A-Za-z_$][\w$]*\b/g)) {
    if (!bindings.has(match[0])) continue;
    const absolute = start + match.index;
    let previous = absolute - 1;
    while (previous >= start && /\s/.test(masked[previous])) previous -= 1;
    let next = absolute + match[0].length;
    while (next < end && /\s/.test(masked[next])) next += 1;
    if (masked[previous] !== "." && masked[next] !== ":") return true;
  }
  return false;
}

function normalizedAnchor(text) {
  return text.replace(/\s+/g, " ").trim();
}

export function scan(roots = ["."], options = {}) {
  const findings = [];
  for (const file of [...new Set(roots.flatMap(filesUnder))].sort()) {
    const source = readFileSync(file, "utf8");
    const searchable = maskNonCode(source);
    const fileName = relative(process.cwd(), file) || file;
    const occurrences = new Map();
    const emit = (kind, start, end, details, confidence = actionableKinds.has(kind) ? "review" : "advisory", anchorStart = start, anchorEnd = end) => {
      const anchor = normalizedAnchor(searchable.slice(anchorStart, anchorEnd));
      const occurrenceKey = `${kind}\0${anchor}`;
      const occurrence = occurrences.get(occurrenceKey) ?? 0;
      occurrences.set(occurrenceKey, occurrence + 1);
      const excerpt = source.slice(start, end).replace(/\s+/g, " ").trim().slice(0, 160);
      const [score, note, currentWork, candidateFloor, proof] = details;
      const finding = {
        id: findingId(kind, fileName, anchor, occurrence),
        score,
        kind,
        confidence,
        file: fileName,
        line: source.slice(0, start).split("\n").length,
        excerpt,
        note,
        currentWork,
        candidateFloor,
        proof,
        surface: /(?:^|[/\\])(?:bench|benchmark|benchmarks)(?:[/\\]|$)|\.bench\.[cm]?[jt]sx?$/.test(file) ? "benchmark" : "product",
      };
      findings.push(finding);
      options.onFinding?.(finding);
    };

    for (const [kind, score, pattern, note, currentWork, candidateFloor, proof] of rules) {
      const matcher = new RegExp(pattern.source, `${pattern.flags}g`);
      for (const match of searchable.matchAll(matcher)) emit(kind, match.index, match.index + match[0].length, [score, note, currentWork, candidateFloor, proof]);
    }

    const { pairs, reversePairs } = lexicalIndex(searchable);
    const loops = loopRegions(searchable, pairs);
    const functions = functionRegions(searchable, pairs, reversePairs);
    const reducers = reducerRegions(searchable, pairs);

    for (const loop of loops) {
      if (loop.parentLoop) emit("nested-loop", loop.loopStart, Math.min(loop.statementEnd, loop.loopStart + 160), structuralRules["nested-loop"], "advisory", loop.loopStart, loop.statementEnd);
    }

    const loopPatterns = [
      ["loop-await", /\bawait\b/g],
      ["loop-parse", /\b(?:JSON\.(?:parse|stringify)|structuredClone|matchAll|innerHTML)\b/g],
      ["loop-callback", /\.(?:map|filter|reduce|flatMap|some|every|find)\s*\(/g],
    ];
    for (const [kind, pattern] of loopPatterns) {
      const emittedLoops = new Set();
      for (const match of searchable.matchAll(pattern)) {
        const loop = containingRegion(loops, match.index, match.index + match[0].length);
        if (loop && !emittedLoops.has(loop)) {
          emittedLoops.add(loop);
          emit(kind, loop.loopStart, match.index + match[0].length, structuralRules[kind], undefined, loop.loopStart, loop.statementEnd);
        }
      }
    }

    for (const match of searchable.matchAll(/\b([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*=\s*\[\s*\.\.\.\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*,/g)) {
      if (match[1] !== match[2]) continue;
      const loop = containingRegion(loops, match.index, match.index + match[0].length);
      if (loop) emit("quadratic-spread-growth", match.index, match.index + match[0].length, structuralRules["quadratic-spread-growth"]);
    }
    for (const reducer of reducers) {
      const pattern = new RegExp(`(?:\\breturn\\s*)?\\[\\s*\\.\\.\\.\\s*${escapedRegExp(reducer.accumulator)}\\s*,`, "g");
      for (const match of searchable.slice(reducer.start, reducer.end).matchAll(pattern)) {
        const start = reducer.start + match.index;
        emit("quadratic-spread-growth", start, start + match[0].length, structuralRules["quadratic-spread-growth"]);
      }
    }

    for (const match of searchable.matchAll(/\b([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\.includes\s*\(/g)) {
      const receiver = match[1];
      if (/(?:alphabet|charset|digits)/i.test(receiver)) continue;
      const open = match.index + match[0].lastIndexOf("(");
      const close = pairs.get(open);
      if (close === undefined) continue;
      const loop = containingRegion(loops, match.index, close + 1);
      if (loop && argumentReferencesLoopBinding(searchable, open + 1, close, loop) && !receiverMutated(searchable, loop, receiver)) {
        emit("repeated-linear-membership", match.index, close + 1, structuralRules["repeated-linear-membership"]);
      }
    }

    for (const match of searchable.matchAll(/(?:\.|\?\.)(filter|map|flatMap)\s*\(/g)) {
      const headName = match[1];
      const open = match.index + match[0].lastIndexOf("(");
      const close = pairs.get(open);
      if (close === undefined) continue;
      let dotIndex = match.index;
      if (searchable[dotIndex] === "?") dotIndex += 1;
      let p = dotIndex - 1;
      while (p >= 0 && /\s/.test(searchable[p])) p -= 1;
      if (p >= 0 && searchable[p] === ")" && reversePairs.has(p)) {
        const enclosingOpen = reversePairs.get(p);
        let q = enclosingOpen - 1;
        while (q >= 0 && /\s/.test(searchable[q])) q -= 1;
        if (q >= 0 && searchable[q] === ".") {
          q -= 1;
          if (q >= 0 && searchable[q] === "?") q -= 1;
          while (q >= 0 && /\s/.test(searchable[q])) q -= 1;
        }
        if (q >= 0 && searchable[q] === ">") {
          let depth = 1;
          let r = q - 1;
          while (r >= 0 && depth > 0) {
            if (searchable[r] === ">") depth += 1;
            else if (searchable[r] === "<") depth -= 1;
            r -= 1;
          }
          if (depth === 0) {
            q = r;
            while (q >= 0 && /\s/.test(searchable[q])) q -= 1;
          } else {
            q = -1;
          }
        }
        let nameEnd = q + 1;
        let nameStart = nameEnd;
        while (nameStart > 0 && /[\w$]/.test(searchable[nameStart - 1])) nameStart -= 1;
        const prevName = searchable.slice(nameStart, nameEnd);
        if (prevName === "filter" || prevName === "map" || prevName === "flatMap") continue;
      }
      const links = [headName];
      let cursor = close;
      for (let step = 0; step < 20; step++) {
        const link = nextChainLink(searchable, cursor);
        if (!link) break;
        if (link.name !== "filter" && link.name !== "map" && link.name !== "flatMap") break;
        let j = skipSpace(searchable, link.nameStart + link.name.length);
        if (searchable[j] === "<") {
          const semi = searchable.indexOf(";", j);
          const paren = searchable.indexOf("(", j);
          if (paren < 0 || (semi >= 0 && semi < paren)) break;
          j = paren;
        }
        j = skipSpace(searchable, j);
        if (searchable[j] === "?" && searchable[j + 1] === ".") j = skipSpace(searchable, j + 2);
        if (searchable[j] !== "(") break;
        const linkClose = pairs.get(j);
        if (linkClose === undefined) break;
        links.push(link.name);
        cursor = linkClose;
      }
      if (links.length >= 2) {
        emit("chained-collection-passes", match.index, cursor + 1, structuralRules["chained-collection-passes"]);
      }
    }

    for (const match of searchable.matchAll(/(?:\.|\?\.)sort\s*\(/g)) {
      const open = match.index + match[0].lastIndexOf("(");
      const close = pairs.get(open);
      if (close === undefined) continue;
      let j = skipSpace(searchable, close + 1);
      let bracketStart = j;
      if (searchable[bracketStart] === "?" && searchable[bracketStart + 1] === "." && searchable[bracketStart + 2] === "[") bracketStart += 2;
      if (searchable[bracketStart] === "[") {
        const bracketClose = pairs.get(bracketStart);
        if (bracketClose !== undefined && /^0n?$/.test(searchable.slice(bracketStart + 1, bracketClose).trim())) {
          emit("full-sort-then-take", match.index, bracketClose + 1, structuralRules["full-sort-then-take"]);
        }
        continue;
      }
      const link = nextChainLink(searchable, close);
      if (!link) continue;
      if (link.name === "at") {
        let k = skipSpace(searchable, link.nameStart + 2);
        if (searchable[k] === "<") {
          const semi = searchable.indexOf(";", k);
          const paren = searchable.indexOf("(", k);
          if (paren < 0 || (semi >= 0 && semi < paren)) continue;
          k = paren;
        }
        k = skipSpace(searchable, k);
        if (searchable[k] === "?" && searchable[k + 1] === ".") k = skipSpace(searchable, k + 2);
        if (searchable[k] !== "(") continue;
        const atClose = pairs.get(k);
        if (atClose === undefined) continue;
        if (searchable.slice(k + 1, atClose).trim() !== "0") continue;
        emit("full-sort-then-take", match.index, atClose + 1, structuralRules["full-sort-then-take"]);
      } else if (link.name === "slice") {
        let s = skipSpace(searchable, link.nameStart + 5);
        if (searchable[s] === "<") {
          const semi = searchable.indexOf(";", s);
          const paren = searchable.indexOf("(", s);
          if (paren < 0 || (semi >= 0 && semi < paren)) continue;
          s = paren;
        }
        s = skipSpace(searchable, s);
        if (searchable[s] === "?" && searchable[s + 1] === ".") s = skipSpace(searchable, s + 2);
        if (searchable[s] !== "(") continue;
        const sliceClose = pairs.get(s);
        if (sliceClose === undefined) continue;
        const argRanges = splitTopLevel(searchable, s + 1, sliceClose, pairs, ",");
        if (argRanges.length < 2) continue;
        const firstArg = searchable.slice(argRanges[0][0], argRanges[0][1]).trim();
        if (firstArg !== "0") continue;
        const secondRaw = searchable.slice(argRanges[1][0], argRanges[1][1]).trim();
        if (!secondRaw) continue;
        const captured = secondRaw.slice(0, 24);
        const base = structuralRules["full-sort-then-take"];
        emit("full-sort-then-take", match.index, sliceClose + 1, [base[0], base[1], `O(N log N) comparator work plus full ordering to retain first ${captured}`, base[3], base[4]]);
      }
    }

    for (const match of searchable.matchAll(/(?:\.|\?\.)(?:sort|toSorted)\s*\(/g)) {
      const open = match.index + match[0].lastIndexOf("(");
      const close = pairs.get(open);
      if (close === undefined) continue;
      const arrow = topLevelIndex(searchable, open + 1, close, pairs, (index) => searchable[index] === "=" && searchable[index + 1] === ">");
      if (arrow < 0) continue;
      let bodyStart = skipSpace(searchable, arrow + 2);
      let bodyEnd = close;
      if (searchable[bodyStart] === "{" && pairs.has(bodyStart) && pairs.get(bodyStart) < close) {
        bodyEnd = pairs.get(bodyStart);
        bodyStart += 1;
      }
      const body = searchable.slice(bodyStart, bodyEnd);
      const repeated = [];
      if (/\bDate\.parse\s*\(/.test(body)) repeated.push("Date.parse");
      if (/\bcompareDateTimeStrings\s*\(/.test(body)) repeated.push("compareDateTimeStrings");
      if (/\bparseTimestamp\s*\(/.test(body)) repeated.push("parseTimestamp");
      if (/\.find\s*\(/.test(body)) repeated.push(".find");
      if (/\bnew\s+Intl\.[A-Za-z_$][\w$]*\s*\(/.test(body)) repeated.push("Intl construction");
      if (/\bstructuredClone\s*\(/.test(body)) repeated.push("structuredClone");
      if (repeated.length > 0) {
        const base = structuralRules["comparator-repeated-work"];
        emit("comparator-repeated-work", match.index, close + 1, [base[0], `${base[1]} (${repeated.join(", ")})`, base[2], base[3], base[4]]);
      }
    }

    for (const match of searchable.matchAll(/(?:\.|\?\.)filter\s*\(/g)) {
      const open = match.index + match[0].lastIndexOf("(");
      const close = pairs.get(open);
      if (close === undefined) continue;
      const link = nextChainLink(searchable, close);
      if (!link || link.name !== "length") continue;
      let j = skipSpace(searchable, link.nameStart + 6);
      let op = null;
      for (const cand of ["===", "!==", "==", "!=", ">=", "<=", ">", "<"]) {
        if (searchable.startsWith(cand, j)) {
          op = cand;
          j += cand.length;
          break;
        }
      }
      if (!op) continue;
      j = skipSpace(searchable, j);
      const numMatch = searchable.slice(j).match(/^(\d+n?)/);
      if (!numMatch) continue;
      const rhsRaw = numMatch[1];
      const rhsEnd = j + rhsRaw.length;
      const after = skipSpace(searchable, rhsEnd);
      if (after < searchable.length && /[\w$.\(+*%/-]/.test(searchable[after])) continue;
      const rhs = rhsRaw.endsWith("n") ? rhsRaw.slice(0, -1) : rhsRaw;
      let hit = false;
      if ((op === ">" && rhs === "0") || (op === "!==" && rhs === "0") || (op === "!=" && rhs === "0") || (op === ">=" && rhs === "1")) hit = true;
      else if ((op === "===" && rhs === "0") || (op === "==" && rhs === "0") || (op === "<=" && rhs === "0") || (op === "<" && rhs === "1")) hit = true;
      if (!hit) continue;
      emit("existential-filter", match.index, rhsEnd, structuralRules["existential-filter"]);
    }

    for (const match of searchable.matchAll(/\bnew\s+(?:Intl\.[A-Za-z_$][\w$]*|RegExp)\s*\(/g)) {
      const open = searchable.indexOf("(", match.index);
      const close = pairs.get(open);
      if (close === undefined || /\b[A-Za-z_$][\w$]*\b/.test(searchable.slice(open + 1, close))) continue;
      const body = containingRegion(functions, match.index, close + 1);
      if (body) emit("per-call-static-construction", match.index, close + 1, structuralRules["per-call-static-construction"], "advisory");
    }
  }
  return findings.sort((a, b) => b.score - a.score || a.file.localeCompare(b.file) || a.line - b.line || a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
}

function main(argv) {
  pruneLedgers();
  const cleanup = argv.includes("--cleanup-ledger");
  if (cleanup) {
    rmSync(join(ledgerBase, sessionKey()), { recursive: true, force: true });
    console.log(JSON.stringify({ type: "ledger-cleaned", ledger: ledgerPath() }));
    return;
  }
  const dismissArg = argv.find((arg) => arg.startsWith("--dismiss="));
  if (dismissArg) {
    const id = dismissArg.slice("--dismiss=".length);
    const reason = argv.find((arg) => arg.startsWith("--reason="))?.slice("--reason=".length) || "false-positive";
    mkdirSync(join(ledgerBase, sessionKey()), { recursive: true });
    appendFileSync(ledgerPath(), `${JSON.stringify({ id, reason, at: new Date().toISOString() })}\n`);
    console.log(JSON.stringify({ type: "dismissed", id, reason, ledger: ledgerPath() }));
    return;
  }
  const json = argv.includes("--json");
  const stream = argv.includes("--stream");
  const includeAdvisory = argv.includes("--include-advisory");
  const maxArg = argv.find((arg) => arg.startsWith("--max="));
  const max = maxArg ? Number(maxArg.slice(6)) : 20;
  if (!Number.isInteger(max) || max < 1) throw new Error("--max must be a positive integer");
  const roots = argv.filter((arg) => !arg.startsWith("--"));
  const dismissed = dismissedIds();
  let streamedCount = 0;
  if (stream) console.log(JSON.stringify({ type: "start", claim: "static candidates, not measured hot paths", ledger: ledgerPath() }));
  const scannedFindings = scan(roots.length ? roots : ["."], {
    onFinding: stream
      ? (finding) => {
          if (dismissed.has(finding.id)) return;
          if (!includeAdvisory && finding.confidence !== "review") return;
          if (streamedCount >= max) return;
          streamedCount += 1;
          console.log(JSON.stringify({ type: "finding", ...finding }));
        }
      : undefined,
  });
  const allFindings = scannedFindings.filter((finding) => !dismissed.has(finding.id));
  const reviewed = includeAdvisory
    ? allFindings
    : allFindings.filter((finding) => finding.confidence === "review");
  const findings = reviewed.slice(0, max);
  const summary = {
    reported: findings.length,
    matched: allFindings.length,
    advisorySuppressed: includeAdvisory ? 0 : allFindings.length - reviewed.length,
    truncated: Math.max(0, reviewed.length - findings.length),
    dismissed: scannedFindings.length - allFindings.length,
    ledger: ledgerPath(),
    cleanup: "node <skill-dir>/scripts/static-audit.mjs --cleanup-ledger",
  };
  if (stream) {
    console.log(JSON.stringify({ type: "summary", ...summary }));
  } else if (json) console.log(JSON.stringify({ claim: "static candidates, not measured hot paths", summary, findings }, null, 2));
  else {
    console.log("Static candidates, not measured hot paths\n");
    for (const item of findings) console.log(`${item.score}\t${item.kind}\t${item.surface}\t${item.file}:${item.line}\n  evidence: ${item.excerpt}\n  current:  ${item.currentWork}\n  floor:    ${item.candidateFloor}\n  prove:    ${item.proof}`);
    console.log(`\n${summary.reported} reported; ${summary.advisorySuppressed} advisory suppressed; ${summary.truncated} truncated.`);
    console.log("Review source and establish runtime frequency before editing. Use --include-advisory for noisy syntax leads.");
  }
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
