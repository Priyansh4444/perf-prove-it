// Reproduces the DOM-skill measurement claims on system Chromium.
// Run: node study/dom-primitives/verify.mjs            (writes results.json)
import { createRequire } from "node:module";
import { writeFile } from "node:fs/promises";

const require = createRequire(new URL("../../presentation/package.json", import.meta.url));
const { chromium } = require("playwright-core");

const ROUNDS = 3;
const NODES = 500;

const scenarios = {
  // Append + read geometry every iteration. Expected: one forced layout per iteration.
  thrash: (n) => {
    const c = document.getElementById("c");
    for (let i = 0; i < n; i++) {
      const d = document.createElement("div");
      d.textContent = "row " + i;
      c.appendChild(d);
      d.dataset.w = String(c.offsetWidth);
    }
  },
  // Build off-DOM, one insert, no frame advance. Expected: zero layout passes.
  fragmentNoRaf: (n) => {
    const c = document.getElementById("c");
    const f = document.createDocumentFragment();
    for (let i = 0; i < n; i++) {
      const d = document.createElement("div");
      d.textContent = "row " + i;
      f.appendChild(d);
    }
    c.appendChild(f);
  },
  // Same insert, then two rAF ticks. Expected: exactly one layout pass.
  fragmentRaf: (n) => {
    const c = document.getElementById("c");
    const f = document.createDocumentFragment();
    for (let i = 0; i < n; i++) {
      const d = document.createElement("div");
      d.textContent = "row " + i;
      f.appendChild(d);
    }
    c.appendChild(f);
  },
};

const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true });
const out = { browser: browser.version(), node: process.version, nodes: NODES, rounds: ROUNDS, scenarios: {} };

async function run(body, { advanceFrames }) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await page.setContent("<!doctype html><html><body><div id='c'></div></body></html>");
  const client = await context.newCDPSession(page);
  await client.send("Performance.enable");
  const metrics = async () =>
    Object.fromEntries((await client.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]));

  const before = await metrics();
  await page.evaluate(body, NODES);
  if (advanceFrames) {
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  }
  const after = await metrics();
  await context.close();
  return {
    LayoutCount: after.LayoutCount - before.LayoutCount,
    RecalcStyleCount: after.RecalcStyleCount - before.RecalcStyleCount,
    LayoutDurationMs: Number(((after.LayoutDuration - before.LayoutDuration) * 1000).toFixed(2)),
    RecalcStyleDurationMs: Number(((after.RecalcStyleDuration - before.RecalcStyleDuration) * 1000).toFixed(2)),
    Nodes: after.Nodes - before.Nodes,
  };
}

for (const [name, body] of Object.entries(scenarios)) {
  const rounds = [];
  for (let i = 0; i < ROUNDS; i++) rounds.push(await run(body, { advanceFrames: name === "fragmentRaf" }));
  const median = (key) => {
    const vals = rounds.map((r) => r[key]).sort((a, b) => a - b);
    return vals[Math.floor(vals.length / 2)];
  };
  out.scenarios[name] = {
    rounds,
    median: Object.fromEntries(
      ["LayoutCount", "RecalcStyleCount", "LayoutDurationMs", "RecalcStyleDurationMs", "Nodes"].map((k) => [k, median(k)])
    ),
  };
}

// page.evaluate accepts a real function; a string is evaluated as an expression,
// so an arrow-function string is never invoked. If a string must be used, wrap it: "(() => {...})()".
{
  const page = await browser.newPage();
  await page.setContent("<!doctype html><body></body>");
  const stringForm = await page.evaluate("() => { globalThis.__ran = true; return 42; }");
  const ranAfterString = await page.evaluate(() => globalThis.__ran === true);
  const fnForm = await page.evaluate(() => { globalThis.__ran2 = true; return 7; });
  const ranAfterFn = await page.evaluate(() => globalThis.__ran2 === true);
  out.evaluateTrap = { stringForm, ranAfterString, fnForm, ranAfterFn };
  await page.close();
}

await browser.close();
await writeFile(new URL("./results.json", import.meta.url), JSON.stringify(out, null, 2) + "\n");
console.log(JSON.stringify(out, null, 2));
