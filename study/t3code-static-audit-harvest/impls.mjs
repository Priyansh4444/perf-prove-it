// Extracted from T3 Code commit 66e39ca2 (https://github.com/pingdotgg/t3code).
// Function bodies marked "verbatim" are copied from the cited source files; only
// module imports are replaced with local equivalents so the study runs on plain
// Node. The `after` variants are behavior-preserving rewrites. See README.md.

// ---- shared helpers copied verbatim from packages/shared/src/usageLimits.ts ----

export const WINDOW_KIND_ORDER = { session: 0, weekly: 1, monthly: 2, other: 3 };

export function resetMillis(window) {
  if (window.resetsAt === undefined) return null;
  const at = Date.parse(window.resetsAt);
  return Number.isFinite(at) ? at : null;
}

export function accountSortName(account) {
  return (account.displayName ?? account.email ?? account.key).toLowerCase();
}

export function accountKey(driver, email) {
  const normalizedEmail = email?.trim().toLowerCase();
  return normalizedEmail ? `${driver}:${normalizedEmail}` : null;
}

export function limitsNotice(limits) {
  if (limits.unavailable?.reason === "unsupported") {
    return limits.unavailable.message ?? "This account has no subscription limits.";
  }
  if (limits.unavailable?.reason === "probeFailed") {
    return limits.unavailable.message ?? "Could not read limits.";
  }
  return limits.windows.length === 0 ? "No limits reported." : null;
}

// ---- dateTime.ts (verbatim; effect/DateTime replaced with pure equivalents) ----

