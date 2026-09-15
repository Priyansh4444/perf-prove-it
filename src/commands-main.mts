#!/usr/bin/env node
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { run as runCensus } from "./census.mts";
import { run as runCompiled } from "./compiled.mts";
import { run as runMachine } from "./machine.mts";
import { run as runTier } from "./tier.mts";

const USAGE = "usage: node --experimental-transform-types src/commands-main.mts <census|compiled|tier|machine> [args...]";

export async function main(argv: readonly string[]): Promise<number> {
  const [name, ...rest] = argv;
  switch (name) {
    case "census":
      return runCensus(rest);
    case "compiled":
      return runCompiled(rest);
    case "tier":
      return runTier(rest);
    case "machine":
      return runMachine(rest);
    default:
      process.stderr.write(`${USAGE}\n`);
      return 2;
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
