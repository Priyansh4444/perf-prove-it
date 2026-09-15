#!/usr/bin/env node
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { resolveParser, analyze, maskRanges, withParents, commentRanges } from "./code-model.mjs";
import { scan } from "./static-audit.mjs";

const forcedLexical = process.env.PERF_PROVE_IT_LEXICAL && !["0", "false"].includes(process.env.PERF_PROVE_IT_LEXICAL);
if (forcedLexical) {
  console.log("code-model test: lexical fallback forced; AST assertions skipped");
  process.exit(0);
}

const parser = resolveParser(["."]);
const failures = [];
const check = (ok, message) => {
  if (!ok) failures.push(message);
};

if (parser && parser.name !== "typescript") {
  console.log(`code-model test: ${parser.name} backend forced; typescript-specific assertions skipped`);
  process.exit(0);
}

if (!parser) {
  console.log("code-model test: no parser resolvable (install typescript, @babel/parser, or acorn); AST assertions skipped");
} else {
  const functionsOf = (source, fileName) => analyze(source, fileName, parser).functions.map((region) => region.name);
  const callsOf = (source, fileName) => analyze(source, fileName, parser).calls.map((call) => call.name);

  check(parser.name === "typescript", `expected typescript parser, got ${parser.name}`);

  const forAwait = "export async function gen(xs) { for await (const x of xs) { JSON.parse(x); } }";
  check(functionsOf(forAwait, "a.ts").includes("gen"), "for-await function not named");

  const generics = "export class C { map<T>(items: T[]) { return items; } }\nexport const arrow = <T>(items: T[]) => items;\nexport const worker = function (items) { return items; };";
  const genericNames = functionsOf(generics, "a.ts");
  check(genericNames.includes("map") && genericNames.includes("arrow") && genericNames.includes("worker"), `generic/assigned functions not named: ${genericNames}`);

  const typedArrow = "const f = (): { a: number } => ({ a: 1 });";
  check(functionsOf(typedArrow, "a.ts")[0] === "f", "typed arrow not named");

  const typeOnly = "type T<A extends B<C>> = { render(): void };\ninterface I extends A<{ z: number }> { m(): void }";
  check(analyze(typeOnly, "a.ts", parser).functions.length === 0, "type-only declarations produced function regions");

  const calls = "f(); obj.f(); this.f(); new F(); f<T>();";
  const found = callsOf(calls, "a.ts");
  check(found.filter((name) => name === "f").length === 3, `expected f(), this.f(), and f<T>() only, got ${found}`);
  check(!found.includes("obj"), "member call on another receiver counted");
  check(found.includes("F"), "new F() not counted");

  const nonCodeSource = "const s = \"text\"; const re = /a\\/b/; const t = `x${y}z`; // comment\nconst n = 1;";
  const model = analyze(nonCodeSource, "a.ts", parser);
  const masked = maskRanges(nonCodeSource, model.nonCode);
  check(!masked.includes("text"), "string literal not masked");
  check(!masked.includes("a\\/b"), "regex literal not masked");
  check(!masked.includes("comment"), "comment not masked");
  check(masked.includes("const s ="), "code was masked");
  check(masked.includes("const n = 1;"), "code after literals was masked");
  check(masked.length === nonCodeSource.length, "masking changed source length");

  const nested = "function outer() { return [].map(() => { for (const x of xs) allowed.includes(x); }); }";
  const regions = withParents(analyze(nested, "a.ts", parser).functions);
  const inner = regions.find((region) => !region.name);
  check(inner && inner.parent && inner.parent.name === "outer", "anonymous region did not inherit a named parent");

  const commented = "export function f(){ for (const x of xs) { /* allowed.includes(x) */ consume(x); } }\n";
  const commentedMask = maskRanges(commented, analyze(commented, "a.ts", parser).nonCode);
  check(!commentedMask.includes("allowed.includes"), "inline comment not masked");

  const shebang = "#!/usr/bin/env node Math.max(...xs)\nexport function f(): void {}\n";
  check(!maskRanges(shebang, analyze(shebang, "a.js", parser).nonCode).includes("Math.max"), "shebang not masked");

  const bomShebang = "\uFEFF#!/usr/bin/env node Math.max(...xs)\nexport function f(): void {}\n";
  check(!maskRanges(bomShebang, analyze(bomShebang, "a.js", parser).nonCode).includes("Math.max"), "BOM-prefixed shebang not masked");

  const crComment = "// c\rexport function f(): void {}\n";
  check(maskRanges(crComment, analyze(crComment, "a.ts", parser).nonCode).includes("function f"), "carriage-return comment hid code");

  check(commentRanges("<!-- f(x)\nconst a = 1;", []).length === 1, "annex-b open comment not detected");
  check(commentRanges("  --> f(x)\n", []).length === 1, "annex-b close comment not detected");

  const req = createRequire(import.meta.url);
  const load = (name) => {
    try {
      return { name, api: req(name) };
    } catch {
      return null;
    }
  };
  const babel = load("@babel/parser");
  if (babel) {
    check(analyze("f?.(); this?.f();", "a.ts", babel).calls.length === 2, "babel missed optional calls");
    check(analyze("export const h = { compute: () => 1 };", "a.ts", babel).functions[0]?.name === "compute", "babel missed object-property function name");
    check(analyze("@dec class A { m() {} }", "a.ts", babel).functions.some((region) => region.name === "m"), "babel failed on decorators");
    const html = "<!-- Math.max(...xs)\nconst a = 1;\n";
    check(!maskRanges(html, analyze(html, "a.js", babel).nonCode).includes("Math.max"), "babel HTML comment not masked");
  }
  const acorn = load("acorn");
  if (acorn) {
    const classNames = analyze("class C { m() {} get value() { return 1; } }", "a.js", acorn).functions.map((region) => region.name);
    check(classNames.includes("m") && classNames.includes("value"), `acorn missed class member names: ${classNames}`);
  }
}

