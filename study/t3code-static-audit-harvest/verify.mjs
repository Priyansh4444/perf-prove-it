#!/usr/bin/env node
// Differential equivalence: the rewrite must produce the same result as the
// extracted original on randomized and hand-built edge inputs before any
// timing claim is allowed.
import { CASES } from "./impls.mjs";
import { build, PROFILES } from "./workloads.mjs";

const failures = [];

function canonical(caseId, result) {
  if (caseId === "orderWindow") return result ? `${result.kind}:${result.id}` : "undefined";
  if (caseId === "sortedMembers") return result.map((account) => account.key).join(",");
  if (caseId === "hubCredits") return result ? `${result.source.id}:${result.account.key}` : "undefined";
  if (caseId === "runningTerminalIds") return result.join(",");
  if (caseId === "retainMessages") return result.map((message) => message.id).join(",");
  throw new Error(caseId);
}

function check(caseId, label, args) {
  const before = canonical(caseId, CASES[caseId].before(...args));
  const after = canonical(caseId, CASES[caseId].after(...args));
  if (before !== after) {
    failures.push(`${caseId}/${label}:\n  before=${before.slice(0, 160)}\n  after =${after.slice(0, 160)}`);
  }
}

// Randomized inputs across both profiles and many seeds.
for (const caseId of Object.keys(CASES)) {
  for (const profile of Object.keys(PROFILES[caseId])) {
    for (let seed = 1; seed <= 40; seed += 1) {
      const { args } = build(caseId, profile, seed);
      check(caseId, `${profile}/seed-${seed}`, args);
    }
  }
}

const account = (overrides) => ({
  key: "k0",
  driver: "codex",
  displayName: "A",
  email: "a@example.com",
  limits: { checkedAt: "2025-01-01T00:00:00.000Z", windows: [] },
  ...overrides,
});
const windowOf = (overrides) => ({
  id: "w",
  kind: "session",
  label: "session",
  usedPercent: 10,
  resetsAt: "2025-01-01T01:00:00.000Z",
  ...overrides,
});

// orderWindow edges
check("orderWindow", "empty", [[]]);
check("orderWindow", "no-windows", [[account({ limits: { windows: [] } })]]);
check("orderWindow", "kind-ties-keep-first", [[
  account({ key: "a", limits: { windows: [windowOf({ id: "first", kind: "weekly" })] } }),
  account({ key: "b", limits: { windows: [windowOf({ id: "second", kind: "weekly" })] } }),
]]);
check("orderWindow", "all-kinds", [[
  account({ key: "a", limits: { windows: [windowOf({ id: "o", kind: "other" })] } }),
  account({ key: "b", limits: { windows: [windowOf({ id: "s", kind: "session" })] } }),
  account({ key: "c", limits: { windows: [windowOf({ id: "m", kind: "monthly" })] } }),
]]);

// sortedMembers edges
check("sortedMembers", "undefined-order-window", [[
  account({ key: "b", displayName: "b" }), account({ key: "a", displayName: "a" }),
], undefined]);
check("sortedMembers", "missing-resets", [[
  account({ key: "a", displayName: "a", limits: { windows: [windowOf({ id: "w", resetsAt: undefined })] } }),
  account({ key: "b", displayName: "b", limits: { windows: [windowOf({ id: "w2", kind: "other" })] } }),
], windowOf({ id: "w" })]);
check("sortedMembers", "name-tie-broken-by-key", [[
  account({ key: "z", displayName: "same" }), account({ key: "a", displayName: "same" }),
], undefined]);
check("sortedMembers", "invalid-reset-sorts-last", [[
  account({ key: "bad", limits: { windows: [windowOf({ id: "w", resetsAt: "not-a-date" })] } }),
  account({ key: "good", limits: { windows: [windowOf({ id: "w" })] } }),
], windowOf({ id: "w" })]);

// hubCredits edges
const source = (id, accounts) => ({ id, label: id, accounts });
const hubAccount = (key, checkedAt, credits = true) => ({
  key, driver: "codex", email: "shared@example.com",
  usageLimits: { checkedAt, windows: [], ...(credits ? { resetCredits: { nextCreditId: "c" } } : {}) },
});
check("hubCredits", "null-key", [[source("s", [hubAccount("a", "2025-01-01T00:00:00.000Z")])], null]);
check("hubCredits", "no-match", [[source("s", [hubAccount("a", "2025-01-01T00:00:00.000Z")])], "codex:other@example.com"]);
check("hubCredits", "pick-freshest", [[
  source("s1", [hubAccount("a", "2025-01-01T00:00:00.000Z")]),
  source("s2", [hubAccount("b", "2025-06-01T00:00:00.000Z")]),
], "codex:shared@example.com"]);
check("hubCredits", "tie-keeps-first", [[
  source("s1", [hubAccount("a", "2025-01-01T00:00:00.000Z")]),
  source("s2", [hubAccount("b", "2025-01-01T00:00:00.000Z")]),
], "codex:shared@example.com"]);
check("hubCredits", "invalid-date", [[
  source("s1", [hubAccount("a", "not-a-date")]),
  source("s2", [hubAccount("b", "2025-01-01T00:00:00.000Z")]),
], "codex:shared@example.com"]);
check("hubCredits", "no-credits-skipped", [[
  source("s1", [hubAccount("a", "2025-06-01T00:00:00.000Z", false)]),
  source("s2", [hubAccount("b", "2025-01-01T00:00:00.000Z")]),
], "codex:shared@example.com"]);

// runningTerminalIds edges
check("runningTerminalIds", "empty", [[]]);
check("runningTerminalIds", "none", [[{ target: { terminalId: "t" }, state: { hasRunningSubprocess: false } }]]);

// retainMessages edges
const msg = (id, role, turnId, createdAt) => ({ id, role, turnId, createdAt });
check("retainMessages", "empty", [[], new Set(), 0]);
check("retainMessages", "zero-turns", [[msg("m0", "user", null, "2025-01-01T00:00:00.000Z")], new Set(), 0]);
check("retainMessages", "invalid-createdAt-sorts-by-string", [[
  msg("m0", "user", null, "not-a-date"),
  msg("m1", "user", null, "2025-01-01T00:00:00.000Z"),
  msg("m2", "user", null, "zzz"),
], new Set(), 2]);
check("retainMessages", "createdAt-ties-by-id", [[
  msg("m9", "user", null, "2025-01-01T00:00:00.000Z"),
  msg("m1", "user", null, "2025-01-01T00:00:00.000Z"),
], new Set(), 1]);

if (failures.length > 0) {
  console.error(`verify: ${failures.length} mismatch(es)`);
  for (const failure of failures) console.error(failure);
  process.exit(1);
}
console.log("verify: before/after identical on randomized inputs and edge cases");
