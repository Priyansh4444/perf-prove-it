const ITERATIONS = Number(process.env.ITERATIONS ?? 1_000_000)

function withDefault(value, cb = () => null) {
  return cb(value)
}

let sink = 0
for (let i = 0; i < ITERATIONS; i++) sink += withDefault(i) === null ? 1 : 0
console.log(sink)
