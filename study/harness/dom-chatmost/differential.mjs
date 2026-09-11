// Differential check: before vs after renderChatEmotes produce the same
// semantic output (text runs, emote imgs, highlight spans) across edge cases
// and a fuzz corpus. Bundles both implementations with esbuild and renders
// with react-dom/server.
import { createRequire } from "node:module";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const chatmost = "/home/pronsh/Coding/chatmost";
const require = createRequire(path.join(chatmost, "package.json"));
const esbuild = require("esbuild");

const H = path.resolve(import.meta.dirname);
const TMP = path.join(H, ".tmp");
await mkdir(TMP, { recursive: true });

const stub = path.join(H, "streamerContextStub.tsx");
const chatSrc = path.join(chatmost, "web/src");
const stubPlugin = {
  name: "stub",
  setup(build) {
    build.onResolve({ filter: /streamerContext$/ }, () => ({ path: stub }));
    build.onResolve({ filter: /^@\// }, (args) => {
      const p = path.join(chatSrc, args.path.slice(2));
      return { path: p.endsWith(".tsx") || p.endsWith(".ts") ? p : p + (require("node:fs").existsSync(p + ".tsx") ? ".tsx" : ".ts") };
    });
  },
};

async function bundle(entry, out) {
  await esbuild.build({
    entryPoints: [entry],
    outfile: path.join(TMP, out),
    bundle: true,
    format: "esm",
    platform: "node",
    jsx: "automatic",
    packages: "external",
    plugins: [stubPlugin],
    logLevel: "silent",
  });
  return pathToFileURL(path.join(TMP, out)).href;
}

const beforeUrl = await bundle(path.join(H, "renderChatEmotes.before.tsx"), "before.mjs");
const afterUrl = await bundle(path.join(chatmost, "web/src/lib/renderChatEmotes.tsx"), "after.mjs");

const before = (await import(beforeUrl)).renderChatEmotes;
const after = (await import(afterUrl)).renderChatEmotes;
const { renderToStaticMarkup } = await import("react-dom/server");
const { createElement, Fragment } = await import("react");

const EMOTES = ["KEKW", "PogU", "catJAM", "EZ", "monkaS"];
const map = new Map(EMOTES.map((e) => [e, `https://cdn.example/${e}.webp`]));
const rec = Object.fromEntries(EMOTES.map((e) => [e, `https://cdn.example/${e}.webp`]));

function textOf(html) {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&");
}

function imgOf(html) {
  return [...html.matchAll(/<img\b[^>]*>/g)].map((m) => m[0]);
}

function highlightOf(html) {
  return [...html.matchAll(/<span class="bg-primary\/20[^"]*">([^<]*)<\/span>/g)].map((m) => m[1]);
}

function signature(fn, text, emoteMap, matchedToken) {
  const node = fn(text, emoteMap, matchedToken);
  const html = renderToStaticMarkup(createElement(Fragment, null, node));
  return JSON.stringify({ text: textOf(html), imgs: imgOf(html), highlights: highlightOf(html) });
}

const cases = [];
const edge = [
  "", " ", "   ", "\t", "\n", "a", " a ", "  a  b  ", "a\tb\nc",
  "KEKW", "kekw", "KEKW KEKW", "hello KEKW world",
  "KEKW at start", "at end KEKW", "no emotes here",
  "csgo EZ clap", "a  b", "  leading", "trailing  ",
  "mixed KEKW kEkw Kekw", "word1 word2 word3",
  "foo bar baz", "foo  bar", "<script>", "& < > \" '", "emoji 😀 KEKW",
  "a\u00a0b", "tab\there", "line\nbreak",
];
for (const text of edge) {
  cases.push([text, map, undefined]);
  cases.push([text, rec, undefined]);
  cases.push([text, map, "foo"]);
  cases.push([text, rec, "KEKW"]);
}
const plainEdge = ["foo bar", " foo ", "foo  bar", "foo\tbar", "FOO bar", "a KEKW foo"];
for (const text of plainEdge) {
  cases.push([text, undefined, undefined]);
  cases.push([text, undefined, "foo"]);
}

// Fuzz
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(0xf00d);
const alphabet = ["foo", "bar", "baz", "KEKW", "kekw", "EZ", " ", "  ", "\t", "\n", "<", ">", "&", '"', "'", "😀", "123"];
for (let i = 0; i < 3000; i++) {
  const n = Math.floor(rnd() * 14);
  let s = "";
  for (let j = 0; j < n; j++) s += alphabet[Math.floor(rnd() * alphabet.length)];
  const useMap = rnd() < 0.5;
  const matched = rnd() < 0.4 ? alphabet[Math.floor(rnd() * 4)] : undefined;
  cases.push([s, useMap ? map : rec, matched]);
}

let mismatches = 0;
let checked = 0;
for (const [text, emoteMap, matchedToken] of cases) {
  checked++;
  const b = signature(before, text, emoteMap, matchedToken);
  const a = signature(after, text, emoteMap, matchedToken);
  if (b !== a) {
    mismatches++;
    if (mismatches <= 5) console.log("MISMATCH", JSON.stringify({ text, matchedToken, b, a }));
  }
}

const out = { checked, mismatches, cases: cases.length, fuzz: 3000 };
console.log(JSON.stringify(out));
await writeFile(path.join(H, "evidence", "differential.json"), JSON.stringify(out, null, 2) + "\n");
await rm(TMP, { recursive: true, force: true });
