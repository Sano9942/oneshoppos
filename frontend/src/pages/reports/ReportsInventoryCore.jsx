import React, { useState, useEffect, useCallback } from "react";
import { api } from "../../api";
import {
  fmtDate,
  exportCSV,
  ExportButton,
  TableShell,
  CardShell,
} from "./ReportShared";
import { useCurrency } from "../../contexts/CurrencyContext";
import { FilterPill } from "../../ui/primitives";

// --- Tab: Sales & Stock -------------------------------------------------------
export function SalesStockTab({ filters }) {
  const { fmt } = useCurrency();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({

        date_from: filters.dateFrom,
        date_to: filters.dateTo,
        time_from: filters.timeFrom,
        time_to: filters.timeTo,
      });
      if (filters.outletIds && filters.outletIds.length) p.set("outlet_id", filters.outletIds.join(","));
      const d = await api.get(`/api/reports/sales-stock?${p}`);
      setRows(d.items || []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [filters.dateFrom, filters.dateTo, filters.timeFrom, filters.timeTo, filters.outletIds]);

  useEffect(() => {
    load();
  }, [load]);

  const totalUnits = rows.reduce((sum, row) => sum + Number(row.units_sold || 0), 0);
  const totalStock = rows.reduce((sum, row) => sum + Number(row.total_stock || 0), 0);
  const totalRevenue = rows.reduce((sum, row) => sum + Number(row.revenue || 0), 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="rounded-2xl border border-(--ui-border) bg-(--ui-surface) p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">Units Sold</p>
          <p className="mt-2 text-2xl font-bold text-(--ui-text)">{totalUnits}</p>
        </div>
        <div className="rounded-2xl border border-(--ui-border) bg-(--ui-surface) p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">Current Stock</p>
          <p className="mt-2 text-2xl font-bold text-(--ui-text)">{totalStock}</p>
        </div>
        <div className="rounded-2xl border border-(--ui-border) bg-(--ui-surface) p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">Revenue</p>
          <p className="mt-2 text-2xl font-bold text-(--ui-text)">{fmt(totalRevenue)}</p>
        </div>
      </div>

      <CardShell
        title="Sales & Stock Alignment"
        subtitle="Correlation between sales velocity and current shelf availability"
        action={
          <ExportButton
            onClick={() =>
              exportCSV(
                "sales_stock.csv",
                [
                  { header: "Product", key: "name" },
                  { header: "Barcode", key: "barcode" },
                  { header: "Category", key: "category" },
                  { header: "Units Sold", key: "units_sold" },
                  { header: "Current Stock", key: "total_stock" },
                  { header: "Revenue", key: "revenue" },
                ],
        rows,
              )
            }
          />
        }
      >
        <TableShell
          cols={["Product", "Category", "Units Sold", "Current Stock", "Revenue"]}
          loading={loading}
          empty={!rows.length}
        >
          {rows.map((r, i) => (
            <tr key={i} className="hover:bg-(--ui-muted-surface)">
              <td className="p-4">
                <div className="text-sm font-bold text-(--ui-text)">{r.name}</div>
                <div className="text-[10px] text-(--ui-text-muted) font-mono italic">{r.barcode}</div>
              </td>
              <td className="p-4 text-sm text-(--ui-text-muted)">{r.category}</td>
              <td className="p-4 text-sm font-bold text-(--ui-text)">{r.units_sold}</td>
              <td className="p-4">
                <div
                  className={`text-sm font-bold ${Number(r.total_stock || 0) <= 5 ? "text-(--ui-danger-fg)" : "text-(--ui-text)"}`}
                >
                  {r.total_stock}
                </div>
              </td>
              <td className="p-4 text-sm font-semibold text-(--ui-success-fg)">{fmt(r.revenue)}</td>
            </tr>
          ))}
        </TableShell>
      </CardShell>
    </div>
  );
}

