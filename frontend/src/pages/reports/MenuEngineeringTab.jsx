import React, { useEffect, useState, useCallback, useMemo } from "react";
import {
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ReferenceLine, Legend, ZAxis,
} from "recharts";
import { api } from "../../api";
import { useCurrency } from "../../contexts/CurrencyContext";
import { CardShell, TableShell, ExportButton } from "./ReportShared";
import { downloadCsv } from "../../utils/csvExport";
import { todayLocalStr, daysAgoLocalStr } from "../../utils/dates";

/**
 * Menu engineering (Boston matrix) tab — Phase 2-R Wave C / 2-R.10.
 *
 * Scatter plot of popularity (x) vs avg margin per unit (y), divided into
 * four quadrants by median reference lines. Dots colored by classification.
 * Drives upsell / delist decisions. CSV export preserves the filtered view.
 */

const CLASS_META = {
  star:       { label: "Star",       color: "#10b981", short: "Hi pop + Hi margin" },
  plowhorse:  { label: "Plowhorse",  color: "#f59e0b", short: "Hi pop + Lo margin" },
  puzzle:     { label: "Puzzle",     color: "#3b82f6", short: "Lo pop + Hi margin" },
  dog:        { label: "Dog",        color: "#ef4444", short: "Lo pop + Lo margin" },
};

