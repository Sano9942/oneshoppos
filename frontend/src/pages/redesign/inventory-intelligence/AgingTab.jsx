import { useEffect, useState } from "react";
import { api } from "../../../api";
import { useCurrency } from "../../../contexts/CurrencyContext";
import { Badge, Select, TableToolbar } from "../../../ui/primitives";

const BUCKETS = [
  { value: "", label: "All ages" },
  { value: "fresh", label: "Fresh (≤ 30d)" },
  { value: "aging", label: "Aging (31–60d)" },
  { value: "old", label: "Old (61–90d)" },
  { value: "critical", label: "Critical (> 90d)" },
];

const BUCKET_TONE = {
  fresh: "success",
  aging: "default",
  old: "warning",
  critical: "danger",
};

export default function AgingTab() {
  const { fmt } = useCurrency();
  const [bucket, setBucket] = useState("");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const q = bucket ? `?bucket=${bucket}` : "";
    api
      .get(`/api/reports/stock-aging${q}`)
      .then((res) => {
        if (!cancelled) {
          setData(res);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || "Failed to load");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [bucket]);

  const items = data?.items || [];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label="Total cost value" value={fmt(Number(data?.total_cost_value) || 0)} />
        <Stat
          label="Avg cost per unit"
          value={fmt(Number(data?.avg_cost_per_unit) || 0)}
        />
        <Stat
          label="Value at risk (≥ 90d)"
          value={fmt(Number(data?.value_at_risk) || 0)}
          tone="danger"
        />
      </div>

      <TableToolbar
        left={
          <div className="flex items-center gap-2">
            <label className="text-sm text-(--ui-text-muted)">Age bucket</label>
            <Select value={bucket} onChange={(e) => setBucket(e.target.value)}>
              {BUCKETS.map((b) => (
                <option key={b.value} value={b.value}>
                  {b.label}
                </option>
              ))}
            </Select>
          </div>
        }
        right={null}
      />

      {error && <p className="text-sm text-(--ui-danger)">{error}</p>}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-(--ui-border) text-left text-xs font-semibold uppercase text-(--ui-text-muted)">
              <th className="px-3 py-2">Product</th>
              <th className="px-3 py-2">Outlet</th>
              <th className="px-3 py-2 text-right">Qty</th>
              <th className="px-3 py-2 text-right">Cost/unit</th>
              <th className="px-3 py-2 text-right">Stock value</th>
              <th className="px-3 py-2 text-right">Age (days)</th>
              <th className="px-3 py-2">Bucket</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-(--ui-text-muted)">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && items.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-(--ui-text-muted)">
                  No aging data for this bucket.
                </td>
              </tr>
            )}
            {!loading &&
              items.map((r) => (
                <tr
                  key={`${r.product_id}:${r.outlet_id}`}
                  className="border-b border-(--ui-border)"
                >
                  <td className="px-3 py-2">{r.name}</td>
                  <td className="px-3 py-2 text-(--ui-text-muted)">{r.outlet_name}</td>
                  <td className="px-3 py-2 text-right">
                    {Number(r.current_stock).toFixed(0)}
                  </td>
                  <td className="px-3 py-2 text-right">{fmt(r.cost_price)}</td>
                  <td className="px-3 py-2 text-right">{fmt(r.stock_value)}</td>
                  <td className="px-3 py-2 text-right">{r.age_days}</td>
                  <td className="px-3 py-2">
                    <Badge tone={BUCKET_TONE[r.age_bucket] || "default"}>{r.age_bucket}</Badge>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({ label, value, tone = "default" }) {
  const color = tone === "danger" ? "text-(--ui-danger)" : "text-(--ui-text)";
  return (
    <div className="rounded-(--ui-radius-md) border border-(--ui-border) bg-(--ui-surface) p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-(--ui-text-muted)">
        {label}
      </div>
      <div className={`mt-1 text-xl font-semibold ${color}`}>{value}</div>
    </div>
  );
}
