// CDP harness for the postwork reply-tree render.
// Usage:
//   node measure.mjs --arm before --dir dist-before --rounds 3
//   node measure.mjs --before dist-before --after dist-after --rounds 3 --tag interleaved
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(new URL("../../../presentation/package.json", import.meta.url));
const { chromium } = require("playwright-core");

const here = path.dirname(fileURLToPath(import.meta.url));
const evidenceDir = path.join(here, "evidence");

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const beforeDir = arg("before", arg("dir", null));
const afterDir = arg("after", null);
const rounds = Number(arg("rounds", "3"));
const tag = arg("tag", "run");
const singleArm = arg("arm", null);

if (!beforeDir) {
  console.error("pass --before <dist dir> (or --dir with --arm <label>)");
  process.exit(1);
}

const ARMS = afterDir
  ? [
      { name: "before", dir: path.resolve(here, beforeDir) },
      { name: "after", dir: path.resolve(here, afterDir) },
    ]
  : [{ name: singleArm ?? "before", dir: path.resolve(here, beforeDir) }];

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

async function serve(dir) {
  const server = createServer(async (req, res) => {
    try {
      let pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
      if (pathname === "/") pathname = "/index.html";
      const file = path.join(dir, pathname);
      if (!file.startsWith(dir)) {
        res.writeHead(403).end();
        return;
      }
      const data = await readFile(file);
      res.writeHead(200, {
        "content-type": MIME[path.extname(file)] ?? "application/octet-stream",
        "cache-control": "no-store",
      });
      res.end(data);
    } catch {
      res.writeHead(404).end("not found");
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, port: server.address().port };
}

const COUNTER_KEYS = [
  "Nodes",
  "JSEventListeners",
  "LayoutObjects",
  "LayoutCount",
  "RecalcStyleCount",
  "LayoutDuration",
  "RecalcStyleDuration",
  "ScriptDuration",
  "TaskDuration",
  "JSHeapUsedSize",
];

const TRACE_KEYS = [
  "Layout",
  "UpdateLayoutTree",
  "Paint",
  "UpdateLayerTree",
  "CompositeLayers",
  "ParseHTML",
  "EventDispatch",
  "FunctionCall",
  "RunTask",
];

function sha1(value) {
  return createHash("sha1").update(value).digest("hex");
}

async function metrics(client) {
  const { metrics: list } = await client.send("Performance.getMetrics");
  return Object.fromEntries(list.map((m) => [m.name, m.value]));
}

function delta(after, before) {
  const out = {};
  for (const key of COUNTER_KEYS) {
    const value = (after[key] ?? 0) - (before[key] ?? 0);
    out[key] = key.endsWith("Duration") ? Number((value * 1000).toFixed(3)) : value;
  }
  return out;
}

async function runArm(browser, arm, round, port, warmup = false) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const client = await context.newCDPSession(page);
  await client.send("Performance.enable");

  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__ready === true);
  await page.evaluate(() => document.fonts.ready.then(() => true));

  const events = [];
  client.on("Tracing.dataCollected", (e) => events.push(...(e.value ?? [])));
  const tracingComplete = new Promise((resolve) =>
    client.once("Tracing.tracingComplete", resolve),
  );
  await client.send("Tracing.start", {
    categories: "devtools.timeline,v8,blink.user_timing",
    transferMode: "ReportEvents",
  });

  const before = await metrics(client);
  await page.evaluate(async () => {
    window.__mount();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  });
  const after = await metrics(client);

  await client.send("Tracing.end");
  await tracingComplete;

  const trace = {};
  for (const event of events) {
    if (!event.name) continue;
    trace[event.name] ??= { count: 0, durMs: 0 };
    trace[event.name].count += 1;
    trace[event.name].durMs += (event.dur ?? 0) / 1000;
  }
  for (const key of TRACE_KEYS) {
    if (!trace[key]) trace[key] = { count: 0, durMs: 0 };
  }

  const structure = await page.evaluate(() => window.__structure());
  const text = await page.evaluate(() => window.__text());
  const stats = await page.evaluate(() => window.__stats());

  // Screenshots are taken after the page settles; the metric window above stays
  // at exactly two rAF ticks.
  await page.evaluate(async () => {
    for (let i = 0; i < 5; i++) {
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    }
  });
  const topPng = await page.screenshot({ animations: "disabled" });

  let axHash = null;
  let axCount = null;
  let axTotal = null;
  try {
    await client.send("Accessibility.enable");
    const { nodes } = await client.send("Accessibility.getFullAXTree");
    const visible = nodes.filter((n) => !n.ignored);
    const projection = visible.map((n) => [
      n.role?.value ?? "",
      n.name?.value ?? "",
      ...(n.properties ?? [])
        .filter((p) => ["expanded", "focusable", "modal", "readonly"].includes(p.name))
        .map((p) => `${p.name}=${JSON.stringify(p.value?.value)}`)
        .sort(),
    ]);
    axCount = projection.length;
    axTotal = nodes.length;
    axHash = sha1(JSON.stringify(projection));
  } catch {
    axHash = null;
  }

  await page.evaluate(async () => {
    for (let i = 0; i < 6; i++) {
      window.scrollTo(0, document.documentElement.scrollHeight);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    }
  });
  const bottomPng = await page.screenshot({ animations: "disabled" });

  const name = `${tag}-${arm.name}-r${round}`;
  if (!warmup) {
    await writeFile(path.join(evidenceDir, `${name}-top.png`), topPng);
    await writeFile(path.join(evidenceDir, `${name}-bottom.png`), bottomPng);
  }

  const roundResult = {
    arm: arm.name,
    round,
    delta: delta(after, before),
    trace: Object.fromEntries(
      TRACE_KEYS.map((k) => [k, { count: trace[k].count, durMs: Number(trace[k].durMs.toFixed(3)) }]),
    ),
    stats,
    structure: { length: structure.length, sha1: sha1(structure) },
    text: { length: text.length, sha1: sha1(text) },
    ax: { count: axCount, total: axTotal, sha1: axHash },
    screenshots: {
      top: { file: `${name}-top.png`, sha1: sha1(topPng) },
      bottom: { file: `${name}-bottom.png`, sha1: sha1(bottomPng) },
    },
  };

  await context.close();
  return roundResult;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

await mkdir(evidenceDir, { recursive: true });

const servers = new Map();
for (const arm of ARMS) {
  servers.set(arm.name, await serve(arm.dir));
}

const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true });
const results = {
  browser: browser.version(),
  node: process.version,
  viewport: { width: 1280, height: 800 },
  rounds,
  tag,
  arms: {},
};

