import { createRequire } from "node:module";
import type { ParserOptions, VisitorObject } from "oxc-parser";
import type * as ESTree from "@oxc-project/types";

interface OxcComment {
  readonly type: "Line" | "Block";
  readonly value: string;
  readonly start: number;
  readonly end: number;
}

interface OxcResult {
  readonly program: ESTree.Program;
  readonly comments: ReadonlyArray<OxcComment>;
  readonly errors: ReadonlyArray<{ readonly message: string }>;
}

interface OxcModule {
  readonly parseSync: (filename: string, sourceText: string, options?: ParserOptions) => OxcResult;
  readonly rawTransferSupported: () => boolean;
  readonly Visitor: new (visitor: VisitorObject) => { visit(program: ESTree.Program): void };
}

// Resolve oxc-parser at runtime instead of with a static ESM import. Bundlers
// that follow the browser build link a module without Visitor or the native
// transfer API, and that build imports an optional WASM binding which is not
// installed. Node always gets the full native build.
const requireOxc = createRequire(import.meta.url);
let cachedOxc: OxcModule | null = null;

function loadOxc(): OxcModule {
  if (cachedOxc !== null) return cachedOxc;
  const loaded = requireOxc("oxc-parser") as OxcModule | undefined;
  if (
    loaded === undefined ||
    typeof loaded.parseSync !== "function" ||
    typeof loaded.Visitor !== "function" ||
    typeof loaded.rawTransferSupported !== "function"
  ) {
    throw new Error(
      "perf-prove-it needs the Node build of oxc-parser. Install it with 'npm i oxc-parser' and run on Node 22.12 or newer; the browser or WASM build is not supported.",
    );
  }
  cachedOxc = loaded;
  return cachedOxc;
}

export interface Span {
  readonly start: number;
  readonly end: number;
}

export interface FunctionFact {
  readonly name: string | null;
  readonly body: Span;
  readonly parent: number | null;
}

export interface CallFact {
  readonly path: string;
  readonly receiverThis: boolean;
  readonly isNew: boolean;
  readonly optional: boolean;
  readonly span: Span;
  readonly args: Span;
  readonly argumentIdentifiers: readonly string[];
  readonly staticArgs: boolean;
  readonly inlineComparator: boolean;
  readonly loop: number | null;
  readonly function_: number | null;
}

export interface LoopFact {
  readonly span: Span;
  readonly body: Span;
  readonly parent: number | null;
  readonly bindings: readonly string[];
}

export interface AwaitFact {
  readonly span: Span;
  readonly loop: number | null;
}

export interface SpreadFact {
  readonly callee: string;
  readonly source: string | null;
  readonly span: Span;
}

export interface ArraySpreadFact {
  readonly source: string | null;
  readonly target: string | null;
  readonly span: Span;
  readonly inLoop: boolean;
  readonly reduceAccumulator: string | null;
}

export interface PushFact {
  readonly parent: string | null;
  readonly array: string | null;
  readonly span: Span;
  readonly function_: number | null;
}

export interface ChainFact {
  readonly links: number;
  readonly span: Span;
}

export interface SortTakeFact {
  readonly kind: "index0" | "at0" | "slice0";
  readonly k: string | null;
  readonly span: Span;
}

export interface ExistentialFilterFact {
  readonly span: Span;
}

export interface ComparatorFact {
  readonly repeated: readonly string[];
  readonly span: Span;
}

export interface ConstructionFact {
  readonly name: string;
  readonly staticArgs: boolean;
  readonly span: Span;
  readonly function_: number | null;
}

