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
  readonly args: Span;
  readonly argumentIdentifiers: readonly string[];
  readonly loop: number | null;
  readonly function_: number | null;
}

export interface LoopFact {
  readonly span: Span;
  readonly parent: number | null;
  readonly binding: string | null;
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

export interface FileFacts {
  readonly file: string;
  readonly functions: readonly FunctionFact[];
  readonly calls: readonly CallFact[];
  readonly loops: readonly LoopFact[];
  readonly awaits: readonly AwaitFact[];
  readonly spreads: readonly SpreadFact[];
  readonly comments: readonly Span[];
  readonly literals: readonly Span[];
  readonly parseErrors: number;
}

const FUNCTION_TYPES = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
  "ClassMethod",
  "ObjectMethod",
  "PropertyDefinition",
  "MethodDefinition",
]);

const LOOP_TYPES = new Set(["ForStatement", "ForInStatement", "ForOfStatement", "WhileStatement", "DoWhileStatement"]);

const LITERAL_TYPES = new Set(["Literal", "TemplateElement", "JSXText", "DirectiveLiteral"]);

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

const isNode = (value: unknown): value is Record<string, unknown> & { type: string; start: number; end: number } =>
  isRecord(value) && typeof value.type === "string" && typeof value.start === "number" && typeof value.end === "number";

function staticName(value: unknown): string | null {
  if (!isNode(value)) return null;
  if (value.type === "Identifier") return typeof value.name === "string" ? value.name : null;
  if (value.type === "PrivateIdentifier") return typeof value.name === "string" ? value.name : null;
  return null;
}

function calleePath(callee: unknown): string | null {
  if (!isNode(callee)) return null;
  if (callee.type === "Identifier") return typeof callee.name === "string" ? callee.name : null;
  if (callee.type === "MemberExpression" && callee.computed !== true) {
    const object = callee.object;
    const property = callee.property;
    const name = staticName(property);
    if (name === null) return null;
    if (isNode(object) && object.type === "ThisExpression") return `this.${name}`;
    if (isNode(object) && object.type === "Identifier" && typeof object.name === "string") return `${object.name}.${name}`;
    return name;
  }
  return null;
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

function bindingName(left: unknown): string | null {
  if (!isNode(left)) return null;
  if (left.type === "Identifier") return typeof left.name === "string" ? left.name : null;
  if (left.type === "VariableDeclaration") {
    const declarations = left.declarations;
    if (!Array.isArray(declarations)) return null;
    const first = declarations[0];
    if (isNode(first)) return bindingName(first.id);
  }
  if (left.type === "VariableDeclarator") return bindingName(left.id);
  return null;
}

export function extractFacts(file: string, source: string): FileFacts {
  const options: Record<string, unknown> = {};
  if (rawTransferSupported()) options.experimentalRawTransfer = true;
  let result;
  try {
    result = parseSync(file, source, options);
  } catch {
    delete options.experimentalRawTransfer;
    result = parseSync(file, source, {});
  }

  const functions: FunctionFact[] = [];
  const calls: CallFact[] = [];
  const loops: LoopFact[] = [];
  const awaits: AwaitFact[] = [];
  const spreads: SpreadFact[] = [];
  const comments: Span[] = [];
  const literals: Span[] = [];

  for (const comment of result.comments) comments.push({ start: comment.start, end: comment.end });

  const functionStack: number[] = [];
  const loopStack: number[] = [];

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
      let binding: string | null = null;
      if (type === "ForOfStatement" || type === "ForInStatement") binding = bindingName(resolved.left);
      else if (type === "ForStatement") binding = null;
      const body = resolved.body;
      loops.push({ span: { start, end }, parent: parentLoop, binding });
      loopStack.push(loops.length - 1);
      walk(body, resolved);
      loopStack.pop();
      for (const key of visitorKeys[type] ?? []) {
        if (key === "body") continue;
        const value = resolved[key];
        if (Array.isArray(value)) for (const child of value) walk(child, resolved);
        else if (isNode(value)) walk(value, resolved);
      }
      return;
    }

    if (type === "AwaitExpression") {
      awaits.push({ span: { start, end }, loop: loopStack.at(-1) ?? null });
    }

    if (LITERAL_TYPES.has(type)) literals.push({ start, end });

    if (type === "CallExpression" || type === "NewExpression") {
      const path = calleePath(resolved.callee);
      if (path !== null) {
        const argsNode = resolved.arguments;
        const args = Array.isArray(argsNode) ? argsNode : [];
        const argumentIdentifiers: string[] = [];
        let argsStart = end;
        let argsEnd = start;
        const collectIdentifiers = (value: unknown): void => {
          if (!isNode(value)) return;
          if (value.type === "Identifier" && typeof value.name === "string") argumentIdentifiers.push(value.name);
          for (const key of visitorKeys[value.type] ?? []) {
            const child = value[key];
            if (Array.isArray(child)) for (const item of child) collectIdentifiers(item);
            else if (isNode(child)) collectIdentifiers(child);
          }
        };
        for (const argument of args) {
          if (isNode(argument)) {
            argsStart = Math.min(argsStart, argument.start);
            argsEnd = Math.max(argsEnd, argument.end);
            if (argument.type === "SpreadElement") {
              const inner = argument.argument;
              spreads.push({ callee: path, source: isNode(inner) && inner.type === "Identifier" && typeof inner.name === "string" ? inner.name : null, span: { start: argument.start, end: argument.end } });
            } else {
              collectIdentifiers(argument);
            }
          }
        }
        calls.push({
          path,
          receiverThis: path.startsWith("this."),
          isNew: type === "NewExpression",
          optional: resolved.optional === true,
          args: { start: args.length === 0 ? start : argsStart, end: args.length === 0 ? end : argsEnd },
          argumentIdentifiers,
          loop: loopStack.at(-1) ?? null,
          function_: functionStack.at(-1) ?? null,
        });
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

  return {
    file,
    functions,
    calls,
    loops,
    awaits,
    spreads,
    comments,
    literals,
    parseErrors: result.errors.length,
  };
}
