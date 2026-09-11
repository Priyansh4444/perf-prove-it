// CDP measurement driver for the ytsearch results render (real app + mocked API).
//
// Run the dev server first (from /home/pronsh/Coding/ytsearch):
//   ./node_modules/.bin/vite --port 3000 --strictPort
// Then:
//   node measure.mjs --arm before --interaction mount --out results-before.json
//
// One fresh browser context per round, 3 rounds, two rAF ticks after the
// interaction, CDP Performance metrics + devtools.timeline trace.
import { createRequire } from "node:module";
import { writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  buildMountResponse,
  buildInitialSingleVideoResponse,
  buildExpandedResponse,
  placeholderSvg,
} from "./fixtures.mjs";

const require = createRequire(new URL("../../../presentation/package.json", import.meta.url));
const { chromium } = require("playwright-core");

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE_URL = process.env.YTSEARCH_BASE_URL ?? "http://localhost:3000";
const QUERY = "moment";

function parseArgs() {
  const args = { arm: "before", interaction: "mount", out: undefined, rounds: 3 };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i].replace(/^--/, "");
    const value = argv[i + 1];
    if (key === "rounds") args.rounds = Number(value);
    else if (key === "arm" || key === "interaction" || key === "out") args[key] = value;
  }
  if (!args.out) args.out = `results-${args.arm}-${args.interaction}.json`;
  return args;
}

const METRIC_KEYS = [
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
  "JSHeapTotalSize",
  "Documents",
  "Frames",
];

const TRACE_NAMES = [
  "RunTask",
  "FunctionCall",
  "EventDispatch",
  "ParseHTML",
  "UpdateLayoutTree",
  "Layout",
  "Paint",
  "UpdateLayerTree",
  "CompositeLayers",
  "ParseAuthorStyleSheet",
  "ScheduleStyleRecalculation",
  "InvalidateLayout",
  "HitTest",
  "Commit",
  "PrePaint",
  "RasterTask",
  "PrePaintTreeWalk",
];

async function setUpRoutes(page, counters) {
  // Block every external origin except the mocked thumbnail CDN.
  await page.route("https://**", (route) => route.abort());
  await page.route("https://i.ytimg.com/**", (route) => {
    const videoId = new URL(route.request().url()).pathname.split("/")[2] ?? "0";
    return route.fulfill({ contentType: "image/svg+xml", body: placeholderSvg(videoId) });
  });
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/availability") {
      return route.fulfill({
        json: {
          status: "ready",
          search_enabled: true,
          enforced: true,
          schedule_policy: "scheduled",
          schedule_phase: "open",
          time_zone: "America/Los_Angeles",
          daily_window: { opens: "12:00", closes: "00:00", label: "12:00 PM–12:00 AM Pacific Time" },
          next_transition_at: "2026-09-10T07:00:00.000Z",
        },
      });
    }
    if (url.pathname === "/api/youtubers") return route.fulfill({ json: { channels: [] } });
    if (url.pathname === "/api/health") return route.fulfill({ json: { ok: true } });
    if (url.pathname === "/api/index-status") {
      return route.fulfill({ json: { handle: "", status: "idle" } });
    }
    if (url.pathname === "/api/search") {
      counters.searchRequests += 1;
      const videoId = url.searchParams.get("video_id");
      const body = videoId
        ? buildExpandedResponse()
        : counters.interaction === "expand"
          ? buildInitialSingleVideoResponse()
          : buildMountResponse();
      if (videoId) counters.expandRequests += 1;
      return route.fulfill({ json: body });
    }
    return route.fulfill({ status: 404, json: { error: "not mocked" } });
  });
}

const metricsSnapshot = async (client) =>
  Object.fromEntries(
    (await client.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]),
  );

const delta = (before, after, key) => {
  const value = (after[key] ?? 0) - (before[key] ?? 0);
  if (key.endsWith("Duration")) return Number((value * 1000).toFixed(3));
  if (key.startsWith("JSHeap")) return value;
  return value;
};

const twoRafs = (page) =>
  page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

