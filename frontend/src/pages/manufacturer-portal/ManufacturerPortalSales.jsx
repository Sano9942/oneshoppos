import { useEffect, useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { useMfgPortalAuth } from "./ManufacturerPortalAuthProvider";
import { manufacturerPortalApi } from "../../api/manufacturerPortalApi";

// Tier 1.4 Day 7 — Sales report page.
// Brand x SKU x day x region rollup with filters + CSV export.

function fmtCurrency(n) {
  return "Rs " + Number(n || 0).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

function fmtQty(n) {
  return Number(n || 0).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  });
}

// Default window: last 30 days, computed in the browser's local tz. The
// server treats from/to as YYYY-MM-DD in the tenant's tz, but for a default
// we just need a reasonable pair; the user can override.
function defaultDateRange() {
  const today = new Date();
  const to = today.toISOString().slice(0, 10);
  const past = new Date(today);
  past.setDate(past.getDate() - 29);
  const from = past.toISOString().slice(0, 10);
  return { from, to };
}

function buildColumns(groupBy) {
  if (groupBy === "day") {
    return [
      { key: "day", label: "Day" },
      { key: "brand_name", label: "Brand" },
    ];
  }
  if (groupBy === "sku") {
    return [
      { key: "product_name", label: "Product" },
      { key: "brand_name", label: "Brand" },
    ];
  }
  if (groupBy === "region") {
    return [
      { key: "region", label: "Region" },
      { key: "brand_name", label: "Brand" },
    ];
  }
  return [{ key: "brand_name", label: "Brand" }];
}

