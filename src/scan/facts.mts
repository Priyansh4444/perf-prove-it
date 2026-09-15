import { parseSync, rawTransferSupported, visitorKeys } from "oxc-parser";

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
  readonly root: string | null;
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

const FUNCTION_TYPES = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression", "ClassMethod", "ObjectMethod"]);

const LOOP_TYPES = new Set(["ForStatement", "ForInStatement", "ForOfStatement", "WhileStatement", "DoWhileStatement"]);

const LITERAL_TYPES = new Set(["Literal", "TemplateElement", "JSXText", "DirectiveLiteral"]);

const COLLECTION_OPS = new Set(["filter", "map", "flatMap"]);

const CALLBACK_OPS = new Set(["map", "filter", "reduce", "flatMap", "some", "every", "find"]);

const REPEATED_IN_COMPARATOR: ReadonlyArray<readonly [string, string]> = [
  ["Date.parse", "Date.parse"],
  ["compareDateTimeStrings", "compareDateTimeStrings"],
  ["parseTimestamp", "parseTimestamp"],
  ["Intl", "Intl construction"],
  ["structuredClone", "structuredClone"],
];

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

type OxcNode = Record<string, unknown> & { type: string; start: number; end: number };

const isNode = (value: unknown): value is OxcNode =>
  isRecord(value) && typeof value.type === "string" && typeof value.start === "number" && typeof value.end === "number";

function staticName(value: unknown): string | null {
  if (!isNode(value)) return null;
  if (value.type === "Identifier" || value.type === "PrivateIdentifier") return typeof value.name === "string" ? value.name : null;
  return null;
}

function pathOf(value: unknown): string | null {
  const node = unwrap(value);
  if (!isNode(node)) return null;
  if (node.type === "Identifier") return typeof node.name === "string" ? node.name : null;
  if (node.type === "ThisExpression") return "this";
  if (node.type === "MemberExpression" && node.computed !== true) {
    const name = staticName(node.property);
    if (name === null) return null;
    const base = pathOf(node.object);
    return base === null ? name : `${base}.${name}`;
  }
  return null;
}

function memberName(callee: unknown): string | null {
  if (!isNode(callee) || callee.type !== "MemberExpression" || callee.computed === true) return null;
  return staticName(callee.property);
}

function memberObject(callee: unknown): unknown {
  if (!isNode(callee) || callee.type !== "MemberExpression") return null;
  return unwrap(callee.object);
}

function unwrap(node: unknown): unknown {
  let current = node;
  for (let depth = 0; depth < 8; depth += 1) {
    if (!isNode(current)) return current;
    if (current.type === "ChainExpression" || current.type === "TSNonNullExpression" || current.type === "ParenthesizedExpression") {
      current = current.expression;
      continue;
    }
    return current;
  }
  return current;
}

function collectBindingNames(left: unknown, out: string[]): void {
  if (!isNode(left)) return;
  switch (left.type) {
    case "Identifier":
      if (typeof left.name === "string") out.push(left.name);
      return;
    case "ObjectPattern": {
      const properties = left.properties;
      if (Array.isArray(properties)) {
        for (const property of properties) {
          if (!isNode(property)) continue;
          if (property.type === "RestElement") collectBindingNames(property.argument, out);
          else collectBindingNames(property.value ?? property.key, out);
        }
      }
      return;
    }
    case "ArrayPattern": {
      const elements = left.elements;
      if (Array.isArray(elements)) for (const element of elements) collectBindingNames(element, out);
      return;
    }
    case "AssignmentPattern":
      collectBindingNames(left.left, out);
      return;
    case "RestElement":
      collectBindingNames(left.argument, out);
      return;
    case "VariableDeclaration":
    case "VariableDeclarator": {
      const declarations = left.type === "VariableDeclaration" ? left.declarations : [left];
      if (Array.isArray(declarations)) {
        for (const declaration of declarations) if (isNode(declaration)) collectBindingNames(declaration.id, out);
      }
      return;
    }
    default:
      return;
  }
}

function firstParamName(fn: unknown): string | null {
  if (!isNode(fn)) return null;
  const params = fn.params;
  if (!Array.isArray(params)) return null;
  const names: string[] = [];
  collectBindingNames(params[0], names);
  return names[0] ?? null;
}

function isFunctionNode(value: unknown): boolean {
  return isNode(value) && FUNCTION_TYPES.has(value.type);
}

