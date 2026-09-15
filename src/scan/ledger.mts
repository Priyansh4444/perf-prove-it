import { appendFileSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const LEDGER_ROOT = join(tmpdir(), "perf-prove-it");

export function sessionKey(): string {
  return (process.env.PERF_PROVE_IT_SESSION_ID ?? `ppid-${process.ppid}`).replace(/[^A-Za-z0-9_.-]/g, "_");
}

export function ledgerPath(): string {
  return join(LEDGER_ROOT, sessionKey(), "dismissed.jsonl");
}

function statSafe(path: string): ReturnType<typeof statSync> | null {
  try {
    return statSync(path);
  } catch {
    return null;
  }
}

export function pruneLedgers(maxAgeMs = 24 * 60 * 60 * 1000): void {
  if (statSafe(LEDGER_ROOT) === null) return;
  const cutoff = Date.now() - maxAgeMs;
  for (const entry of readdirSync(LEDGER_ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = join(LEDGER_ROOT, entry.name);
    try {
      if (statSync(dir).mtimeMs < cutoff) rmSync(dir, { recursive: true, force: true });
    } catch {
      /* raced with another process */
    }
  }
}

export function dismissedIds(): Set<string> {
  const file = ledgerPath();
  if (statSafe(file) === null) return new Set();
  const ids = new Set<string>();
  for (const line of readFileSync(file, "utf8").trim().split("\n")) {
    if (line.length === 0) continue;
    try {
      const parsed = JSON.parse(line) as { id?: unknown };
      if (typeof parsed.id === "string") ids.add(parsed.id);
    } catch {
      /* ignore malformed lines */
    }
  }
  return ids;
}

export function dismiss(id: string, reason: string): string {
  const path = ledgerPath();
  mkdirSync(join(LEDGER_ROOT, sessionKey()), { recursive: true });
  appendFileSync(path, `${JSON.stringify({ id, reason, at: new Date().toISOString() })}\n`);
  return path;
}

export function cleanupLedger(): string {
  const dir = join(LEDGER_ROOT, sessionKey());
  rmSync(dir, { recursive: true, force: true });
  return ledgerPath();
}