export default function ManufacturerPortalSales() {
  const { tenantSlug } = useOutletContext();
  const init = defaultDateRange();
  const [from, setFrom] = useState(init.from);
  const [to, setTo] = useState(init.to);
  const [groupBy, setGroupBy] = useState("day");
  const [brandFilter, setBrandFilter] = useState("");
  const [regionInput, setRegionInput] = useState("");
  const [appliedRegion, setAppliedRegion] = useState("");
  const [brands, setBrands] = useState([]);
  const [rows, setRows] = useState([]);
  const [reportWindow, setReportWindow] = useState(null);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let cancelled = false;
    manufacturerPortalApi
      .get(tenantSlug, "/api/manufacturer-portal/me")
      .then((me) => {
        if (!cancelled) setBrands(me?.brands || []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [tenantSlug]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr(null);
    const query = { from, to, group_by: groupBy };
    if (brandFilter) query.brand_id = brandFilter;
    if (appliedRegion) query.region = appliedRegion;
    manufacturerPortalApi
      .get(tenantSlug, "/api/manufacturer-portal/sales", query)
      .then((res) => {
        if (cancelled) return;
        setRows(res?.rows || []);
        setReportWindow(res?.window || null);
      })
      .catch((e) => {
        if (!cancelled) setErr(e.message || "Couldn't load sales");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tenantSlug, from, to, groupBy, brandFilter, appliedRegion]);

  const totals = useMemo(() => {
    return rows.reduce(
      (acc, r) => {
        acc.qty += Number(r.qty || 0);
        acc.gross += Number(r.gross_revenue || 0);
        return acc;
      },
      { qty: 0, gross: 0 }
    );
  }, [rows]);

  const columns = buildColumns(groupBy);

  async function onDownloadCsv() {
    setErr(null);
    setDownloading(true);
    try {
      const qs = new URLSearchParams();
      qs.set("from", from);
      qs.set("to", to);
      if (brandFilter) qs.set("brand_id", brandFilter);
      const path = `/api/manufacturer-portal/sales.csv?${qs.toString()}`;
      const res = await manufacturerPortalApi.raw(tenantSlug, path);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Download failed (${res.status})`);
      }
      const cd = res.headers.get("content-disposition") || "";
      const match = /filename=([^;]+)/i.exec(cd);
      const filename = match
        ? match[1].replace(/['"]/g, "").trim()
        : `sales_${from}_to_${to}.csv`;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      setErr(e.message || "Download failed");
    } finally {
      setDownloading(false);
    }
  }

  function applyRegion() {
    setAppliedRegion(regionInput.trim());
  }

  function clearFilters() {
    setBrandFilter("");
    setRegionInput("");
    setAppliedRegion("");
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Sales</h1>
        <p className="text-slate-600 mt-1">
          Aggregate sales of your brands through {tenantSlug}. Retailer identity
          is never exposed.
        </p>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg p-4">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          <div>
            <label className="block text-xs text-slate-500 mb-1">From</label>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">To</label>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Group by</label>
            <select
              value={groupBy}
              onChange={(e) => setGroupBy(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded text-sm bg-white"
            >
              <option value="day">Day</option>
              <option value="sku">SKU</option>
              <option value="region">Region</option>
              <option value="brand">Brand</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Brand</label>
            <select
              value={brandFilter}
              onChange={(e) => setBrandFilter(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded text-sm bg-white"
            >
              <option value="">All your brands</option>
              {brands.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Region</label>
            <div className="flex gap-1">
              <input
                type="text"
                value={regionInput}
                onChange={(e) => setRegionInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") applyRegion();
                }}
                placeholder="e.g. Karachi"
                className="flex-1 px-3 py-2 border border-slate-300 rounded text-sm"
              />
              <button
                type="button"
                onClick={applyRegion}
                className="px-3 py-2 border border-slate-300 rounded text-sm hover:bg-slate-50"
              >
                Go
              </button>
            </div>
          </div>
        </div>
        <div className="mt-3 flex items-center justify-between">
          <button
            type="button"
            onClick={clearFilters}
            className="text-xs text-slate-500 hover:text-slate-700"
          >
            Clear filters
          </button>
          <button
            type="button"
            onClick={onDownloadCsv}
            disabled={downloading || loading}
            className="text-sm bg-slate-900 text-white px-4 py-2 rounded hover:bg-slate-700 disabled:opacity-50"
          >
            {downloading ? "Downloading…" : "Download CSV"}
          </button>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg">
        <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
          <div className="text-sm font-medium text-slate-700">
            {loading ? "Loading…" : `${rows.length} row${rows.length === 1 ? "" : "s"}`}
          </div>
          {reportWindow && (
            <div className="text-xs text-slate-500">
              {reportWindow.from} → {reportWindow.to} · {reportWindow.timezone}
            </div>
          )}
        </div>

        {err && (
          <div className="px-4 py-3 text-sm text-red-600 bg-red-50 border-b border-red-200">
            {err}
          </div>
        )}

        {!loading && rows.length === 0 && !err ? (
          <div className="px-4 py-12 text-center text-sm text-slate-500">
            No sales recorded for your brands in this window.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-slate-500 uppercase border-b border-slate-200 bg-slate-50">
                <tr>
                  {columns.map((c) => (
                    <th key={c.key} className="text-left px-4 py-2 font-medium">
                      {c.label}
                    </th>
                  ))}
                  <th className="text-right px-4 py-2 font-medium">Qty</th>
                  <th className="text-right px-4 py-2 font-medium">Gross</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, idx) => (
                  <tr key={idx} className="border-b border-slate-100">
                    {columns.map((c) => (
                      <td key={c.key} className="px-4 py-2">
                        {r[c.key] ?? "—"}
                      </td>
                    ))}
                    <td className="px-4 py-2 text-right font-medium">
                      {fmtQty(r.qty)}
                    </td>
                    <td className="px-4 py-2 text-right font-medium">
                      {fmtCurrency(r.gross_revenue)}
                    </td>
                  </tr>
                ))}
                {rows.length > 0 && (
                  <tr className="bg-slate-50 font-semibold">
                    <td colSpan={columns.length} className="px-4 py-2 text-right text-slate-600">
                      Total
                    </td>
                    <td className="px-4 py-2 text-right">{fmtQty(totals.qty)}</td>
                    <td className="px-4 py-2 text-right">{fmtCurrency(totals.gross)}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
