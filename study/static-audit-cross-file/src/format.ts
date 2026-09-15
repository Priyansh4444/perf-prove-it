export interface Row {
  id: string;
  at: string;
  weight: number;
}

export function parseConfigs(inputs: string[]): unknown[] {
  const parsed: unknown[] = [];
  for (const input of inputs) {
    parsed.push(JSON.parse(input));
  }
  return parsed;
}
