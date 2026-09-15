import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const skillsRoot = join(packageRoot, "skills");

const AGENT_DIRECTORIES: Readonly<Record<string, readonly string[]>> = {
  agents: [".agents/skills"],
  claude: [".claude/skills"],
  opencode: [".opencode/skills", ".config/opencode/skills"],
  codex: [".codex/skills"],
};

function skillNames(): string[] {
  if (!existsSync(skillsRoot)) return [];
  return readdirSync(skillsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function filesUnder(root: string, base = root): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const child = join(root, entry.name);
    if (entry.isDirectory()) files.push(...filesUnder(child, base));
    else if (entry.isFile()) files.push(relative(base, child));
  }
  return files;
}

function usage(): number {
  process.stderr.write("usage: perf-prove-it install [--dir <path>] [--agent <agents|claude|opencode|codex>] [--global] [--print] [--force]\n");
  return 2;
}

export function run(argv: readonly string[]): number {
  let target: string | null = null;
  let agent = "agents";
  let global = false;
  let print = false;
  let force = false;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--dir") target = argv[index + 1] ?? null;
    else if (token?.startsWith("--dir=")) target = token.slice("--dir=".length);
    else if (token === "--agent") agent = argv[index + 1] ?? "agents";
    else if (token?.startsWith("--agent=")) agent = token.slice("--agent=".length);
    else if (token === "--global") global = true;
    else if (token === "--print") print = true;
    else if (token === "--force") force = true;
    else return usage();
  }

  const registry = AGENT_DIRECTORIES[agent];
  if (registry === undefined) {
    process.stderr.write(`perf-prove-it install: unknown agent "${agent}" (expected ${Object.keys(AGENT_DIRECTORIES).join(", ")})\n`);
    return 2;
  }
  const base = target ?? (global ? join(homedir(), registry[0] ?? ".agents/skills") : join(process.cwd(), registry[0] ?? ".agents/skills"));
  const names = skillNames();
  if (names.length === 0) {
    process.stderr.write(`perf-prove-it install: no skills bundled at ${skillsRoot}\n`);
    return 1;
  }

  if (print) {
    for (const name of names) {
      const dir = join(skillsRoot, name);
      for (const file of filesUnder(dir)) {
        const content = readFileSync(join(dir, file), "utf8");
        process.stdout.write(`${JSON.stringify({ type: "skill-file", skill: name, path: `${name}/${file}`, bytes: Buffer.byteLength(content), content })}\n`);
      }
    }
    process.stdout.write(`${JSON.stringify({ type: "skill-manifest", target: base, skills: names, files: names.reduce((total, name) => total + filesUnder(join(skillsRoot, name)).length, 0) })}\n`);
    return 0;
  }

  mkdirSync(base, { recursive: true });
  for (const name of names) {
    const destination = join(base, name);
    if (existsSync(destination) && !force) {
      process.stderr.write(`perf-prove-it install: ${destination} exists; pass --force to replace\n`);
      return 1;
    }
    if (existsSync(destination) && force) rmSync(destination, { recursive: true, force: true });
    cpSync(join(skillsRoot, name), destination, { recursive: true });
    const manifest = { type: "installed", skill: name, path: destination, files: filesUnder(destination).length };
    process.stdout.write(`${JSON.stringify(manifest)}\n`);
  }
  return 0;
}

export function bundledSkillNames(): string[] {
  void statSync;
  void writeFileSync;
  void basename;
  return skillNames();
}