// --- Tab: Inventory Dump ------------------------------------------------------
export function InventoryDumpTab({ filters }) {
  const { fmt } = useCurrency();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [aggregate, setAggregate] = useState(false);
  const [anomaly, setAnomaly] = useState("");
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
      const d = await api.get(`/api/reports/inventory-dump?${p}`);
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

  const totalCostValue = rows.reduce(
    (sum, row) => sum + Number(row.cost_value || 0),
    0,
  );
  const totalRetailValue = rows.reduce(
    (sum, row) => sum + Number(row.retail_value || 0),
    0,
  );
  const lowStockRows = rows.filter((row) => Number(row.quantity || 0) <= 5).length;
  const anomalyPresets = [
    { value: "", label: "All Rows" },
    { value: "low_stock", label: "Low Stock" },
    { value: "zero_stock", label: "Zero Stock" },
    { value: "negative_stock", label: "Negative Stock" },
    { value: "zero_sale_price", label: "Zero Sale" },
    { value: "zero_cost", label: "Zero Cost" },
    { value: "cost_over_sale", label: "Cost >= Sale" },
    { value: "margin_risk", label: "Margin Risk" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-(--ui-border) bg-(--ui-surface) p-3">
        <div className="flex rounded-xl bg-(--ui-muted-surface) p-1">
          <button
            type="button"
            onClick={() => setAggregate(false)}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${!aggregate ? "bg-(--ui-surface) text-(--ui-text)" : "text-(--ui-text-muted)"}`}
          >
            Outlet Detail
          </button>
          <button
            type="button"
            onClick={() => setAggregate(true)}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${aggregate ? "bg-(--ui-surface) text-(--ui-text)" : "text-(--ui-text-muted)"}`}
          >
            All Outlets
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          {anomalyPresets.map((preset) => (
            <button
              key={preset.value || "all"}
              type="button"
              onClick={() => setAnomaly(preset.value)}
              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                anomaly === preset.value
                  ? "bg-(--ui-primary) text-(--ui-on-primary)"
                  : "bg-(--ui-muted-surface) text-(--ui-text-muted)"
              }`}
            >
              {preset.label}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2 rounded-xl border border-(--ui-border) px-3 py-1.5">
          <span className="text-xs font-semibold text-(--ui-text-muted)">Margin %</span>
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

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="rounded-2xl border border-(--ui-border) bg-(--ui-surface) p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">
            Cost Value
          </p>
          <p className="mt-2 text-2xl font-bold text-(--ui-text)">
            {fmt(totalCostValue)}
          </p>
        </div>
        <div className="rounded-2xl border border-(--ui-border) bg-(--ui-surface) p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">
            Retail Value
          </p>
          <p className="mt-2 text-2xl font-bold text-(--ui-text)">
            {fmt(totalRetailValue)}
          </p>
        </div>
        <div className="rounded-2xl border border-(--ui-border) bg-(--ui-surface) p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">
            Low Stock Rows
          </p>
          <p className="mt-2 text-2xl font-bold text-(--ui-text)">{lowStockRows}</p>
        </div>
      </div>

      <CardShell
        title="Master Inventory Audit"
        subtitle={aggregate ? "Aggregated stock positions across all outlets" : "Outlet-level stock positions with retail and cost valuation"}
        action={
          <ExportButton
            onClick={() =>
              exportCSV(
                "inventory_dump.csv",
                [
                  { header: "Outlet", key: "outlet_name" },
                  { header: "Product", key: "product_name" },
                  { header: "Barcode", key: "barcode" },
                  { header: "Category", key: "category" },
                  { header: "Brand", key: "brand" },
                  { header: "Quantity", key: "quantity" },
                  { header: "Cost Value", key: "cost_value" },
                  { header: "Retail Value", key: "retail_value" },
                ],
        rows,
              )
            }
          />
        }
      >
        <TableShell
          cols={["Product", "Outlet", "Category / Brand", "Qty", "Cost Value", "Retail Value"]}
          loading={loading}
          empty={!rows.length}
        >
          {rows.map((r, i) => (
            <tr key={`${r.outlet_name}-${r.barcode}-${i}`} className="hover:bg-(--ui-muted-surface)">
              <td className="px-4 py-3">
                <div className="text-sm font-semibold text-(--ui-text)">
                  {r.product_name}
                </div>
                <div className="font-mono text-[11px] text-(--ui-text-muted)">
                  {r.barcode}
                </div>
              </td>
              <td className="px-4 py-3 text-sm text-(--ui-text-muted)">{r.outlet_name}</td>
              <td className="px-4 py-3">
                <div className="text-sm text-(--ui-text)">{r.category}</div>
                <div className="text-[11px] text-(--ui-text-muted)">{r.brand}</div>
                <div className="text-[11px] text-(--ui-text-muted)">{r.supplier}</div>
              </td>
              <td className="px-4 py-3">
                <span
                  className={`inline-flex rounded-full px-2 py-1 text-xs font-bold ${
                    Number(r.quantity || 0) <= 5
                      ? "bg-(--ui-danger-bg) text-(--ui-danger-fg)"
                      : "bg-(--ui-muted-surface) text-(--ui-text)"
                  }`}
                >
                  {r.quantity}
                </span>
              </td>
              <td className="px-4 py-3 text-sm font-semibold text-(--ui-text)">
                {fmt(r.cost_value)}
              </td>
              <td className="px-4 py-3 text-sm font-bold text-(--ui-text)">
                {fmt(r.retail_value)}
              </td>
            </tr>
          ))}
        </TableShell>
      </CardShell>
    </div>
  );
}

// --- Tab: On Hand Inventory ---------------------------------------------------
export function OnHandTab({ filters }) {
  const { fmt } = useCurrency();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [aggregate, setAggregate] = useState(false);
  const [anomaly, setAnomaly] = useState("");
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
      const d = await api.get(`/api/reports/on-hand?${p}`);
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

  const totalRetail = rows.reduce(
    (sum, row) => sum + Number(row.retail_value || 0),
    0,
  );
  const totalCost = rows.reduce(
    (sum, row) => sum + Number(row.cost_value || 0),
    0,
  );
  const lowStockRows = rows.filter((row) => Number(row.quantity || 0) <= 5).length;
  const anomalyPresets = [
    { value: "", label: "All Rows" },
    { value: "low_stock", label: "Low Stock" },
    { value: "zero_stock", label: "Zero Stock" },
    { value: "negative_stock", label: "Negative Stock" },
    { value: "margin_risk", label: "Margin Risk" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-(--ui-border) bg-(--ui-surface) p-3">
        <div className="flex rounded-xl bg-(--ui-muted-surface) p-1">
          <button
            type="button"
            onClick={() => setAggregate(false)}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${!aggregate ? "bg-(--ui-surface) text-(--ui-text)" : "text-(--ui-text-muted)"}`}
          >
            Outlet Detail
          </button>
          <button
            type="button"
            onClick={() => setAggregate(true)}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${aggregate ? "bg-(--ui-surface) text-(--ui-text)" : "text-(--ui-text-muted)"}`}
          >
            All Outlets
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          {anomalyPresets.map((preset) => (
            <button
              key={preset.value || "all"}
              type="button"
              onClick={() => setAnomaly(preset.value)}
              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                anomaly === preset.value
                  ? "bg-(--ui-primary) text-(--ui-on-primary)"
                  : "bg-(--ui-muted-surface) text-(--ui-text-muted)"
              }`}
            >
              {preset.label}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2 rounded-xl border border-(--ui-border) px-3 py-1.5">
          <span className="text-xs font-semibold text-(--ui-text-muted)">Margin %</span>
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

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="rounded-2xl border border-(--ui-border) bg-(--ui-surface) p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">
            Retail Value
          </p>
          <p className="mt-2 text-2xl font-bold text-(--ui-text)">{fmt(totalRetail)}</p>
        </div>
        <div className="rounded-2xl border border-(--ui-border) bg-(--ui-surface) p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">
            Cost Value
          </p>
          <p className="mt-2 text-2xl font-bold text-(--ui-text)">{fmt(totalCost)}</p>
        </div>
        <div className="rounded-2xl border border-(--ui-border) bg-(--ui-surface) p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">
            Low Stock Rows
          </p>
          <p className="mt-2 text-2xl font-bold text-(--ui-text)">{lowStockRows}</p>
        </div>
      </div>

      <CardShell
        title="Real-time Shelf Position"
        subtitle={`${aggregate ? "Aggregated across all outlets" : "Current outlet-level position"} • Current valuation at retail: ${fmt(totalRetail)}`}
        action={
          <ExportButton
            onClick={() =>
              exportCSV(
                "on_hand.csv",
                [
                  { header: "Product", key: "product_name" },
                  { header: "Barcode", key: "barcode" },
                  { header: "Outlet", key: "outlet_name" },
                  { header: "Quantity", key: "quantity" },
                  { header: "Retail Value", key: "retail_value" },
                  { header: "Cost Value", key: "cost_value" },
                ],
        rows,
              )
            }
          />
        }
      >
        <TableShell
          cols={["Product", "Outlet", "Qty", "Retail Value", "Cost Value"]}
          loading={loading}
          empty={!rows.length}
        >
          {rows.map((r, i) => (
            <tr key={`${r.outlet_name}-${r.barcode}-${i}`} className="hover:bg-(--ui-muted-surface)">
              <td className="px-4 py-3">
                <div className="text-sm font-semibold text-(--ui-text)">
                  {r.product_name}
                </div>
                <div className="font-mono text-[11px] text-(--ui-text-muted)">
                  {r.barcode}
                </div>
              </td>
              <td className="px-4 py-3 text-sm text-(--ui-text-muted)">{r.outlet_name}</td>
              <td className="px-4 py-3">
                <span
                  className={`inline-flex rounded-full px-2 py-1 text-xs font-bold ${
                    Number(r.quantity || 0) <= 5
                      ? "bg-(--ui-danger-bg) text-(--ui-danger-fg)"
                      : "bg-(--ui-muted-surface) text-(--ui-text)"
                  }`}
                >
                  {r.quantity}
                </span>
              </td>
              <td className="px-4 py-3 text-sm font-bold text-(--ui-text)">
                {fmt(r.retail_value)}
              </td>
              <td className="px-4 py-3 text-sm font-semibold text-(--ui-text-muted)">
                <div>{fmt(r.cost_value)}</div>
                <div className="text-[11px] text-(--ui-text-muted)">
                  {r.category} • {r.brand}
                </div>
              </td>
            </tr>
          ))}
        </TableShell>
      </CardShell>
    </div>
  );
}