async function runRound({ browser, args, round }) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    reducedMotion: "reduce",
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  const counters = { searchRequests: 0, expandRequests: 0, interaction: args.interaction };
  await setUpRoutes(page, counters);
  const client = await context.newCDPSession(page);
  await client.send("Performance.enable");

  const initialUrl = args.interaction === "expand" ? `${BASE_URL}/?q=${QUERY}` : `${BASE_URL}/`;
  await page.goto(initialUrl, { waitUntil: "domcontentloaded" });
  await page.getByRole("combobox", { name: "Search transcripts" }).waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Search" }).waitFor({ state: "attached" });
  // Warm the lazy results chunk so the measured interaction is the render, not
  // the first-ever module fetch. Both arms use the same warmup.
  await page.evaluate(() => import("/src/components/search-results.tsx"));
  await twoRafs(page);
  if (process.env.YTSEARCH_INJECT_CSS) {
    await page.addStyleTag({ content: process.env.YTSEARCH_INJECT_CSS });
    await twoRafs(page);
  }

  const traceEvents = [];
  client.on("Tracing.dataCollected", (event) => traceEvents.push(...(event.value ?? [])));
  const traceComplete = new Promise((resolve) => client.once("Tracing.tracingComplete", resolve));

  let settle;
  if (args.interaction === "mount") {
    const input = page.getByRole("combobox", { name: "Search transcripts" });
    await input.fill(QUERY);
    await twoRafs(page);
  } else {
    await page.waitForFunction(
      () => document.querySelectorAll("button[aria-label='Mark moment useful']").length === 3,
      { timeout: 15_000 },
    );
    await page.getByRole("button", { name: /Show all moments/ }).waitFor({ state: "visible" });
    await twoRafs(page);
  }

  const before = await metricsSnapshot(client);
  await client.send("Tracing.start", {
    categories: "devtools.timeline,v8,blink.user_timing",
    transferMode: "ReportEvents",
  });

  const started = Date.now();
  if (args.interaction === "mount") {
    await page.getByRole("combobox", { name: "Search transcripts" }).press("Enter");
    await page.waitForFunction(
      () => document.querySelectorAll("article.search-result-card").length === 30,
      { timeout: 15_000 },
    );
    settle = () => twoRafs(page);
  } else {
    await page.getByRole("button", { name: /Show all moments/ }).click();
    await page.waitForFunction(
      () => document.querySelectorAll("button[aria-label='Mark moment useful']").length === 100,
      { timeout: 15_000 },
    );
    settle = () => twoRafs(page);
  }
  await settle();
  const wallMs = Date.now() - started;

  await client.send("Tracing.end");
  await traceComplete;
  const after = await metricsSnapshot(client);
  const screenshot = await page.screenshot({ animations: "disabled" });
  // Visible region from the top of the first card down to the viewport bottom:
  // excludes the volatile request-duration text in the page header.
  const visibleRegion = await page.evaluate(() => {
    const rect = document.querySelector("article.search-result-card").getBoundingClientRect();
    const y = Math.max(0, Math.round(rect.top));
    return { x: 0, y, width: 1280, height: Math.max(1, 800 - y) };
  });
  const visibleRowBoxes = await page.evaluate(() => {
    const rows = [...document.querySelectorAll("button[aria-label='Mark moment useful']")].slice(0, 8);
    const box = (element) => {
      const rect = element.getBoundingClientRect();
      return {
        top: Number(rect.top.toFixed(3)),
        height: Number(rect.height.toFixed(3)),
        width: Number(rect.width.toFixed(3)),
      };
    };
    return rows.map((button) => {
      const row = button.parentElement.parentElement;
      const column = button.parentElement;
      const useful = column.children[0];
      const notUseful = column.children[1];
      const styleOf = (element) => {
        const style = getComputedStyle(element);
        return {
          borderTop: `${style.borderTopWidth} ${style.borderTopStyle} ${style.borderTopColor}`,
          borderRight: `${style.borderRightWidth} ${style.borderRightStyle} ${style.borderRightColor}`,
          color: style.color,
          background: style.backgroundColor,
        };
      };
      return {
        row: box(row),
        column: box(column),
        useful: { ...box(useful), style: styleOf(useful) },
        notUseful: { ...box(notUseful), style: styleOf(notUseful) },
        rowBorderTop: getComputedStyle(row).borderTopColor,
      };
    });
  });
  const roundingProbe = await page.evaluate(() => {
    const cells = [...document.querySelectorAll(".moment-row")];
    return {
      rowCount: cells.length,
      contentVisibility: cells[0] ? getComputedStyle(cells[0]).contentVisibility : undefined,
      containIntrinsic: cells[0] ? getComputedStyle(cells[0]).containIntrinsicSize : undefined,
      scrollHeight: document.documentElement.scrollHeight,
      elementCount: document.querySelectorAll("*").length,
    };
  });
  const visibleShot = await page.screenshot({ clip: visibleRegion, animations: "disabled" });
  // Extra two frames: detect whether a transient paint offset settles.
  await twoRafs(page);
  const lateVisibleShot = await page.screenshot({ clip: visibleRegion, animations: "disabled" });
  let repairedShot;
  if (process.env.YTSEARCH_REPAINT === "1") {
    await page.evaluate(() => {
      const container = document.querySelector("article.search-result-card .grid.gap-2");
      if (container) container.style.display = "none";
      void document.body.offsetHeight;
      if (container) container.style.display = "";
    });
    await twoRafs(page);
    repairedShot = await page.screenshot({ clip: visibleRegion, animations: "disabled" });
    await writeFile(join(HERE, `repaired-${args.arm}-${args.interaction}-r${round}.png`), repairedShot);
  }
  // Force-render content-visibility-skipped content, then capture an offscreen
  // band: proves the skipped rows are pixel-identical when rendered.
  await page.addStyleTag({
    content:
      "* { content-visibility: visible !important; contain-intrinsic-size: none !important; }",
  });
  await twoRafs(page);
  const revealedRegion = await page.evaluate(() => {
    const rect = document.querySelector("article.search-result-card").getBoundingClientRect();
    const y = Math.max(0, Math.round(rect.top) + 400);
    return { x: 0, y, width: 1280, height: Math.min(1200, Math.max(1, document.body.scrollHeight - y)) };
  });
  const revealedShot = await page.screenshot({ clip: revealedRegion, animations: "disabled" });
  const dom = await page.evaluate(() => {
    const outline = (element) => {
      if (element.nodeType === Node.TEXT_NODE) {
        const text = element.textContent.trim();
        return text ? `#${text.replace(/\d+/g, "N").slice(0, 60)}` : null;
      }
      if (element.nodeType !== Node.ELEMENT_NODE) return null;
      const tag = element.tagName.toLowerCase();
      if (tag === "svg") return "svg";
      const children = [...element.childNodes].map(outline).filter(Boolean);
      return children.length > 0
        ? `${tag}[${children.join("|")}]`
        : `${tag}(${element.textContent.trim().replace(/\d+/g, "N").slice(0, 40)})`;
    };
    const sections = [...document.querySelectorAll("section")].filter((section) =>
      section.querySelector("article.search-result-card"),
    );
    const rowMetrics = [...document.querySelectorAll("button[aria-label='Mark moment useful']")]
      .slice(0, 6)
      .map((button) => {
        const row = button.parentElement.parentElement;
        const rect = row.getBoundingClientRect();
        return { height: Number(rect.height.toFixed(2)), top: Number(rect.top.toFixed(2)) };
      });
    const articles = [...document.querySelectorAll("article.search-result-card")].map((article) => {
      const aria = [...article.querySelectorAll("[aria-label]")].map((element) => [
        element.tagName.toLowerCase(),
        element.getAttribute("aria-label"),
        element.getAttribute("aria-pressed") ?? undefined,
      ]);
      return {
        id: article.id,
        outline: outline(article),
        aria,
        rows: article.querySelectorAll("button[aria-label='Mark moment useful']").length,
      };
    });
    return {
      elementCount: document.querySelectorAll("*").length,
      articleCount: articles.length,
      sectionHeaders: sections.map((section) => section.querySelector("h2")?.textContent ?? ""),
      articles,
      rowMetrics,
      bodyTextSample: document.body.innerText.replace(/\d+/g, "N").slice(0, 400),
    };
  });
  const domDigest = createHash("sha256")
    .update(
      JSON.stringify({
        articleCount: dom.articleCount,
        sectionHeaders: dom.sectionHeaders,
        aria: dom.articles.map((article) => article.aria),
        outline: dom.articles.map((article) => article.outline),
      }),
    )
    .digest("hex");
  const screenshotDigest = createHash("sha256").update(screenshot).digest("hex");
  const screenshotPath = join(HERE, `screen-${args.arm}-${args.interaction}-r${round}.png`);
  await writeFile(screenshotPath, screenshot);
  const visibleDigest = createHash("sha256").update(visibleShot).digest("hex");
  const visiblePath = join(HERE, `visible-${args.arm}-${args.interaction}-r${round}.png`);
  await writeFile(visiblePath, visibleShot);
  const revealedDigest = createHash("sha256").update(revealedShot).digest("hex");
  const revealedPath = join(HERE, `revealed-${args.arm}-${args.interaction}-r${round}.png`);
  await writeFile(revealedPath, revealedShot);
  const lateVisibleDigest = createHash("sha256").update(lateVisibleShot).digest("hex");
  const lateVisiblePath = join(HERE, `late-visible-${args.arm}-${args.interaction}-r${round}.png`);
  await writeFile(lateVisiblePath, lateVisibleShot);

  const trace = {};
  const eventDispatchTypes = {};
  for (const event of traceEvents) {
    if (!event.name) continue;
    if (event.name === "EventDispatch" && event.args?.data?.type) {
      eventDispatchTypes[event.args.data.type] =
        (eventDispatchTypes[event.args.data.type] ?? 0) + 1;
    }
    const entry = (trace[event.name] ??= { count: 0, durMs: 0 });
    entry.count += 1;
    if (typeof event.dur === "number") entry.durMs += event.dur / 1000;
  }
  for (const entry of Object.values(trace)) entry.durMs = Number(entry.durMs.toFixed(3));
  const longEvents = traceEvents
    .filter((event) => (event.dur ?? 0) >= 2000)
    .map((event) => ({
      name: event.name,
      durMs: Number(((event.dur ?? 0) / 1000).toFixed(3)),
      ...(event.args?.data
        ? {
            functionName: event.args.data.functionName,
            url: event.args.data.url,
            lineNumber: event.args.data.lineNumber,
            eventType: event.args.data.eventType,
            type: event.args.data.type,
          }
        : {}),
      ...(event.args?.beginData ? { beginData: event.args.beginData } : {}),
      ...(event.args?.endData ? { endData: event.args.endData } : {}),
    }))
    .sort((a, b) => b.durMs - a.durMs)
    .slice(0, 80);

  await context.close();
  return {
    round,
    wallMs,
    counters,
    metrics: Object.fromEntries(METRIC_KEYS.map((key) => [key, delta(before, after, key)])),
    trace,
    eventDispatchTypes,
    traceHighlight: Object.fromEntries(
      TRACE_NAMES.filter((name) => trace[name]).map((name) => [name, trace[name]]),
    ),
    longEvents,
    dom: {
      digest: domDigest,
      elementCount: dom.elementCount,
      articleCount: dom.articleCount,
      sectionHeaders: dom.sectionHeaders,
      rowsPerArticle: dom.articles.map((article) => article.rows),
      rowMetrics: dom.rowMetrics,
      ariaByArticle: dom.articles.slice(0, 3).map((article) => article.aria),
      bodyTextSample: dom.bodyTextSample,
    },
    screenshot: { digest: screenshotDigest, path: screenshotPath, bytes: screenshot.length },
    visibleScreenshot: { digest: visibleDigest, path: visiblePath, bytes: visibleShot.length, region: visibleRegion },
    visibleRowBoxes,
    roundingProbe,
    revealedScreenshot: { digest: revealedDigest, path: revealedPath, bytes: revealedShot.length, region: revealedRegion },
    lateVisibleScreenshot: { digest: lateVisibleDigest, path: lateVisiblePath, bytes: lateVisibleShot.length },
  };
}

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

