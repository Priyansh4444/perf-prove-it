#!/usr/bin/env node
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scan } from "./static-audit.mjs";
const fixture = mkdtempSync(join(tmpdir(), "perf-static-audit-"));
writeFileSync(join(fixture, "hot.ts"), `
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
writeFileSync(join(fixture, "ignored.txt"), "for (;;) await work()");
writeFileSync(join(fixture, "ignored.test.ts"), "for (;;) await work()");
writeFileSync(join(fixture, "cold.ts"), `const text = "for (;;) await work()"; // for (;;) await work()`);
mkdirSync(join(fixture, ".repos"));
writeFileSync(join(fixture, ".repos", "vendored.ts"), "for (;;) await work()");
mkdirSync(join(fixture, "benchmarks"));
writeFileSync(join(fixture, "benchmarks", "throughput.ts"), "export const run = (xs: number[]) => Math.max(...xs)");

const findings = scan([fixture]);
const kinds = new Set(findings.map((finding) => finding.kind));
const packed = join(fixture, "packed.ts");
writeFileSync(packed, `
export function subscribe(owner: any, value: any, slot: number) {
  owner.sources.push(value, slot);
}
`);
const packedFindings = scan([packed]);
const failures = [
  [kinds.has("loop-await"), "loop-await not found"],
  [kinds.has("nested-loop"), "nested-loop not found"],
  [kinds.has("spread-call"), "spread-call not found"],
  [kinds.has("parallel-array-growth"), "parallel-array-growth not found"],
  [findings.every((finding) => finding.currentWork && finding.candidateFloor && finding.proof), "process fields missing"],
  [findings.every((finding) => !finding.file.includes(".repos") && !finding.file.includes("ignored")), "ignored source scanned"],
  [findings.some((finding) => finding.surface === "benchmark" && finding.file.endsWith("throughput.ts")), "benchmark not scanned and labeled"],
  [findings.every((finding, index, all) => index === 0 || all[index - 1].score >= finding.score), "findings not score-sorted"],
  [!packedFindings.some((finding) => finding.kind === "parallel-array-growth"), "packed representation still flagged"],
].filter(([ok]) => !ok);
if (failures.length) {
  for (const [, message] of failures) console.error(message);
  process.exit(1);
}
console.log("static audit test: all cases pass");
