import type { Row } from "./format";

export function computeScores(rows: Row[], blocked: string[]): number[] {
  const scores: number[] = [];
  for (const row of rows) {
    scores.push(blocked.includes(row.id) ? 0 : row.weight);
  }
  return scores;
}
