#!/usr/bin/env node
// Run: node --allow-natives-syntax scripts/tier-check.mjs
//
// Confirms that this V8 build tiers a hot function to TurboFan. The skill's
// tier claims come from --trace-opt lines; this is the one-command check that
// the tier machinery works on this machine before you trust or blame it.
// Add --trace-opt to watch the compiler lines. Exits non-zero if TurboFan is
// never reached.

function hot(values) {
  let sum = 0
  for (let i = 0; i < values.length; i++) sum += values[i] * values[i]
  return sum
}

const calls = Number(process.argv[2] ?? 200000)
const values = Array.from({ length: 64 }, (_, i) => i + 1)
let sink = 0
for (let i = 0; i < calls; i++) sink += hot(values)

let turbofan = false
let maglev = false
try {
  turbofan = %ActiveTierIsTurbofan(hot)
} catch {}
try {
  maglev = %ActiveTierIsMaglev(hot)
} catch {}

console.log(JSON.stringify({ turbofan, maglev, calls, node: process.version, v8: process.versions.v8, sink }))

if (!turbofan) {
  console.error("tier-check: hot() did not reach TurboFan; rerun with --trace-opt to see the compiler lines")
  process.exit(1)
}
