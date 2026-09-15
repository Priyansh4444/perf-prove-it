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
  {
    name: "semicolons inside an object/tuple return type do not hide the function",
    source: `function inner(): [{ a: number; b: number }] { for (const x of xs) allowed.includes(x); return []; }`,
    kind: "repeated-linear-membership",
    count: 1,
    check: (matches) => matches[0]?.enclosingFunction === "inner" && matches[0]?.staticCallSites === 0,
  },
  {
    name: "typed arrow returning an object type keeps its enclosing name",
    source: `const f = (): { a: number } => { for (const x of xs) allowed.includes(x); return { a: 1 }; };`,
    kind: "repeated-linear-membership",
    count: 1,
    check: (matches) => matches[0]?.enclosingFunction === "f" && matches[0]?.staticCallSites === 0,
  },
  {
    name: "interface and typed signatures are not call sites",
    source: `interface I { render(): void; }\nexport function render(): void { for (const x of xs) allowed.includes(x); }`,
    kind: "repeated-linear-membership",
    count: 1,
    check: (matches) => matches[0]?.enclosingFunction === "render" && matches[0]?.staticCallSites === 0 && matches[0]?.rankBoost === 0,
  },
  {
    name: "method overload signatures are not call sites",
    source: `class C { compute(a: string): void; compute(a: number): void; compute(a: unknown): void { for (const x of xs) allowed.includes(x); } }`,
    kind: "repeated-linear-membership",
    count: 1,
    check: (matches) => matches[0]?.enclosingFunction === "compute" && matches[0]?.staticCallSites === 0,
  },
  {
    name: "regex literals neither count as calls nor hide later findings",
    source: `export function foo(): void { for (const x of xs) allowed.includes(x); }\nconst re = /don't|foo(b/;`,
    kind: "repeated-linear-membership",
    count: 1,
    check: (matches) => matches[0]?.enclosingFunction === "foo" && matches[0]?.staticCallSites === 0 && matches[0]?.rankBoost === 0,
  },
  {
    name: "division after a keyword-named property or postfix operator is not a regex",
    source: `export function divider(): void { for (const x of xs) allowed.includes(x); }\nconst q = obj.in / obj.out;\nlet n = 0; const r = n++ / 2;`,
    kind: "repeated-linear-membership",
    count: 1,
    check: (matches) => matches[0]?.enclosingFunction === "divider" && matches[0]?.staticCallSites === 0,
  },
  {
    name: "calls followed by a colon in ternaries and case labels still count",
    source: `export function shared(): void { for (const x of xs) allowed.includes(x); }\nconst y = c ? shared() : 0;\nswitch (n) { case shared(): break; }`,
    kind: "repeated-linear-membership",
    count: 1,
    check: (matches) => matches[0]?.enclosingFunction === "shared" && matches[0]?.staticCallSites === 2 && matches[0]?.rankBoost === 1,
  },
  {
    name: "escaped bracket regex does not hide later findings",
    source: `const re = /\\[/g;\nexport function esc(): void { for (const x of xs) allowed.includes(x); }`,
    kind: "repeated-linear-membership",
    count: 1,
    check: (matches) => matches[0]?.enclosingFunction === "esc",
  },
  {
    name: "division after string and template literals is not a regex",
    source: "export function strDiv(): void { for (const x of xs) allowed.includes(x); }\nconst q = \"x\" / 2;\nconst t = `x` / 2;",
    kind: "repeated-linear-membership",
    count: 1,
    check: (matches) => matches[0]?.enclosingFunction === "strDiv",
  },
  {
    name: "division after a non-null assertion is not a regex",
    source: `export function nonNull(): void { for (const x of xs) allowed.includes(x); }\nconst q = a! / 2;`,
    kind: "repeated-linear-membership",
    count: 1,
    check: (matches) => matches[0]?.enclosingFunction === "nonNull",
  },
  {
    name: "class field ternary calls are counted",
    source: `export function shared(): void { for (const x of xs) allowed.includes(x); }\nclass A { x = c ? shared() : 0; }`,
    kind: "repeated-linear-membership",
    count: 1,
    check: (matches) => matches[0]?.staticCallSites === 1 && matches[0]?.rankBoost === 1,
  },
  {
    name: "wrapped and intersected object type aliases are not call sites",
    source: `export function render(): void { for (const x of xs) allowed.includes(x); }\ntype T = Readonly<{ render(): void }>;\ntype U = A & { render(): void };`,
    kind: "repeated-linear-membership",
    count: 1,
    check: (matches) => matches[0]?.staticCallSites === 0 && matches[0]?.rankBoost === 0,
  },
  {
    name: "division after a block or object literal is not a regex",
    source: `const y = { a: 1 } / 2; export function blockDiv(): void { for (const x of xs) allowed.includes(x); }`,
    kind: "repeated-linear-membership",
    count: 1,
    check: (matches) => matches[0]?.enclosingFunction === "blockDiv",
  },
  {
    name: "object types inside interface heritage generics are not call sites",
    source: `interface I extends A<{ z: number }> { render(): void }\nexport function render(): void { for (const x of xs) allowed.includes(x); }`,
    kind: "repeated-linear-membership",
    count: 1,
    check: (matches) => matches[0]?.staticCallSites === 0 && matches[0]?.rankBoost === 0,
  },
  {
    name: "class type parameters do not defeat overload signature detection",
    source: `class C<T> { compute(a: string): void; compute(a: number): void; compute(a: unknown): void { for (const x of xs) allowed.includes(x); } }`,
    kind: "repeated-linear-membership",
    count: 1,
    check: (matches) => matches[0]?.enclosingFunction === "compute" && matches[0]?.staticCallSites === 0,
  },
  {
    name: "a keyword inside a line comment does not turn a following division into a regex",
    source: `const q = a // return\n/ 2; export function f(): void { for (const x of xs) allowed.includes(x); }`,
    kind: "repeated-linear-membership",
    count: 1,
    check: (matches) => matches[0]?.enclosingFunction === "f",
  },
  {
    name: "division after a generic type assertion is not a regex",
    source: `const q = a as T<U> / 2; export function g(): void { for (const x of xs) allowed.includes(x); }`,
    kind: "repeated-linear-membership",
    count: 1,
    check: (matches) => matches[0]?.enclosingFunction === "g",
  },
  {
    name: "a regex in statement position after a control header does not hide a same-line finding",
    source: `if (x) /{/.test(s); export function fn(): void { for (const x of xs) allowed.includes(x); }`,
    kind: "repeated-linear-membership",
    count: 1,
    check: (matches) => matches[0]?.enclosingFunction === "fn",
  },
  {
    name: "division after a call or parenthesized expression is not a regex",
    source: `const a = f() / 2; const b = (x + y) / 2; export function div2(): void { for (const x of xs) allowed.includes(x); }`,
    kind: "repeated-linear-membership",
    count: 1,
    check: (matches) => matches[0]?.enclosingFunction === "div2",
  },
  {
    name: "nine call sites rank +2, ten rank +3",
    source: `function handler() { for (const item of items) allowed.includes(item.id); }\n` + Array.from({ length: 9 }, (_, i) => `handler(${i});`).join("\n"),
    kind: "repeated-linear-membership",
    count: 1,
    check: (matches) => matches[0]?.staticCallSites === 9 && matches[0]?.rankBoost === 2 && matches[0]?.score === 9,
  },
  {
    name: "ten call sites reach the top rank boost",
    source: `function handler() { for (const item of items) allowed.includes(item.id); }\n` + Array.from({ length: 10 }, (_, i) => `handler(${i});`).join("\n"),
    kind: "repeated-linear-membership",
    count: 1,
    check: (matches) => matches[0]?.staticCallSites === 10 && matches[0]?.rankBoost === 3 && matches[0]?.score === 10,
  },
  {
    name: "free function overload signatures are not call sites",
    source: `function foo(a: string): void;\nfunction foo(a: number): void;\nfunction foo(a: any): void { for (const x of xs) allowed.includes(x); }`,
    kind: "repeated-linear-membership",
    count: 1,
    check: (matches) => matches[0]?.enclosingFunction === "foo" && matches[0]?.staticCallSites === 0 && matches[0]?.rankBoost === 0,
  },
  {
    name: "calls through a foreign receiver are not call sites",
    source: `function render() { for (const x of xs) allowed.includes(x); }\nother.render();`,
    kind: "repeated-linear-membership",
    count: 1,
    check: (matches) => matches[0]?.enclosingFunction === "render" && matches[0]?.staticCallSites === 0,
  },
  {
    name: "anonymous arrow inside a named function inherits its name",
    source: `function outer() { return [].map(() => { for (const x of xs) allowed.includes(x); }); }`,
    kind: "repeated-linear-membership",
    count: 1,
    check: (matches) => matches[0]?.enclosingFunction === "outer" && matches[0]?.staticCallSites === 0,
  },
  {
    name: "function returning an array of object types keeps its name",
    source: `function f(): { a: number }[] { for (const x of xs) allowed.includes(x); }`,
    kind: "repeated-linear-membership",
    count: 1,
    check: (matches) => matches[0]?.enclosingFunction === "f" && matches[0]?.staticCallSites === 0,
  },
  {
    name: "arrow returning a tuple type keeps its name",
    source: `const f = (): [number, string] => { for (const x of xs) allowed.includes(x); return []; };`,
    kind: "repeated-linear-membership",
    count: 1,
    check: (matches) => matches[0]?.enclosingFunction === "f",
  },
  {
    name: "regex text after a control header is not a phantom loop",
    source: `if (x) /for (const y of ys) await f(y)/.test(s);`,
    kind: "loop-await",
    count: 0,
  },
  {
    name: "regex text after return is not a phantom loop",
    source: `function check() { return /for (const y of ys) await f(y)/.test(s); }`,
    kind: "loop-await",
    count: 0,
  },
  {
    name: "regex text after a prefix bang is not a phantom loop",
    source: `const ok = ! /for (const y of ys) await f(y)/.test(s);`,
    kind: "loop-await",
    count: 0,
  },
  {
    name: "code inside an inline block comment is not a finding",
    source: `export function f(): void { for (const x of xs) { /* allowed.includes(x) */ consume(x); } }`,
    kind: "repeated-linear-membership",
    count: 0,
  },
  {
    name: "a comment between chained links does not hide the chain",
    source: `export function chain(xs: number[]) {\n  return xs\n    .map((x) => x + 1)\n    // drop non-positives before publishing\n    .filter((x) => x > 0);\n}`,
    kind: "chained-collection-passes",
    count: 1,
    check: (matches) => matches[0]?.enclosingFunction === "chain",
  },
  {
    name: "carriage-return-only line comments do not swallow the file",
    source: `// comment\rexport function f(): void { for (const x of xs) allowed.includes(x); }`,
    kind: "repeated-linear-membership",
    count: 1,
    check: (matches) => matches[0]?.enclosingFunction === "f",
  },
  {
    name: "a shebang line is not scanned for findings",
    source: `#!/usr/bin/env node Math.max(...xs)\nexport function f(): void { for (const x of xs) allowed.includes(x); }`,
    kind: "spread-call",
    count: 0,
  },
  {
    name: "annex-b html comments are masked",
    source: `<!-- Math.max(...xs)\nconst a = 1;\nexport function f(): void { for (const x of xs) allowed.includes(x); }`,
    kind: "spread-call",
    count: 0,
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

const crossA = write("cross-a.ts", `export function shared(): void { for (const x of xs) allowed.includes(x); }`);
const crossB = write("cross-b.ts", `shared();\nshared();\nshared();`);
const sharedFinding = scan([crossA, crossB]).find((finding) => finding.enclosingFunction === "shared");
failures.push([sharedFinding?.staticCallSites === 3 && sharedFinding?.rankBoost === 2, `cross-file call sites not counted across files: ${sharedFinding?.staticCallSites}/${sharedFinding?.rankBoost}`]);

const actualFailures = failures.filter(([ok]) => !ok);
if (actualFailures.length) {
  for (const [, message] of actualFailures) console.error(message);
  process.exit(1);
}
console.log(`static audit test: all ${cases.length + 13} cases pass`);
