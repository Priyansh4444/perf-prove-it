import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(new URL("../../../presentation/package.json", import.meta.url));
const { chromium } = require("playwright-core");
const here = path.dirname(fileURLToPath(import.meta.url));

const [fileA, fileB] = process.argv.slice(2);
const a = (await readFile(path.resolve(here, fileA))).toString("base64");
const b = (await readFile(path.resolve(here, fileB))).toString("base64");

const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true });
const page = await browser.newPage();
const result = await page.evaluate(
  async ([aData, bData]) => {
    const load = (data) =>
      new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = `data:image/png;base64,${data}`;
      });
    const [imgA, imgB] = await Promise.all([load(aData), load(bData)]);
    const draw = (img) => {
      const canvas = new OffscreenCanvas(img.width, img.height);
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);
      return ctx.getImageData(0, 0, img.width, img.height).data;
    };
    const dataA = draw(imgA);
    const dataB = draw(imgB);
    const { width, height } = imgA;
    const diffAt = (dx, dy, x0, y0, x1, y1) => {
      let differing = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const xb = x + dx;
          const yb = y + dy;
          if (xb < 0 || yb < 0 || xb >= width || yb >= height) continue;
          const ia = (y * width + x) * 4;
          const ib = (yb * width + xb) * 4;
          if (
            Math.abs(dataA[ia] - dataB[ib]) > 8 ||
            Math.abs(dataA[ia + 1] - dataB[ib + 1]) > 8 ||
            Math.abs(dataA[ia + 2] - dataB[ib + 2]) > 8
          ) {
            differing++;
          }
        }
      }
      return differing;
    };
    const bands = [];
    for (let y0 = 0; y0 < height; y0 += 100) {
      const y1 = Math.min(y0 + 100, height);
      let best = { diff: Infinity, dx: 0, dy: 0 };
      for (let dy = -4; dy <= 4; dy++) {
        for (let dx = -4; dx <= 4; dx++) {
          const diff = diffAt(dx, dy, 0, y0, width, y1);
          if (diff < best.diff) best = { diff, dx, dy };
        }
      }
      const zero = diffAt(0, 0, 0, y0, width, y1);
      bands.push({ y0, zero, bestDiff: best.diff, bestDx: best.dx, bestDy: best.dy });
    }
    return { width, height, bands };
  },
  [a, b],
);

console.log(JSON.stringify(result, null, 1));
await browser.close();