export interface FileFacts {
  readonly file: string;
  readonly functions: readonly FunctionFact[];
  readonly calls: readonly CallFact[];
  readonly loops: readonly LoopFact[];
  readonly awaits: readonly AwaitFact[];
  readonly spreads: readonly SpreadFact[];
  readonly arraySpreads: readonly ArraySpreadFact[];
  readonly pushes: readonly PushFact[];
  readonly chains: readonly ChainFact[];
  readonly sortTakes: readonly SortTakeFact[];
  readonly existentialFilters: readonly ExistentialFilterFact[];
  readonly comparators: readonly ComparatorFact[];
  readonly constructions: readonly ConstructionFact[];
  readonly comments: readonly Span[];
  readonly literals: readonly Span[];
  readonly htmlAssignments: readonly AwaitFact[];
  readonly parseErrors: number;
}

const COLLECTION_OPS = new Set(["filter", "map", "flatMap"]);

const REPEATED_NEEDLES: ReadonlyArray<readonly [string, string]> = [
  ["Date.parse", "Date.parse"],
  ["compareDateTimeStrings", "compareDateTimeStrings"],
  ["parseTimestamp", "parseTimestamp"],
  ["Intl", "Intl construction"],
  ["structuredClone", "structuredClone"],
];

function spanOf(node: { readonly start: number; readonly end: number }): Span {
  return { start: node.start, end: node.end };
}

function unwrapExpression(expression: ESTree.Expression): ESTree.Expression {
  let current = expression;
  while (current.type === "ChainExpression" || current.type === "TSNonNullExpression" || current.type === "ParenthesizedExpression") {
    current = current.expression;
  }
  return current;
}

function staticName(value: ESTree.Node): string | null {
  if (value.type === "Identifier" || value.type === "PrivateIdentifier") return value.name;
  return null;
}

function isStaticMember(expression: ESTree.Expression): expression is ESTree.StaticMemberExpression {
  return expression.type === "MemberExpression" && expression.computed === false && expression.property.type === "Identifier";
}

function memberNameOf(callee: ESTree.Expression): string | null {
  const expression = unwrapExpression(callee);
  return isStaticMember(expression) ? expression.property.name : null;
}

function memberObjectOf(callee: ESTree.Expression): ESTree.Expression | null {
  const expression = unwrapExpression(callee);
  return expression.type === "MemberExpression" ? expression.object : null;
}

function pathOf(value: ESTree.Expression): string | null {
  const expression = unwrapExpression(value);
  if (expression.type === "Identifier") return expression.name;
  if (expression.type === "ThisExpression") return "this";
  if (isStaticMember(expression)) {
    const base = pathOf(expression.object);
    return base === null ? expression.property.name : `${base}.${expression.property.name}`;
  }
  return null;
}

function isFunctionLike(value: ESTree.Node): value is ESTree.Function | ESTree.ArrowFunctionExpression {
  return value.type === "FunctionDeclaration" || value.type === "FunctionExpression" || value.type === "ArrowFunctionExpression";
}

function keyName(key: ESTree.PropertyKey): string | null {
  if (key.type === "Identifier" || key.type === "PrivateIdentifier") return key.name;
  if (key.type === "Literal" && (typeof key.value === "string" || typeof key.value === "number")) return String(key.value);
  return null;
}

function patternNames(pattern: ESTree.BindingPattern): string[] {
  const names: string[] = [];
  const visit = (value: ESTree.BindingPattern): void => {
    switch (value.type) {
      case "Identifier":
        names.push(value.name);
        return;
      case "ObjectPattern":
        for (const property of value.properties) {
          if (property.type === "RestElement") visit(property.argument);
          else visit(property.value);
        }
        return;
      case "ArrayPattern":
        for (const element of value.elements) {
          if (element === null) continue;
          visit(element.type === "RestElement" ? element.argument : element);
        }
        return;
      case "AssignmentPattern":
        visit(value.left);
        return;
      default:
        return;
    }
  };
  visit(pattern);
  return names;
}

function loopBindings(node: ESTree.ForOfStatement | ESTree.ForInStatement | ESTree.ForStatement): string[] {
  if (node.type === "ForStatement") {
    const init = node.init;
    if (init !== null && init.type === "VariableDeclaration") return init.declarations.flatMap((declaration) => patternNames(declaration.id));
    return [];
  }
  if (node.left.type === "VariableDeclaration") return node.left.declarations.flatMap((declaration) => patternNames(declaration.id));
  return [];
}