function isSortCall(node: unknown): boolean {
  const name = memberName(isNode(node) && node.type === "CallExpression" ? node.callee : null);
  return name === "sort";
}

function collectIdentifiers(value: unknown, out: string[]): void {
  if (!isNode(value)) return;
  if (value.type === "Identifier" && typeof value.name === "string") out.push(value.name);
  for (const key of visitorKeys[value.type] ?? []) {
    const child = value[key];
    if (Array.isArray(child)) for (const item of child) collectIdentifiers(item, out);
    else if (isNode(child)) collectIdentifiers(child, out);
  }
}

function collectCallPaths(value: unknown, out: string[]): void {
  if (!isNode(value)) return;
  if (value.type === "CallExpression" || value.type === "NewExpression") {
    const path = pathOf(value.callee) ?? pathOf(value.expression);
    if (path !== null) out.push(path);
    if (memberName(value.callee) === "find") out.push(".find");
  }
  for (const key of visitorKeys[value.type] ?? []) {
    const child = value[key];
    if (Array.isArray(child)) for (const item of child) collectCallPaths(item, out);
    else if (isNode(child)) collectCallPaths(child, out);
  }
}

function comparatorRepeated(body: unknown): string[] {
  const paths: string[] = [];
  collectCallPaths(body, paths);
  const found: string[] = [];
  for (const [needle, label] of REPEATED_IN_COMPARATOR) {
    if (paths.some((path) => path === needle || path.startsWith(`${needle}.`))) found.push(label);
  }
  if (paths.includes(".find")) found.push(".find");
  return found;
}

function chainLinks(outermost: OxcNode): { links: number; end: number } {
  let links = 0;
  let current: unknown = outermost;
  let end = outermost.end;
  for (let depth = 0; depth < 32; depth += 1) {
    const node = unwrap(current);
    if (!isNode(node) || node.type !== "CallExpression") break;
    const name = memberName(node.callee);
    if (name === null || !COLLECTION_OPS.has(name)) break;
    links += 1;
    if (node.end > end) end = node.end;
    current = memberObject(node.callee);
  }
  return { links, end };
}

function parseOptions(): Record<string, unknown> {
  const options: Record<string, unknown> = {};
  if (rawTransferSupported()) options.experimentalRawTransfer = true;
  return options;
}

