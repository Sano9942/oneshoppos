import { parseDbDate } from "../../utils/dates";

export { useCurrency } from "../../contexts/CurrencyContext";

/** Shows a delta arrow + percentage vs yesterday. green = up, red = down */
export function DeltaArrow({ today, yesterday, invert = false }) {
  if (yesterday == null || yesterday === 0) return null;
  const pct = ((today - yesterday) / Math.abs(yesterday)) * 100;
  const isPositive = invert ? pct < 0 : pct > 0;
  const abs = Math.abs(pct).toFixed(1);
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-medium ${isPositive ? "text-(--ui-success-fg)" : "text-(--ui-danger-fg)"}`}>
      {pct > 0 ? "↑" : pct < 0 ? "↓" : "→"} {abs}%
    </span>
  );
}

/** Shows a human-readable relative time from a SQLite UTC timestamp string */
export function RelativeTime({ ts }) {
  if (!ts) return <span className="text-(--ui-text-muted) text-xs">—</span>;
  const diffMs = Date.now() - parseDbDate(ts).getTime();
  const diffMin = Math.floor(diffMs / 60000);
  let label;
  if (diffMin < 1) label = "just now";
  else if (diffMin < 60) label = `${diffMin}m ago`;
  else if (diffMin < 1440) label = `${Math.floor(diffMin / 60)}h ago`;
  else label = `${Math.floor(diffMin / 1440)}d ago`;
  return <span className="text-(--ui-text-muted) text-xs">{label}</span>;
}
