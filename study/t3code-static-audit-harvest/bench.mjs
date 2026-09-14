#!/usr/bin/env node
// Paired benchmark driver. For each case/profile it runs, in separate Node
// processes, the before arm, the after arm, and an A/A control (before twice).
// Order alternates each trial; the reported delta is the median of paired
// ratios, and a delta inside the A/A band is rejected as noise.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const arm = join(here, "arm.mjs");

const cases = (process.env.HARVEST_CASES ?? "orderWindow,sortedMembers,hubCredits,runningTerminalIds,retainMessages").split(",");
const profiles = (process.env.HARVEST_PROFILES ?? "realistic,scaled").split(",");
const trials = Number(process.env.HARVEST_TRIALS ?? "7");
const seed = Number(process.env.HARVEST_SEED ?? "7");

function loadAverage() {
  try {
    return readFileSync("/proc/loadavg", "utf8").trim();
  } catch {
    return "unknown";
  }
}

function run(caseId, variant, profile) {
  const result = spawnSync(
    process.execPath,
    [arm, `--case=${caseId}`, `--variant=${variant}`, `--profile=${profile}`, `--seed=${seed}`],
    { encoding: "utf8", maxBuffer: 1 << 20 },
  );
  if (result.status !== 0) throw new Error(`${caseId}/${variant}/${profile} failed: ${result.stderr}`);
  return JSON.parse(result.stdout.trim().split("\n").at(-1));
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function ratioSummary(label, ratios) {
  const med = median(ratios);
  return {
    label,
    medianRatio: Number(med.toFixed(4)),
    deltaPercent: Number(((med - 1) * 100).toFixed(2)),
    speedup: Number((1 / med).toFixed(3)),
    ratios: ratios.map((value) => Number(value.toFixed(4))),
  };
}

console.log(JSON.stringify({ event: "start", loadAverage: loadAverage(), trials, seed, node: process.version, v8: process.versions.v8 }));

const report = [];
for (const caseId of cases) {
  for (const profile of profiles) {
    const ab = [];
    const aa = [];
    const beforeNs = [];
    const afterNs = [];
    for (let trial = 0; trial < trials; trial += 1) {
      const reverse = trial % 2 === 1;
      let before;
      let beforeSecond;
      let after;
      if (reverse) {
        after = run(caseId, "after", profile);
        beforeSecond = run(caseId, "before", profile);
        before = run(caseId, "before", profile);
      } else {
        before = run(caseId, "before", profile);
        beforeSecond = run(caseId, "before", profile);
        after = run(caseId, "after", profile);
      }
      ab.push(after.nsPerOp / before.nsPerOp);
      aa.push(beforeSecond.nsPerOp / before.nsPerOp);
      beforeNs.push(before.nsPerOp);
      afterNs.push(after.nsPerOp);
    }
    const abSummary = ratioSummary("A/B", ab);
    const aaSummary = ratioSummary("A/A", aa);
    const line = {
      case: caseId,
      profile,
      beforeNsPerOp: median(beforeNs),
      afterNsPerOp: median(afterNs),
      ab: abSummary,
      aa: aaSummary,
      verdict:
        Math.abs(abSummary.medianRatio - 1) <= Math.abs(aaSummary.medianRatio - 1) + 0.02
          ? "noise"
          : abSummary.medianRatio < 1
            ? "faster"
            : "slower",
    };
    report.push(line);
    console.log(JSON.stringify({ event: "case", ...line }));
  }
}

console.log(JSON.stringify({ event: "summary", report }));
