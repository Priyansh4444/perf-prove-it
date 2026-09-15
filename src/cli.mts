#!/usr/bin/env node
import { createRequire } from "node:module";
import { Effect, Option } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { scan, type ScanResult } from "./index.mts";
import { cleanupLedger, dismissedIds, dismiss, pruneLedgers } from "./scan/ledger.mts";
import { run as runCensus } from "./census.mts";
import { run as runCompiled } from "./compiled.mts";
import { run as runTier } from "./tier.mts";
import { run as runMachine } from "./machine.mts";
import { run as runInstall } from "./install.mts";

const requirePackage = createRequire(import.meta.url);

function readVersion(): string {
  try {
    const loaded: { version?: string } = requirePackage("../package.json");
    return typeof loaded.version === "string" ? loaded.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

const VERSION = readVersion();

type Format = "pretty" | "json" | "ndjson";

function render(result: ScanResult, format: Format): void {
  if (format === "json") {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  if (format === "ndjson") {
    process.stdout.write(`${JSON.stringify({ type: "start", claim: result.claim })}\n`);
    for (const finding of result.findings) process.stdout.write(`${JSON.stringify({ type: "finding", ...finding })}\n`);
    process.stdout.write(`${JSON.stringify({ type: "summary", ...result.summary })}\n`);
    return;
  }
  process.stdout.write("Static candidates, not measured hot paths\n\n");
  for (const item of result.findings) {
    process.stdout.write(`${item.score}\t${item.kind}\t${item.surface}\t${item.file}:${item.line}\n`);
    process.stdout.write(`  evidence: ${item.excerpt}\n  current:  ${item.currentWork}\n  floor:    ${item.candidateFloor}\n  prove:    ${item.proof}\n`);
    if (item.enclosingFunction !== null) process.stdout.write(`  calls:    ${item.enclosingFunction}: ${item.staticCallSites} static call site(s), rank +${item.rankBoost}\n`);
  }
  process.stdout.write(`\n${result.summary.reported} reported; ${result.summary.advisorySuppressed} advisory suppressed; ${result.summary.truncated} truncated; ${result.summary.dismissed} dismissed.\n`);
  process.stdout.write(`parser backend: oxc | files: ${result.summary.files} | concurrency: ${result.summary.concurrency} | parse errors: ${result.summary.parseErrors}\n`);
}

const audit = Command.make(
  "audit",
  {
    paths: Argument.String("paths").pipe(Argument.variadic(), Argument.optional),
    json: Flag.Boolean("json").pipe(Flag.withDefault(false)),
    stream: Flag.Boolean("stream").pipe(Flag.withDefault(false)),
    includeAdvisory: Flag.Boolean("include-advisory").pipe(Flag.withDefault(false)),
    max: Flag.Int("max").pipe(Flag.withDefault(20)),
    concurrency: Flag.Int("concurrency").pipe(Flag.optional),
    dismiss: Flag.String("dismiss").pipe(Flag.optional),
    reason: Flag.String("reason").pipe(Flag.withDefault("false-positive")),
    cleanupLedger: Flag.Boolean("cleanup-ledger").pipe(Flag.withDefault(false)),
  },
  (config) =>
    Effect.gen(function* () {
      pruneLedgers();
      if (config.cleanupLedger) {
        const path = cleanupLedger();
        yield* Effect.sync(() => process.stdout.write(`${JSON.stringify({ type: "ledger-cleaned", ledger: path })}\n`));
        return;
      }
      if (Option.isSome(config.dismiss)) {
        const path = dismiss(config.dismiss.value, config.reason);
        const id = config.dismiss.value;
        yield* Effect.sync(() => process.stdout.write(`${JSON.stringify({ type: "dismissed", id, reason: config.reason, ledger: path })}\n`));
        return;
      }
      const format: Format = config.stream ? "ndjson" : config.json ? "json" : "pretty";
      const concurrency = Option.isSome(config.concurrency) ? config.concurrency.value : undefined;
      const excluded = dismissedIds();
      const scanned = Effect.tryPromise(() =>
        scan(Option.getOrElse(config.paths, (): readonly string[] => []), {
          includeAdvisory: config.includeAdvisory,
          max: config.max,
          exclude: excluded,
          ...(concurrency === undefined ? {} : { concurrency }),
        }),
      );
      const result = yield* scanned.pipe(
        Effect.catch((cause) =>
          Effect.sync(() => {
            process.stderr.write(`perf-prove-it audit: ${cause instanceof Error ? cause.message : String(cause)}\n`);
            process.exitCode = 1;
            return null;
          }),
        ),
      );
      if (result !== null) yield* Effect.sync(() => render(result, format));
    }),
).pipe(Command.withDescription("Scan source roots and rank static performance candidates."));

const passthrough = (name: string, description: string) =>
  Command.make(name, {}, () => Effect.sync(() => {})).pipe(Command.withDescription(description));

const plainTools: Readonly<Record<string, (argv: readonly string[]) => number>> = {
  census: runCensus,
  compiled: runCompiled,
  tier: runTier,
  machine: runMachine,
  install: runInstall,
};

const sub = process.argv[2];
if (sub !== undefined && plainTools[sub] !== undefined) {
  process.exitCode = plainTools[sub](process.argv.slice(3));
} else {
  const root = audit.pipe(
    Command.withSubcommands([
      passthrough("census", "Parse V8 --print-bytecode dumps into an allocation and cost census."),
      passthrough("compiled", "Inventory emitted bundles and sourcemaps."),
      passthrough("tier", "Probe Maglev and TurboFan reachability for this build."),
      passthrough("machine", "Print a machine fingerprint for benchmark reports."),
      passthrough("install", "Install the bundled skills for coding agents."),
    ]),
  );
  Command.run(root, { version: VERSION }).pipe(Effect.provide(NodeServices.layer), NodeRuntime.runMain);
}
