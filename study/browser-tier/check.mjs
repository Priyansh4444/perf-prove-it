// Verifies that V8 tier checks work in the browser when the embedder allows natives syntax.
// Run: node study/browser-tier/check.mjs
import { createRequire } from "node:module";
const require = createRequire(new URL("../../presentation/package.json", import.meta.url));
const { chromium } = require("playwright-core");

async function probe(args) {
  const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true, args });
  const page = await browser.newPage();
  await page.setContent("<!doctype html><body></body>");
  let result;
  try {
    result = await page.evaluate(`(function () {
      function f(x) { return x + 1; }
      for (let i = 0; i < 50000; i++) f(i);
      const out = { status: %GetOptimizationStatus(f) };
      try { out.turbofan = %ActiveTierIsTurbofan(f); } catch (e) { out.turbofan = String(e); }
      try { out.maglev = %ActiveTierIsMaglev(f); } catch (e) { out.maglev = String(e); }
      return out;
    })()`);
  } catch (error) {
    result = { error: String(error).split("\n")[0] };
  }
  console.log(JSON.stringify({ args, chromium: browser.version(), result }));
  await browser.close();
}

await probe([]);
await probe(["--js-flags=--allow-natives-syntax"]);
