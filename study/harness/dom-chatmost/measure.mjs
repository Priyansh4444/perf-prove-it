// CDP measurement harness for the chatmost chat-feed render path.
// Usage: node measure.mjs [pilot|final] [rounds]
// Requires: static server on BASE (see run.sh), built arms in evidence/serve/<arm>.
import { createRequire } from "node:module";
import { writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";

const require = createRequire("/home/pronsh/Coding/perf-prove-it/presentation/package.json");
const { chromium } = require("playwright-core");

const MODE = process.argv[2] ?? "pilot";
const ROUNDS = Number(process.argv[3] ?? (MODE === "pilot" ? 1 : 3));
const BASE = process.env.HARNESS_BASE ?? "http://127.0.0.1:8017";
const OUT_DIR = new URL("./evidence/", import.meta.url);
const SCREEN_DIR = new URL("./evidence/screens/", import.meta.url);

const ARM_URLS = {
  before: `${BASE}/before/`,
  after: `${BASE}/after/`,
};

const KEYS = [
  "Nodes",
  "LayoutObjects",
  "JSEventListeners",
  "LayoutCount",
  "RecalcStyleCount",
  "LayoutDuration",
  "RecalcStyleDuration",
  "ScriptDuration",
  "TaskDuration",
  "JSHeapUsedSize",
  "Documents",
];

const TRACE_NAMES = [
  "Layout",
  "UpdateLayoutTree",
  "Paint",
  "UpdateLayerTree",
  "CompositeLayers",
  "ParseHTML",
  "EventDispatch",
  "FunctionCall",
  "RunTask",
  "Commit",
  "PrePaint",
];

function delta(before, after) {
  const out = {};
  for (const k of KEYS) out[k] = +(((after[k] ?? 0) - (before[k] ?? 0))).toFixed(6);
  return out;
}

function sha1(buf) {
  return createHash("sha1").update(buf).digest("hex");
}

function summarizeTrace(events) {
  const counts = {};
  const durations = {};
  for (const e of events) {
    if (e.ph !== "X" || typeof e.dur !== "number") continue;
    counts[e.name] = (counts[e.name] ?? 0) + 1;
    durations[e.name] = +(((durations[e.name] ?? 0) + e.dur / 1000)).toFixed(3);
  }
  const out = { counts: {}, durationsMs: {} };
  for (const name of TRACE_NAMES) {
    out.counts[name] = counts[name] ?? 0;
    out.durationsMs[name] = durations[name] ?? 0;
  }
  out.totalEvents = events.length;
  return out;
}

async function twoRaf(page) {
  await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  );
}

async function settleScroll(page) {
  await page.evaluate(async () => {
    const el = document.querySelector("#feed-root .overflow-y-auto");
    if (!el) return;
    let last = NaN;
    let stable = 0;
    for (let i = 0; i < 300 && stable < 10; i++) {
      await new Promise((r) => requestAnimationFrame(r));
      if (el.scrollTop === last) stable += 1;
      else {
        stable = 0;
        last = el.scrollTop;
      }
    }
  });
}

async function captureParity(p) {
  return p.evaluate(() => {
    const feed = document.querySelector("#feed-root");
    const img = [...feed.querySelectorAll("img")];
    return {
      textContent: feed.textContent,
      innerText: feed.innerText,
      elementCount: feed.querySelectorAll("*").length,
      spanCount: feed.querySelectorAll("span").length,
      imgCount: img.length,
      imgAlts: img.map((i) => i.alt),
      ariaLabelCount: feed.querySelectorAll("[aria-label]").length,
      roleCount: feed.querySelectorAll("[role]").length,
      scrollTop: document.querySelector("#feed-root .overflow-y-auto")?.scrollTop ?? null,
      scrollHeight: document.querySelector("#feed-root .overflow-y-auto")?.scrollHeight ?? null,
    };
  });
}

async function traceWindow(client, fn) {
  const collected = [];
  const onData = (e) => collected.push(...(e.value ?? []));
  client.on("Tracing.dataCollected", onData);
  const complete = new Promise((resolve) => client.once("Tracing.tracingComplete", resolve));
  await client.send("Tracing.start", {
    categories: "devtools.timeline,v8,blink.user_timing",
    transferMode: "ReportEvents",
  });
  await fn();
  await client.send("Tracing.end");
  await complete;
  client.off("Tracing.dataCollected", onData);
  return collected;
}

let page;

