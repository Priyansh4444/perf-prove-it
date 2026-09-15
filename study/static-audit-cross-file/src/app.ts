import type { Row } from "./format";
import { parseConfigs } from "./format";
import { computeScores } from "./rank";

const seeds = ["{}", '{"a":1}'];

export function bootstrap(rows: Row[], blocked: string[]): number[] {
  parseConfigs(seeds);
  return computeScores(rows, blocked);
}

computeScores([], []);
computeScores([], []);
