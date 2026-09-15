# T3 Code QR packed-grid evaluation

This study tests replacing the QR encoder's parallel `boolean[][]` grids with one flat `Uint8Array`. Bit 0 stores module darkness and bit 1 marks function modules during construction.

The snapshots are minified, self-contained builds derived from `packages/shared/src/qrCode.ts` at T3 Code commit `b1e223e2b0d87124883b1410ab52dd6a1338e40d` (`https://github.com/pingdotgg/t3code.git`). `qr-before.mjs` preserves the original representation; `qr-packed.mjs` changes only grid storage and access. The underlying QR implementation is Copyright Project Nayuki and MIT-licensed; see [LICENSE.md](./LICENSE.md).

## Reproduce

The original evaluation used Bun 1.4.0, the runtime shipped in the inspected checkout.

```sh
bun study/t3code-qr-eval/evaluate.mjs --behavior-only
bun study/t3code-qr-eval/evaluate.mjs
```

The behavior check compares version, mask, and every output module for three pairing-URL-shaped payloads across four ECC levels and every forced mask. The benchmark runs an isolated A/A control followed by A/B. Each series warms both arms independently, then runs 15 alternating-order pairs of 300 automatic-mask encodes. Separate checksums keep both series observable.

Recorded raw summaries and the decision are in [RESULT.md](./RESULT.md).
