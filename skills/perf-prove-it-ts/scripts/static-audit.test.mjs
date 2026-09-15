#!/usr/bin/env node
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scan } from "./static-audit.mjs";
const fixture = mkdtempSync(join(tmpdir(), "perf-static-audit-"));

function write(name, source) {
  const path = join(fixture, name);
  writeFileSync(path, source);
  return path;
}

write("hot.ts", `
export async function load(ids: string[]) {
  for (const id of ids) await fetch(id);
}
export function matrix(rows: number[][]) {
  for (const row of rows) for (const value of row) console.log(value);
}
export function max(values: number[]) { return Math.max(...values); }
export function subscribe(owner: any, value: any, slot: number) {
  owner.sources.push(value);
  owner.sourceSlots!.push(slot);
}
`);
write("ignored.txt", "for (;;) await work()");
write("ignored.test.ts", "for (;;) await work()");
write("cold.ts", `const text = "for (;;) await work()"; // for (;;) await work()`);
mkdirSync(join(fixture, ".repos"));
writeFileSync(join(fixture, ".repos", "vendored.ts"), "for (;;) await work()");
mkdirSync(join(fixture, "benchmarks"));
writeFileSync(join(fixture, "benchmarks", "throughput.ts"), "export const run = (xs: number[]) => Math.max(...xs)");

const findings = scan([fixture]);
const kinds = new Set(findings.map((finding) => finding.kind));
const packedFindings = scan([write("packed.ts", `
export function subscribe(owner: any, value: any, slot: number) {
  owner.sources.push(value, slot);
}
`)]);

