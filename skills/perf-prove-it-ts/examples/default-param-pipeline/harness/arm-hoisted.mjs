const ITERATIONS = Number(process.env.ITERATIONS ?? 1_000_000)
const noop = () => null

function withHoisted(value, cb = noop) {
  return cb(value)
}

let sink = 0
for (let i = 0; i < ITERATIONS; i++) sink += withHoisted(i) === null ? 1 : 0
console.log(sink)
