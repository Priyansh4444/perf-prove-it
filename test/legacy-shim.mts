import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(root, "dist", "cli.mjs");

export function scan(roots: readonly string[], _options?: unknown): unknown[] {
  if (!existsSync(cli)) throw new Error(`build the CLI first: node dist/cli.mjs is missing at ${cli}`);
  const stdout = execFileSync(process.execPath, [cli, "--json", "--include-advisory", "--max=100000", ...roots], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    stdio: ["ignore", "pipe", "ignore"],
  });
  const parsed = JSON.parse(stdout) as { findings: unknown[] };
  return parsed.findings;
}