// --- Tab: Stock Value (One Toy Store G1) --------------------------------------
// Stock value in one table, grouped by Supplier / Category / Sub-category /
// Brand, like iPOS's PSP summaries (owner, 2026-10-19).
const STOCK_VALUE_GROUPS = [
  { id: "supplier", label: "Supplier" },
  { id: "category", label: "Category" },
  { id: "subcategory", label: "Sub-category" },
  { id: "brand", label: "Brand" },
];

// G2: "Now" = the grouped table above; "Saved by day" = the figure saved at
// each Close Shift, else nightly at 23:59 (owner, 2026-10-19).
export function StockValueTab({ filters }) {
  const [view, setView] = useState("now");
  return (
    <div className="space-y-4" data-testid="stock-value">
      <div className="flex flex-wrap items-center gap-2">
        <FilterPill label="Now" active={view === "now"} onClick={() => setView("now")} />
        <FilterPill label="Saved by day" active={view === "days"} onClick={() => setView("days")} />
      </div>
      {view === "now" ? <StockValueNow filters={filters} /> : <StockValueDays filters={filters} />}
    </div>
  );
}

const SAVED_HOW = { close_shift: "At Close Shift", nightly: "Automatic (no shift closed)" };
// "2026-10-19" → "19 Oct 2026", read as a calendar day (no timezone shift).
function dayLabel(day) {
  const [y, m, d] = String(day).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", {
    day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
  });
}

