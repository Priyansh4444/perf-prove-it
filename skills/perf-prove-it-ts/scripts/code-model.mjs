import { createRequire } from "node:module";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { statSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const PARSERS = ["typescript", "@babel/parser", "acorn"];
const SCRIPT_KINDS = { ".ts": "TS", ".tsx": "TSX", ".js": "JS", ".jsx": "JSX", ".mjs": "JS", ".cjs": "JS", ".mts": "TS", ".cts": "TS" };

function resolveFrom(name, startDir) {
  let dir = resolve(startDir);
  while (true) {
    try {
      return require.resolve(name, { paths: [dir] });
    } catch {
      const parent = dirname(dir);
      if (parent === dir) return null;
      dir = parent;
    }
  }
}

function hasApi(name, api) {
  if (!api) return false;
  return name === "typescript" ? typeof api.createSourceFile === "function" : typeof api.parse === "function";
}

export function resolveParser(roots = ["."]) {
  const lexical = process.env.PERF_PROVE_IT_LEXICAL;
  if (lexical && lexical !== "0" && lexical !== "false") return null;
  const starts = [];
  if (process.env.PERF_PROVE_IT_PARSER_ROOT) starts.push(process.env.PERF_PROVE_IT_PARSER_ROOT);
  for (const root of roots) {
    try {
      const absolute = resolve(root);
      starts.push(statSync(absolute).isDirectory() ? absolute : dirname(absolute));
    } catch {
      /* nonexistent root */
    }
  }
  starts.push(here);
  const wanted = process.env.PERF_PROVE_IT_PARSER;
  const search = wanted ? PARSERS.filter((name) => name === wanted) : PARSERS;
  for (const name of search) {
    for (const start of starts) {
      const resolved = resolveFrom(name, start);
      if (!resolved) continue;
      try {
        const api = require(resolved);
        if (hasApi(name, api)) return { name, api };
      } catch {
        /* unreadable module */
      }
    }
  }
  return null;
}

const LINE_TERMINATORS = new Set(["\n", "\r", "\u2028", "\u2029"]);

function lineEnd(source, from) {
  for (let index = from; index < source.length; index++) if (LINE_TERMINATORS.has(source[index])) return index;
  return source.length;
}

function atLineStart(source, index) {
  for (let cursor = index - 1; cursor >= 0; cursor--) {
    const char = source[cursor];
    if (LINE_TERMINATORS.has(char)) return true;
    if (char !== " " && char !== "\t") return false;
  }
  return true;
}

export function commentRanges(source, literalRanges) {
  const ranges = [...literalRanges].sort((a, b) => a[0] - b[0]);
  const comments = [];
  const shebangIndex = source[0] === "\uFEFF" ? 1 : 0;
  let cursor = 0;
  for (let index = 0; index < source.length; index++) {
    while (cursor < ranges.length && ranges[cursor][1] <= index) cursor += 1;
    if (cursor < ranges.length && ranges[cursor][0] <= index && index < ranges[cursor][1]) {
      index = ranges[cursor][1] - 1;
      continue;
    }
    if (index === shebangIndex && source[index] === "#" && source[index + 1] === "!") {
      const end = lineEnd(source, index + 2);
      comments.push([index, end]);
      index = end - 1;
    } else if (source.startsWith("<!--", index)) {
      const end = lineEnd(source, index + 4);
      comments.push([index, end]);
      index = end - 1;
    } else if (source.startsWith("-->", index) && atLineStart(source, index)) {
      const end = lineEnd(source, index + 3);
      comments.push([index, end]);
      index = end - 1;
    } else if (source[index] === "/" && source[index + 1] === "/") {
      const end = lineEnd(source, index + 2);
      comments.push([index, end]);
      index = end - 1;
    } else if (source[index] === "/" && source[index + 1] === "*") {
      const close = source.indexOf("*/", index + 2);
      const end = close < 0 ? source.length : close + 2;
      comments.push([index, end]);
      index = end - 1;
    }
  }
  return comments;
}

function tsFunctionName(ts, node, parent) {
  if (ts.isConstructorDeclaration(node)) return "constructor";
  const name = node.name;
  if (name) {
    if (ts.isIdentifier(name) || ts.isPrivateIdentifier?.(name)) return name.text;
    if (ts.isStringLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name)) return name.text;
    return null;
  }
  if (!parent) return null;
  if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) return parent.name.text;
  if ((ts.isPropertyDeclaration(parent) || ts.isPropertyAssignment(parent)) && parent.name && ts.isIdentifier(parent.name)) return parent.name.text;
  if (ts.isAssignmentExpression(parent)) {
    if (ts.isIdentifier(parent.left)) return parent.left.text;
    if (ts.isPropertyAccessExpression(parent.left)) return parent.left.name.text;
  }
  return null;
}

