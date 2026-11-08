import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("packed CLI works with freshly resolved consumer dependencies", async (t) => {
  const npm = process.env.npm_execpath;
  assert.ok(npm, "Run this test with npm run test:package");
  const dir = mkdtempSync(join(tmpdir(), "ppit-package-"));
  try {
    execFileSync(process.execPath, [npm, "pack", "--ignore-scripts", "--pack-destination", dir], {
      cwd: root,
      encoding: "utf8",
    });
    const tarballs = readdirSync(dir).filter((file) => file.endsWith(".tgz"));
    assert.equal(tarballs.length, 1, "expected exactly one packed tarball");
    const tarball = join(dir, tarballs[0]);
    const consumer = join(dir, "consumer");
    mkdirSync(consumer);
    writeFileSync(join(consumer, "package.json"), JSON.stringify({ name: "ppit-consumer", private: true }));
    execFileSync(process.execPath, [npm, "install", "--ignore-scripts", "--omit=dev", "--no-audit", "--no-fund", tarball], {
      cwd: consumer,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const cli = join(consumer, "node_modules", "perf-prove-it", "dist", "cli.mjs");
    const run = (...args) => execFileSync(process.execPath, [cli, ...args], {
      cwd: consumer,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });

    await t.test("prints help", () => {
      assert.match(run("--help"), /Scan source roots and rank static performance candidates/);
    });

    await t.test("prints the package version", () => {
      const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
      assert.equal(run("--version").trim(), `audit v${version}`);
    });

    await t.test("audits a source file", () => {
      const file = join(consumer, "fixture.ts");
      writeFileSync(file, "export function max(values: number[]): number { return Math.max(...values); }\n");
      const report = JSON.parse(run("--json", "--include-advisory", file));
      assert.equal(report.summary.files, 1);
      assert.equal(report.summary.parseErrors, 0);
      assert.ok(report.findings.some((finding) => finding.kind === "spread-call"));
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
