import { createRequire } from "node:module";
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(new URL("../../../presentation/package.json", import.meta.url));
const { chromium } = require("playwright-core");
const here = path.dirname(fileURLToPath(import.meta.url));

async function serve(dir) {
  const server = createServer(async (req, res) => {
    try {
      let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
      if (p === "/") p = "/index.html";
      const data = await readFile(path.join(dir, p));
      const ext = path.extname(p);
      res.writeHead(200, {
        "content-type":
          ext === ".js"
            ? "text/javascript"
            : ext === ".css"
              ? "text/css"
              : ext === ".html"
                ? "text/html"
                : "application/octet-stream",
      });
      res.end(data);
    } catch {
      res.writeHead(404).end("nf");
    }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { server, port: server.address().port };
}

const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true });

for (const arm of process.argv.slice(2)) {
  const { server, port } = await serve(path.resolve(here, arm));
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__ready === true);
  await page.evaluate(async () => {
    window.__mount();
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    }
  });
  const png = await page.screenshot({ animations: "disabled" });
  const file = `evidence/variant-${arm}-top.png`;
  await writeFile(path.join(here, file), png);
  console.log(arm, createHash("sha1").update(png).digest("hex").slice(0, 12), png.length);
  await context.close();
  server.close();
}

await browser.close();
