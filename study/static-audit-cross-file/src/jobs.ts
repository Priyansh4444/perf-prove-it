import type { Row } from "./format";
import { computeScores } from "./rank";

export function runJob(rows: Row[], blocked: string[]): number[] {
  return computeScores(rows, blocked);
}

computeScores([], []);
computeScores([], []);
