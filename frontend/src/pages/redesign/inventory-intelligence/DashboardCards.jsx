import { useEffect, useState } from "react";
import { api } from "../../../api";
import { useCurrency } from "../../../contexts/CurrencyContext";
import { Button, Skeleton } from "../../../ui/primitives";

const CARDS = [
  { key: "reorder_count", label: "Needs reorder", tab: "reorder" },
  { key: "next_cycle_count", label: "Next cycle count", tab: "cycle-counts", kind: "date" },
  { key: "dead_stock_count", label: "Dead stock items", tab: "aging" },
  { key: "stock_value_at_risk", label: "Stock value at risk", tab: "aging", kind: "currency" },
];

function formatDate(v) {
  if (!v) return "—";
  // Server returns DATE; pg driver can return string or Date. Render as
  // YYYY-MM-DD to stay timezone-stable (the value is a raw DATE, not a
  // timestamp).
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "string") return v.slice(0, 10);
  return String(v);
}

export default function DashboardCards({ onSelectTab }) {
  const { fmt } = useCurrency();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get("/api/inventory-intelligence/dashboard-cards")
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || "Failed to load cards");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <div className="rounded-(--ui-radius-md) border border-(--ui-border) bg-(--ui-surface) p-4 text-sm text-(--ui-danger)">
        {error}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {CARDS.map((c) => {
        const raw = data?.[c.key];
        let display;
        if (loading) {
          display = <Skeleton className="h-7 w-24" />;
        } else if (c.kind === "date") {
          display = <span>{formatDate(raw)}</span>;
        } else if (c.kind === "currency") {
          display = <span>{fmt(Number(raw) || 0)}</span>;
        } else {
          display = <span>{Number(raw) || 0}</span>;
        }
        return (
          <Button
            key={c.key}
            tone="plain"
            onClick={() => onSelectTab && onSelectTab(c.tab)}
            className="flex flex-col items-start gap-1 rounded-(--ui-radius-md) border border-(--ui-border) bg-(--ui-surface) p-4 text-left hover:border-(--ui-primary)"
          >
            <span className="text-xs font-medium uppercase tracking-wide text-(--ui-text-muted)">
              {c.label}
            </span>
            <span className="text-2xl font-semibold text-(--ui-text)">{display}</span>
          </Button>
        );
      })}
    </div>
  );
}