function isStaticExpression(argument: ESTree.Expression | ESTree.SpreadElement): boolean {
  if (argument.type === "SpreadElement") return isStaticExpression(argument.argument);
  const expression = unwrapExpression(argument);
  switch (expression.type) {
    case "Literal":
      return true;
    case "TemplateLiteral":
      return expression.expressions.length === 0;
    case "ArrayExpression":
      return expression.elements.every((element) => element === null || isStaticExpression(element));
    case "UnaryExpression":
      return isStaticExpression(expression.argument);
    default:
      return false;
  }
}

type FastOptions = ParserOptions & { readonly experimentalRawTransfer?: boolean };

function parseOptions(oxc: OxcModule): FastOptions {
  return oxc.rawTransferSupported() ? { experimentalRawTransfer: true } : {};
}

export function extractFacts(file: string, source: string): FileFacts {
  const oxc = loadOxc();
  let result: OxcResult;
  try {
    result = oxc.parseSync(file, source, parseOptions(oxc));
  } catch {
    result = oxc.parseSync(file, source, {});
  }

  const functions: FunctionFact[] = [];
  const calls: CallFact[] = [];
  const loops: LoopFact[] = [];
  const awaits: AwaitFact[] = [];
  const spreads: SpreadFact[] = [];
  const arraySpreads: ArraySpreadFact[] = [];
  const pushes: PushFact[] = [];
  const chains: ChainFact[] = [];
  const sortTakes: SortTakeFact[] = [];
  const existentialFilters: ExistentialFilterFact[] = [];
  const comparatorsRaw: Array<{ body: Span; span: Span }> = [];
  const comparators: ComparatorFact[] = [];
  const constructions: ConstructionFact[] = [];
  const comments: Span[] = result.comments.map(spanOf);
  const literals: Span[] = [];
  const htmlAssignments: AwaitFact[] = [];
  const reduceRegions: Array<{ accumulator: string; body: Span }> = [];
  const nameHints = new Map<number, string>();
  const arrayTargetHints = new Map<number, string | null>();
  const collectionCalls: Array<{ node: ESTree.CallExpression; object: ESTree.Expression | null }> = [];
  const identifierNames: Array<{ name: string; span: Span }> = [];
  const callFrames: Array<{ args: Span; names: string[]; callIndex: number }> = [];
  const functionStack: number[] = [];
  const loopStack: number[] = [];

  const effectiveLoop = (span: Span): number | null => {
    for (let index = loopStack.length - 1; index >= 0; index -= 1) {
      const loopIndex = loopStack[index];
      if (loopIndex === undefined) continue;
      const loop = loops[loopIndex];
      if (loop !== undefined && loop.body.start <= span.start && span.end <= loop.body.end) return loopIndex;
    }
    return null;
  };

  const registerFunction = (start: number, body: { start: number; end: number }, declared: string | null): void => {
    functions.push({ name: declared ?? nameHints.get(start) ?? null, body: spanOf(body), parent: functionStack.at(-1) ?? null });
    functionStack.push(functions.length - 1);
  };

  const popFunction = (): void => {
    functionStack.pop();
  };

  const registerLoop = (node: { start: number; end: number; body: { start: number; end: number } }, bindings: string[]): void => {
    loops.push({ span: spanOf(node), body: spanOf(node.body), parent: loopStack.at(-1) ?? null, bindings });
    loopStack.push(loops.length - 1);
  };

  const popLoop = (): void => {
    loopStack.pop();
  };

  const recordCall = (node: ESTree.CallExpression | ESTree.NewExpression, isNew: boolean): void => {
    const callee = node.callee;
    const path = pathOf(callee);
    if (path === null) return;
    const args: ReadonlyArray<ESTree.Expression | ESTree.SpreadElement> = node.arguments;
    const first = args[0];
    const last = args[args.length - 1];
    const argsSpan: Span = args.length === 0 || first === undefined || last === undefined ? spanOf(node) : { start: first.start, end: last.end };
    const name = memberNameOf(callee);
    for (const argument of args) {
      if (argument.type !== "SpreadElement") continue;
      const inner = unwrapExpression(argument.argument);
      spreads.push({ callee: path, source: inner.type === "Identifier" ? inner.name : null, span: spanOf(argument) });
    }
    if (name === "push") {
      const object = memberObjectOf(callee);
      const objectPath = object === null ? null : pathOf(object);
      const separator = objectPath === null ? -1 : objectPath.lastIndexOf(".");
      pushes.push({
        parent: separator > 0 ? objectPath?.slice(0, separator) ?? null : null,
        array: objectPath === null ? null : separator >= 0 ? objectPath.slice(separator + 1) : objectPath,
        span: spanOf(node),
        function_: functionStack.at(-1) ?? null,
      });
    }
    if (name === "reduce") {
      if (first !== undefined && first.type !== "SpreadElement" && isFunctionLike(first)) {
        const accumulator = first.params[0];
        if (accumulator !== undefined && accumulator.type === "Identifier" && first.body !== null) {
          reduceRegions.push({ accumulator: accumulator.name, body: spanOf(first.body) });
        }
      }
    }
    if (name !== null && COLLECTION_OPS.has(name)) {
      const object = memberObjectOf(callee);
      collectionCalls.push({ node: node as ESTree.CallExpression, object: object === null ? null : unwrapExpression(object) });
    }
    if ((name === "sort" || name === "toSorted") && first !== undefined && first.type !== "SpreadElement" && isFunctionLike(first) && first.body !== null) {
      comparatorsRaw.push({ body: spanOf(first.body), span: spanOf(node) });
    }
    if (isNew && (path === "RegExp" || path.startsWith("Intl."))) {
      constructions.push({ name: path, staticArgs: false, span: spanOf(node), function_: functionStack.at(-1) ?? null });
    }
    if ((name === "at" || name === "slice") && memberObjectOf(callee) !== null) {
      const object = memberObjectOf(callee);
      const sortCall = object === null ? null : unwrapExpression(object);
      if (sortCall !== null && sortCall.type === "CallExpression" && memberNameOf(sortCall.callee) === "sort") {
        const first = args[0];
        const second = args[1];
        if (name === "at" && first !== undefined && first.type === "Literal" && first.value === 0) {
          sortTakes.push({ kind: "at0", k: null, span: spanOf(node) });
        }
        if (name === "slice" && first !== undefined && first.type === "Literal" && first.value === 0 && second !== undefined) {
          const k = second.type === "Identifier" ? second.name : second.type === "Literal" && typeof second.value === "number" ? String(second.value) : null;
          sortTakes.push({ kind: "slice0", k, span: spanOf(node) });
        }
      }
    }
    calls.push({
      path,
      receiverThis: path === "this" || path.startsWith("this."),
      isNew,
      optional: node.type === "CallExpression" && node.optional,
      span: spanOf(node),
      args: argsSpan,
      argumentIdentifiers: [],
      staticArgs: args.every((argument) => isStaticExpression(argument)),
      inlineComparator: name === "sort" && first !== undefined && first.type !== "SpreadElement" && isFunctionLike(first),
      loop: effectiveLoop(spanOf(node)),
      function_: functionStack.at(-1) ?? null,
    });
    callFrames.push({ args: argsSpan, names: [], callIndex: calls.length - 1 });
  };

  const popCall = (): void => {
    const frame = callFrames.pop();
    if (frame === undefined) return;
    const call = calls[frame.callIndex];
    if (call === undefined) return;
    calls[frame.callIndex] = { ...call, argumentIdentifiers: frame.names };
    if (call.isNew && (call.path === "RegExp" || call.path.startsWith("Intl."))) {
      for (let index = constructions.length - 1; index >= 0; index -= 1) {
        const construction = constructions[index];
        if (construction !== undefined && construction.span.start === call.span.start && construction.span.end === call.span.end) {
          constructions[index] = { ...construction, staticArgs: frame.names.length === 0 };
          break;
        }
      }
    }
  };

  const visitor: VisitorObject = {
    Identifier: (node) => {
      for (const frame of callFrames) {
        if (frame.args.start <= node.start && node.end <= frame.args.end) frame.names.push(node.name);
      }
      identifierNames.push({ name: node.name, span: spanOf(node) });
    },
    Literal: (node) => {
      literals.push(spanOf(node));
    },
    MemberExpression: (node) => {
      if (node.computed !== true) return;
      const property = unwrapExpression(node.property);
      if (property.type !== "Literal" || property.value !== 0) return;
      const object = unwrapExpression(node.object);
      if (object.type === "CallExpression" && memberNameOf(object.callee) === "sort") sortTakes.push({ kind: "index0", k: null, span: spanOf(node) });
    },
    TemplateElement: (node) => {
      literals.push(spanOf(node));
    },
    JSXText: (node) => {
      literals.push(spanOf(node));
    },
    VariableDeclarator: (node) => {
      if (node.init === null) return;
      if (node.init.type === "ArrayExpression") {
        arrayTargetHints.set(node.init.start, node.id.type === "Identifier" ? node.id.name : null);
      }
      if (isFunctionLike(node.init) && node.id.type === "Identifier") nameHints.set(node.init.start, node.id.name);
    },
    Property: (node) => {
      if (isFunctionLike(node.value)) {
        const name = keyName(node.key);
        if (name !== null) nameHints.set(node.value.start, name);
      }
    },
    PropertyDefinition: (node) => {
      if (node.value !== null && isFunctionLike(node.value)) {
        const name = keyName(node.key);
        if (name !== null) nameHints.set(node.value.start, name);
      }
    },
    MethodDefinition: (node) => {
      const name = keyName(node.key);
      if (name !== null) nameHints.set(node.value.start, name);
    },
    AssignmentExpression: (node) => {
      const target =
        node.left.type === "Identifier"
          ? node.left.name
          : node.left.type === "MemberExpression" && node.left.computed === false && node.left.property.type === "Identifier"
            ? node.left.property.name
            : null;
      if (node.right.type === "ArrayExpression") arrayTargetHints.set(node.right.start, target);
      if (isFunctionLike(node.right) && target !== null) nameHints.set(node.right.start, target);
      if (target === "innerHTML") htmlAssignments.push({ span: spanOf(node), loop: effectiveLoop(spanOf(node)) });
    },
    FunctionDeclaration: (node: ESTree.Function) => {
      if (node.body !== null) registerFunction(node.start, node.body, node.id?.name ?? null);
    },
    FunctionExpression: (node: ESTree.Function) => {
      if (node.body !== null) registerFunction(node.start, node.body, node.id?.name ?? null);
    },
    ArrowFunctionExpression: (node: ESTree.ArrowFunctionExpression) => {
      registerFunction(node.start, node.body, null);
    },
    "FunctionDeclaration:exit": popFunction,
    "FunctionExpression:exit": popFunction,
    "ArrowFunctionExpression:exit": popFunction,
    ForStatement: (node) => {
      registerLoop(node, loopBindings(node));
    },
    ForInStatement: (node) => {
      registerLoop(node, loopBindings(node));
    },
    ForOfStatement: (node) => {
      registerLoop(node, loopBindings(node));
    },
    WhileStatement: (node) => {
      registerLoop(node, []);
    },
    DoWhileStatement: (node) => {
      registerLoop(node, []);
    },
    "ForStatement:exit": popLoop,
    "ForInStatement:exit": popLoop,
    "ForOfStatement:exit": popLoop,
    "WhileStatement:exit": popLoop,
    "DoWhileStatement:exit": popLoop,
    AwaitExpression: (node) => {
      awaits.push({ span: spanOf(node), loop: effectiveLoop(spanOf(node)) });
    },
    CallExpression: (node) => {
      recordCall(node, false);
    },
    "CallExpression:exit": popCall,
    NewExpression: (node) => {
      recordCall(node, true);
    },
    "NewExpression:exit": popCall,
    BinaryExpression: (node) => {
      const operator = node.operator;
      if (![">", "!==", "!=", ">=", "===", "==", "<=", "<"].includes(operator)) return;
      for (const side of [node.left, node.right] as const) {
        const expression = unwrapExpression(side);
        if (!isStaticMember(expression) || expression.property.name !== "length") continue;
        const filterCall = unwrapExpression(expression.object);
        if (filterCall.type !== "CallExpression" || memberNameOf(filterCall.callee) !== "filter") continue;
        const other = unwrapExpression(side === node.left ? node.right : node.left);
        if (other.type !== "Literal" || typeof other.value !== "number") continue;
        const rhs = other.value;
        const zeroOperators = [">", "!==", "!=", "===", "==", "<="];
        const oneOperators = [">=", "<"];
        const matched = (zeroOperators.includes(operator) && rhs === 0) || (oneOperators.includes(operator) && rhs === 1);
        if (matched) existentialFilters.push({ span: spanOf(node) });
      }
    },
    ArrayExpression: (node) => {
      for (const element of node.elements) {
        if (element === null || element.type !== "SpreadElement") continue;
        const inner = unwrapExpression(element.argument);
        const source = inner.type === "Identifier" ? inner.name : null;
        const target = arrayTargetHints.get(node.start) ?? null;
        arraySpreads.push({ source, target, span: spanOf(element), inLoop: loopStack.length > 0, reduceAccumulator: null });
      }
    },
  };

  new oxc.Visitor(visitor).visit(result.program);

  const resolvedArraySpreads = arraySpreads.map((spread) => {
    if (spread.source === null) return spread;
    const region = reduceRegions.find((candidate) => candidate.body.start <= spread.span.start && spread.span.end <= candidate.body.end && candidate.accumulator === spread.source);
    return region === undefined ? spread : { ...spread, reduceAccumulator: region.accumulator };
  });

  const objectNodes = new Set<ESTree.Expression>();
  for (const entry of collectionCalls) if (entry.object !== null) objectNodes.add(entry.object);
  for (const entry of collectionCalls) {
    if (objectNodes.has(entry.node)) continue;
    let links = 0;
    let end = entry.node.end;
    let current: ESTree.Expression = entry.node;
    for (let depth = 0; depth < 32; depth += 1) {
      const expression = unwrapExpression(current);
      if (expression.type !== "CallExpression") break;
      const name = memberNameOf(expression.callee);
      if (name === null || !COLLECTION_OPS.has(name)) break;
      links += 1;
      if (expression.end > end) end = expression.end;
      const object = memberObjectOf(expression.callee);
      if (object === null) break;
      current = object;
    }
    if (links >= 2) chains.push({ links, span: { start: entry.node.start, end } });
  }

  for (const raw of comparatorsRaw) {
    const repeated: string[] = [];
    const inside = calls.filter((call) => raw.body.start <= call.span.start && call.span.end <= raw.body.end);
    for (const [needle, label] of REPEATED_NEEDLES) {
      if (inside.some((call) => call.path === needle || call.path.startsWith(`${needle}.`))) repeated.push(label);
    }
    if (inside.some((call) => call.path === ".find" || call.path.endsWith(".find"))) repeated.push(".find");
    if (repeated.length > 0) comparators.push({ repeated, span: raw.span });
  }

  return {
    file,
    functions,
    calls,
    loops,
    awaits,
    spreads,
    arraySpreads: resolvedArraySpreads,
    pushes,
    chains,
    sortTakes,
    existentialFilters,
    comparators,
    constructions,
    comments,
    literals,
    htmlAssignments,
    parseErrors: result.errors.length,
  };
}

