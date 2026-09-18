#!/usr/bin/env node
// Parse V8 --print-bytecode output into a per-function allocation census.
//
//   node --allow-natives-syntax --print-bytecode --print-bytecode-filter='rerank' harness.cjs \
//     | node --import tsx src/commands-main.mts census
//
// Or pass dump files: node --import tsx src/commands-main.mts census before.txt after.txt
// Add --json for machine-readable output to gate in CI.
// Add --classes to print a second table with cost classes, protocol ops, and
// loop-site counts. --diff before.txt after.txt prints per-function class-count
// deltas; --diff --json emits {before, after, deltas} as per-function class maps.
//
// Opcodes are read only from disassembly lines, so strings that happen to
// contain "CreateClosure" or a function header cannot pollute the counts.
// Categories match by rule, so a new V8 name lands in the closest column or in
// `other` instead of being dropped. Exit code 1 means the dump could not be
// parsed, not that opcodes moved.
//
// Cost classes, first matching rule wins so related names stay together:
//   alloc      Create* / _Create*, CloneObject, GetTemplateObject
//   iterator   GetIterator, CallIterator, IteratorNext, IteratorClose
//   property   Lda/Sta/Get/Set/Define + Named|Keyed|Global|Context|Current|Super
//   call       Call*, Invoke*, Construct*
//   branch     Jump*, Test*
//   arithmetic Add|Sub|Mul|Div|Mod|Exp|Inc|Dec*, Bitwise*, Shift*, Ldar, Star,
//              Mov, and remaining Lda*/Sta* (constants, arguments, holes)
//   other      everything else, named in otherOps
// Intrinsic names such as _CreateJSGeneratorObject count as ops and class as
// allocations.
//
// A JumpLoop with a printed target "(0xADDR @ N)" closes a loop whose body is
// bytecode offsets [N, jumpLoopOffset]. InLoop counts are static construction
// sites inside any (possibly nested) loop body: candidates for per-iteration
// work. JumpLoop lines without a printed target count as no body.
//
// Counts are static construction sites in Ignition bytecode, not dynamic
// allocations. Cross-check allocation claims with --heap-prof or GC counts (see
// references/memory-and-heap.md). Self-test: test/commands.test.mts.

import { readFileSync } from "node:fs";

type CountRuleLabel = "closures" | "contexts" | "arr[]" | "obj{}" | "re{}";
type CensusLabel = CountRuleLabel | "other";
type ClassLabel = "alloc" | "call" | "property" | "iterator" | "branch" | "arithmetic" | "other";
type LoopLabel = "closuresInLoop" | "contextsInLoop" | "arraysInLoop" | "objectsInLoop" | "regexpsInLoop" | "protocolInLoop";
type Matcher = (op: string) => boolean;

interface Instruction {
  offset: number;
  mnemonic: string;
  operands: string;
}

interface Row {
  name: string;
  length: number | null;
  ops: Record<string, number>;
  otherOps: string[];
  closures: number;
  contexts: number;
  "arr[]": number;
  "obj{}": number;
  "re{}": number;
  other: number;
  classes: Record<ClassLabel, number>;
  protocol: Record<string, number>;
  loopBodies: number;
  closuresInLoop: number;
  contextsInLoop: number;
  arraysInLoop: number;
  objectsInLoop: number;
  regexpsInLoop: number;
  protocolInLoop: number;
}

interface Totals {
  closures: number;
  contexts: number;
  "arr[]": number;
  "obj{}": number;
  "re{}": number;
  other: number;
  protocol: Record<string, number>;
}

const RULES: ReadonlyArray<readonly [CountRuleLabel, Matcher]> = [
  ["closures", (op) => op === "CreateClosure"],
  ["contexts", (op) => op.includes("Context")],
  ["arr[]", (op) => op.includes("Array") || op === "CreateRestParameter"],
  [
    "obj{}",
    (op) => /Object(Literal|FromIterable)/.test(op) || /MappedArguments|UnmappedArguments/.test(op) || op === "CloneObject",
  ],
  ["re{}", (op) => op.includes("RegExp")],
];
const LABELS: readonly CountRuleLabel[] = RULES.map(([label]) => label);
const OTHER = "other";