const ISO_PATTERN =
  /^(?:\d{4}|[+-]\d{6})-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?|24:00(?::00(?:\.0+)?)?)(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;

function isZonedIsoDateTime(value) {
  return ISO_PATTERN.test(value);
}

export function parseTimestamp(value) {
  if (!isZonedIsoDateTime(value)) return Number.NaN;
  // Replicates the effect/DateTime calendar normalization check from
  // dateTime.ts: an impossible date like 2024-02-30 must be rejected, not
  // normalized forward by Date.parse.
  const datePart = value.slice(0, value.indexOf("T"));
  const month = Number(datePart.slice(-5, -3));
  const day = Number(datePart.slice(-2));
  const year = Number(datePart.slice(0, datePart.length - 6));
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return Number.NaN;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

export function compareDateTimeStrings(left, right) {
  const leftTimestamp = parseTimestamp(left);
  const rightTimestamp = parseTimestamp(right);
  const leftIsValid = !Number.isNaN(leftTimestamp);
  const rightIsValid = !Number.isNaN(rightTimestamp);

  if (leftIsValid !== rightIsValid) return leftIsValid ? 1 : -1;
  if (leftIsValid) return leftTimestamp - rightTimestamp;
  return left < right ? -1 : left > right ? 1 : 0;
}

// ================= CASE A: orderWindow minimum =================
// usageLimits.ts:316-318 (verbatim).

export function orderWindowBefore(members) {
  return members
    .flatMap((account) => account.limits.windows)
    .sort((left, right) => WINDOW_KIND_ORDER[left.kind] - WINDOW_KIND_ORDER[right.kind])[0];
}

export function orderWindowAfter(members) {
  let best;
  let bestOrder = Number.POSITIVE_INFINITY;
  for (const account of members) {
    for (const window of account.limits.windows) {
      const order = WINDOW_KIND_ORDER[window.kind];
      if (order < bestOrder) {
        best = window;
        bestOrder = order;
      }
    }
  }
  return best;
}

// ================= CASE B: sort members with orderReset comparator =================
// usageLimits.ts:319-330 (verbatim).

export function sortedMembersBefore(members, orderWindow) {
  const orderReset = (account) => {
    const window = account.limits.windows.find(
      (window) => window.kind === orderWindow?.kind && window.id === orderWindow.id,
    );
    return (window ? resetMillis(window) : null) ?? Number.POSITIVE_INFINITY;
  };
  return [...members].sort(
    (left, right) =>
      orderReset(left) - orderReset(right) ||
      accountSortName(left).localeCompare(accountSortName(right)) ||
      left.key.localeCompare(right.key),
  );
}

export function sortedMembersAfter(members, orderWindow) {
  const targetKind = orderWindow?.kind;
  const targetId = orderWindow?.id;
  const prepared = members.map((account) => {
    let reset = null;
    if (orderWindow !== undefined) {
      for (const window of account.limits.windows) {
        if (window.kind === targetKind && window.id === targetId) {
          reset = resetMillis(window);
          break;
        }
      }
    }
    return {
      account,
      order: reset ?? Number.POSITIVE_INFINITY,
      name: accountSortName(account),
    };
  });
  prepared.sort(
    (left, right) =>
      left.order - right.order ||
      left.name.localeCompare(right.name) ||
      left.account.key.localeCompare(right.account.key),
  );
  return prepared.map((entry) => entry.account);
}

// ================= CASE C: hubCredits freshest-by-checkedAt =================
// usageLimits.ts:566-578 (verbatim).

export function hubCreditsBefore(sources, key) {
  return sources
    .flatMap((source) => source.accounts.map((account) => ({ source, account })))
    .filter(
      ({ account }) =>
        key !== null &&
        accountKey(account.driver, account.email) === key &&
        account.usageLimits.resetCredits &&
        !limitsNotice(account.usageLimits),
    )
    .sort(
      (a, b) =>
        Date.parse(b.account.usageLimits.checkedAt) - Date.parse(a.account.usageLimits.checkedAt),
    )[0];
}

export function hubCreditsAfter(sources, key) {
  if (key === null) return undefined;
  let best;
  let bestAt = Number.NEGATIVE_INFINITY;
  for (const source of sources) {
    for (const account of source.accounts) {
      if (accountKey(account.driver, account.email) !== key) continue;
      if (!account.usageLimits.resetCredits) continue;
      if (limitsNotice(account.usageLimits) !== null) continue;
      const at = Date.parse(account.usageLimits.checkedAt);
      if (best === undefined || at > bestAt) {
        best = { source, account };
        bestAt = at;
      }
    }
  }
  return best;
}

// ================= CASE D: filter+map terminal ids =================
// terminalSession.ts:58-64 (verbatim).

export function runningTerminalIdsBefore(sessions) {
  return sessions
    .filter((session) => session.state.hasRunningSubprocess)
    .map((session) => session.target.terminalId);
}

export function runningTerminalIdsAfter(sessions) {
  const ids = [];
  for (const session of sessions) {
    if (session.state.hasRunningSubprocess) ids.push(session.target.terminalId);
  }
  return ids;
}

// ================= CASE F: retainMessagesAfterRevert fallback sort =================
// threadReducer.ts:818-861 (verbatim; isImportedAgentSessionMessageId stubbed).

export function isImportedAgentSessionMessageId(id) {
  return id.startsWith("imported:");
}

export function retainMessagesBefore(messages, retainedTurnIds, turnCount) {
  const retainedMessageIds = new Set();
  for (const message of messages) {
    if (message.role === "system" || isImportedAgentSessionMessageId(message.id)) {
      retainedMessageIds.add(message.id);
    } else if (message.turnId !== null && retainedTurnIds.has(message.turnId)) {
      retainedMessageIds.add(message.id);
    }
  }

  for (const role of ["user", "assistant"]) {
    const retainedCount = messages.filter(
      (message) =>
        message.role === role &&
        !isImportedAgentSessionMessageId(message.id) &&
        retainedMessageIds.has(message.id),
    ).length;
    const missingCount = Math.max(0, turnCount - retainedCount);
    const fallbackMessages = messages
      .filter(
        (message) =>
          message.role === role &&
          !retainedMessageIds.has(message.id) &&
          (message.turnId === null || retainedTurnIds.has(message.turnId)),
      )
      .sort(
        (left, right) =>
          compareDateTimeStrings(left.createdAt, right.createdAt) ||
          left.id.localeCompare(right.id),
      )
      .slice(0, missingCount);
    for (const message of fallbackMessages) {
      retainedMessageIds.add(message.id);
    }
  }

  return messages.filter((message) => retainedMessageIds.has(message.id));
}

function compareDecorated(left, right) {
  if (left.valid !== right.valid) return left.valid ? 1 : -1;
  const byTime = left.valid ? left.ts - right.ts : left.raw < right.raw ? -1 : left.raw > right.raw ? 1 : 0;
  return byTime || left.id.localeCompare(right.id);
}

export function retainMessagesAfter(messages, retainedTurnIds, turnCount) {
  const retainedMessageIds = new Set();
  for (const message of messages) {
    if (message.role === "system" || isImportedAgentSessionMessageId(message.id)) {
      retainedMessageIds.add(message.id);
    } else if (message.turnId !== null && retainedTurnIds.has(message.turnId)) {
      retainedMessageIds.add(message.id);
    }
  }

  for (const role of ["user", "assistant"]) {
    const retainedCount = messages.filter(
      (message) =>
        message.role === role &&
        !isImportedAgentSessionMessageId(message.id) &&
        retainedMessageIds.has(message.id),
    ).length;
    const missingCount = Math.max(0, turnCount - retainedCount);
    const candidates = [];
    for (const message of messages) {
      if (message.role !== role) continue;
      if (retainedMessageIds.has(message.id)) continue;
      if (message.turnId !== null && !retainedTurnIds.has(message.turnId)) continue;
      const ts = parseTimestamp(message.createdAt);
      candidates.push({ message, ts, valid: !Number.isNaN(ts), raw: message.createdAt, id: message.id });
    }
    candidates.sort(compareDecorated);
    for (let index = 0; index < candidates.length && index < missingCount; index += 1) {
      retainedMessageIds.add(candidates[index].message.id);
    }
  }

  return messages.filter((message) => retainedMessageIds.has(message.id));
}

export const CASES = {
  orderWindow: { before: orderWindowBefore, after: orderWindowAfter },
  sortedMembers: { before: sortedMembersBefore, after: sortedMembersAfter },
  hubCredits: { before: hubCreditsBefore, after: hubCreditsAfter },
  runningTerminalIds: { before: runningTerminalIdsBefore, after: runningTerminalIdsAfter },
  retainMessages: { before: retainMessagesBefore, after: retainMessagesAfter },
};
