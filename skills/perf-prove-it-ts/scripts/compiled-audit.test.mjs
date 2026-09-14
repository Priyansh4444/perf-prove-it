#!/usr/bin/env node
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { auditCompiled } from "./compiled-audit.mjs";

const fixture = mkdtempSync(join(tmpdir(), "perf-compiled-audit-"));
const chunk = join(fixture, "app-abc.js");
const source = 'function render(){return "ChatMarkdown"}\n//# sourceMappingURL=app-abc.js.map\n';
writeFileSync(chunk, source);
writeFileSync(`${chunk}.map`, JSON.stringify({ version: 3, sources: ["../src/App.tsx"], sourcesContent: ["export function App() {}"], names: [], mappings: "" }));

const [result] = auditCompiled(fixture, ["ChatMarkdown"]);
if (result.bytes !== Buffer.byteLength(source) || result.sourcemap?.sources !== 1 || result.sourcemap?.embedded !== true || result.matched?.[0] !== "ChatMarkdown") {
  throw new Error(`unexpected result: ${JSON.stringify(result)}`);
}
console.log("compiled audit test: all cases pass");
