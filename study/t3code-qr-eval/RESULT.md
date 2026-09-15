# T3 Code QR packed-grid result

Behavior was identical for 12 automatic payload/ECC cases and 24 forced-mask cases, covering version, selected mask, dimensions, and every module.

- Run 1 A/A median delta: -1.35%; A/B: -6.12%.
- Run 2 A/A median delta: -0.35%; A/B: -6.50%.

One full run of the corrected committed harness produced A/A -2.87% and A/B -6.60%. The treatment exceeded that run's directional control by about 3.7 percentage points; the earlier controls show that the A/A drift is not stable.

```text
committed harness A/A
[[622.36,618.60],[621.62,614.39],[660.20,619.16],[614.55,614.58],[726.47,719.66],[701.98,681.61],[726.50,674.55],[703.69,681.94],[711.17,695.46],[697.99,717.89],[713.24,682.41],[714.94,694.44],[691.80,677.13],[699.30,672.66],[708.87,620.90]]

committed harness A/B
[[656.47,623.76],[665.73,642.98],[592.25,565.88],[615.52,563.86],[690.09,594.19],[588.61,603.53],[674.67,630.17],[675.89,586.16],[601.87,613.87],[654.05,661.30],[598.14,588.50],[685.37,604.74],[741.23,671.40],[739.32,662.96],[714.60,644.88]]
```

## Raw paired milliseconds

Each pair is `[before, comparison]`. A/A compares two original executions; A/B compares original with packed.

```text
run 1 A/A
[[604.76,607.91],[608.80,634.37],[610.18,612.53],[588.56,604.92],[598.08,587.13],[591.41,589.25],[584.97,605.08],[622.02,584.33],[596.27,584.81],[658.45,630.89],[610.63,601.76],[637.30,609.58],[612.30,680.63],[761.26,750.97],[806.07,749.13]]

run 1 A/B
[[605.03,566.46],[622.96,587.76],[608.94,552.08],[600.94,556.43],[597.19,555.44],[595.89,575.45],[587.87,561.34],[584.95,549.18],[584.95,573.70],[628.63,588.34],[622.81,570.07],[609.32,607.39],[614.39,614.05],[730.10,702.87],[878.31,747.73]]

run 2 A/A
[[729.83,711.29],[682.02,706.98],[645.51,639.30],[699.07,685.36],[715.20,698.84],[696.57,746.12],[718.22,694.19],[693.17,714.15],[694.85,687.21],[612.60,678.84],[668.19,702.93],[671.32,668.97],[660.42,712.02],[625.74,642.30],[656.14,652.27]]

run 2 A/B
[[719.69,705.64],[636.13,609.95],[653.07,666.84],[701.80,636.93],[704.56,631.93],[701.69,642.25],[688.37,696.63],[682.49,678.54],[709.26,672.24],[680.68,555.55],[694.67,706.32],[663.90,620.76],[648.32,605.93],[654.73,588.37],[659.97,607.79]]
```

## Decision

Do not propose a T3 Code PR from this evidence. Packing improves QR encoding by about 6.3%, but saves only about 0.12–0.15 ms on a one-time pairing/startup path. The mechanism is proven; material product impact is not.

If later justified, limit the PR to `packages/shared/src/qrCode.ts` plus matrix-equivalence tests, with no API or caller changes. Benchmark Chromium too because the web path does not execute in Bun.