const CLASS_LABELS: readonly ClassLabel[] = ["alloc", "call", "property", "iterator", "branch", "arithmetic", OTHER];
const CLASS_RULES: ReadonlyArray<readonly [ClassLabel, Matcher]> = [
  [
    "alloc",
    (op) => op.startsWith("Create") || op.startsWith("_Create") || op === "CloneObject" || op === "GetTemplateObject",
  ],
  ["iterator", (op) => /^(GetIterator|CallIterator|IteratorNext|IteratorClose)$/.test(op)],
  ["property", (op) => /^(Lda|Sta|Get|Set|Define)(Named|Keyed|Global|Context|Current|Super)/.test(op)],
  ["call", (op) => /^(Call|Invoke|Construct)/.test(op)],
  ["branch", (op) => /^(Jump|Test)/.test(op)],
  [
    "arithmetic",
    (op) =>
      op === "Ldar" ||
      op.startsWith("Star") ||
      op === "Mov" ||
      /^(Add|Sub|Mul|Div|Mod|Exp|Inc|Dec|Bitwise|Shift)/.test(op) ||
      /^(Lda|Sta)[A-Z]/.test(op),
  ],
];

const PROTOCOL_OPS: readonly string[] = [
  "GetIterator",
  "CallIterator",
  "IteratorNext",
  "IteratorClose",
  "CreateArrayFromIterable",
  "CopyDataProperties",
  "CreateRestParameter",
  "GetTemplateObject",
  "CreateMappedArguments",
  "CloneObject",
];

const LOOP_KEYS: Record<CountRuleLabel, LoopLabel> = {
  closures: "closuresInLoop",
  contexts: "contextsInLoop",
  "arr[]": "arraysInLoop",
  "obj{}": "objectsInLoop",
  "re{}": "regexpsInLoop",
};
const LOOP_LABELS: readonly LoopLabel[] = [
  "closuresInLoop",
  "contextsInLoop",
  "arraysInLoop",
  "objectsInLoop",
  "regexpsInLoop",
  "protocolInLoop",
];

const INSTRUCTION_RE = /@\s+(-?\d+)\s*:\s*(?:[0-9a-f]{2}\s+)*([A-Za-z][A-Za-z0-9_]*)([^\n]*)/g;
const LOOP_TARGET_RE = /@\s*(-?\d+)\s*\)/;

function zeroed<K extends string>(labels: readonly K[]): Record<K, number> {
  const out = {} as Record<K, number>;
  for (const label of labels) out[label] = 0;
  return out;
}

function classify(op: string): ClassLabel {
  const rule = CLASS_RULES.find(([, matches]) => matches(op));
  return rule ? rule[0] : OTHER;
}

function readInput(files: readonly string[]): string {
  if (files.length > 0) return files.map((file) => readFileSync(file, "utf8")).join("\n");
  return readFileSync(0, "utf8");
}

