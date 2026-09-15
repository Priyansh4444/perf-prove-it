import { QrCode as Before, QrSegment as BeforeSegment } from "./qr-before.mjs";
import { QrCode as Packed, QrSegment as PackedSegment } from "./qr-packed.mjs";

const payloads = [
  "http://127.0.0.1:4983/pair#token=" + "a".repeat(96),
  "https://host.example/pair#token=" + "b".repeat(240),
  "https://host.example/pair#token=" + "c".repeat(680),
];

function matrix(qr) {
  let result = "";
  for (let y = 0; y < qr.size; y += 1) {
    for (let x = 0; x < qr.size; x += 1) result += qr.getModule(x, y) ? "1" : "0";
  }
  return result;
}

function assertSame(a, b, label) {
  if (a.version !== b.version || a.mask !== b.mask || matrix(a) !== matrix(b)) {
    throw new Error(`QR mismatch: ${label}`);
  }
}

let automaticCases = 0;
for (const payload of payloads) {
  for (const eccName of ["LOW", "MEDIUM", "QUARTILE", "HIGH"]) {
    let a;
    let b;
    let aError;
    let bError;
    try { a = Before.encodeText(payload, Before.Ecc[eccName]); } catch (error) { aError = error; }
    try { b = Packed.encodeText(payload, Packed.Ecc[eccName]); } catch (error) { bError = error; }
    if (Boolean(aError) !== Boolean(bError)) throw new Error(`Error mismatch: ${payload.length}/${eccName}`);
    if (a && b) assertSame(a, b, `${payload.length}/${eccName}`);
    automaticCases += 1;
  }
}

let forcedCases = 0;
for (const payload of payloads) {
  for (let mask = 0; mask < 8; mask += 1) {
    const a = Before.encodeSegments(BeforeSegment.makeSegments(payload), Before.Ecc.LOW, 1, 40, mask, false);
    const b = Packed.encodeSegments(PackedSegment.makeSegments(payload), Packed.Ecc.LOW, 1, 40, mask, false);
    assertSame(a, b, `${payload.length}/mask-${mask}`);
    forcedCases += 1;
  }
}

console.log(`behavior: ${automaticCases} automatic and ${forcedCases} forced-mask cases identical`);
if (process.argv.includes("--behavior-only")) process.exit(0);

function run(Implementation, iterations) {
  let checksum = 0;
  const start = performance.now();
  for (let index = 0; index < iterations; index += 1) {
    const qr = Implementation.encodeText(payloads[index % payloads.length], Implementation.Ecc.MEDIUM);
    checksum += qr.size + qr.mask + (qr.getModule(index % qr.size, (index * 7) % qr.size) ? 1 : 0);
  }
  return { elapsedMs: performance.now() - start, checksum };
}

function pairedSeries(label, leftImplementation, rightImplementation) {
  run(leftImplementation, 150);
  run(rightImplementation, 150);
  const pairs = [];
  let checksum = 0;
  for (let sample = 0; sample < 15; sample += 1) {
    let left;
    let right;
    if (sample % 2 === 0) {
      left = run(leftImplementation, 300);
      right = run(rightImplementation, 300);
    } else {
      right = run(rightImplementation, 300);
      left = run(leftImplementation, 300);
    }
    pairs.push([left.elapsedMs, right.elapsedMs]);
    checksum += left.checksum + right.checksum;
  }
  const ratios = pairs.map(([left, right]) => right / left).sort((a, b) => a - b);
  const medianRatio = ratios[Math.floor(ratios.length / 2)];
  console.log(`${label} ${JSON.stringify({
    pairsMs: pairs.map((pair) => pair.map((value) => Number(value.toFixed(2)))),
    medianRatio: Number(medianRatio.toFixed(4)),
    medianDeltaPercent: Number(((medianRatio - 1) * 100).toFixed(2)),
    checksum,
  })}`);
}

pairedSeries("A/A", Before, Before);
pairedSeries("A/B", Before, Packed);
