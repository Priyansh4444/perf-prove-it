import { test } from "node:test";
import { Schema } from "effect";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const commandsMain = join(root, "src", "commands-main.mts");
const legacyScripts = join(root, "skills", "perf-prove-it-ts", "scripts");

interface CommandResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

function runCommands(args: readonly string[], execArgv: readonly string[] = []): CommandResult {
  const result = spawnSync(process.execPath, [...execArgv, "--experimental-transform-types", commandsMain, ...args], {
    encoding: "utf8",
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function writeCensusRunner(dir: string): string {
  const runner = join(dir, "census-runner.mjs");
  const lines = [
    'import { spawnSync } from "node:child_process";',
    `const args = ["--experimental-transform-types", ${JSON.stringify(commandsMain)}, "census", ...process.argv.slice(2)];`,
    "const result = spawnSync(process.execPath, args, { stdio: \"inherit\" });",
    "if (result.error) throw result.error;",
    "process.exit(result.status ?? 1);",
    "",
  ];
  writeFileSync(runner, lines.join("\n"));
  return runner;
}

function writeCompiledShim(dir: string): string {
  const shim = join(dir, "compiled-shim.mjs");
  const lines = [
    'import { spawnSync } from "node:child_process";',
    "export function auditCompiled(root, terms = []) {",
    `  const args = ["--experimental-transform-types", ${JSON.stringify(commandsMain)}, "compiled", root, ...terms];`,
    '  const result = spawnSync(process.execPath, args, { encoding: "utf8" });',
    "  if (result.status !== 0) throw new Error(result.stderr);",
    '  return result.stdout.split("\\n").filter((line) => line !== "").map((line) => JSON.parse(line));',
    "}",
    "",
  ];
  writeFileSync(shim, lines.join("\n"));
  return shim;
}

function runLegacyTest(source: string, dir: string, filename: string): CommandResult {
  const file = join(dir, filename);
  writeFileSync(file, source);
  const result = spawnSync(process.execPath, ["--experimental-transform-types", file], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

test("legacy census suite passes through the commands-main dispatcher", () => {
  const dir = mkdtempSync(join(tmpdir(), "ppit-census-parity-"));
  try {
    const runner = writeCensusRunner(dir);
    const legacySource = readFileSync(join(legacyScripts, "census.test.mjs"), "utf8");
    const rewritten = legacySource.replace(
      'const census = fileURLToPath(new URL("./census.mjs", import.meta.url));',
      `const census = ${JSON.stringify(runner)};`,
    );
    assert.notEqual(rewritten, legacySource, "legacy census test spawn path was not rewritten");
    const result = runLegacyTest(rewritten, dir, "legacy-census.test.mjs");
    assert.equal(result.status, 0, `legacy census parity failed:\n${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /census test: all cases pass/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("legacy compiled-audit suite passes through the commands-main dispatcher", () => {
  const dir = mkdtempSync(join(tmpdir(), "ppit-compiled-parity-"));
  try {
    const shim = writeCompiledShim(dir);
    const legacySource = readFileSync(join(legacyScripts, "compiled-audit.test.mjs"), "utf8");
    const rewritten = legacySource.replace(
      'from "./compiled-audit.mjs"',
      `from ${JSON.stringify(pathToFileURL(shim).href)}`,
    );
    assert.notEqual(rewritten, legacySource, "legacy compiled-audit import was not rewritten");
    const result = runLegacyTest(rewritten, dir, "legacy-compiled-audit.test.mjs");
    assert.equal(result.status, 0, `legacy compiled-audit parity failed:\n${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /compiled audit test: all cases pass/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("machine prints node, v8, and arch lines", () => {
  const result = runCommands(["machine"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^node: /m, result.stdout);
  assert.match(result.stdout, /^v8: /m, result.stdout);
  assert.match(result.stdout, /^arch: /m, result.stdout);
});

test("tier without --allow-natives-syntax reports an error instead of crashing", () => {
  const result = runCommands(["tier"]);
  assert.notEqual(result.status, 0, result.stdout);
  assert.doesNotMatch(result.stderr, /SyntaxError/, result.stderr);
  assert.match(result.stderr, /--allow-natives-syntax/, result.stderr);
});

test("tier reaches TurboFan when launched with --allow-natives-syntax", () => {
  const result = runCommands(["tier"], ["--allow-natives-syntax"]);
  assert.equal(result.status, 0, `tier failed:\n${result.stdout}\n${result.stderr}`);
  const parsed = Schema.decodeUnknownSync(Schema.Struct({ turbofan: Schema.Boolean }))(JSON.parse(result.stdout));
  assert.equal(parsed.turbofan, true, `turbofan not reached: ${result.stdout}`);
});