function aggregate(rounds, keys) {
  const result = {};
  for (const key of keys) {
    const values = rounds.map((round) => round[key]).filter((value) => typeof value === "number");
    if (values.length > 0) result[key] = median(values);
  }
  return result;
}

const args = parseArgs();
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true });
const browserVersion = browser.version();
const rounds = [];
for (let round = 1; round <= args.rounds; round++) {
  const result = await runRound({ browser, args, round });
  rounds.push(result);
  console.log(
    `round ${round}: wall ${result.wallMs}ms ` +
      `LayoutCount ${result.metrics.LayoutCount} RecalcStyleCount ${result.metrics.RecalcStyleCount} ` +
      `LayoutDuration ${result.metrics.LayoutDuration}ms RecalcStyleDuration ${result.metrics.RecalcStyleDuration}ms ` +
      `Paint ${result.traceHighlight.Paint?.count ?? 0}/${result.traceHighlight.Paint?.durMs ?? 0}ms ` +
      `UpdateLayoutTree ${result.traceHighlight.UpdateLayoutTree?.count ?? 0}/${result.traceHighlight.UpdateLayoutTree?.durMs ?? 0}ms`,
  );
}
await browser.close();

const output = {
  arm: args.arm,
  interaction: args.interaction,
  baseUrl: BASE_URL,
  query: QUERY,
  browser: browserVersion,
  node: process.version,
  viewport: { width: 1280, height: 800 },
  reducedMotion: "reduce",
  metricsMedian: aggregate(rounds.map((round) => round.metrics), METRIC_KEYS),
  rounds,
};
await mkdir(HERE, { recursive: true });
await writeFile(join(HERE, args.out), JSON.stringify(output, null, 2) + "\n");
console.log(JSON.stringify({ arm: args.arm, metricsMedian: output.metricsMedian }, null, 2));