const cases = [
  {
    name: "nested loops are structural, sequential loops are not",
    source: `for (const x of xs) use(x); for (const y of ys) use(y);\nfor (const x of xs) { while (ready) use(x); }`,
    kind: "nested-loop",
    count: 1,
    check: (matches) => matches[0]?.confidence === "advisory",
  },
  {
    name: "await is limited to the actual single-statement loop body",
    source: `for (const x of xs) use(x); await after();\nfor (const y of ys) { await inside(y); }`,
    kind: "loop-await",
    count: 1,
  },
  {
    name: "do-while bodies are indexed structurally",
    source: `do await inside(); while (ready); await after();`,
    kind: "loop-await",
    count: 1,
  },
  {
    name: "parse is limited to the actual loop body",
    source: `while (ready) tick(); JSON.parse(after);\nwhile (ready) { JSON.parse(inside); }`,
    kind: "loop-parse",
    count: 1,
  },
  {
    name: "callback is limited to the actual loop body",
    source: `for (const x of xs) use(x); ys.map(after);\nfor (const x of xs) ys.filter(test);`,
    kind: "loop-callback",
    count: 1,
  },
  {
    name: "only self-spread growth in a loop is quadratic",
    source: `for (const x of xs) out = [...other, x];\nfor (const x of xs) out = [...out, x];`,
    kind: "quadratic-spread-growth",
    count: 1,
    check: (matches) => /1 \+ 2/.test(matches[0]?.currentWork) && /N array allocations/.test(matches[0]?.currentWork) && /order/.test(matches[0]?.proof),
  },
  {
    name: "reducer accumulator self-spread is quadratic",
    source: `const out = xs.reduce((acc, x) => [...acc, x], []); const copy = [...out];`,
    kind: "quadratic-spread-growth",
    count: 1,
  },
  {
    name: "stable collection includes an iteration-derived value but a mutated receiver does not",
    source: `for (const item of items) allowed.includes(item.id);\nfor (const item of items) { mutable.push(item.id); mutable.includes(item.id); }`,
    kind: "repeated-linear-membership",
    count: 1,
    check: (matches) => matches[0]?.confidence === "review" && /O\(N×M\)/.test(matches[0]?.currentWork) && /SameValueZero/.test(matches[0]?.proof),
  },
  {
    name: "constant and string-like includes arguments are ignored",
    source: `for (const item of items) { item.path.includes("$"); allowed.includes("fixed"); }`,
    kind: "repeated-linear-membership",
    count: 0,
  },
  {
    name: "destructured and classic declaration bindings are recognized",
    source: `for (const { id, value: alias } of items) { allowed.includes(id); aliases.includes(alias); items.includes(items); }\nfor (let i = 0; i < items.length; i++) allowed.includes(i);`,
    kind: "repeated-linear-membership",
    count: 3,
  },
  {
    name: "string indexOf and fixed alphabet names are ignored",
    source: `for (const x of xs) text.indexOf(x); for (const x of xs) HEX_DIGITS.includes(x);`,
    kind: "repeated-linear-membership",
    count: 0,
  },
  {
    name: "construction must be inside a recognizable function body",
    source: `const globalPattern = new RegExp("x"); function build() { return new RegExp("x"); } const arrow = () => { return new Intl.Collator("en"); }; const owner = { method() { return new RegExp("y"); } };`,
    kind: "per-call-static-construction",
    count: 3,
    check: (matches) => matches.every((finding) => finding.confidence === "advisory"),
  },
  {
    name: "broad one-off spread calls do not trigger",
    source: `consume(...xs); const ys = [...xs]; Math.min(...xs);`,
    kind: "spread-call",
    count: 1,
  },
  {
    name: "adjacent filter-map chain fires once",
    source: `const a = xs.filter(f).map(g);`,
    kind: "chained-collection-passes",
    count: 1,
    check: (matches) => matches[0]?.confidence === "advisory" && /P passes|intermediate/.test(matches[0]?.currentWork),
  },
  {
    name: "triple chain emits once",
    source: `const a = xs.map(f).filter(g).flatMap(h);`,
    kind: "chained-collection-passes",
    count: 1,
  },
  {
    name: "separate statements and nested callbacks do not fire",
    source: `xs.filter(f); xs.map(g);\nys.filter(x => zs.map(h));`,
    kind: "chained-collection-passes",
    count: 0,
  },
  {
    name: "multiline optional chain fires",
    source: `const ys = xs\n  ?.map(f)\n  ?.filter(g);`,
    kind: "chained-collection-passes",
    count: 1,
  },
  {
    name: "sort index zero and at(0) fire",
    source: `const a = xs.sort(cmp)[0];\nconst b = ys.sort(cmp).at(0);`,
    kind: "full-sort-then-take",
    count: 2,
    check: (matches) => matches.every((finding) => finding.confidence === "advisory"),
  },
  {
    name: "sort slice with identifier k fires with k in the model",
    source: `const b = roster.slice().sort(rank).slice(0, LIMIT);`,
    kind: "full-sort-then-take",
    count: 1,
    check: (matches) => /LIMIT/.test(matches[0]?.currentWork),
  },
  {
    name: "bare sort, slice copy, and index one do not fire",
    source: `const s = xs.sort(cmp);\nconst c = xs.sort(cmp).slice(0);\nconst second = xs.sort(cmp)[1];`,
    kind: "full-sort-then-take",
    count: 0,
  },
  {
    name: "filter length compared against zero fires",
    source: `if (xs.filter(f).length > 0) a();\nif (ys.filter(g).length === 0) b();`,
    kind: "existential-filter",
    count: 2,
    check: (matches) => matches.every((finding) => finding.confidence === "advisory"),
  },
  {
    name: "measured and non-existential lengths do not fire",
    source: `if (xs.filter(f).length > 1) a();\nif (ys.filter(g).length > LIMIT) b();\nconst n = zs.filter(h).length;\nif (xs.length > 0) c();\nif (xs.some((x) => x.ready)) d();\nconst hit = ys.find((y) => y.ok);`,
    kind: "existential-filter",
    count: 0,
  },
  {
    name: "date parse inside a comparator is review",
    source: `rows.sort((left, right) => Date.parse(left.at) - Date.parse(right.at));`,
    kind: "comparator-repeated-work",
    count: 1,
    check: (matches) => matches[0]?.confidence === "review" && /O\(N log N\)/.test(matches[0]?.currentWork) && /Date\.parse/.test(matches[0]?.note),
  },
  {
    name: "search helper inside a comparator fires",
    source: `entries.toSorted((left, right) => compareDateTimeStrings(left.at, right.at) || left.id.localeCompare(right.id));`,
    kind: "comparator-repeated-work",
    count: 1,
    check: (matches) => /compareDateTimeStrings/.test(matches[0]?.note),
  },
  {
    name: "find inside a comparator fires on nested callbacks",
    source: `items.sort((a, b) => list.find((x) => x.id === a.id).rank - list.find((x) => x.id === b.id).rank);`,
    kind: "comparator-repeated-work",
    count: 1,
    check: (matches) => /\.find/.test(matches[0]?.note),
  },
  {
    name: "block body and multiline comparator still fire",
    source: `rows.sort((a, b) => {\n  const left = Date.parse(a.at);\n  return left - Date.parse(b.at);\n});`,
    kind: "comparator-repeated-work",
    count: 1,
  },
  {
    name: "plain numeric comparators and parse outside the comparator do not fire",
    source: `rows.sort((a, b) => a.at - b.at);\nconst t = Date.parse(x.at);\nrows.sort(byName);\nrows.sort();`,
    kind: "comparator-repeated-work",
    count: 0,
  },
  {
    name: "local call sites raise the enclosing function's rank",
    source: `function handler() { for (const item of items) allowed.includes(item.id); }\nhandler(1); handler(2); handler(3);`,
    kind: "repeated-linear-membership",
    count: 1,
    check: (matches) => matches[0]?.enclosingFunction === "handler" && matches[0]?.staticCallSites === 3 && matches[0]?.rankBoost === 2 && matches[0]?.score === 9,
  },
  {
    name: "uncalled local functions keep the base rank",
    source: `function lonely() { for (const item of items) allowed.includes(item.id); }`,
    kind: "repeated-linear-membership",
    count: 1,
    check: (matches) => matches[0]?.enclosingFunction === "lonely" && matches[0]?.staticCallSites === 0 && matches[0]?.rankBoost === 0 && matches[0]?.score === 7,
  },
  {
    name: "framework calls such as useState never raise a rank",
    source: `function screen() { const [open] = useState(false); for (const item of items) allowed.includes(item.id); }\nuseState(true); useState(false); useState(0);`,
    kind: "repeated-linear-membership",
    count: 1,
    check: (matches) => matches[0]?.enclosingFunction === "screen" && matches[0]?.staticCallSites === 0 && matches[0]?.score === 7,
  },
  {
    name: "this-method call sites count toward the method's rank",
    source: `class Grid { render() { for (const item of items) allowed.includes(item.id); } tick() { this.render(); } }`,
    kind: "repeated-linear-membership",
    count: 1,
    check: (matches) => matches[0]?.enclosingFunction === "render" && matches[0]?.staticCallSites === 1 && matches[0]?.rankBoost === 1 && matches[0]?.score === 8,
  },
];

