import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Schema } from "effect";
import { ScanOutputSchema, type FindingOutput } from "../src/core/schema.mts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(root, "dist", "cli.mjs");

export function scan(roots: readonly string[]): readonly FindingOutput[] {
  if (!existsSync(cli)) throw new Error(`build the CLI first: node dist/cli.mjs is missing at ${cli}`);
  const stdout = execFileSync(process.execPath, [cli, "--json", "--include-advisory", "--max=100000", ...roots], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    stdio: ["ignore", "pipe", "ignore"],
  });
  return Schema.decodeUnknownSync(ScanOutputSchema)(JSON.parse(stdout)).findings;
}