function StockValueDays({ filters }) {
  const { fmt } = useCurrency();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      const p = new URLSearchParams();
      if (filters.dateFrom) p.set("date_from", filters.dateFrom);
      if (filters.dateTo) p.set("date_to", filters.dateTo);
      if (filters.outletIds && filters.outletIds.length) p.set("outlet_id", filters.outletIds.join(","));
      const q = p.toString();
      const d = await api.get(`/api/reports/stock-value-days${q ? `?${q}` : ""}`);
      setRows(d.rows || []);
    } catch {
      setRows([]);
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [filters.dateFrom, filters.dateTo, filters.outletIds]);

  useEffect(() => {
    load();
  }, [load]);

  const units = (n) => Number(n || 0).toLocaleString("en-US");
  const showBranch = new Set(rows.map((r) => r.outlet_id)).size > 1;

  return (
    <CardShell
      title="Stock value saved by day"
      subtitle="Saved at each Close Shift; a day with no Close Shift is saved automatically at 23:59."
      action={
        <ExportButton
          onClick={() =>
            exportCSV(
              "stock_value_by_day.csv",
              [
                { header: "Day", key: "day" },
                { header: "Branch", key: "outlet_name" },
                { header: "Saved", key: "saved" },
                { header: "Toys", key: "toys" },
                { header: "Units", key: "units" },
                { header: "Value at cost", key: "cost_value" },
                { header: "Value at sale price", key: "retail_value" },
              ],
              rows.map((r) => ({ ...r, saved: SAVED_HOW[r.source] || r.source })),
            )
          }
        />
      }
    >
      <div data-testid="stock-value-days">
        {!loading && failed ? (
          <div className="px-4 py-6 text-sm text-(--ui-danger-fg)">
            Could not load the saved days. Check the connection and try again.
          </div>
        ) : !loading && !rows.length ? (
          <div className="px-4 py-6 text-sm text-(--ui-text-muted)">
            Nothing saved yet. The first figure is saved at the next Close Shift.
          </div>
        ) : (
          <TableShell
            cols={["Day", ...(showBranch ? ["Branch"] : []), "Saved", "Toys", "Units", "Value at cost", "Value at sale price"]}
            loading={loading}
            empty={false}
          >
            {rows.map((r) => (
              <tr key={`${r.outlet_id}-${r.day}`} data-testid="stock-value-day" className="hover:bg-(--ui-muted-surface)">
                <td className="px-4 py-3 text-sm font-semibold text-(--ui-text)">{dayLabel(r.day)}</td>
                {showBranch && <td className="px-4 py-3 text-sm text-(--ui-text-muted)">{r.outlet_name}</td>}
                <td className="px-4 py-3 text-sm text-(--ui-text-muted)">
                  {SAVED_HOW[r.source] || r.source}
                  {r.taken_at && (
                    <span className="ml-1 text-[11px]">
                      {new Date(r.taken_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-sm text-(--ui-text-muted)">{units(r.toys)}</td>
                <td className="px-4 py-3 text-sm text-(--ui-text)">{units(r.units)}</td>
                <td className="px-4 py-3 text-sm font-semibold text-(--ui-text)">{fmt(r.cost_value)}</td>
                <td className="px-4 py-3 text-sm text-(--ui-text)">{fmt(r.retail_value)}</td>
              </tr>
            ))}
          </TableShell>
        )}
      </div>
    </CardShell>
  );
}

function StockValueNow({ filters }) {
  const { fmt } = useCurrency();
  const [groupBy, setGroupBy] = useState("supplier");
  const [data, setData] = useState({ rows: [], totals: null });
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ group_by: groupBy });
      if (filters.outletIds && filters.outletIds.length) p.set("outlet_id", filters.outletIds.join(","));
      const d = await api.get(`/api/reports/stock-value-summary?${p}`);
      setData({ rows: d.rows || [], totals: d.totals || null });
    } catch {
      setData({ rows: [], totals: null });
    } finally {
      setLoading(false);
    }
  }, [groupBy, filters.outletIds]);

  useEffect(() => {
    load();
  }, [load]);

  const label = STOCK_VALUE_GROUPS.find((g) => g.id === groupBy)?.label || "Name";
  const { rows, totals } = data;
  const units = (n) => Number(n || 0).toLocaleString();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-(--ui-border) bg-(--ui-surface) p-3">
        <span className="text-xs font-semibold text-(--ui-text-muted)">Group by</span>
        {STOCK_VALUE_GROUPS.map((g) => (
          <FilterPill key={g.id} label={g.label} active={groupBy === g.id} onClick={() => setGroupBy(g.id)} />
        ))}
      </div>

      <CardShell
        title={`Stock value by ${label.toLowerCase()}`}
        subtitle={totals ? `${units(totals.toys)} toys in stock • ${units(totals.units)} units • at cost ${fmt(totals.cost_value)} • at sale price ${fmt(totals.retail_value)}` : ""}
        action={
          <ExportButton
            onClick={() =>
              exportCSV(
                `stock_value_by_${groupBy}.csv`,
                [
                  { header: label, key: "name" },
                  ...(groupBy === "subcategory" ? [{ header: "Category", key: "parent" }] : []),
                  { header: "Toys", key: "toys" },
                  { header: "Units", key: "units" },
                  { header: "Value at cost", key: "cost_value" },
                  { header: "Value at sale price", key: "retail_value" },
                  { header: "Margin %", key: "margin_pct" },
                  { header: "Share of cost %", key: "share_pct" },
                ],
                totals ? [...rows, { name: "Total", parent: "", ...totals, share_pct: 100 }] : rows,
              )
            }
          />
        }
      >
        <TableShell
          cols={[label, "Toys", "Units", "Value at cost", "Value at sale price", "Margin", "Share of cost"]}
          loading={loading}
          empty={!rows.length}
        >
          {rows.map((r) => (
            <tr key={`${r.parent || ""}-${r.name}`} className="hover:bg-(--ui-muted-surface)">
              <td className="px-4 py-3">
                <div className="text-sm font-semibold text-(--ui-text)">{r.name}</div>
                {r.parent && <div className="text-[11px] text-(--ui-text-muted)">{r.parent}</div>}
              </td>
              <td className="px-4 py-3 text-sm text-(--ui-text-muted)">{units(r.toys)}</td>
              <td className="px-4 py-3 text-sm text-(--ui-text)">{units(r.units)}</td>
              <td className="px-4 py-3 text-sm font-semibold text-(--ui-text)">{fmt(r.cost_value)}</td>
              <td className="px-4 py-3 text-sm text-(--ui-text)">{fmt(r.retail_value)}</td>
              <td className="px-4 py-3 text-sm text-(--ui-text-muted)">{r.margin_pct}%</td>
              <td className="px-4 py-3 text-sm text-(--ui-text-muted)">{r.share_pct}%</td>
            </tr>
          ))}
          {totals && (
            <tr data-testid="stock-value-total" className="bg-(--ui-muted-surface) font-bold">
              <td className="px-4 py-3 text-sm text-(--ui-text)">Total</td>
              <td className="px-4 py-3 text-sm text-(--ui-text)">{units(totals.toys)}</td>
              <td className="px-4 py-3 text-sm text-(--ui-text)">{units(totals.units)}</td>
              <td className="px-4 py-3 text-sm text-(--ui-text)">{fmt(totals.cost_value)}</td>
              <td className="px-4 py-3 text-sm text-(--ui-text)">{fmt(totals.retail_value)}</td>
              <td className="px-4 py-3 text-sm text-(--ui-text)">{totals.margin_pct}%</td>
              <td className="px-4 py-3 text-sm text-(--ui-text)">100%</td>
            </tr>
          )}
        </TableShell>
      </CardShell>
    </div>
  );
}
