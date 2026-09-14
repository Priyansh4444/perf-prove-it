# default parameter closure: one line at module scope

Source: `examples/default-param-pipeline/`. Unit: a function whose second parameter defaults to `() => null`, called without that argument.

## The source and the census

```js
function withDefault(value, cb = () => null) {
  return cb(value)
}
```

`node --print-bytecode --print-bytecode-filter=withDefault`:

```text
Bytecode length: 21
@ 7 : 8b 00 00 02  CreateClosure [0:... <SharedFunctionInfo cb>], FBV[0], #2
```

A default value is evaluated on every call that omits the argument, so V8 builds a function object each time. Hoisting the noop to module scope removes the `CreateClosure` site and keeps the function the same 21 bytes.

## The numbers

`--trace-gc`, three runs each, identical every run:

| arm | scavenges per 1M calls |
| --- | --- |
| inline default `cb = () => null` | 54, 54, 54 |
| hoisted `cb = noop` | 0, 0, 0 |

The counts are the same under `--max-opt=0`, so this is not a tier artifact. Each scavenge is a young-generation collection; the closures only exist to return `null`.

## The trap

The allocation stops being churn when a reference escapes: the closure is stored in a cache, attached as a listener, or kept on an object. Then the memory is retained by functions that do nothing. The fix is one module-scope constant, and call sites that pass the argument are untouched because a default only runs for `undefined`.

## Identity

For callers that omit the argument the returned value is unchanged. If any caller compares the callback identity or depends on a fresh function object per call, hoisting changes that, so check the callers first.
