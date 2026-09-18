#!/usr/bin/env node
// Print the machine header that belongs at the top of every performance report.
// Usage: node --import tsx src/commands-main.mts machine
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

const LSCPU_FIELDS =
  /^(Model name|Architecture|CPU\(s\)|Thread|Core|Socket|NUMA node\(s\)|L1d|L1i|L2|L3|CPU max MHz|CPU min MHz|Virtualization)/;

function out(line: string): void {
  process.stdout.write(`${line}\n`);
}

function hasCommand(name: string): boolean {
  const pathValue = process.env["PATH"];
  if (pathValue === undefined) return false;
  for (const dir of pathValue.split(path.delimiter)) {
    if (dir === "") continue;
    try {
      fs.accessSync(path.join(dir, name), fs.constants.X_OK);
      return true;
    } catch {
      /* keep looking */
    }
  }
  return false;
}

function commandText(command: string, args: readonly string[]): string | null {
  const result = spawnSync(command, [...args], { encoding: "utf8" });
  if (result.error || result.status !== 0) return null;
  return result.stdout ?? "";
}

function readableText(file: string): string | null {
  try {
    return fs.readFileSync(file, "utf8").trim();
  } catch {
    return null;
  }
}

function distroName(): string | null {
  const text = readableText("/etc/os-release");
  if (text === null) return null;
  for (const line of text.split("\n")) {
    const match = /^PRETTY_NAME=(.*)$/.exec(line);
    if (match !== null) return (match[1] ?? "").replace(/^"|"$/g, "");
  }
  return "unknown";
}

function hostKernel(): string {
  return commandText("uname", ["-srm"])?.trim() ?? `${os.type()} ${os.release()} ${os.arch()}`;
}

function physicalCores(): number {
  const text = commandText("lscpu", ["-p=CPU,CORE"]);
  if (text !== null) {
    const cores = new Set<string>();
    for (const line of text.split("\n")) {
      if (line === "" || line.startsWith("#")) continue;
      const core = line.split(",")[1];
      if (core !== undefined && core !== "") cores.add(core);
    }
    if (cores.size > 0) return cores.size;
  }
  return os.cpus().length;
}

function cpuLines(): string[] {
  if (hasCommand("lscpu")) {
    const text = commandText("lscpu", []);
    if (text !== null) {
      return text
        .split("\n")
        .filter((line) => LSCPU_FIELDS.test(line))
        .map((line) => line.replace(/ +/g, " "));
    }
  }
  const lines = [`Model name: ${os.cpus()[0]?.model ?? "unknown"}`, `Architecture: ${os.arch()}`];
  lines.push(`logical cpus: ${os.cpus().length}`);
  return lines;
}

function governorLines(): string[] {
  let entries: string[];
  try {
    entries = fs.readdirSync("/sys/devices/system/cpu/cpufreq");
  } catch {
    return [];
  }
  const counts = new Map<string, number>();
  for (const entry of entries) {
    if (!entry.startsWith("policy")) continue;
    const value = readableText(path.join("/sys/devices/system/cpu/cpufreq", entry, "scaling_governor"));
    if (value === null || value === "") continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.keys()].sort().map((name) => `${counts.get(name) ?? 0}x ${name}`);
}

function headLines(text: string, count: number): string[] {
  const body = text.endsWith("\n") ? text.slice(0, -1) : text;
  return body.split("\n").slice(0, count);
}

function loadLine(): string {
  return readableText("/proc/loadavg") ?? os.loadavg().map((value) => value.toFixed(2)).join(" ");
}

function numaLines(): string[] {
  const text = commandText("numactl", ["-H"]);
  if (text !== null) return headLines(text, 8);
  let entries: string[] = [];
  try {
    entries = fs.readdirSync("/sys/devices/system/node");
  } catch {
    entries = [];
  }
  const nodes = entries.filter((entry) => entry.startsWith("node")).sort();
  return nodes.length > 0 ? nodes : ["single node"];
}

function toolchainLines(): string[] {
  const lines: string[] = [];
  if (hasCommand("rustc")) {
    const version = commandText("rustc", ["-Vv"]);
    if (version !== null) lines.push(...headLines(version, 3));
    else lines.push("rustc not found");
  } else {
    lines.push("rustc not found");
  }
  if (hasCommand("cargo")) {
    const version = commandText("cargo", ["-V"]);
    if (version !== null) lines.push(version.trim());
  }
  return lines;
}

function counterLines(): string[] {
  const lines: string[] = [];
  if (hasCommand("perf")) {
    const result = spawnSync("perf", ["stat", "-e", "instructions,cycles", "true"], { stdio: "ignore" });
    if (!result.error && result.status === 0) {
      lines.push("perf: instructions/cycles available");
    } else {
      lines.push("perf: restricted (check /proc/sys/kernel/perf_event_paranoid)");
    }
  } else {
    lines.push("perf: not installed");
  }
  lines.push(
    hasCommand("valgrind")
      ? "valgrind: installed (iai-callgrind usable)"
      : "valgrind: not installed (iai-callgrind needs it)",
  );
  if (hasCommand("taskset")) lines.push("taskset: installed");
  return lines;
}

export function run(_argv: readonly string[]): number {
  out("== host ==");
  out(`kernel:    ${hostKernel()}`);
  const distro = distroName();
  if (distro !== null) out(`distro:    ${distro}`);

  out("");
  out("== cpu ==");
  for (const line of cpuLines()) out(line);
  out(`physical cores: ${physicalCores()}`);

  out("");
  out("== governor / boost ==");
  for (const line of governorLines()) out(`governor: ${line}`);
  const noTurbo = readableText("/sys/devices/system/cpu/intel_pstate/no_turbo");
  if (noTurbo !== null) out(`intel_pstate/no_turbo: ${noTurbo}`);
  const boost = readableText("/sys/devices/system/cpu/cpufreq/boost");
  if (boost !== null) out(`cpufreq/boost: ${boost}`);

  out("");
  out("== load ==");
  out(loadLine());

  out("");
  out("== numa ==");
  for (const line of numaLines()) out(line);

  out("");
  out("== toolchain ==");
  for (const line of toolchainLines()) out(line);

  out("");
  out("== available counters ==");
  for (const line of counterLines()) out(line);

  out("");
  out("== runtime ==");
  out(`node: ${process.version}`);
  out(`v8: ${process.versions.v8}`);
  out(`arch: ${os.arch()}`);
  return 0;
}
