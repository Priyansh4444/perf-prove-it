#!/usr/bin/env node
// Regenerate the presentation cards.
//   node generate-cards.mjs
// Writes presentation/cards/*.svg and, when rsvg-convert is installed, 2x PNGs.

import { mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "cards");
mkdirSync(outDir, { recursive: true });

const C = {
  bg: "#0B1220",
  panel: "#0F172A",
  border: "#1E293B",
  dim: "#64748B",
  faint: "#334155",
  text: "#E2E8F0",
  punct: "#94A3B8",
  kw: "#22D3EE",
  fn: "#34D399",
  str: "#FBBF24",
  num: "#C084FC",
  type: "#93C5FD",
  slate: "#475569",
  green: "#34D399",
  cyan: "#22D3EE",
};

const FONT = "'JetBrains Mono','Fira Code',ui-monospace,SFMono-Regular,Menlo,Consolas,monospace";
const esc = (s) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

const KEYWORDS = new Set([
  "const", "let", "var", "for", "of", "in", "if", "else", "return", "function", "export",
  "new", "type", "interface", "class", "extends", "import", "from", "as", "async", "await",
  "try", "catch", "throw", "typeof", "null", "undefined", "true", "false",
  "fn", "pub", "impl", "struct", "enum", "mut", "use", "match", "loop", "while", "where",
  "self", "crate", "mod", "trait", "dyn", "move", "ref", "unsafe", "static", "break", "continue",
]);

function tokenize(line) {
  const runs = [];
  let buf = "";
  const push = (text, color) => {
    if (!text) return;
    const last = runs[runs.length - 1];
    if (last && last.color === color) last.text += text;
    else runs.push({ text, color });
  };
  const flush = () => {
    if (buf) {
      push(buf, C.punct);
      buf = "";
    }
  };
  let i = 0;
  while (i < line.length) {
    const ch = line[i];
    if (ch === "/" && line[i + 1] === "/") {
      flush();
      push(line.slice(i), C.dim);
      break;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      flush();
      let j = i + 1;
      while (j < line.length && line[j] !== ch) {
        if (line[j] === "\\") j += 1;
        j += 1;
      }
      push(line.slice(i, j + 1), C.str);
      i = j + 1;
      continue;
    }
    if (/[A-Za-z_$]/.test(ch)) {
      flush();
      let j = i;
      while (j < line.length && /[\w$]/.test(line[j])) j += 1;
      const word = line.slice(i, j);
      let color = C.text;
      if (KEYWORDS.has(word)) color = C.kw;
      else if (/[A-Z]/.test(word[0])) color = C.type;
      let k = j;
      while (k < line.length && line[k] === " ") k += 1;
      if (line[k] === "(" && !KEYWORDS.has(word)) color = C.fn;
      push(word, color);
      i = j;
      continue;
    }
    if (/[0-9]/.test(ch)) {
      flush();
      let j = i;
      while (j < line.length && /[\w.]/.test(line[j])) j += 1;
      push(line.slice(i, j), C.num);
      i = j;
      continue;
    }
    buf += ch;
    i += 1;
  }
  flush();
  return runs;
}

function renderRuns(runs, x, y) {
  return runs
    .map((r, idx) =>
      idx === 0
        ? `<tspan x="${x}" y="${y}" fill="${r.color}">${esc(r.text)}</tspan>`
        : `<tspan fill="${r.color}">${esc(r.text)}</tspan>`,
    )
    .join("");
}