function parse(text: string): { rows: Row[]; formatIssues: number } {
  const blockRe = /^\[generated bytecode for function:[ \t]*(.*?)(?: \(0x[0-9a-f]+.*?)?\]\s*$/gm;
  const blocks = [...text.matchAll(blockRe)];
  const rows: Row[] = [];
  let formatIssues = 0;

  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index];
    if (block === undefined) continue;
    const whole = block[0] ?? "";
    const raw = block[1] ?? "";
    const name = raw.startsWith("(") ? "(anonymous)" : raw;
    const start = (block.index ?? 0) + whole.length;
    const next = blocks[index + 1];
    const end = next !== undefined ? (next.index ?? 0) : text.length;
    const body = text.slice(start, end);

    const ops: Record<string, number> = {};
    const instructions: Instruction[] = [];
    for (const match of body.matchAll(INSTRUCTION_RE)) {
      const offset = Number(match[1] ?? "0");
      const mnemonic = match[2] ?? "";
      const operands = match[3] ?? "";
      ops[mnemonic] = (ops[mnemonic] ?? 0) + 1;
      for (const intrinsic of operands.match(/_Create\w+/g) ?? []) {
        ops[intrinsic] = (ops[intrinsic] ?? 0) + 1;
      }
      instructions.push({ offset, mnemonic, operands });
    }

    const counts: Record<CensusLabel, number> = { ...zeroed(LABELS), other: 0 };
    const otherOps: string[] = [];
    for (const [op, count] of Object.entries(ops)) {
      if (!op.startsWith("Create") && !op.startsWith("_Create") && op !== "CloneObject") continue;
      const rule = RULES.find(([, matches]) => matches(op));
      if (rule) counts[rule[0]] += count;
      else otherOps.push(op);
    }
    counts[OTHER] = otherOps.reduce((sum, op) => sum + (ops[op] ?? 0), 0);

    const classes = zeroed(CLASS_LABELS);
    for (const [op, count] of Object.entries(ops)) classes[classify(op)] += count;

    const protocol: Record<string, number> = {};
    for (const op of PROTOCOL_OPS) protocol[op] = ops[op] ?? 0;

    const loopBodies: Array<readonly [number, number]> = [];
    for (const instruction of instructions) {
      if (instruction.mnemonic !== "JumpLoop") continue;
      const target = instruction.operands.match(LOOP_TARGET_RE);
      if (target) loopBodies.push([Number(target[1] ?? "0"), instruction.offset]);
    }
    const inLoop = (offset: number): boolean => loopBodies.some(([from, to]) => offset >= from && offset <= to);

    const loopCounts = zeroed(LOOP_LABELS);
    for (const instruction of instructions) {
      if (!inLoop(instruction.offset)) continue;
      const names = [instruction.mnemonic, ...(instruction.operands.match(/_Create\w+/g) ?? [])];
      for (const op of names) {
        const rule = RULES.find(([, matches]) => matches(op));
        if (rule) loopCounts[LOOP_KEYS[rule[0]]] += 1;
      }
      if (PROTOCOL_OPS.includes(instruction.mnemonic)) loopCounts.protocolInLoop += 1;
    }

    const lengthMatch = body.match(/^Bytecode length: (\d+)/m);
    if (!lengthMatch) {
      process.stderr.write(`census: ${name} has no 'Bytecode length' line, the dump format may have changed\n`);
      formatIssues += 1;
    }
    rows.push({
      name,
      length: lengthMatch ? Number(lengthMatch[1] ?? "0") : null,
      ops,
      otherOps,
      ...counts,
      classes,
      protocol,
      loopBodies: loopBodies.length,
      ...loopCounts,
    });
  }

  return { rows, formatIssues };
}

function classMap(rows: readonly Row[]): Record<string, Record<ClassLabel, number>> {
  const map: Record<string, Record<ClassLabel, number>> = {};
  for (const row of rows) {
    const entry = map[row.name] ?? zeroed(CLASS_LABELS);
    map[row.name] = entry;
    for (const label of CLASS_LABELS) entry[label] += row.classes[label];
  }
  return map;
}

function printTable(header: readonly string[], data: ReadonlyArray<ReadonlyArray<string | number>>): void {
  const widths = header.map((cell, i) => Math.max(cell.length, ...data.map((row) => String(row[i]).length)));
  const line = (cells: ReadonlyArray<string | number>): string =>
    cells.map((cell, i) => String(cell).padEnd(widths[i] ?? 0)).join(" ");
  process.stdout.write(`${line(header)}\n`);
  process.stdout.write(`${widths.map((width) => "-".repeat(width)).join(" ")}\n`);
  for (const row of data) process.stdout.write(`${line(row)}\n`);
}

