#!/usr/bin/env node
// One arm per process: executes a single extracted function on a deterministic
// workload and prints { nsPerOp }. The bench driver spawns this per measurement
// so two bundles never share a V8 isolate (per benchmark-protocol.md).
import { CASES } from "./impls.mjs";
import { build } from "./workloads.mjs";

function readFlag(name, fallback) {
  const arg = process.argv.find((value) => value.startsWith(`--${name}=`));
  return arg === undefined ? fallback : arg.slice(name.length + 3);
}

const caseId = readFlag("case");
const variant = readFlag("variant");
const profile = readFlag("profile", "realistic");
const seed = Number(readFlag("seed", "1"));
const minMs = Number(readFlag("min-ms", "150"));

if (!CASES[caseId]) throw new Error(`unknown case: ${caseId}`);
const fn = CASES[caseId][variant];
if (!fn) throw new Error(`unknown variant: ${variant}`);

const { args, meta } = build(caseId, profile, seed);

const sinks = {
  orderWindow: (result) => (result ? result.kind.length + result.id.length : 0),
  sortedMembers: (result) => result.length + (result.length > 0 ? result[0].key.length : 0),
  hubCredits: (result) => (result ? result.account.key.length + result.source.id.length : 0),
  runningTerminalIds: (result) => result.length,
  retainMessages: (result) => result.length,
};
const sink = sinks[caseId];

// Mask the build/compile cost before timing; the target function is then the
// only work in the measured loop.
let warm = 0;
for (let index = 0; index < 64; index += 1) warm += sink(fn(...args));

// Auto-calibrate the iteration count so each arm runs long enough to clear
// timer noise, then report nanoseconds per call (median is the driver's job).
let iterations = 1;
let ms = 0;
let checksum = warm;
for (;;) {
  const start = performance.now();
  for (let index = 0; index < iterations; index += 1) checksum += sink(fn(...args));
  ms = performance.now() - start;
  if (ms >= minMs || iterations >= 100_000_000) break;
  iterations = Math.max(iterations * 2, Math.ceil((iterations * minMs) / Math.max(ms, 0.01)));
}

console.log(
  JSON.stringify({
    case: caseId,
    variant,
    profile,
    seed,
    meta,
    iterations,
    ms: Number(ms.toFixed(3)),
    nsPerOp: Number(((ms * 1e6) / iterations).toFixed(1)),
    checksum,
    node: process.version,
    v8: process.versions.v8,
  }),
);
