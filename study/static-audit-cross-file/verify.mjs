#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { scan } from "../../skills/perf-prove-it-ts/scripts/static-audit.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const findings = scan([join(here, "src")]);

const byOwner = new Map();
for (const finding of findings) {
  if (finding.enclosingFunction) byOwner.set(finding.enclosingFunction, finding);
}

const failures = [];
const expect = (ok, message) => {
  if (!ok) failures.push(message);
};

const scores = byOwner.get("computeScores");
expect(scores?.staticCallSites === 7, `computeScores: expected 7 static call sites, got ${scores?.staticCallSites}`);
expect(scores?.rankBoost === 2 && scores?.score === 9, `computeScores: expected rank +2 and score 9, got +${scores?.rankBoost}/${scores?.score}`);
expect(scores?.file.endsWith("rank.ts"), `computeScores finding should be in rank.ts, got ${scores?.file}`);

const parsed = byOwner.get("parseConfigs");
expect(parsed?.staticCallSites === 1 && parsed?.rankBoost === 1 && parsed?.score === 9, `parseConfigs: expected 1 call site and score 9, got ${parsed?.staticCallSites}/${parsed?.score}`);

const widget = byOwner.get("Widget");
expect(widget?.staticCallSites === 0 && widget?.rankBoost === 0 && widget?.score === 7, `Widget: expected 0 call sites and score 7, got ${widget?.staticCallSites}/${widget?.score}`);
expect(!byOwner.has("useState"), "useState must never appear as an enclosing function");

if (failures.length) {
  for (const failure of failures) console.error(failure);
  process.exit(1);
}
console.log("cross-file static-audit fixture: all assertions pass");
console.log(`  computeScores: ${scores.staticCallSites} call sites, rank +${scores.rankBoost} (defined in rank.ts; called from app.ts, jobs.ts, widget.tsx)`);
console.log(`  parseConfigs:  ${parsed.staticCallSites} call site, rank +${parsed.rankBoost} (defined in format.ts; called from app.ts)`);
console.log(`  Widget:        ${widget.staticCallSites} call sites, rank +${widget.rankBoost} (JSX usage is not a Widget( call)`);