async function runRound(browser, arm, round) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const p = await context.newPage();
  page = p;
  const consoleIssues = [];
  p.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") consoleIssues.push(`${m.type()}: ${m.text()}`);
  });
  p.on("pageerror", (e) => consoleIssues.push(`pageerror: ${e.message}`));

  const client = await context.newCDPSession(p);
  await client.send("Performance.enable");
  const metrics = async () =>
    Object.fromEntries((await client.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]));

  await p.goto(ARM_URLS[arm], { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.__harness, null, { timeout: 30_000 });
  await twoRaf(p);

  const m0 = await metrics();
  const traceMountEvents = await traceWindow(client, async () => {
    await p.evaluate(() => window.__harness.mount());
    await twoRaf(p);
  });
  const m1 = await metrics();
  const mountCount = await p.evaluate(() => window.__harness.messageCount());

  await settleScroll(p);
  await p.evaluate(() =>
    Promise.all([...document.images].map((i) => (i.decode ? i.decode().catch(() => {}) : undefined)))
  );
  const parityMount = await captureParity(p);
  const shotMount = await p.screenshot({ animations: "disabled", fullPage: false });

  const m1b = await metrics();

  const traceAppendEvents = await traceWindow(client, async () => {
    await p.evaluate(() => window.__harness.appendOne());
    await twoRaf(p);
  });
  const m2 = await metrics();
  const appendCount = await p.evaluate(() => window.__harness.messageCount());

  await settleScroll(p);
  await p.evaluate(() =>
    Promise.all([...document.images].map((i) => (i.decode ? i.decode().catch(() => {}) : undefined)))
  );
  const parityAppend = await captureParity(p);
  const shotAppend = await p.screenshot({ animations: "disabled", fullPage: false });

  await mkdir(SCREEN_DIR, { recursive: true });
  await writeFile(new URL(`./screens/${arm}-r${round}-mount.png`, OUT_DIR), shotMount);
  await writeFile(new URL(`./screens/${arm}-r${round}-append.png`, OUT_DIR), shotAppend);

  if (process.env.HARNESS_RAW) {
    await mkdir(new URL(`./raw/`, OUT_DIR), { recursive: true });
    await writeFile(
      new URL(`./raw/${arm}-r${round}-mount.json`, OUT_DIR),
      JSON.stringify(traceMountEvents) + "\n"
    );
    await writeFile(
      new URL(`./raw/${arm}-r${round}-append.json`, OUT_DIR),
      JSON.stringify(traceAppendEvents) + "\n"
    );
  }

  let a11y = null;
  try {
    a11y = await p.accessibility.snapshot();
  } catch {}

  await context.close();

  return {
    arm,
    round,
    armUrl: ARM_URLS[arm],
    mountCount,
    appendCount,
    mount: delta(m0, m1),
    append: delta(m1b, m2),
    traceMount: summarizeTrace(traceMountEvents),
    traceAppend: summarizeTrace(traceAppendEvents),
    parityMount,
    parityAppend,
    screenshotMountSha1: sha1(shotMount),
    screenshotAppendSha1: sha1(shotAppend),
    screenshotMountBytes: shotMount.length,
    screenshotAppendBytes: shotAppend.length,
    a11y,
    consoleIssues,
  };
}

const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true });
const out = {
  mode: MODE,
  browser: browser.version(),
  viewport: "1280x800",
  rounds: ROUNDS,
  base: BASE,
  arms: {},
};

for (let round = 1; round <= ROUNDS; round++) {
  let order = round % 2 === 1 ? ["before", "after"] : ["after", "before"];
  if (process.env.HARNESS_ARM) order = order.filter((a) => a === process.env.HARNESS_ARM);
  for (const arm of order) {
    process.stdout.write(`round ${round} arm ${arm} ... `);
    const r = await runRound(browser, arm, round);
    (out.arms[arm] ??= { rounds: [], medians: null }).rounds.push(r);
    console.log(
      `mount Nd=${r.mount.Nodes} Layout=${r.mount.LayoutCount} Script=${(r.mount.ScriptDuration * 1000).toFixed(1)}ms | ` +
        `append Nd=${r.append.Nodes} Layout=${r.append.LayoutCount} Script=${(r.append.ScriptDuration * 1000).toFixed(1)}ms`
    );
  }
}

const median = (nums) => {
  const s = [...nums].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

for (const arm of Object.keys(out.arms)) {
  const rounds = out.arms[arm].rounds;
  out.arms[arm].medians = {
    mount: Object.fromEntries(KEYS.map((k) => [k, median(rounds.map((r) => r.mount[k]))])),
    append: Object.fromEntries(KEYS.map((k) => [k, median(rounds.map((r) => r.append[k]))])),
    traceMount: {
      counts: Object.fromEntries(
        Object.keys(out.arms[arm].rounds[0].traceMount.counts).map((n) => [
          n,
          median(rounds.map((r) => r.traceMount.counts[n])),
        ])
      ),
      durationsMs: Object.fromEntries(
        Object.keys(out.arms[arm].rounds[0].traceMount.durationsMs).map((n) => [
          n,
          median(rounds.map((r) => r.traceMount.durationsMs[n])),
        ])
      ),
    },
    traceAppend: {
      counts: Object.fromEntries(
        Object.keys(out.arms[arm].rounds[0].traceAppend.counts).map((n) => [
          n,
          median(rounds.map((r) => r.traceAppend.counts[n])),
        ])
      ),
      durationsMs: Object.fromEntries(
        Object.keys(out.arms[arm].rounds[0].traceAppend.durationsMs).map((n) => [
          n,
          median(rounds.map((r) => r.traceAppend.durationsMs[n])),
        ])
      ),
    },
  };
}

await browser.close();
await mkdir(OUT_DIR, { recursive: true });
await writeFile(new URL(`./results-${MODE}.json`, OUT_DIR), JSON.stringify(out, null, 2) + "\n");
console.log(`\nwrote evidence/results-${MODE}.json`);
