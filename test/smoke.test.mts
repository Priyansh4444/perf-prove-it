import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scan } from "../src/index.mts";
import { RuleKind } from "../src/core/types.mts";

const fixture = (): string => mkdtempSync(join(tmpdir(), "ppit-"));

test("cross-file call sites rank the enclosing function", async () => {
  const dir = fixture();
  writeFileSync(
    join(dir, "rank.ts"),
    "export function computeScores(rows: number[], blocked: string[]): number[] {\n  const out: number[] = [];\n  for (const row of rows) out.push(blocked.includes(String(row)) ? 0 : row);\n  return out;\n}\n",
  );
  writeFileSync(join(dir, "a.ts"), 'import { computeScores } from "./rank";\ncomputeScores([], []);\ncomputeScores([], []);\n');
  writeFileSync(join(dir, "b.ts"), 'import { computeScores } from "./rank";\ncomputeScores([], []);\ncomputeScores([], []);\n');
  const result = await scan([dir], { includeAdvisory: true, max: 50 });
  const finding = result.findings.find((item) => item.enclosingFunction === "computeScores");
  assert.equal(finding?.kind, "repeated-linear-membership");
  assert.equal(finding?.staticCallSites, 4);
  assert.equal(finding?.rankBoost, 2);
  assert.equal(finding?.score, 9);
});

test("await in a loop is a review finding owned by its function", async () => {
  const dir = fixture();
  writeFileSync(join(dir, "io.ts"), "export async function loadAll(ids: string[]): Promise<void> {\n  for (const id of ids) await fetch(id);\n}\n");
  const result = await scan([dir], { includeAdvisory: true });
  const finding = result.findings.find((item) => item.kind === "loop-await");
  assert.equal(finding?.enclosingFunction, "loadAll");
  assert.equal(finding?.confidence, "review");
});

test("nested loops and spread calls are reported, regex text is not", async () => {
  const dir = fixture();
  writeFileSync(join(dir, "mixed.ts"), 'const re = /bar(b/;\nexport function matrix(rows: number[][]): void {\n  for (const row of rows) for (const value of row) console.log(value);\n}\nexport function max(values: number[]): number {\n  return Math.max(...values);\n}\n');
  const result = await scan([dir], { includeAdvisory: true });
  const kinds = new Set(result.findings.map((item) => item.kind));
  assert.ok(kinds.has(RuleKind.NestedLoop));
  assert.ok(kinds.has(RuleKind.SpreadCall));
  const maxFinding = result.findings.find((item) => item.kind === RuleKind.SpreadCall);
  assert.equal(maxFinding?.enclosingFunction, "max");
});
