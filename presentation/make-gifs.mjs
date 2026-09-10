#!/usr/bin/env node
// Regenerate the Vesper-themed output GIFs from the real captured runs.
//   node make-gifs.mjs            all scenarios
//   node make-gifs.mjs before     one scenario by name fragment
//
// Pipeline: Shiki (vesper) colors the text -> chromium screenshots each reveal
// frame -> ImageMagick assembles the GIF.

import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const tmpRoot = "/tmp/opencode/gifframes";
const outDir = join(here, "gifs");
mkdirSync(outDir, { recursive: true });

const V = {
  bg: "#101010",
  bar: "#161616",
  border: "#2A2A2A",
  fg: "#FFF",
  dim: "#8B8B8B",
  orange: "#FFC799",
  mint: "#99FFE4",
  slate: "#A0A0A0",
};

const esc = (s) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

function clean(line) {
  return line
    .replace(/^\s*\d*\s*[ES]>\s*/, "")
    .replace(/^0x[0-9a-f]+\s*/, "")
    .replace(/\(sfi = 0x[0-9a-f]+\)/g, "")
    .replace(/, caller SP 0x[0-9a-f]+, pc 0x[0-9a-f]+/g, "")
    .replace(/0x[0-9a-f]+/g, "")
    .replace(/\(\s+/g, "(")
    .replace(/\s+>/g, ">")
    .replace(/\(\s*\)/g, "")
    .replace(/\s{2,}/g, " ")
    .trimEnd();
}

function readLines(file) {
  return readFileSync(join(here, file), "utf8").split("\n");
}

function dumpFrame({ cmd, lines, note, file }) {
  const rows = [];
  rows.push({ kind: "cmd", text: cmd });
  for (const line of lines) rows.push({ kind: "out", text: line });
  if (note) {
    rows.push({ kind: "gap", text: "" });
    rows.push({ kind: "note", text: note });
  }
  return { rows, file };
}

const scenarios = [];
{
  const all = readLines("bytecode/rerank-before.txt");
  const header = all.slice(0, 6).map(clean);
  const closures = all.filter((l) => l.includes("CreateClosure")).map(clean);
  scenarios.push({
    name: "rerank-before",
    height: 600,
    frame: dumpFrame({
      cmd: "node --allow-natives-syntax --print-bytecode --print-bytecode-filter=rerank harness.cjs",
      lines: [...header, "...", ...closures],
      note: "=> 7 CreateClosure per call, bytecode length 476",
      file: "convex/engine/rank.ts, before",
    }),
  });
}
{
  const all = readLines("bytecode/rerank-after.txt");
  const header = all.slice(0, 6).map(clean);
  const closures = all.filter((l) => l.includes("CreateClosure")).map(clean);
  scenarios.push({
    name: "rerank-after",
    height: 460,
    frame: dumpFrame({
      cmd: "node --allow-natives-syntax --print-bytecode --print-bytecode-filter=rerank harness.cjs",
      lines: [...header, "...", ...closures],
      note: "=> 1 CreateClosure per call; the callbacks moved inline, so this function grew to 1856 bytes",
      file: "convex/engine/rank.ts, after",
    }),
  });
}
{
  const all = readLines("bytecode/opt-after.txt").filter((l) => l.trim()).map(clean);
  scenarios.push({
    name: "opt-tier-up",
    height: 620,
    frame: dumpFrame({
      cmd: "node --allow-natives-syntax --trace-opt harness.cjs",
      lines: all,
      note: "=> Maglev then TurboFan on every hot function, no deopt lines (addresses trimmed)",
      file: "trace-opt",
    }),
  });
}
{
  const all = readLines("bytecode/deopt-ab.txt")
    .filter((l) => l.includes("wrong map"))
    .slice(0, 4)
    .map(clean);
  scenarios.push({
    name: "deopt-wrong-map",
    height: 430,
    frame: dumpFrame({
      cmd: "node --allow-natives-syntax --trace-deopt ab.cjs",
      lines: all,
      note: "=> both bundles in one process deoptimized each other; the 16x A/B result was thrown out",
      file: "trace-deopt, before.mjs + after.mjs",
    }),
  });
}

function lineHtml(row) {
  const text = esc(row.text);
  if (row.kind === "cmd") {
    return `<div class="row cmd"><span style="color:${V.dim}">$ </span>${text}</div>`;
  }
  if (row.kind === "note") return `<div class="row note">${text}</div>`;
  if (row.kind === "gap") return `<div class="row gap"></div>`;
  const hl = row.text.includes("CreateClosure")
    ? text.replaceAll("CreateClosure", `<span style="color:${V.orange}">CreateClosure</span>`)
    : text.replaceAll(/MAGLEV/g, `<span style="color:${V.slate}">MAGLEV</span>`).replaceAll(/TURBOFAN_JS/g, `<span style="color:${V.mint}">TURBOFAN_JS</span>`).replaceAll(/wrong map/g, `<span style="color:${V.orange}">wrong map</span>`);
  const cls = row.text.includes("CreateClosure") ? "row out hl" : "row out";
  return `<div class="${cls}">${hl}</div>`;
}

function htmlFor(frame, revealCount, file) {
  const rows = frame.rows
    .slice(0, revealCount)
    .map(lineHtml)
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: ${V.bg}; font-family: "JetBrains Mono", "Fira Code", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  .win { border: 1px solid ${V.border}; border-radius: 14px; overflow: hidden; margin: 22px; background: ${V.bg}; }
  .bar { display: flex; align-items: center; gap: 8px; background: ${V.bar}; border-bottom: 1px solid ${V.border}; padding: 12px 16px; }
  .dot { width: 11px; height: 11px; border-radius: 50%; background: #3A3A3A; }
  .title { color: ${V.dim}; font-size: 13px; margin-left: 10px; }
  .body { padding: 20px 24px 24px; }
  .row { color: ${V.fg}; font-size: 15px; line-height: 1.62; white-space: pre; }
  .row.hl { background: rgba(255, 199, 153, 0.08); border-left: 2px solid ${V.orange}; margin-left: -24px; padding-left: 22px; }
  .row.note { color: ${V.mint}; margin-top: 10px; white-space: pre-wrap; }
  .row.gap { height: 10px; }
  .row.cmd { color: ${V.fg}; }
  </style></head><body><div class="win">
  <div class="bar"><span class="dot"></span><span class="dot"></span><span class="dot"></span><span class="title">${esc(file)}</span></div>
  <div class="body">${rows}</div>
  </div></body></html>`;
}

function shoot(htmlPath, pngPath, height) {
  const r = spawnSync("chromium", [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--hide-scrollbars",
    `--window-size=1240,${height}`,
    `--screenshot=${pngPath}`,
    `file://${htmlPath}`,
  ]);
  if (r.error) throw r.error;
}

const filter = process.argv[2];
for (const scenario of scenarios) {
  if (filter && !scenario.name.includes(filter)) continue;
  const dir = join(tmpRoot, scenario.name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const rows = scenario.frame.rows;
  const frames = [];
  for (let n = 1; n <= rows.length; n++) {
    const htmlPath = join(dir, `frame-${String(n).padStart(3, "0")}.html`);
    const pngPath = join(dir, `frame-${String(n).padStart(3, "0")}.png`);
    writeFileSync(htmlPath, htmlFor(scenario.frame, n, scenario.frame.file));
    shoot(htmlPath, pngPath, scenario.height);
    frames.push(pngPath);
  }
  const last = frames[frames.length - 1];
  const gif = join(outDir, `${scenario.name}.gif`);
  const args = ["-delay", "55", ...frames, "-delay", "260", last, "-loop", "0", "-layers", "Optimize", gif];
  const m = spawnSync("magick", args);
  if (m.error) throw m.error;
  console.log(`wrote gifs/${scenario.name}.gif (${rows.length} frames)`);
}
