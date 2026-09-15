#!/usr/bin/env node
// Run: node --allow-natives-syntax --experimental-transform-types src/commands-main.mts tier
//
// Confirms that this V8 build tiers a hot function to TurboFan. The skill's
// tier claims come from --trace-opt lines; this is the one-command check that
// the tier machinery works on this machine before you trust or blame it.
// Add --trace-opt to watch the compiler lines. Exits non-zero if TurboFan is
// never reached.

type TierProbe = (fn: unknown) => boolean;

// %ActiveTierIsTurbofan is only a valid token under --allow-natives-syntax, so
// the probe body is parsed lazily; a SyntaxError means this process was started
// without the flag and the caller reports that instead of crashing.
function probe(name: string): TierProbe | null {
  try {
    const created: unknown = new Function("fn", `return %${name}(fn)`);
    if (typeof created !== "function") return null;
    return (fn: unknown): boolean => Boolean(created(fn));
  } catch {
    return null;
  }
}

function hot(values: readonly number[]): number {
  let sum = 0;
  for (let i = 0; i < values.length; i++) sum += (values[i] ?? 0) * (values[i] ?? 0);
  return sum;
}

export function run(argv: readonly string[]): number {
  const calls = Number(argv[0] ?? 200000);
  const values = Array.from({ length: 64 }, (_, i) => i + 1);
  let sink = 0;
  for (let i = 0; i < calls; i++) sink += hot(values);

  const turbofanProbe = probe("ActiveTierIsTurbofan");
  if (turbofanProbe === null) {
    process.stderr.write("tier-check: native syntax unavailable; rerun with --allow-natives-syntax\n");
    return 1;
  }

  let turbofan = false;
  try {
    turbofan = turbofanProbe(hot);
  } catch {
    /* kernel unavailable in this build: stays false */
  }
  let maglev = false;
  const maglevProbe = probe("ActiveTierIsMaglev");
  if (maglevProbe !== null) {
    try {
      maglev = maglevProbe(hot);
    } catch {
      /* kernel unavailable in this build: stays false */
    }
  }

  process.stdout.write(
    `${JSON.stringify({ turbofan, maglev, calls, node: process.version, v8: process.versions.v8, sink })}\n`,
  );

  if (!turbofan) {
    process.stderr.write("tier-check: hot() did not reach TurboFan; rerun with --trace-opt to see the compiler lines\n");
    return 1;
  }
  return 0;
}
