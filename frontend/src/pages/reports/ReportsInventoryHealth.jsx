import React, { useState, useEffect, useCallback } from "react";
import { PackageX, AlertTriangle } from "lucide-react";
import { api } from "../../api";
import {
  fmtDate,
  exportCSV,
  ExportButton,
  TableShell,
  CardShell,
} from "./ReportShared";
import { useCurrency } from "../../contexts/CurrencyContext";

function InventoryHealthStat({ label, value, hint }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p className="mt-2 text-2xl font-bold text-slate-900">{value}</p>
      {hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}

// --- Tab: Pricing & Margin Matrix ---------------------------------------------
export function PricingMarginTab({ filters }) {
  const { fmt } = useCurrency();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [aggregate, setAggregate] = useState(false);
  const [anomaly, setAnomaly] = useState("margin_risk");
  const [marginThreshold, setMarginThreshold] = useState(15);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({
        category_id: filters.categoryId,
        brand_id: filters.brandId,
        supplier_id: filters.supplierId,
        search: filters.search,
        aggregate: aggregate ? "1" : "0",
        anomaly,
        margin_threshold: String(marginThreshold),
      });
      if (filters.outletIds && filters.outletIds.length) p.set("outlet_id", filters.outletIds.join(","));
      const d = await api.get(`/api/reports/pricing-exceptions?${p}`);
      setRows(d.items || []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [
    filters.outletIds,
    filters.categoryId,
    filters.brandId,
    filters.supplierId,
    filters.search,
    aggregate,
    anomaly,
    marginThreshold,
  ]);

  useEffect(() => {
    load();
  }, [load]);

  const costOverSaleCount = rows.filter(
    (row) => Number(row.cost_price || 0) >= Number(row.price || 0),
  ).length;
  const zeroPriceCount = rows.filter((row) => Number(row.price || 0) <= 0).length;
  const zeroCostCount = rows.filter((row) => Number(row.cost_price || 0) <= 0).length;
  const marginRiskCount = rows.filter(
    (row) =>
      Number(row.cost_price || 0) >= Number(row.price || 0) ||
      Number(row.margin_pct || 0) < marginThreshold,
  ).length;
  const presets = [
    { value: "margin_risk", label: "Margin Risk" },
    { value: "cost_over_sale", label: "Cost >= Sale" },
    { value: "zero_sale_price", label: "Zero Sale" },
    { value: "zero_cost", label: "Zero Cost" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex rounded-xl bg-slate-100 p-1">
          <button
            type="button"
            onClick={() => setAggregate(false)}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${!aggregate ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`}
          >
            Outlet Detail
          </button>
          <button
            type="button"
            onClick={() => setAggregate(true)}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${aggregate ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`}
          >
            All Outlets
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          {presets.map((preset) => (
            <button
              key={preset.value}
              type="button"
              onClick={() => setAnomaly(preset.value)}
              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                anomaly === preset.value
                  ? "bg-blue-600 text-white"
                  : "bg-slate-100 text-slate-600"
              }`}
            >
              {preset.label}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-1.5">
          <span className="text-xs font-semibold text-slate-500">Margin %</span>
          <input
            type="number"
            min="0"
            max="100"
            value={marginThreshold}
            onChange={(e) => setMarginThreshold(Number(e.target.value || 0))}
            className="w-16 border-none bg-transparent p-0 text-sm font-semibold focus:ring-0"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            {"Cost >= Sale"}
          </p>
          <p className="mt-2 text-2xl font-bold text-slate-900">
            {costOverSaleCount}
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Zero Sale Price
          </p>
          <p className="mt-2 text-2xl font-bold text-slate-900">
            {zeroPriceCount}
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Zero Cost
          </p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{zeroCostCount}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Margin Risk
          </p>
          <p className="mt-2 text-2xl font-bold text-slate-900">
            {marginRiskCount}
          </p>
        </div>
      </div>

      <CardShell
        title="Pricing Exceptions"
        subtitle="Price, cost, and margin-risk exceptions with outlet-detail and aggregated views"
        action={
          <ExportButton
            onClick={() =>
              exportCSV(
                "pricing_exceptions.csv",
                [
                  { header: "Product", key: "product_name" },
                  { header: "Barcode", key: "barcode" },
                  { header: "Outlet", key: "outlet_name" },
                  { header: "Category", key: "category" },
                  { header: "Brand", key: "brand" },
                  { header: "Supplier", key: "supplier" },
                  { header: "Quantity", key: "quantity" },
                  { header: "Sale Price", key: "price" },
                  { header: "Cost Price", key: "cost_price" },
                  { header: "Margin %", key: "margin_pct" },
                ],
        rows,
              )
            }
          />
        }
      >
        <TableShell
          cols={["Product", "Outlet / Tags", "Qty", "Sell vs Cost", "Margin %"]}
          loading={loading}
          empty={!rows.length}
        >
          {rows.map((r, i) => (
            <tr key={`${r.product_id}-${r.outlet_name}-${i}`} className="hover:bg-slate-50">
              <td className="px-4 py-3">
                <div className="text-sm font-bold text-slate-800">{r.product_name}</div>
                <div className="font-mono text-[11px] text-slate-400">{r.barcode}</div>
              </td>
              <td className="px-4 py-3">
                <div className="text-sm font-bold text-slate-900">{r.outlet_name}</div>
                <div className="text-[11px] text-slate-400">{r.category}</div>
                <div className="text-[11px] text-slate-400">{r.brand} • {r.supplier}</div>
              </td>
              <td className="px-4 py-3 text-sm font-semibold text-slate-700">
                {r.quantity}
              </td>
              <td className="px-4 py-3 text-sm">
                <div className="text-slate-700">Sell: {fmt(r.price)}</div>
                <div className="text-[11px] text-slate-400">Cost: {fmt(r.cost_price)}</div>
              </td>
              <td className="px-4 py-3">
                <div className={`text-sm font-bold ${
                  Number(r.margin_pct || 0) < marginThreshold || Number(r.cost_price || 0) >= Number(r.price || 0)
                    ? "text-rose-700"
                    : "text-emerald-700"
                }`}>
                  {r.margin_pct}%
                </div>
              </td>
            </tr>
          ))}
        </TableShell>
      </CardShell>
    </div>
  );
}

// --- Tab: Dead Stock ---------------------------------------------------------
export function DeadStockTab({ filters }) {
  const { fmt } = useCurrency();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [inactiveDays, setInactiveDays] = useState(60);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({
        category_id: filters.categoryId,
        brand_id: filters.brandId,
        supplier_id: filters.supplierId,
        search: filters.search,
        inactive_days: String(inactiveDays),
      });
      if (filters.outletIds && filters.outletIds.length) p.set("outlet_id", filters.outletIds.join(","));
      const d = await api.get(`/api/reports/dead-stock?${p}`);
      setRows(d.items || d.rows || []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [
    filters.outletIds,
    filters.categoryId,
    filters.brandId,
    filters.supplierId,
    filters.search,
    inactiveDays,
  ]);

  useEffect(() => {
    load();
  }, [load]);

  const totalCost = rows.reduce((sum, row) => sum + Number(row.stock_cost_value || 0), 0);
  const totalRetail = rows.reduce((sum, row) => sum + Number(row.stock_retail_value || 0), 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-1.5">
          <span className="text-xs font-semibold text-slate-500">Inactive Days</span>
          <input
            type="number"
            min="1"
            max="3650"
            value={inactiveDays}
            onChange={(e) => setInactiveDays(Number(e.target.value || 1))}
            className="w-20 border-none bg-transparent p-0 text-sm font-semibold focus:ring-0"
          />
        </div>
        <div className="rounded-xl bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700">
          Dead stock is outlet-based. No rack/bin location exists in the current schema.
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <InventoryHealthStat label="Dead Stock Rows" value={rows.length} />
        <InventoryHealthStat label="Cost Value" value={fmt(totalCost)} />
        <InventoryHealthStat label="Retail Value" value={fmt(totalRetail)} />
      </div>

      <CardShell
        title="Dead Stock"
        subtitle="Items with stock on hand and no recent sale activity for the chosen inactivity window"
        action={
          <ExportButton
            onClick={() =>
              exportCSV(
                "dead_stock.csv",
                [
                  { header: "Product", key: "product_name" },
                  { header: "Barcode", key: "barcode" },
                  { header: "Outlet", key: "outlet_name" },
                  { header: "Category", key: "category" },
                  { header: "Brand", key: "brand" },
                  { header: "Supplier", key: "supplier" },
                  { header: "Stock Qty", key: "stock_qty" },
                  { header: "Cost Value", key: "stock_cost_value" },
                  { header: "Retail Value", key: "stock_retail_value" },
                  { header: "Last Sold", key: "last_sold_at" },
                  { header: "Days Since Sale", key: "days_since_sale" },
                ],
        rows,
              )
            }
          />
        }
      >
        <TableShell
          cols={["Product", "Outlet / Tags", "Stock", "Last Sold", "Days Idle", "Value"]}
          loading={loading}
          empty={!rows.length}
          emptyIcon={PackageX}
        >
          {rows.map((row, i) => (
            <tr key={`${row.product_id}-${row.outlet_id}-${i}`} className="hover:bg-slate-50">
              <td className="px-4 py-3">
                <div className="text-sm font-semibold text-slate-800">{row.product_name}</div>
                <div className="font-mono text-[11px] text-slate-400">{row.barcode}</div>
              </td>
              <td className="px-4 py-3">
                <div className="text-sm font-semibold text-slate-900">{row.outlet_name}</div>
                <div className="text-[11px] text-slate-400">{row.category}</div>
                <div className="text-[11px] text-slate-400">{row.brand} | {row.supplier}</div>
              </td>
              <td className="px-4 py-3 text-sm font-bold text-slate-900">{row.stock_qty}</td>
              <td className="px-4 py-3 text-sm text-slate-600">
                {row.last_sold_at ? fmtDate(row.last_sold_at) : "Never sold"}
              </td>
              <td className="px-4 py-3">
                <span className="rounded-full bg-amber-50 px-2 py-1 text-xs font-bold text-amber-700">
                  {row.days_since_sale ?? "N/A"}
                </span>
              </td>
              <td className="px-4 py-3 text-sm">
                <div className="font-semibold text-slate-800">{fmt(row.stock_cost_value)}</div>
                <div className="text-[11px] text-slate-400">{fmt(row.stock_retail_value)} retail</div>
              </td>
            </tr>
          ))}
        </TableShell>
      </CardShell>
    </div>
  );
}

// --- Tab: Stock Aging --------------------------------------------------------

const BUCKET_CONFIG = [
  { key: "fresh", label: "Fresh", sub: "0–30 days", bg: "bg-emerald-50", border: "border-emerald-200", text: "text-emerald-700", ring: "ring-emerald-400" },
  { key: "aging", label: "Aging", sub: "31–60 days", bg: "bg-amber-50", border: "border-amber-200", text: "text-amber-700", ring: "ring-amber-400" },
  { key: "old", label: "Old", sub: "61–90 days", bg: "bg-orange-50", border: "border-orange-200", text: "text-orange-700", ring: "ring-orange-400" },
  { key: "critical", label: "Critical", sub: "90+ days", bg: "bg-rose-50", border: "border-rose-200", text: "text-rose-700", ring: "ring-rose-400" },
];

export function StockAgingTab({ filters }) {
  const { fmt } = useCurrency();
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState({});
  const [loading, setLoading] = useState(true);
  const [activeBucket, setActiveBucket] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams();
      if (filters.categoryId) p.set("category_id", filters.categoryId);
      if (filters.brandId) p.set("brand_id", filters.brandId);
      if (filters.supplierId) p.set("supplier_id", filters.supplierId);
      if (filters.search) p.set("search", filters.search);
      if (filters.outletIds && filters.outletIds.length) p.set("outlet_id", filters.outletIds.join(","));
      if (activeBucket) p.set("bucket", activeBucket);
      const d = await api.get(`/api/reports/stock-aging?${p}`);
      setRows(d.items || []);
      if (d.summary) setSummary(d.summary);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [
    filters.outletIds,
    filters.categoryId,
    filters.brandId,
    filters.supplierId,
    filters.search,
    activeBucket,
  ]);

  useEffect(() => {
    load();
  }, [load]);

  const handleBucketClick = (key) => {
    setActiveBucket((prev) => (prev === key ? null : key));
  };

  return (
    <div className="space-y-4">
      {/* Bucket summary cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {BUCKET_CONFIG.map((b) => {
          const s = summary[b.key] || { count: 0, value: 0 };
          const isActive = activeBucket === b.key;
          return (
            <button
              key={b.key}
              type="button"
              onClick={() => handleBucketClick(b.key)}
              className={`rounded-2xl border p-4 text-left shadow-sm transition-all ${b.bg} ${b.border} ${isActive ? `ring-2 ${b.ring}` : ""}`}
            >
              <p className={`text-xs font-semibold uppercase tracking-wide ${b.text}`}>
                {b.label}
              </p>
              <p className="text-[10px] text-slate-500">{b.sub}</p>
              <p className={`mt-2 text-2xl font-bold ${b.text}`}>{s.count}</p>
              <p className="mt-0.5 text-xs font-medium text-slate-600">{fmt(s.value)}</p>
            </button>
          );
        })}
      </div>

      {activeBucket && (
        <div className="flex items-center gap-2 rounded-xl bg-slate-100 px-3 py-2 text-xs font-medium text-slate-600">
          Showing only <span className="font-bold">{BUCKET_CONFIG.find((b) => b.key === activeBucket)?.label}</span> items
          <button type="button" onClick={() => setActiveBucket(null)} className="ml-auto text-slate-400 hover:text-slate-700">✕ Clear</button>
        </div>
      )}

      <CardShell
        title="Stock Aging Analysis"
        subtitle="Age calculated from most recent GRN received date — identifies inventory sitting too long before it becomes dead stock"
        action={
          <ExportButton
            onClick={() =>
              exportCSV(
                "stock_aging.csv",
                [
                  { header: "Product", key: "name" },
                  { header: "SKU", key: "sku" },
                  { header: "Barcode", key: "barcode" },
                  { header: "Outlet", key: "outlet_name" },
                  { header: "Category", key: "category" },
                  { header: "Brand", key: "brand" },
                  { header: "Supplier", key: "supplier" },
                  { header: "Stock", key: "current_stock" },
                  { header: "Cost Price", key: "cost_price" },
                  { header: "Stock Value", key: "stock_value" },
                  { header: "Age Days", key: "age_days" },
                  { header: "Bucket", key: "age_bucket" },
                ],
                rows,
              )
            }
          />
        }
      >
        <TableShell
          cols={["Product", "Outlet / Tags", "Stock", "Cost", "Stock Value", "Age", "Bucket"]}
          loading={loading}
          empty={!rows.length}
          emptyIcon={AlertTriangle}
        >
          {rows.map((row, i) => {
            const days = Number(row.age_days) || 0;
            const isCritical = row.age_bucket === "critical";
            const bucketCfg = BUCKET_CONFIG.find((b) => b.key === row.age_bucket) || BUCKET_CONFIG[0];
            return (
              <tr
                key={`${row.product_id}-${row.outlet_id}-${i}`}
                className={isCritical ? "bg-rose-50/50 hover:bg-rose-50" : "hover:bg-slate-50"}
              >
                <td className="px-4 py-3">
                  <div className="text-sm font-semibold text-slate-800">{row.name}</div>
                  <div className="font-mono text-[11px] text-slate-400">
                    {row.sku || row.barcode || "—"}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="text-sm font-semibold text-slate-900">{row.outlet_name}</div>
                  <div className="text-[11px] text-slate-400">{row.category}</div>
                  <div className="text-[11px] text-slate-400">{row.brand}{row.supplier ? ` | ${row.supplier}` : ""}</div>
                </td>
                <td className="px-4 py-3 text-sm font-bold text-slate-900">{row.current_stock}</td>
                <td className="px-4 py-3 text-sm text-slate-600">{fmt(row.cost_price)}</td>
                <td className="px-4 py-3 text-sm font-semibold text-slate-800">{fmt(row.stock_value)}</td>
                <td className="px-4 py-3 text-sm font-bold text-slate-700">{days}d</td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-1 text-xs font-bold ${bucketCfg.bg} ${bucketCfg.text}`}>
                    {bucketCfg.label}
                  </span>
                </td>
              </tr>
            );
          })}
        </TableShell>
      </CardShell>
    </div>
  );
}

