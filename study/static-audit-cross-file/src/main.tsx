import type { Row } from "./format";
import { Widget } from "./widget";

export function App({ rows, blocked }: { rows: Row[]; blocked: string[] }) {
  return <Widget rows={rows} blocked={blocked} />;
}