export function extractFacts(file: string, source: string): FileFacts {
  let result;
  const options = parseOptions();
  try {
    result = parseSync(file, source, options);
  } catch {
    result = parseSync(file, source, {});
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
  const comparators: ComparatorFact[] = [];
  const constructions: ConstructionFact[] = [];
  const comments: Span[] = [];
  const literals: Span[] = [];
  const htmlAssignments: AwaitFact[] = [];
  const reduceRegions: Array<{ accumulator: string; body: Span }> = [];
  const collectionCalls: Array<{ node: OxcNode; object: unknown }> = [];

  for (const comment of result.comments) comments.push({ start: comment.start, end: comment.end });

  const functionStack: number[] = [];
  const loopStack: number[] = [];

  const recordSortTake = (node: OxcNode): void => {
    const kind = node.type;
    if (kind === "MemberExpression") {
      if (node.computed !== true) return;
      const property = node.property;
      if (isNode(property) && property.type === "Literal" && property.value === 0 && isSortCall(node.object)) {
        sortTakes.push({ kind: "index0", k: null, span: { start: node.start, end: node.end } });
      }
      return;
    }
    if (kind !== "CallExpression") return;
    const name = memberName(node.callee);
    if (name !== "at" && name !== "slice") return;
    const object = memberObject(node.callee);
    if (!isSortCall(object)) return;
    const args = Array.isArray(node.arguments) ? node.arguments : [];
    const first = args[0];
    if (!isNode(first) || first.type !== "Literal") return;
    if (name === "at") {
      if (first.value === 0) sortTakes.push({ kind: "at0", k: null, span: { start: node.start, end: node.end } });
      return;
    }
    if (first.value !== 0) return;
    const second = args[1];
    const k = isNode(second) && second.type === "Identifier" && typeof second.name === "string" ? second.name : isNode(second) && second.type === "Literal" ? String(second.value) : null;
    sortTakes.push({ kind: "slice0", k, span: { start: node.start, end: node.end } });
  };

  const walk = (node: unknown, parent: unknown): void => {
    const resolved = unwrap(node);
    if (!isNode(resolved)) return;
    const type = resolved.type;
    const start = resolved.start;
    const end = resolved.end;

    if (FUNCTION_TYPES.has(type)) {
      const body = resolved.body;
      if (isNode(body)) {
        const parentName = isNode(parent) ? staticName(parent.key) : null;
        const declaratorName = isNode(parent) && parent.type === "VariableDeclarator" ? staticName(parent.id) : null;
        const ownName = staticName(resolved.id) ?? staticName(resolved.key) ?? parentName ?? declaratorName;
        functions.push({ name: ownName, body: { start: body.start, end: body.end }, parent: functionStack.at(-1) ?? null });
        functionStack.push(functions.length - 1);
      }
    }

    if (LOOP_TYPES.has(type)) {
      const parentLoop = loopStack.at(-1) ?? null;
      const bindings: string[] = [];
      if (type === "ForOfStatement" || type === "ForInStatement") collectBindingNames(resolved.left, bindings);
      else if (type === "ForStatement") collectBindingNames(resolved.init, bindings);
      loops.push({ span: { start, end }, parent: parentLoop, bindings });
      loopStack.push(loops.length - 1);
      walk(resolved.body, resolved);
      loopStack.pop();
      for (const key of visitorKeys[type] ?? []) {
        if (key === "body") continue;
        const value = resolved[key];
        if (Array.isArray(value)) for (const child of value) walk(child, resolved);
        else if (isNode(value)) walk(value, resolved);
      }
      return;
    }

    if (type === "AwaitExpression") awaits.push({ span: { start, end }, loop: loopStack.at(-1) ?? null });

    if (type === "AssignmentExpression") {
      const left = unwrap(resolved.left);
      if (isNode(left) && left.type === "MemberExpression" && left.computed !== true && staticName(left.property) === "innerHTML") {
        htmlAssignments.push({ span: { start, end }, loop: loopStack.at(-1) ?? null });
      }
    }

    if (LITERAL_TYPES.has(type)) literals.push({ start, end });

    if (type === "BinaryExpression") {
      const operators = new Set(["===", "!==", "==", "!=", ">=", "<=", ">", "<"]);
      const operator = typeof resolved.operator === "string" ? resolved.operator : null;
      if (operator !== null && operators.has(operator)) {
        for (const side of [resolved.left, resolved.right]) {
          const lengthExpr = unwrap(side);
          if (!isNode(lengthExpr) || lengthExpr.type !== "MemberExpression" || lengthExpr.computed === true) continue;
          if (staticName(lengthExpr.property) !== "length") continue;
          const filterCall = unwrap(memberObject(lengthExpr));
          if (!isNode(filterCall) || filterCall.type !== "CallExpression" || memberName(filterCall.callee) !== "filter") continue;
          const other = unwrap(side === resolved.left ? resolved.right : resolved.left);
          if (!isNode(other) || other.type !== "Literal") continue;
          const rhs = String(other.value);
          const truthy = [">", "!==", "!="].includes(operator) && rhs === "0";
          const falsy = ["===", "=="].includes(operator) && rhs === "0";
          const geOne = operator === ">=" && rhs === "1";
          const ltOne = operator === "<" && rhs === "1";
          const leZero = operator === "<=" && rhs === "0";
          if (truthy || falsy || geOne || ltOne || leZero) existentialFilters.push({ span: { start, end } });
        }
      }
    }

    if (type === "CallExpression" || type === "NewExpression") {
      const callee = resolved.callee;
      const path = pathOf(callee);
      const isNew = type === "NewExpression";
      if (path !== null) {
        const args = Array.isArray(resolved.arguments) ? resolved.arguments : [];
        const argumentIdentifiers: string[] = [];
        let staticArgs = true;
        let argsStart = end;
        let argsEnd = start;
        for (const argument of args) {
          if (!isNode(argument)) {
            staticArgs = false;
            continue;
          }
          argsStart = Math.min(argsStart, argument.start);
          argsEnd = Math.max(argsEnd, argument.end);
          if (argument.type === "SpreadElement") {
            const inner = argument.argument;
            spreads.push({
              callee: path,
              source: isNode(inner) && inner.type === "Identifier" && typeof inner.name === "string" ? inner.name : null,
              span: { start: argument.start, end: argument.end },
            });
            continue;
          }
          collectIdentifiers(argument, argumentIdentifiers);
          if (argumentIdentifiers.length > 0) staticArgs = false;
        }
        const inlineComparator = memberName(callee) === "sort" && args.length > 0 && isFunctionNode(args[0]);
        calls.push({
          path,
          receiverThis: path === "this" || path.startsWith("this."),
          isNew,
          optional: resolved.optional === true,
          span: { start, end },
          args: { start: args.length === 0 ? start : argsStart, end: args.length === 0 ? end : argsEnd },
          argumentIdentifiers,
          staticArgs,
          inlineComparator,
          loop: loopStack.at(-1) ?? null,
          function_: functionStack.at(-1) ?? null,
        });

        const name = memberName(callee);
        if (name === "push") pushes.push({ root: pathOf(memberObject(callee)), span: { start, end }, function_: functionStack.at(-1) ?? null });
        if (name === "reduce") {
          const accumulator = firstParamName(args[0]);
          const callbackBody = isNode(args[0]) && isNode(args[0].body) ? args[0].body : null;
          if (accumulator !== null && callbackBody !== null) reduceRegions.push({ accumulator, body: { start: callbackBody.start, end: callbackBody.end } });
        }
        if (name !== null && COLLECTION_OPS.has(name)) collectionCalls.push({ node: resolved, object: memberObject(callee) });
        if ((name === "sort" || name === "toSorted") && args.length > 0 && isFunctionNode(args[0])) {
          const body = isNode(args[0]) && isNode(args[0].body) ? args[0].body : args[0];
          const repeated = comparatorRepeated(body);
          if (repeated.length > 0) comparators.push({ repeated, span: { start, end } });
        }
        if (isNew && (path === "RegExp" || path.startsWith("Intl."))) {
          constructions.push({ name: path, staticArgs, span: { start, end }, function_: functionStack.at(-1) ?? null });
        }
        if (name === "at" || name === "slice") {
          if (name === "slice") {
            const sliceArgs = Array.isArray(resolved.arguments) ? resolved.arguments : [];
            if (sliceArgs.length >= 2) recordSortTake(resolved);
          } else {
            recordSortTake(resolved);
          }
        }
      }
    }

    if (type === "MemberExpression") recordSortTake(resolved);

    if (type === "ArrayExpression") {
      const elements = Array.isArray(resolved.elements) ? resolved.elements : [];
      for (const element of elements) {
        if (!isNode(element) || element.type !== "SpreadElement") continue;
        const inner = unwrap(element.argument);
        const source = isNode(inner) && inner.type === "Identifier" && typeof inner.name === "string" ? inner.name : null;
        const parentNode = unwrap(parent);
        let target: string | null = null;
        if (isNode(parentNode)) {
          if (parentNode.type === "VariableDeclarator") target = staticName(parentNode.id);
          else if (parentNode.type === "AssignmentExpression") target = staticName(parentNode.left) ?? pathOf(parentNode.left);
        }
        arraySpreads.push({ source, target, span: { start: element.start, end: element.end }, inLoop: loopStack.length > 0, reduceAccumulator: null });
      }
    }

    for (const key of visitorKeys[type] ?? []) {
      const value = resolved[key];
      if (Array.isArray(value)) for (const child of value) walk(child, resolved);
      else if (isNode(value)) walk(value, resolved);
    }

    if (FUNCTION_TYPES.has(type) && isNode(resolved.body)) functionStack.pop();
  };

  walk(result.program, null);

  const objectNodes = new Set<unknown>();
  for (const entry of collectionCalls) if (entry.object !== null) objectNodes.add(entry.object);
  for (const entry of collectionCalls) {
    if (objectNodes.has(entry.node)) continue;
    const { links, end: chainEnd } = chainLinks({ ...entry.node, ...{} } as OxcNode);
    if (links >= 2) chains.push({ links, span: { start: entry.node.start, end: chainEnd } });
  }

  const resolvedArraySpreads = arraySpreads.map((spread) => {
    if (spread.source === null) return spread;
    const region = reduceRegions.find((candidate) => candidate.body.start <= spread.span.start && spread.span.end <= candidate.body.end && candidate.accumulator === spread.source);
    return region === undefined ? spread : { ...spread, reduceAccumulator: region.accumulator };
  });

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