export function run(argv: readonly string[]): number {
  const asJson = argv.includes("--json");
  const asClasses = argv.includes("--classes");
  const asDiff = argv.includes("--diff");
  const files = argv.filter((arg) => !arg.startsWith("--"));

  if (asDiff) {
    const beforeFile = files[0];
    const afterFile = files[1];
    if (files.length !== 2 || beforeFile === undefined || afterFile === undefined) {
      process.stderr.write("census: --diff needs exactly two dump files: node census.mjs --diff before.txt after.txt\n");
      return 1;
    }
    const beforeParsed = parse(readFileSync(beforeFile, "utf8"));
    const afterParsed = parse(readFileSync(afterFile, "utf8"));
    if (beforeParsed.rows.length === 0 || afterParsed.rows.length === 0) {
      process.stderr.write(
        "no '[generated bytecode for function: ...]' blocks found in one of the dumps (did you pass --print-bytecode?)\n",
      );
      return 1;
    }

    const before = classMap(beforeParsed.rows);
    const after = classMap(afterParsed.rows);
    const deltas: Record<string, Partial<Record<ClassLabel, number>>> = {};
    for (const name of new Set([...Object.keys(before), ...Object.keys(after)])) {
      const delta: Partial<Record<ClassLabel, number>> = {};
      let changed = false;
      for (const label of CLASS_LABELS) {
        const change = (after[name]?.[label] ?? 0) - (before[name]?.[label] ?? 0);
        if (change !== 0) {
          delta[label] = change;
          changed = true;
        }
      }
      if (changed) deltas[name] = delta;
    }

    if (asJson) {
      process.stdout.write(`${JSON.stringify({ before, after, deltas }, null, 2)}\n`);
    } else {
      const sums = zeroed(CLASS_LABELS);
      const data: Array<Array<string | number>> = Object.entries(deltas).map(([name, delta]) => {
        const cells: Array<string | number> = [name];
        for (const label of CLASS_LABELS) {
          const value = delta[label] ?? 0;
          sums[label] += value;
          cells.push(value > 0 ? `+${value}` : String(value));
        }
        return cells;
      });
      data.push([
        "totals",
        ...CLASS_LABELS.map((label) => (sums[label] > 0 ? `+${sums[label]}` : String(sums[label]))),
      ]);
      printTable(["function", ...CLASS_LABELS], data);
    }
    return beforeParsed.formatIssues + afterParsed.formatIssues > 0 ? 1 : 0;
  }

  const { rows, formatIssues } = parse(readInput(files));

  if (rows.length === 0) {
    process.stderr.write(
      "no '[generated bytecode for function: ...]' blocks found (did you pass --print-bytecode?)\n",
    );
    return 1;
  }

  const totals: Totals = { ...zeroed(LABELS), other: 0, protocol: {} };
  const allLabels: readonly CensusLabel[] = [...LABELS, OTHER];
  for (const label of allLabels) {
    totals[label] = rows.reduce((sum, row) => sum + row[label], 0);
  }
  for (const op of PROTOCOL_OPS) {
    totals.protocol[op] = rows.reduce((sum, row) => sum + (row.protocol[op] ?? 0), 0);
  }
  const classTotals = zeroed(CLASS_LABELS);
  for (const label of CLASS_LABELS) {
    classTotals[label] = rows.reduce((sum, row) => sum + row.classes[label], 0);
  }
  const otherOps = [...new Set(rows.flatMap((row) => row.otherOps))];

  if (asJson) {
    process.stdout.write(
      `${JSON.stringify(
        {
          functions: rows,
          totals,
          classTotals,
          otherOps,
          v8: process.versions.v8,
          node: process.version,
        },
        null,
        2,
      )}\n`,
    );
    return formatIssues > 0 ? 1 : 0;
  }

  const header = ["function", "len", ...LABELS, OTHER];
  const data = rows.map((row) => [row.name, row.length ?? "?", ...LABELS.map((label) => row[label]), row[OTHER]]);
  printTable(header, data);

  if (asClasses) {
    const classHeader = ["function", ...CLASS_LABELS, ...PROTOCOL_OPS, "loops", ...LOOP_LABELS];
    const classData = rows.map((row) => [
      row.name,
      ...CLASS_LABELS.map((label) => row.classes[label]),
      ...PROTOCOL_OPS.map((op) => row.protocol[op] ?? 0),
      row.loopBodies,
      ...LOOP_LABELS.map((label) => row[label]),
    ]);
    process.stdout.write("\n");
    printTable(classHeader, classData);
  }

  const closureContextSites = totals.closures + totals.contexts;
  process.stdout.write(`\n${rows.length} function(s), ${closureContextSites} closure/context construction sites\n`);
  process.stdout.write("rule-based columns: closures, contexts, arrays, objects, regexps, other\n");
  process.stdout.write("static sites per function body, not dynamic counts: a guarded site may never execute\n");
  process.stdout.write(`v8 ${process.versions.v8}, node ${process.version}\n`);
  if (otherOps.length > 0) {
    process.stdout.write(`other Create ops (not closures, contexts, arrays, objects, regexps): ${otherOps.join(", ")}\n`);
  }
  return formatIssues > 0 ? 1 : 0;
}