// --- Tab: Shrinkage / Stock Discrepancy ----------------------------------------
export function ShrinkageTab({ filters }) {
  const { fmt } = useCurrency();
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams();
      // Default to last 30 days if no date range set
      const today = new Date();
      const thirtyAgo = new Date(today);
      thirtyAgo.setDate(thirtyAgo.getDate() - 30);
      p.set("date_from", filters.dateFrom || thirtyAgo.toISOString().slice(0, 10));
      p.set("date_to", filters.dateTo || today.toISOString().slice(0, 10));
      if (filters.outletIds && filters.outletIds.length) p.set("outlet_id", filters.outletIds.join(","));
      if (filters.categoryId) p.set("category_id", filters.categoryId);
      if (filters.search) p.set("search", filters.search);
      const d = await api.get(`/api/reports/shrinkage?${p}`);
      setRows(d.rows || []);
      setSummary(d.summary || {});
    } catch {
      setRows([]);
      setSummary({});
    } finally {
      setLoading(false);
    }
  }, [filters.dateFrom, filters.dateTo, filters.outletIds, filters.categoryId, filters.search]);

  useEffect(() => {
    load();
  }, [load]);

  const totalVarianceValue = rows.reduce((sum, r) => sum + Number(r.variance_value || 0), 0);
  const shrinkageRows = rows.filter((r) => Number(r.variance || 0) < 0);
  const surplusRows = rows.filter((r) => Number(r.variance || 0) > 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <InventoryHealthStat label="Products Tracked" value={summary.total_products || rows.length} />
        <InventoryHealthStat label="Rows with Variance" value={summary.rows_with_variance || 0} />
        <InventoryHealthStat label="Shrinkage Units" value={summary.total_shrinkage_units || 0} />
        <InventoryHealthStat
          label="Net Variance Value"
          value={fmt(totalVarianceValue)}
          hint={totalVarianceValue < 0 ? "Net loss" : totalVarianceValue > 0 ? "Net surplus" : "Balanced"}
        />
      </div>

      <CardShell
        title="Stock Discrepancy / Shrinkage"
        subtitle="Compares expected vs actual stock per product per outlet — all tracked movements in the date range"
        action={
          <ExportButton
            onClick={() =>
              exportCSV(
                "shrinkage_report.csv",
                [
                  { header: "Product", key: "product_name" },
                  { header: "Barcode", key: "barcode" },
                  { header: "SKU", key: "sku" },
                  { header: "Outlet", key: "outlet_name" },
                  { header: "Opening", key: "opening" },
                  { header: "Purchases", key: "purchases" },
                  { header: "Sales", key: "sales" },
                  { header: "Returns", key: "returns" },
                  { header: "Transfers In", key: "transfers_in" },
                  { header: "Transfers Out", key: "transfers_out" },
                  { header: "Adjustments", key: "adjustments" },
                  { header: "Expected", key: "expected" },
                  { header: "Actual", key: "actual" },
                  { header: "Variance", key: "variance" },
                  { header: "Variance Value", key: "variance_value" },
                ],
                rows,
              )
            }
          />
        }
      >
        <TableShell
          cols={[
            "Product",
            "Outlet",
            "Opening",
            "Purchases",
            "Sales",
            "Returns",
            "Tfr In",
            "Tfr Out",
            "Adj",
            "Expected",
            "Actual",
            "Variance",
            "Var Value",
          ]}
          loading={loading}
          empty={!rows.length}
          emptyIcon={AlertTriangle}
        >
          {rows.map((row, i) => {
            const v = Number(row.variance || 0);
            const vv = Number(row.variance_value || 0);
            const vColor = v < 0 ? "text-red-600 font-bold" : v > 0 ? "text-emerald-600 font-bold" : "text-slate-500";
            return (
              <tr key={`${row.product_id}-${row.outlet_id}-${i}`} className="hover:bg-slate-50">
                <td className="px-4 py-3">
                  <div className="text-sm font-semibold text-slate-800">{row.product_name}</div>
                  <div className="font-mono text-[11px] text-slate-400">{row.barcode || row.sku || "-"}</div>
                </td>
                <td className="px-4 py-3 text-sm text-slate-700">{row.outlet_name}</td>
                <td className="px-4 py-3 text-sm text-slate-700 text-right">{row.opening}</td>
                <td className="px-4 py-3 text-sm text-slate-700 text-right">{row.purchases}</td>
                <td className="px-4 py-3 text-sm text-slate-700 text-right">{row.sales}</td>
                <td className="px-4 py-3 text-sm text-slate-700 text-right">{row.returns}</td>
                <td className="px-4 py-3 text-sm text-slate-700 text-right">{row.transfers_in}</td>
                <td className="px-4 py-3 text-sm text-slate-700 text-right">{row.transfers_out}</td>
                <td className="px-4 py-3 text-sm text-slate-700 text-right">{row.adjustments}</td>
                <td className="px-4 py-3 text-sm font-semibold text-slate-800 text-right">{row.expected}</td>
                <td className="px-4 py-3 text-sm font-semibold text-slate-800 text-right">{row.actual}</td>
                <td className={`px-4 py-3 text-sm text-right ${vColor}`}>{v > 0 ? `+${v}` : v}</td>
                <td className={`px-4 py-3 text-sm text-right ${vColor}`}>{fmt(vv)}</td>
              </tr>
            );
          })}
          {rows.length > 0 && (
            <tr className="border-t-2 border-slate-300 bg-slate-50 font-bold">
              <td className="px-4 py-3 text-sm text-slate-900" colSpan={11}>Total</td>
              <td className={`px-4 py-3 text-sm text-right ${totalVarianceValue < 0 ? "text-red-600" : totalVarianceValue > 0 ? "text-emerald-600" : "text-slate-500"}`}>
                {rows.reduce((s, r) => s + Number(r.variance || 0), 0)}
              </td>
              <td className={`px-4 py-3 text-sm text-right ${totalVarianceValue < 0 ? "text-red-600" : totalVarianceValue > 0 ? "text-emerald-600" : "text-slate-500"}`}>
                {fmt(totalVarianceValue)}
              </td>
            </tr>
          )}
        </TableShell>
      </CardShell>
    </div>
  );
}