function analyzeTypeScript(ts, source, fileName) {
  const kindMap = { TS: ts.ScriptKind.TS, TSX: ts.ScriptKind.TSX, JS: ts.ScriptKind.JS, JSX: ts.ScriptKind.JSX };
  const scriptKind = kindMap[SCRIPT_KINDS[extname(fileName)] ?? "TS"] ?? ts.ScriptKind.TS;
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, scriptKind);
  const functions = [];
  const calls = [];
  const nonCode = [];
  const isFunctionLike = (node) =>
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node);
  const literalKinds = new Set([
    ts.SyntaxKind.RegularExpressionLiteral,
    ts.SyntaxKind.StringLiteral,
    ts.SyntaxKind.NoSubstitutionTemplateLiteral,
    ts.SyntaxKind.TemplateHead,
    ts.SyntaxKind.TemplateMiddle,
    ts.SyntaxKind.TemplateTail,
    ts.SyntaxKind.JsxText,
    ts.SyntaxKind.JsxTextAllWhiteSpaces,
  ]);
  const visit = (node, parent) => {
    if (literalKinds.has(node.kind)) nonCode.push([node.getStart(sf), node.getEnd()]);
    if (isFunctionLike(node) && node.body) {
      functions.push({ start: node.body.getStart(sf), end: node.body.getEnd(), name: tsFunctionName(ts, node, parent) });
    }
    if (ts.isCallExpression(node)) {
      if (ts.isIdentifier(node.expression)) calls.push({ name: node.expression.text });
      else if (ts.isPropertyAccessExpression(node.expression) && node.expression.expression.kind === ts.SyntaxKind.ThisKeyword) calls.push({ name: node.expression.name.text });
    } else if (ts.isNewExpression(node) && node.expression && ts.isIdentifier(node.expression)) {
      calls.push({ name: node.expression.text });
    }
    ts.forEachChild(node, (child) => visit(child, node));
  };
  visit(sf, null);
  for (const range of commentRanges(source, nonCode)) nonCode.push(range);
  return { functions, calls, nonCode };
}

function estreeFunctionName(node, parent) {
  if (node.id && node.id.type === "Identifier") return node.id.name;
  if (node.key && node.key.type === "Identifier") return node.key.name;
  if (!parent) return null;
  if (parent.type === "VariableDeclarator" && parent.id && parent.id.type === "Identifier") return parent.id.name;
  if (["Property", "ObjectProperty", "PropertyDefinition", "ClassProperty", "MethodDefinition"].includes(parent.type) && parent.key && parent.key.type === "Identifier") return parent.key.name;
  if (parent.type === "AssignmentExpression" && parent.left) {
    if (parent.left.type === "Identifier") return parent.left.name;
    if (parent.left.type === "MemberExpression" && parent.left.property && parent.left.property.type === "Identifier") return parent.left.property.name;
  }
  return null;
}

