import { useEffect, useState } from "react";
import { api } from "../../../api";
import { Button, Input, Select, TableToolbar } from "../../../ui/primitives";
import { downloadCsv } from "../../../utils/csvExport";
import RankChip from "./RankChip";

const PAGE_SIZE = 50;

function pct(n) {
  if (n == null) return "—";
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(1)}%`;
}

function numOrDash(n, digits = 0) {
  if (n == null) return "—";
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  return v.toFixed(digits);
}

export default function ABCTab() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [rank, setRank] = useState("");
  const [search, setSearch] = useState("");
  const [deadOnly, setDeadOnly] = useState(false);
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams();
    if (rank) params.set("rank", rank);
    if (deadOnly) params.set("dead_stock_only", "true");
    if (search) params.set("search", search);
    params.set("limit", String(PAGE_SIZE));
    params.set("offset", String(offset));
    api
      .get(`/api/inventory-intelligence/abc?${params.toString()}`)
      .then((res) => {
        if (!cancelled) {
          setItems(res.items || []);
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
  }, [rank, deadOnly, search, offset]);

  const exportCsv = () => {
    const headers = [
      "Product",
      "SKU",
      "Rank",
      "Revenue %",
      "Units sold",
      "Sell-through",
      "GMROI",
      "Days since last sale",
    ];
    const rows = items.map((r) => [
      r.name,
      r.sku || "",
      r.rank || "",
      pct(r.revenue_contribution_pct),
      numOrDash(r.units_sold, 0),
      pct(r.sell_through_rate),
      numOrDash(r.gmroi, 2),
      numOrDash(r.days_since_last_sale, 0),
    ]);
    downloadCsv(headers, rows, "abc-analysis");
  };

  return (
    <div className="space-y-4">
      <TableToolbar
        left={
          <div className="flex flex-wrap items-center gap-2">
            <Input
              placeholder="Search by product name"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setOffset(0);
              }}
              className="w-64"
            />
            <Select
              value={rank}
              onChange={(e) => {
                setRank(e.target.value);
                setOffset(0);
              }}
            >
              <option value="">All ranks</option>
              <option value="A">A</option>
              <option value="B">B</option>
              <option value="C">C</option>
            </Select>
            <label className="flex items-center gap-2 text-sm text-(--ui-text)">
              <input
                type="checkbox"
                checked={deadOnly}
                onChange={(e) => {
                  setDeadOnly(e.target.checked);
                  setOffset(0);
                }}
                aria-label="Dead stock only"
              />
              Dead stock only
            </label>
          </div>
        }
        right={
          <Button tone="plain" size="sm" onClick={exportCsv} disabled={!items.length}>
            Export CSV
          </Button>
        }
      />

      {error && <p className="text-sm text-(--ui-danger)">{error}</p>}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-(--ui-border) text-left text-xs font-semibold uppercase text-(--ui-text-muted)">
              <th className="px-3 py-2">Product</th>
              <th className="px-3 py-2">SKU</th>
              <th className="px-3 py-2">Rank</th>
              <th className="px-3 py-2 text-right">Revenue %</th>
              <th className="px-3 py-2 text-right">Units sold</th>
              <th className="px-3 py-2 text-right">Sell-through</th>
              <th className="px-3 py-2 text-right">GMROI</th>
              <th className="px-3 py-2 text-right">Days since sale</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-(--ui-text-muted)">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && items.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-(--ui-text-muted)">
                  No data yet — the nightly worker runs at 02:00 UTC.
                </td>
              </tr>
            )}
            {!loading &&
              items.map((r) => (
                <tr key={r.product_id} className="border-b border-(--ui-border)">
                  <td className="px-3 py-2">{r.name}</td>
                  <td className="px-3 py-2 text-(--ui-text-muted)">{r.sku || ""}</td>
                  <td className="px-3 py-2">
                    <RankChip rank={r.rank} />
                  </td>
                  <td className="px-3 py-2 text-right">{pct(r.revenue_contribution_pct)}</td>
                  <td className="px-3 py-2 text-right">{numOrDash(r.units_sold, 0)}</td>
                  <td className="px-3 py-2 text-right">{pct(r.sell_through_rate)}</td>
                  <td className="px-3 py-2 text-right">{numOrDash(r.gmroi, 2)}</td>
                  <td className="px-3 py-2 text-right">{numOrDash(r.days_since_last_sale, 0)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm text-(--ui-text-muted)">
        <span>
          Showing {items.length ? offset + 1 : 0}–{offset + items.length}
        </span>
        <div className="flex gap-2">
          <Button
            tone="plain"
            size="sm"
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            disabled={offset === 0}
          >
            Previous
          </Button>
          <Button
            tone="plain"
            size="sm"
            onClick={() => setOffset(offset + PAGE_SIZE)}
            disabled={items.length < PAGE_SIZE}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}