for (const arm of ARMS) {
  results.arms[arm.name] = { dir: arm.dir, rounds: [] };
}

// Discard one mount per arm first: the very first lifecycle in a fresh browser
// process pays font-shaping and raster caches, which would otherwise land on the
// arm that happens to run first.
for (const arm of ARMS) {
  await runArm(browser, arm, 0, servers.get(arm.name).port, true);
}

for (let round = 1; round <= rounds; round++) {
  for (const arm of ARMS) {
    const result = await runArm(browser, arm, round, servers.get(arm.name).port);
    results.arms[arm.name].rounds.push(result);
    console.log(
      `${result.arm} r${round}`,
      JSON.stringify({
        LayoutCount: result.delta.LayoutCount,
        RecalcStyleCount: result.delta.RecalcStyleCount,
        LayoutDurationMs: result.delta.LayoutDuration,
        RecalcStyleDurationMs: result.delta.RecalcStyleDuration,
        UpdateLayoutTreeDurMs: result.trace.UpdateLayoutTree.durMs,
        PaintDurMs: result.trace.Paint.durMs,
        Nodes: result.delta.Nodes,
      }),
    );
  }
}

for (const arm of ARMS) {
  const rs = results.arms[arm.name].rounds;
  const medianOf = (fn) => median(rs.map(fn));
  results.arms[arm.name].median = {
    LayoutCount: medianOf((r) => r.delta.LayoutCount),
    RecalcStyleCount: medianOf((r) => r.delta.RecalcStyleCount),
    LayoutDurationMs: medianOf((r) => r.delta.LayoutDuration),
    RecalcStyleDurationMs: medianOf((r) => r.delta.RecalcStyleDuration),
    ScriptDurationMs: medianOf((r) => r.delta.ScriptDuration),
    TaskDurationMs: medianOf((r) => r.delta.TaskDuration),
    Nodes: medianOf((r) => r.delta.Nodes),
    JSEventListeners: medianOf((r) => r.delta.JSEventListeners),
    LayoutTraceDurMs: medianOf((r) => r.trace.Layout.durMs),
    UpdateLayoutTreeDurMs: medianOf((r) => r.trace.UpdateLayoutTree.durMs),
    PaintDurMs: medianOf((r) => r.trace.Paint.durMs),
    FunctionCallDurMs: medianOf((r) => r.trace.FunctionCall.durMs),
    elements: medianOf((r) => r.stats.elements),
    scrollHeight: medianOf((r) => r.stats.scrollHeight),
  };
}

await browser.close();
for (const { server } of servers.values()) server.close();

const outFile = path.join(evidenceDir, `${tag}.json`);
await writeFile(outFile, JSON.stringify(results, null, 2) + "\n");
console.log(`wrote ${outFile}`);
