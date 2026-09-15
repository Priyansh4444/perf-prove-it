# decodeEntities: a DOM parse replaced by a string scan

Sources: the repo's `study/reports/highlight-worker.md`, `study/reports/highlight-verifier.md`.
Unit: `decodeEntities` over search result titles and transcript fragments.

## The source change

Every segment of a tagged snippet went through `entityDecoder.innerHTML = value` on a shared textarea: a full HTML parse per segment, about 1.8 parses per call. The backend escapes exactly five entities, and most segments contain no `&` at all.

The fix adds a guard: return the input when it has no `&` (and no `\r` or NUL, which the HTML parser normalizes), decode the five known entities in JS when every `&` is one of them, and fall through to the textarea for anything else. No caching, no API change.

## What the census returned

This case is not about closures; it is about a call the census cannot price, so the evidence is the entry block. Baseline first instruction:

```text
@ 0 : 17 03  LdaCurrentContextSlotNoCell [3]
@ 2 : b8 00  ThrowReferenceErrorIfHole [0:"entityDecoder"]
```

The old entry always loads the shared textarea slot and falls through to `SetNamedProperty innerHTML`. Optimized entry:

```text
@ 0 : 33 03 00 00  GetNamedProperty a0, [0:"indexOf"]
...
@ 16 : 76 f9 00 00  TestEqualStrict r0, EmbeddedFeedback[0x0]
@ 20 : a6 33        JumpIfFalse [51]
```

The new entry calls `value.indexOf("&")` first and can return without ever reaching the DOM. DOM accounting on 304 calls: `innerHTML` sets 547 to 0, `createElement` 1 to 0, both engines.

Note the price runs the other way here: the function grew 44 to 130 bytes because the fast path is inlined ahead of the DOM path. Bigger bytecode, far less work.

## Outcome and identity

Timing, separate processes: 26,165.8 to 576.5 ns per call on the worker's mixed workload (45.4x); the verifier reproduced 40.6x mixed, 20.4x on the entity path, 66.6x on the no-entity path. Differential: 94,097 checks over 47,236 inputs in Chromium, 0 mismatches; the worker's own 50,015-case corpus also ran 0 mismatches.

Identity has one engine boundary: for lone surrogates, jsdom's `innerHTML` setter throws while the fast path returns the string (42 jsdom-only divergences). Chromium preserves lone surrogates, so the fast path matches the real browser; the report states the boundary instead of hiding it.