const fixture = mkdtempSync(join(tmpdir(), "perf-code-model-"));
function write(name, source) {
  const path = join(fixture, name);
  writeFileSync(path, source);
  return path;
}

const regexPhantom = write("regex.ts", "1 < /target(?:x)/;\nexport function target(): void { for (const x of xs) allowed.includes(x); }\n");
const regexFinding = scan([regexPhantom]).find((finding) => finding.kind === "repeated-linear-membership");
check(regexFinding?.staticCallSites === 0, `regex content inflated call sites: ${regexFinding?.staticCallSites}`);

const divHidden = write("division.ts", "const a = f() / 2; export function divider(): void { for (const x of xs) allowed.includes(x); }\n");
check(scan([divHidden]).some((finding) => finding.enclosingFunction === "divider"), "division hid a same-line finding");

const crossA = write("cross-a.ts", "export function shared(): void { for (const x of xs) allowed.includes(x); }\n");
const crossB = write("cross-b.ts", "shared(); shared(); shared();\n");
const crossFinding = scan([crossA, crossB]).find((finding) => finding.enclosingFunction === "shared");
check(crossFinding?.staticCallSites === 3, `cross-file call count wrong: ${crossFinding?.staticCallSites}`);

const framework = write("framework.ts", "import { useState } from \"react\";\nexport function Widget() { const [o] = useState(false); for (const x of xs) allowed.includes(x); }\n");
check(!scan([framework]).some((finding) => finding.enclosingFunction === "useState"), "useState became an enclosing function");

const forAwaitFile = write("for-await.ts", "export async function gen(xs) { for await (const x of xs) { JSON.parse(x); } }\n");
const forAwaitFinding = scan([forAwaitFile]).find((finding) => finding.kind === "loop-parse");
check(forAwaitFinding?.enclosingFunction === "gen", "for-await loop not attributed to its function");

if (failures.length) {
  for (const failure of failures) console.error(failure);
  process.exit(1);
}
console.log(`code-model test: ${parser ? `${parser.name} backend` : "lexical"}; all assertions pass`);
