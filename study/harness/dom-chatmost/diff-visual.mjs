// Write a red-mask diff image + cropped side-by-side of the changed region.
// Usage: node diff-visual.mjs a.png b.png out-prefix
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
const require = createRequire("/home/pronsh/Coding/perf-prove-it/presentation/package.json");
const { chromium } = require("playwright-core");

const a = readFileSync(process.argv[2]).toString("base64");
const b = readFileSync(process.argv[3]).toString("base64");
const prefix = process.argv[4] ?? "diff";

const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true });
const page = await browser.newPage();
const out = await page.evaluate(async ({ a, b }) => {
  const load = (data) =>
    new Promise((resolve) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.src = "data:image/png;base64," + data;
    });
  const [ia, ib] = await Promise.all([load(a), load(b)]);
  const w = ia.width;
  const h = ia.height;
  const ca = new OffscreenCanvas(w, h);
  const cb = new OffscreenCanvas(w, h);
  const xa = ca.getContext("2d");
  const xb = cb.getContext("2d");
  xa.drawImage(ia, 0, 0);
  xb.drawImage(ib, 0, 0);
  const da = xa.getImageData(0, 0, w, h);
  const db = xb.getImageData(0, 0, w, h);

  let minX = w, minY = h, maxX = 0, maxY = 0;
  for (let i = 0; i < da.data.length; i += 4) {
    const d = Math.max(
      Math.abs(da.data[i] - db.data[i]),
      Math.abs(da.data[i + 1] - db.data[i + 1]),
      Math.abs(da.data[i + 2] - db.data[i + 2])
    );
    if (d > 0) {
      const p = i / 4;
      const x = p % w;
      const y = Math.floor(p / w);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  const mask = new OffscreenCanvas(w, h);
  const xm = mask.getContext("2d");
  xm.drawImage(ia, 0, 0);
  for (let i = 0; i < da.data.length; i += 4) {
    const d = Math.max(
      Math.abs(da.data[i] - db.data[i]),
      Math.abs(da.data[i + 1] - db.data[i + 1]),
      Math.abs(da.data[i + 2] - db.data[i + 2])
    );
    if (d > 0) {
      const p = i / 4;
      xm.fillStyle = "red";
      xm.fillRect(p % w, Math.floor(p / w), 1, 1);
    }
  }

  const pad = 12;
  const cx = Math.max(0, minX - pad);
  const cy = Math.max(0, minY - pad);
  const cw = Math.min(w - cx, maxX - cx + pad);
  const ch = Math.min(h - cy, maxY - cy + pad);
  const side = new OffscreenCanvas(cw * 2 + 8, ch);
  const xs = side.getContext("2d");
  xs.fillStyle = "#111";
  xs.fillRect(0, 0, side.width, side.height);
  xs.drawImage(ia, cx, cy, cw, ch, 0, 0, cw, ch);
  xs.drawImage(ib, cx, cy, cw, ch, cw + 8, 0, cw, ch);

  const toB64 = async (canvas) => {
    const blob = await canvas.convertToBlob({ type: "image/png" });
    return await new Promise((r) => {
      const fr = new FileReader();
      fr.onload = () => r(fr.result.split(",")[1]);
      fr.readAsDataURL(blob);
    });
  };
  return {
    bbox: { minX, minY, maxX, maxY, cw, ch },
    mask: await toB64(mask),
    side: await toB64(side),
  };
}, { a, b });

writeFileSync(`${prefix}-mask.png`, Buffer.from(out.mask, "base64"));
writeFileSync(`${prefix}-side.png`, Buffer.from(out.side, "base64"));
console.log(JSON.stringify(out.bbox));
await browser.close();
