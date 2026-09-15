import { readFileSync } from "node:fs"

const file = process.argv[2]
const profile = JSON.parse(readFileSync(file, "utf8"))
const nodes = new Map(profile.nodes.map((node) => [node.id, node]))
const self = new Map()
for (const id of profile.samples ?? []) {
  const node = nodes.get(id)
  if (!node) continue
  const name = node.callFrame.functionName || "(anonymous)"
  self.set(name, (self.get(name) ?? 0) + 1)
}
const total = (profile.samples ?? []).length
for (const [name, count] of [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
  console.log(`${name.padEnd(28)} ${String(count).padStart(6)} ${((count / total) * 100).toFixed(1).padStart(5)}%`)
}
console.log(`total samples ${total}`)
