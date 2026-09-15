import { useState } from "react";
import type { Row } from "./format";
import { computeScores } from "./rank";

export interface WidgetProps {
  rows: Row[];
  blocked: string[];
}

export function Widget({ rows, blocked }: WidgetProps) {
  const [open, setOpen] = useState(false);
  const scores = computeScores(rows, blocked);
  for (const row of rows) {
    blocked.includes(row.id);
  }
  return (
    <button onClick={() => setOpen(!open)}>
      {open ? "hide" : "show"} {scores.length}
    </button>
  );
}