function analyzeEstree(parser, source, fileName) {
  const ext = extname(fileName);
  let ast;
  const parserComments = [];
  if (parser.name === "@babel/parser") {
    const plugins = ["decorators-legacy"];
    if (ext === ".ts" || ext === ".mts" || ext === ".cts") plugins.push("typescript");
    else if (ext === ".tsx") plugins.push(["typescript", { isTSX: true }], "jsx");
    else if (ext === ".jsx") plugins.push("jsx");
    ast = parser.api.parse(source, { sourceType: "unambiguous", errorRecovery: true, allowReturnOutsideFunction: true, allowAwaitOutsideFunction: true, plugins });
    for (const comment of ast.comments ?? []) parserComments.push([comment.start, comment.end]);
  } else {
    if (ext === ".ts" || ext === ".tsx" || ext === ".mts" || ext === ".cts") throw new Error("acorn cannot parse TypeScript");
    ast = parser.api.parse(source, {
      ecmaVersion: "latest",
      sourceType: "module",
      allowHashBang: true,
      allowReturnOutsideFunction: true,
      allowAwaitOutsideFunction: true,
      onComment: (isBlock, _text, start, end) => parserComments.push([start, end]),
    });
  }
  const functions = [];
  const calls = [];
  const nonCode = [];
  const functionTypes = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression", "ClassMethod", "ObjectMethod", "ClassPrivateMethod"]);
  const literalTypes = new Set(["StringLiteral", "RegExpLiteral", "TemplateElement", "DirectiveLiteral", "JSXText"]);
  const visit = (node, parent) => {
    if (literalTypes.has(node.type)) nonCode.push([node.start, node.end]);
    else if (node.type === "Literal" && (typeof node.value === "string" || node.regex)) nonCode.push([node.start, node.end]);
    if (functionTypes.has(node.type) && node.body) {
      const body = node.body;
      functions.push({ start: body.start, end: body.end, name: estreeFunctionName(node, parent) });
    }
    if (node.type === "CallExpression" || node.type === "NewExpression" || node.type === "OptionalCallExpression") {
      const callee = node.callee;
      if (callee && callee.type === "Identifier") calls.push({ name: callee.name });
      else if (callee && (callee.type === "MemberExpression" || callee.type === "OptionalMemberExpression") && callee.object && callee.object.type === "ThisExpression" && callee.property && callee.property.type === "Identifier") calls.push({ name: callee.property.name });
    }
    for (const key of Object.keys(node)) {
      if (key === "parent" || key === "loc" || key === "range") continue;
      const value = node[key];
      if (Array.isArray(value)) {
        for (const child of value) if (child && typeof child.type === "string") visit(child, node);
      } else if (value && typeof value.type === "string") {
        visit(value, node);
      }
    }
  };
  visit(ast, null);
  for (const range of commentRanges(source, nonCode)) nonCode.push(range);
  for (const range of parserComments) nonCode.push(range);
  return { functions, calls, nonCode };
}

export function analyze(source, fileName, parser) {
  if (!parser) return null;
  return parser.name === "typescript" ? analyzeTypeScript(parser.api, source, fileName) : analyzeEstree(parser, source, fileName);
}

export function analyzeFile(source, fileName, parser) {
  try {
    return analyze(source, fileName, parser);
  } catch {
    return null;
  }
}

export function maskRanges(source, ranges) {
  const chars = source.split("");
  for (const [start, end] of ranges) {
    for (let index = Math.max(0, start); index < Math.min(chars.length, end); index++) {
      if (chars[index] !== "\n" && chars[index] !== "\r") chars[index] = " ";
    }
  }
  return chars.join("");
}

export function withParents(regions) {
  const sorted = [...regions].sort((a, b) => a.start - b.start || b.end - a.end);
  const stack = [];
  for (const region of sorted) {
    while (stack.length && !(stack[stack.length - 1].start <= region.start && region.end <= stack[stack.length - 1].end)) stack.pop();
    region.parent = stack.length ? stack[stack.length - 1] : null;
    stack.push(region);
  }
  return regions;
}
