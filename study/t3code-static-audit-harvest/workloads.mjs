// Deterministic workloads for the static-audit harvest study.
// Profiles: `realistic` approximates the sizes the product actually sees at
// the cited call sites; `scaled` pushes the input up so the asymptotic work
// model is observable. Both arms of a case receive the identical object graph.

function mulberry32(seed) {
  let state = seed >>> 0;
  return function next() {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const BASE_TIME = Date.UTC(2025, 0, 1);
const KINDS = ["session", "weekly", "monthly", "other"];

function makeAccount(rng, index, windowsCount, email) {
  const windows = [];
  for (let w = 0; w < windowsCount; w += 1) {
    const kind = KINDS[Math.floor(rng() * KINDS.length)];
    windows.push({
      id: `w${w}-${kind}`,
      kind,
      label: kind,
      usedPercent: Math.floor(rng() * 100),
      windowDurationMins: 60 * (1 + Math.floor(rng() * 24)),
      resetsAt: new Date(BASE_TIME + Math.floor(rng() * 1e11)).toISOString(),
    });
  }
  return {
    key: `acct-${index}`,
    driver: "codex",
    displayName: `Account ${index}`,
    email,
    plan: "pro",
    accentColor: undefined,
    environments: [],
    sourceLabel: null,
    redeem: null,
    limits: {
      checkedAt: new Date(BASE_TIME + Math.floor(rng() * 1e11)).toISOString(),
      windows,
    },
  };
}

function makeMembers(rng, count, windowsCount) {
  const members = [];
  for (let i = 0; i < count; i += 1) {
    members.push(makeAccount(rng, i, windowsCount, `acct-${i}@example.com`));
  }
  return members;
}

export const PROFILES = {
  orderWindow: {
    realistic: { accounts: 4, windows: 3 },
    scaled: { accounts: 400, windows: 8 },
  },
  sortedMembers: {
    realistic: { accounts: 4, windows: 3 },
    scaled: { accounts: 400, windows: 8 },
  },
  hubCredits: {
    realistic: { sources: 3, perSource: 3 },
    scaled: { sources: 8, perSource: 250 },
  },
  runningTerminalIds: {
    realistic: { sessions: 200 },
    scaled: { sessions: 200000 },
  },
  retainMessages: {
    tiny: { messages: 20 },
    small: { messages: 200 },
    realistic: { messages: 2000 },
    scaled: { messages: 50000 },
  },
};

export function build(caseId, profile, seed) {
  const sizes = PROFILES[caseId][profile];
  const rng = mulberry32(seed);

  if (caseId === "orderWindow") {
    const members = makeMembers(rng, sizes.accounts, sizes.windows);
    return { args: [members], meta: sizes };
  }

  if (caseId === "sortedMembers") {
    const members = makeMembers(rng, sizes.accounts, sizes.windows);
    const orderWindow = members[0].limits.windows.find((window) => window.kind === "session")
      ?? members[0].limits.windows[0];
    return { args: [members, orderWindow], meta: sizes };
  }

  if (caseId === "hubCredits") {
    const sources = [];
    for (let s = 0; s < sizes.sources; s += 1) {
      const accounts = [];
      for (let a = 0; a < sizes.perSource; a += 1) {
        const account = makeAccount(rng, s * sizes.perSource + a, 2, `shared@example.com`);
        account.key = `s${s}-a${a}`;
        account.usageLimits = {
          ...account.limits,
          resetCredits: { nextCreditId: `credit-${s}-${a}` },
        };
        delete account.limits;
        accounts.push(account);
      }
      sources.push({ id: `source-${s}`, label: `Hub ${s}`, accounts });
    }
    return { args: [sources, "codex:shared@example.com"], meta: sizes };
  }

  if (caseId === "runningTerminalIds") {
    const sessions = [];
    for (let i = 0; i < sizes.sessions; i += 1) {
      sessions.push({
        target: { environmentId: `env-${i % 8}`, threadId: `thread-${i % 500}`, terminalId: `term-${i}` },
        state: { hasRunningSubprocess: rng() < 0.35, status: "running" },
      });
    }
    return { args: [sessions], meta: sizes };
  }

  if (caseId === "retainMessages") {
    const messages = [];
    let turnCounter = 0;
    for (let i = 0; i < sizes.messages; i += 1) {
      const kind = rng();
      const role = kind < 0.45 ? "assistant" : kind < 0.9 ? "user" : "system";
      const turnId = rng() < 0.6 ? null : `turn-${turnCounter++}`;
      const createdAt = new Date(BASE_TIME + Math.floor(rng() * 1e11)).toISOString();
      messages.push({ id: `m-${i}`, role, turnId, createdAt });
    }
    const retainedTurnIds = new Set();
    for (let t = 0; t < Math.floor(turnCounter * 0.02); t += 1) retainedTurnIds.add(`turn-${t}`);
    const turnCount = Math.max(1, Math.floor(turnCounter * 0.05));
    return { args: [messages, retainedTurnIds, turnCount], meta: { ...sizes, turns: turnCounter } };
  }

  throw new Error(`unknown case: ${caseId}`);
}
