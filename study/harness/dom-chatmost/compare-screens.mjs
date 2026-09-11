// Pixel-diff two PNG screenshots inside Chromium.
// Usage: node compare-screens.mjs a.png b.png
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const require = createRequire("/home/pronsh/Coding/perf-prove-it/presentation/package.json");
const { chromium } = require("playwright-core");

const a = readFileSync(process.argv[2]).toString("base64");
const b = readFileSync(process.argv[3]).toString("base64");

const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true });
const page = await browser.newPage();
const res = await page.evaluate(async ({ a, b }) => {
  const load = (data) =>
    new Promise((resolve) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.src = "data:image/png;base64," + data;
    });
  const [ia, ib] = await Promise.all([load(a), load(b)]);
  const w = Math.max(ia.width, ib.width);
  const h = Math.max(ia.height, ib.height);
  const ca = new OffscreenCanvas(w, h);
  const cb = new OffscreenCanvas(w, h);
  const xa = ca.getContext("2d");
  const xb = cb.getContext("2d");
  xa.drawImage(ia, 0, 0);
  xb.drawImage(ib, 0, 0);
  const da = xa.getImageData(0, 0, w, h).data;
  const db = xb.getImageData(0, 0, w, h).data;
  let diff = 0;
  let maxd = 0;
  let sumd = 0;
  let firstDiff = null;
  for (let i = 0; i < da.length; i += 4) {
    const d = Math.max(Math.abs(da[i] - db[i]), Math.abs(da[i + 1] - db[i + 1]), Math.abs(da[i + 2] - db[i + 2]));
    if (d > 0) {
      diff++;
      if (firstDiff === null) firstDiff = { px: (i / 4) % w, py: Math.floor(i / 4 / w) };
    }
    if (d > maxd) maxd = d;
    sumd += d;
  }
  return { w, h, diff, maxd, mean: +(sumd / (da.length / 4)).toFixed(5), firstDiff };
}, { a, b });
console.log(JSON.stringify(res));
await browser.close();