function frame({ width, height, title, file, body, badge }) {
  const header = `
  <rect width="${width}" height="${height}" rx="24" fill="${C.bg}" stroke="${C.border}" stroke-width="2"/>
  <path d="M0 24 A24 24 0 0 1 24 0 H${width - 24} A24 24 0 0 1 ${width} 24 V72 H0 Z" fill="${C.panel}"/>
  <line x1="0" y1="72" x2="${width}" y2="72" stroke="${C.border}" stroke-width="2"/>
  <circle cx="44" cy="36" r="8" fill="${C.faint}"/>
  <circle cx="70" cy="36" r="8" fill="${C.faint}"/>
  <circle cx="96" cy="36" r="8" fill="${C.faint}"/>
  <text x="132" y="43" font-family="${FONT}" font-size="20" fill="${C.dim}">${esc(file)}</text>
  <text x="${width - 44}" y="43" text-anchor="end" font-family="${FONT}" font-size="20" fill="${C.dim}">${esc(title)}</text>`;
  let badgeSvg = "";
  if (badge) {
    const w = Math.ceil(badge.length * 10.8 + 44);
    badgeSvg = `
  <rect x="${width - 44 - w}" y="${height - 62}" width="${w}" height="38" rx="19" fill="#0E2A21" stroke="#1F6F4A"/>
  <text x="${width - 44 - w / 2}" y="${height - 36}" text-anchor="middle" font-family="${FONT}" font-size="18" fill="${C.green}">${esc(badge)}</text>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(title)}">
  ${header}
  ${body}
  ${badgeSvg}
</svg>
`;
}

function codeCard({ file, title, lines, badge }) {
  const FS = 22;
  const CH = FS * 0.602;
  const LH = 36;
  const PAD = 44;
  const GUT = 64;
  const codeTop = 72 + 52;
  const rendered = lines.map((line) =>
    Array.isArray(line) ? line.map(([text, color]) => ({ text, color })) : tokenize(line),
  );
  const maxChars = Math.max(
    ...lines.map((line) => (Array.isArray(line) ? line.reduce((a, r) => a + r[0].length, 0) : line.length)),
  );
  const width = Math.max(760, Math.ceil(PAD * 2 + GUT + maxChars * CH + 24));
  const height = codeTop + rendered.length * LH + 104;
  const body = rendered
    .map((runs, idx) => {
      const y = codeTop + idx * LH;
      const num = `<text x="${PAD + 44}" y="${y}" text-anchor="end" font-family="${FONT}" font-size="${FS - 4}" fill="${C.faint}">${idx + 1}</text>`;
      const code = `<text xml:space="preserve" font-family="${FONT}" font-size="${FS}">${renderRuns(runs, PAD + GUT, y)}</text>`;
      return `  ${num}\n  ${code}`;
    })
    .join("\n");
  return frame({ width, height, title, file, body, badge });
}

function censusCard() {
  const rows = [
    ["rerank", 7, 1],
    ["tokenize", 4, 0],
    ["mapAspects", 4, 0],
    ["planL0", 1, 0],
    ["escalate", 5, 0],
  ];
  const width = 1160;
  const top = 72 + 96;
  const rowH = 64;
  const height = top + rows.length * rowH + 88;
  const max = 7;
  const scale = 250 / max;
  const barX = 330;
  const barX2 = 760;
  const barH = 18;
  let body = `
  <text x="44" y="${top - 28}" font-family="${FONT}" font-size="22" fill="${C.dim}">closures per call, from Ignition bytecode</text>
  <rect x="${barX - 16}" y="${top - 8}" width="12" height="12" fill="${C.slate}"/>
  <text x="${barX + 4}" y="${top + 2}" font-family="${FONT}" font-size="18" fill="${C.dim}">before</text>
  <rect x="${barX2 - 16}" y="${top - 8}" width="12" height="12" fill="${C.green}"/>
  <text x="${barX2 + 4}" y="${top + 2}" font-family="${FONT}" font-size="18" fill="${C.green}">after</text>`;
  rows.forEach(([name, before, after], idx) => {
    const y = top + 44 + idx * rowH;
    const b = before * scale;
    const a = after * scale;
    body += `
  <text x="44" y="${y + 5}" font-family="${FONT}" font-size="22" fill="${C.text}">${name}</text>
  <rect x="${barX}" y="${y - 12}" width="${b}" height="${barH}" rx="4" fill="${C.slate}"/>
  <text x="${barX + b + 12}" y="${y + 4}" font-family="${FONT}" font-size="20" fill="${C.dim}">${before}</text>
  <rect x="${barX2}" y="${y - 12}" width="${after === 0 ? 3 : a}" height="${barH}" rx="4" fill="${after === 0 ? C.faint : C.green}"/>
  <text x="${barX2 + Math.max(a, 3) + 12}" y="${y + 4}" font-family="${FONT}" font-size="20" fill="${after === 0 ? C.dim : C.green}">${after}</text>`;
  });
  const badge = "same output, 103 tests green";
  const bw = Math.ceil(badge.length * 10.8 + 44);
  body += `
  <rect x="${width - 44 - bw}" y="${height - 62}" width="${bw}" height="38" rx="19" fill="#0E2A21" stroke="#1F6F4A"/>
  <text x="${width - 44 - bw / 2}" y="${height - 36}" text-anchor="middle" font-family="${FONT}" font-size="18" fill="${C.green}">${badge}</text>`;
  return frame({ width, height, title: "ignition census", file: "census --print-bytecode", body });
}

function rustCard() {
  const runs = [
    ["run 1", 166.96, 71.6, "2.33x"],
    ["run 2", 158.9, 72.0, "2.21x"],
    ["run 3", 155.7, 63.55, "2.45x"],
  ];
  const width = 1160;
  const top = 72 + 104;
  const rowH = 92;
  const height = top + runs.length * rowH + 84;
  const max = 170;
  const scale = 430 / max;
  const barX = 240;
  const barH = 22;
  let body = `
  <text x="44" y="${top - 32}" font-family="${FONT}" font-size="22" fill="${C.dim}">milliseconds end to end, one pass replaced by an early-exit probe</text>
  <rect x="${barX - 16}" y="${top - 6}" width="12" height="12" fill="${C.slate}"/>
  <text x="${barX + 4}" y="${top + 4}" font-family="${FONT}" font-size="18" fill="${C.dim}">before</text>
  <rect x="${barX + 130}" y="${top - 6}" width="12" height="12" fill="${C.green}"/>
  <text x="${barX + 150}" y="${top + 4}" font-family="${FONT}" font-size="18" fill="${C.green}">after</text>`;
  runs.forEach(([label, before, after, speedup], idx) => {
    const y = top + 40 + idx * rowH;
    body += `
  <text x="44" y="${y + 6}" font-family="${FONT}" font-size="22" fill="${C.text}">${label}</text>
  <rect x="${barX}" y="${y - 24}" width="${before * scale}" height="${barH}" rx="4" fill="${C.slate}"/>
  <text x="${barX + before * scale + 12}" y="${y - 7}" font-family="${FONT}" font-size="18" fill="${C.dim}">${before.toFixed(2)} ms</text>
  <rect x="${barX}" y="${y + 4}" width="${after * scale}" height="${barH}" rx="4" fill="${C.green}"/>
  <text x="${barX + after * scale + 12}" y="${y + 21}" font-family="${FONT}" font-size="18" fill="${C.green}">${after.toFixed(2)} ms</text>
  <text x="${width - 44}" y="${y + 4}" text-anchor="end" font-family="${FONT}" font-size="26" fill="${C.cyan}">${speedup}</text>`;
  });
  const badge = "exact video order asserted";
  const bw = Math.ceil(badge.length * 10.8 + 44);
  body += `
  <rect x="${width - 44 - bw}" y="${height - 62}" width="${bw}" height="38" rx="19" fill="#0E2A21" stroke="#1F6F4A"/>
  <text x="${width - 44 - bw / 2}" y="${height - 36}" text-anchor="middle" font-family="${FONT}" font-size="18" fill="${C.green}">${badge}</text>`;
  return frame({ width, height, title: "rust probe", file: "collect_visible_videos", body });
}

const traceOpt = [
  [["$ ", C.dim], ["node --allow-natives-syntax --trace-opt harness.cjs | grep rerank", C.text]],
  [["[marking ", C.dim], ["<JSFunction rerank>", C.type], [" for optimization to ", C.dim], ["MAGLEV", C.cyan], [", reason: hot and stable]", C.dim]],
  [["[completed compiling rerank (target ", C.dim], ["MAGLEV", C.cyan], [")]", C.dim]],
  [["[marking ", C.dim], ["<JSFunction rerank>", C.type], [" for optimization to ", C.dim], ["TURBOFAN_JS", C.green], [", reason: hot and stable]", C.dim]],
  [["[completed optimizing rerank (target ", C.dim], ["TURBOFAN_JS", C.green], [")]", C.dim]],
  [["", C.text]],
  [["# no deopt lines. the code being measured is the optimized code.", C.dim]],
];

const phantom = [
  [["[bailout (kind: deopt-eager, reason: ", C.dim], ["wrong map", C.str], ["):", C.dim]],
  [["  deoptimizing <JSFunction ", C.dim], ["rerank", C.text], ["> ... ", C.dim], ["TURBOFAN_JS", C.green]],
  [["  bytecode offset 3, deopt exit 52", C.dim]],
  [["", C.text]],
  [["# two bundles in one process deoptimized each other.", C.dim]],
  [["# the first A/B run claimed 16x. the deopt trace said otherwise.", C.dim]],
  [["# thrown out, arms rerun in separate processes.", C.dim]],
];

const rerankBefore = [
  "const raw = candidates.map((c) => ({",
  "  rel: signalRel(c),",
  "  eng: signalEng(c),",
  "  auth: signalAuth(c),",
  "}));",
  "",
  "const z = {",
  "  rel: maxSignal(raw, (r) => r.rel),",
  "  eng: maxSignal(raw, (r) => r.eng),",
  "  auth: maxSignal(raw, (r) => r.auth),",
  "};",
];

const rerankAfter = [
  "const rels = new Array(candidates.length);",
  "let zRel = 1e-9, zEng = 1e-9, zAuth = 1e-9;",
  "",
  "for (let i = 0; i < candidates.length; i++) {",
  "  const c = candidates[i]!;",
  "  const rel = signalRel(c);",
  "  const eng = signalEng(c);",
  "  const auth = signalAuth(c);",
  "  rels[i] = rel; engs[i] = eng; auths[i] = auth;",
  "  if (rel > zRel) zRel = rel;",
  "  if (eng > zEng) zEng = eng;",
  "  if (auth > zAuth) zAuth = auth;",
  "}",
];

const cards = {
  "rerank-before": codeCard({
    file: "convex/engine/rank.ts",
    title: "before",
    lines: rerankBefore,
    badge: "7 closures, 204 temporaries per call",
  }),
  "rerank-after": codeCard({
    file: "convex/engine/rank.ts",
    title: "after",
    lines: rerankAfter,
    badge: "1 closure, 3 output arrays",
  }),
  "trace-opt": codeCard({
    file: "trace-opt",
    title: "backend verified",
    lines: traceOpt,
    badge: "Maglev then TurboFan, no deopts",
  }),
  "phantom-16x": codeCard({
    file: "trace-deopt",
    title: "the win that was not real",
    lines: phantom,
    badge: "16x thrown out",
  }),
  census: censusCard(),
  "rust-runs": rustCard(),
};

for (const [name, svg] of Object.entries(cards)) {
  writeFileSync(join(outDir, `${name}.svg`), svg);
  const png = join(outDir, `${name}.png`);
  const r = spawnSync("rsvg-convert", ["-z", "2", "-o", png, join(outDir, `${name}.svg`)]);
  if (r.error) console.log(`wrote ${name}.svg (rsvg-convert missing, no PNG)`);
  else console.log(`wrote ${name}.svg and ${name}.png`);
}
