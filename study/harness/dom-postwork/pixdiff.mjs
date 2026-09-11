import { createRequire } from "node:module";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(new URL("../../../presentation/package.json", import.meta.url));
const { chromium } = require("playwright-core");
const here = path.dirname(fileURLToPath(import.meta.url));

const [fileA, fileB, outName] = process.argv.slice(2);
if (!fileA || !fileB) {
  console.error("usage: node pixdiff.mjs a.png b.png [out.png]");
  process.exit(1);
}

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
    if (imgA.width !== imgB.width || imgA.height !== imgB.height) {
      return { sizeMismatch: true, a: [imgA.width, imgA.height], b: [imgB.width, imgB.height] };
    }
    const canvasA = new OffscreenCanvas(imgA.width, imgA.height);
    const canvasB = new OffscreenCanvas(imgB.width, imgB.height);
    const ctxA = canvasA.getContext("2d");
    const ctxB = canvasB.getContext("2d");
    ctxA.drawImage(imgA, 0, 0);
    ctxB.drawImage(imgB, 0, 0);
    const dataA = ctxA.getImageData(0, 0, imgA.width, imgA.height).data;
    const dataB = ctxB.getImageData(0, 0, imgB.width, imgB.height).data;
    let differing = 0;
    let maxDelta = 0;
    let minX = imgA.width;
    let minY = imgA.height;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < imgA.height; y++) {
      for (let x = 0; x < imgA.width; x++) {
        const i = (y * imgA.width + x) * 4;
        const dr = Math.abs(dataA[i] - dataB[i]);
        const dg = Math.abs(dataA[i + 1] - dataB[i + 1]);
        const db = Math.abs(dataA[i + 2] - dataB[i + 2]);
        const delta = Math.max(dr, dg, db);
        if (delta > 0) {
          differing += 1;
          maxDelta = Math.max(maxDelta, delta);
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    return {
      width: imgA.width,
      height: imgA.height,
      differing,
      total: imgA.width * imgA.height,
      fraction: differing / (imgA.width * imgA.height),
      maxDelta,
      bbox: maxX < 0 ? null : { minX, minY, maxX, maxY },
    };
  },
  [a, b],
);

console.log(JSON.stringify(result));
await browser.close();
