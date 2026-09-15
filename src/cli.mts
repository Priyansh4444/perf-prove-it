#!/usr/bin/env node
import { Effect, Option } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { scan, type ScanResult } from "./index.mts";

const VERSION = "0.1.0";

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
  process.stdout.write(`\n${result.summary.reported} reported; ${result.summary.advisorySuppressed} advisory suppressed; ${result.summary.truncated} truncated.\n`);
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
  },
  (config) =>
    Effect.gen(function* () {
      const format: Format = config.stream ? "ndjson" : config.json ? "json" : "pretty";
      const concurrency = Option.isSome(config.concurrency) ? config.concurrency.value : undefined;
      const result = yield* Effect.tryPromise(() =>
        scan(Option.getOrElse(config.paths, (): readonly string[] => []), {
          includeAdvisory: config.includeAdvisory,
          max: config.max,
          ...(concurrency === undefined ? {} : { concurrency }),
        }),
      );
      yield* Effect.sync(() => render(result, format));
    }),
).pipe(Command.withDescription("Scan source roots and rank static performance candidates."));

const notPorted = (name: string) =>
  Command.make(name, {}, () =>
    Effect.sync(() => {
      process.stderr.write(`perf-prove-it ${name}: not ported yet (see docs/perf-prove-it-v1-plan.md)\n`);
      process.exitCode = 2;
    }),
  );

const root = audit.pipe(
  Command.withSubcommands([notPorted("census"), notPorted("compiled"), notPorted("tier"), notPorted("machine"), notPorted("install")]),
);

Command.run(root, { version: VERSION }).pipe(Effect.provide(NodeServices.layer), NodeRuntime.runMain);
