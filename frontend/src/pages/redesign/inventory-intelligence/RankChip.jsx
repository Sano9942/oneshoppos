import { Badge } from "../../../ui/primitives";

const TONE_BY_RANK = { A: "success", B: "warning", C: "danger" };

export default function RankChip({ rank }) {
  if (!rank) return <span className="text-xs text-(--ui-text-muted)">—</span>;
  return <Badge tone={TONE_BY_RANK[rank] || "default"}>{rank}</Badge>;
}