const failures = [
  [kinds.has("loop-await"), "loop-await not found"],
  [kinds.has("nested-loop"), "nested-loop not found"],
  [kinds.has("spread-call"), "spread-call not found"],
  [kinds.has("parallel-array-growth"), "parallel-array-growth not found"],
  [findings.every((finding) => finding.currentWork && finding.candidateFloor && finding.proof), "process fields missing"],
  [findings.every((finding) => finding.confidence === "review" || finding.confidence === "advisory"), "confidence missing"],
  [findings.every((finding) => !finding.file.includes(".repos") && !finding.file.includes("ignored")), "ignored source scanned"],
  [findings.some((finding) => finding.surface === "benchmark" && finding.file.endsWith("throughput.ts")), "benchmark not scanned and labeled"],
  [findings.every((finding, index, all) => index === 0 || all[index - 1].score >= finding.score), "findings not score-sorted"],
  [!packedFindings.some((finding) => finding.kind === "parallel-array-growth"), "packed representation still flagged"],
];

for (const testCase of cases) {
  const path = write(`case-${cases.indexOf(testCase)}.ts`, testCase.source);
  const matches = scan([path]).filter((finding) => finding.kind === testCase.kind);
  failures.push([matches.length === testCase.count, `${testCase.name}: expected ${testCase.count}, got ${matches.length}`]);
  if (testCase.check) failures.push([testCase.check(matches), `${testCase.name}: metadata check failed`]);
}

const repeatedPath = write("repeated.ts", `
for (const x of xs) { await work(x); }
for (const x of xs) { await work(x); }
`);
const firstScan = scan([repeatedPath]);
const secondScan = scan([repeatedPath]);
failures.push([new Set(firstScan.map((finding) => finding.id)).size === firstScan.length, "finding IDs are not unique"]);
failures.push([JSON.stringify(firstScan.map((finding) => finding.id)) === JSON.stringify(secondScan.map((finding) => finding.id)), "finding IDs are not deterministic"]);

const actualFailures = failures.filter(([ok]) => !ok);
if (actualFailures.length) {
  for (const [, message] of actualFailures) console.error(message);
  process.exit(1);
}
console.log(`static audit test: all ${cases.length + 12} cases pass`);
