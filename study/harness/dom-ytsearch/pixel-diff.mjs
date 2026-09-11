// Pixel-diff PNG screenshots via headless Chromium canvas.
// node pixel-diff.mjs a.png b.png [...]
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";

const require = createRequire(new URL("../../../presentation/package.json", import.meta.url));
const { chromium } = require("playwright-core");

const files = process.argv.slice(2);
if (files.length < 2) throw new Error("need at least two files");
const images = await Promise.all(
  files.map(async (file) => ({
    file,
    dataUrl: `data:image/png;base64,${(await readFile(file)).toString("base64")}`,
  })),
);

const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true });
const page = await browser.newPage();
const result = await page.evaluate(async (images) => {
  const load = (url) =>
    new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = url;
    });
  const loaded = await Promise.all(images.map((image) => load(image.dataUrl)));
  const canvas = new OffscreenCanvas(loaded[0].width, loaded[0].height);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  const pixels = loaded.map((image) => {
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0);
    return context.getImageData(0, 0, canvas.width, canvas.height).data;
  });
  const compare = (a, b, label) => {
    let differing = 0;
    let maxDelta = 0;
    let sumDelta = 0;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -1;
    let maxY = -1;
    for (let i = 0; i < a.length; i += 4) {
      const delta =
        Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
      if (delta > 0) {
        differing += 1;
        sumDelta += delta;
        if (delta > maxDelta) maxDelta = delta;
        const pixel = i / 4;
        const x = pixel % canvas.width;
        const y = Math.floor(pixel / canvas.width);
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    return {
      label,
      differingPixels: differing,
      totalPixels: a.length / 4,
      percent: Number(((differing / (a.length / 4)) * 100).toFixed(4)),
      maxChannelSumDelta: maxDelta,
      meanDeltaOverDiffering: differing ? Number((sumDelta / differing).toFixed(2)) : 0,
      bbox: differing ? { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 } : null,
    };
  };
  const pairs = [];
  const diffImages = [];
  for (let i = 0; i < images.length; i++) {
    for (let j = i + 1; j < images.length; j++) {
      pairs.push(compare(pixels[i], pixels[j], `${images[i].file} vs ${images[j].file}`));
      const diffCanvas = document.createElement("canvas");
      diffCanvas.width = canvas.width;
      diffCanvas.height = canvas.height;
      const diffContext = diffCanvas.getContext("2d");
      const diffData = diffContext.createImageData(canvas.width, canvas.height);
      const a = pixels[i];
      const b = pixels[j];
      for (let k = 0; k < a.length; k += 4) {
        const delta =
          Math.abs(a[k] - b[k]) + Math.abs(a[k + 1] - b[k + 1]) + Math.abs(a[k + 2] - b[k + 2]);
        if (delta > 0) {
          diffData.data[k] = 255;
          diffData.data[k + 1] = Math.min(255, delta);
          diffData.data[k + 2] = 0;
          diffData.data[k + 3] = 255;
        }
      }
      diffContext.putImageData(diffData, 0, 0);
      diffImages.push({ label: `${i}-${j}`, dataUrl: diffCanvas.toDataURL("image/png") });
    }
  }
  return { size: { width: loaded[0].width, height: loaded[0].height }, pairs, diffImages };
}, images);
await browser.close();
const jsonOut = { size: result.size, pairs: result.pairs };
console.log(JSON.stringify(jsonOut, null, 2));
for (const diff of result.diffImages) {
  const pair = result.pairs.find((item) => item.label.startsWith(`${files[Number(diff.label.split("-")[0])]} vs`));
  if (pair && pair.differingPixels > 0) {
    const out = `pixdiff-${diff.label}.png`;
    await (await import("node:fs/promises")).writeFile(out, Buffer.from(diff.dataUrl.split(",")[1], "base64"));
    console.error(`wrote ${out}`);
  }
}
