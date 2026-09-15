import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const legacyTest = join(root, "test", "legacy", "static-audit.test.mjs");
const shim = join(root, "test", "legacy-shim.mts");
const cli = join(root, "dist", "cli.mjs");

test("legacy static-audit suite passes against the new CLI", () => {
  execFileSync("npx", ["tsdown"], { cwd: root, stdio: "ignore" });
  const source = readFileSync(legacyTest, "utf8");
  const rewritten = source.replace('import { scan } from "./static-audit.mjs";', `import { scan } from ${JSON.stringify(shim)};`);
  assert.notEqual(rewritten, source, "legacy test import was not rewritten");
  const dir = mkdtempSync(join(tmpdir(), "ppit-parity-"));
  const file = join(dir, "legacy-parity.mjs");
  writeFileSync(file, rewritten);
  const output = execFileSync(process.execPath, ["--experimental-transform-types", file], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  assert.match(output, /cases pass/, `legacy suite output: ${output}`);
});