export default function MenuEngineeringTab() {
  const { fmt } = useCurrency();
  const today = todayLocalStr();
  const monthAgo = daysAgoLocalStr(30);

  const [from, setFrom] = useState(monthAgo);
  const [to, setTo] = useState(today);
  const [outletId, setOutletId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [outlets, setOutlets] = useState([]);
  const [categories, setCategories] = useState([]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sortKey, setSortKey] = useState("popularity");
  const [sortDir, setSortDir] = useState("desc");

  useEffect(() => {
    api.get("/api/outlets").then((res) => {
      setOutlets(Array.isArray(res) ? res : res?.outlets || []);
    }).catch(() => setOutlets([]));
    api.get("/api/categories").then((res) => {
      setCategories(Array.isArray(res) ? res : res?.categories || []);
    }).catch(() => setCategories([]));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ from, to });
      if (outletId) qs.set("outlet_id", outletId);
      if (categoryId) qs.set("category_id", categoryId);
      const res = await api.get(`/api/reports/menu-engineering?${qs.toString()}`);
      setData(res);
    } catch (err) {
      setError(err.message || "Failed to load menu engineering report");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [from, to, outletId, categoryId]);

  useEffect(() => { load(); }, [load]);

  const thresholds = data?.thresholds || { popularity_median: 0, margin_median: 0 };
  const products = data?.products || [];

  const quadrantCounts = useMemo(() => {
    const counts = { star: 0, plowhorse: 0, puzzle: 0, dog: 0 };
    for (const p of products) counts[p.classification] = (counts[p.classification] || 0) + 1;
    return counts;
  }, [products]);

  const sorted = useMemo(() => {
    const copy = [...products];
    copy.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (typeof av === "string") {
        return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      return sortDir === "asc" ? (av || 0) - (bv || 0) : (bv || 0) - (av || 0);
    });
    return copy;
  }, [products, sortKey, sortDir]);

  function toggleSort(key) {
    if (sortKey === key) setSortDir((d) => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("desc"); }
  }

  // Recharts needs one series per color. Split products by classification.
  const seriesByClass = useMemo(() => {
    const result = {};
    for (const key of Object.keys(CLASS_META)) {
      result[key] = products.filter((p) => p.classification === key);
    }
    return result;
  }, [products]);

  function exportCsv() {
    const headers = ["product_id", "name", "category", "classification", "popularity", "revenue", "cogs", "profit", "avg_margin_per_unit"];
    const rows = sorted.map((p) => ({
      product_id: p.product_id,
      name: p.name,
      category: p.category_name || "",
      classification: p.classification,
      popularity: p.popularity,
      revenue: p.revenue,
      cogs: p.cogs,
      profit: p.profit,
      avg_margin_per_unit: p.avg_margin_per_unit,
    }));
    downloadCsv(headers, rows, `menu-engineering-${from}-to-${to}.csv`);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 bg-white border border-slate-200 rounded-lg p-3">
        <div>
          <label className="block text-xs text-slate-500">From</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
            className="border border-slate-300 rounded px-2 py-1 text-sm" />
        </div>
        <div>
          <label className="block text-xs text-slate-500">To</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
            className="border border-slate-300 rounded px-2 py-1 text-sm" />
        </div>
        <div>
          <label className="block text-xs text-slate-500">Outlet</label>
          <select value={outletId} onChange={(e) => setOutletId(e.target.value)}
            className="border border-slate-300 rounded px-2 py-1 text-sm">
            <option value="">All outlets</option>
            {outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </div>
        <div className="grow">
          <label className="block text-xs text-slate-500">Category</label>
          <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}
            className="border border-slate-300 rounded px-2 py-1 text-sm w-60">
            <option value="">All categories</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <ExportButton onClick={exportCsv} />
      </div>

      {error && <div className="p-3 bg-red-50 text-red-700 rounded border border-red-200 text-sm">{error}</div>}
      {loading && <div className="p-3 text-slate-500 text-sm">Loading menu engineering…</div>}

      {!loading && !error && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            {Object.entries(CLASS_META).map(([key, meta]) => (
              <div key={key} className="bg-white border border-slate-200 rounded-lg p-3">
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full inline-block" style={{ background: meta.color }} />
                  <span className="font-semibold">{meta.label}</span>
                </div>
                <div className="text-2xl font-bold mt-1">{quadrantCounts[key] || 0}</div>
                <div className="text-xs text-slate-500">{meta.short}</div>
              </div>
            ))}
          </div>

          <CardShell title="Boston Matrix — popularity vs margin per unit">
            {products.length === 0 ? (
              <div className="p-4 text-slate-500 text-sm">No sales in this date range.</div>
            ) : (
              <div style={{ width: "100%", height: 360 }}>
                <ResponsiveContainer>
                  <ScatterChart margin={{ top: 20, right: 20, bottom: 40, left: 40 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis type="number" dataKey="popularity" name="Popularity (units sold)">
                      <label value="Popularity" position="insideBottom" offset={-5} />
                    </XAxis>
                    <YAxis type="number" dataKey="avg_margin_per_unit" name="Avg margin / unit" />
                    <ZAxis type="number" range={[80, 80]} />
                    <Tooltip
                      cursor={{ strokeDasharray: "3 3" }}
                      content={({ active, payload }) => {
                        if (!active || !payload?.length) return null;
                        const p = payload[0].payload;
                        return (
                          <div className="bg-white border border-slate-200 rounded p-2 text-xs shadow">
                            <div className="font-semibold">{p.name}</div>
                            <div>Popularity: {p.popularity}</div>
                            <div>Avg margin: {fmt(p.avg_margin_per_unit)}</div>
                            <div>Profit: {fmt(p.profit)}</div>
                            <div>Classification: {p.classification}</div>
                          </div>
                        );
                      }}
                    />
                    <ReferenceLine
                      x={thresholds.popularity_median}
                      stroke="#94a3b8"
                      strokeDasharray="4 4"
                      label={{ value: `median pop ${Math.round(thresholds.popularity_median)}`, position: "top", fontSize: 10 }}
                    />
                    <ReferenceLine
                      y={thresholds.margin_median}
                      stroke="#94a3b8"
                      strokeDasharray="4 4"
                      label={{ value: `median margin ${Math.round(thresholds.margin_median)}`, position: "right", fontSize: 10 }}
                    />
                    <Legend />
                    {Object.entries(CLASS_META).map(([key, meta]) => (
                      <Scatter key={key} name={meta.label} data={seriesByClass[key]} fill={meta.color} />
                    ))}
                  </ScatterChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardShell>

          <CardShell title="Product performance">
            <TableShell
              cols={["Name", "Category", "Popularity", "Profit", "Avg margin / unit", "Classification"]}
              loading={false}
              empty={sorted.length === 0}
            >
              {sorted.map((p) => (
                <tr key={p.product_id} className="border-b">
                  <td className="py-2">
                    <button
                      className="text-blue-600 hover:underline"
                      onClick={() => toggleSort("name")}
                    >
                      {p.name}
                    </button>
                  </td>
                  <td>{p.category_name || "—"}</td>
                  <td>{p.popularity}</td>
                  <td>{fmt(p.profit)}</td>
                  <td>{fmt(p.avg_margin_per_unit)}</td>
                  <td>
                    <span
                      className="inline-block px-2 py-0.5 rounded text-xs text-white"
                      style={{ background: CLASS_META[p.classification]?.color || "#64748b" }}
                    >
                      {CLASS_META[p.classification]?.label || p.classification}
                    </span>
                  </td>
                </tr>
              ))}
            </TableShell>
          </CardShell>
        </>
      )}
    </div>
  );
}
