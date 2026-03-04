import React, { useState, useEffect, useCallback } from "react";
import { Tag, Package, SearchCheck, ReceiptText, History } from "lucide-react";
import { API_BASE as API } from "../../config";
import {
  fmt,
  fmtDate,
  fmtDateTime,
  exportCSV,
  ExportButton,
  TableShell,
  CardShell,
} from "./ReportShared";

function buildCatalogParams(filters, extra = {}) {
  return new URLSearchParams({
    date_from: filters.dateFrom || "",
    date_to: filters.dateTo || "",
    time_from: filters.timeFrom || "",
    time_to: filters.timeTo || "",
    outlet_id: filters.outletId || "",
    employee_id: filters.employeeId || "",
    search: filters.search || "",
    category_id: filters.categoryId || "",
    brand_id: filters.brandId || "",
    supplier_id: filters.supplierId || "",
    ...extra,
  });
}

// --- Tab: Category Wise -------------------------------------------------------
export function CategoryWiseTab({ filters }) {
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
        outlet_id: filters.outletId,
      });
      const res = await fetch(`${API}/api/reports/category-wise?${p}`);
      const d = await res.json();
      setRows(d.items || []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [filters.dateFrom, filters.dateTo, filters.timeFrom, filters.timeTo, filters.outletId]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <CardShell
      title="Category Performance Matrix"
      subtitle="Revenue and volume breakdown by product taxonomy"
      action={
        <ExportButton
          onClick={() =>
            exportCSV(
              "category_wise.csv",
              [
                { header: "Category", key: "category" },
                { header: "Orders", key: "units_sold" },
                { header: "Revenue", key: "revenue" },
              ],
              rows,
            )
          }
        />
      }
    >
      <TableShell
        cols={["Category", "Volume", "Total Revenue"]}
        loading={loading}
        empty={!rows.length}
      >
        {rows.map((r, i) => (
          <tr key={i} className="hover:bg-slate-50">
            <td className="p-4 font-bold text-slate-800 text-sm italic">
              {r.category}
            </td>
            <td className="p-4">
              <span className="bg-slate-100 text-slate-700 px-2 py-0.5 rounded text-xs font-bold">
                {r.units_sold} items
              </span>
            </td>
            <td className="p-4 font-bold text-indigo-600">
              {fmt(r.revenue)}
            </td>
          </tr>
        ))}
      </TableShell>
    </CardShell>
  );
}

// --- Tab: Product Specification -----------------------------------------------
export function ProductSpecTab({ filters }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({
        search: filters.search,
        category_id: filters.categoryId,
        brand_id: filters.brandId,
        supplier_id: filters.supplierId,
      });
      const res = await fetch(`${API}/api/reports/product-spec?${p}`);
      const d = await res.json();
      setRows(d.items || []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [filters.search, filters.categoryId, filters.brandId, filters.supplierId]);

  useEffect(() => {
    load();
  }, [load]);

  const categorizedRows = rows.filter((row) => row.category && row.category !== "-").length;
  const brandedRows = rows.filter((row) => row.brand && row.brand !== "-").length;
  const supplierRows = rows.filter((row) => row.supplier && row.supplier !== "-").length;
  const activeRows = rows.filter((row) => String(row.status || "").toLowerCase() === "active").length;
  const multiOutletRows = rows.filter((row) => Number(row.outlet_count || 0) > 1).length;
  const totalStock = rows.reduce((sum, row) => sum + Number(row.total_stock || 0), 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Categorized
          </p>
          <p className="mt-2 text-2xl font-bold text-slate-900">
            {categorizedRows} / {rows.length}
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Branded
          </p>
          <p className="mt-2 text-2xl font-bold text-slate-900">
            {brandedRows} / {rows.length}
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            With Supplier
          </p>
          <p className="mt-2 text-2xl font-bold text-slate-900">
            {supplierRows} / {rows.length}
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Active Masters
          </p>
          <p className="mt-2 text-2xl font-bold text-slate-900">
            {activeRows} / {rows.length}
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Multi-Outlet
          </p>
          <p className="mt-2 text-2xl font-bold text-slate-900">
            {multiOutletRows}
          </p>
          <p className="mt-1 text-xs text-slate-500">{totalStock} units in scope</p>
        </div>
      </div>

      <CardShell
        title="Item File / Product Master"
        subtitle="Master lookup across taxonomy, supplier, commercial settings, and stock footprint"
        action={
          <ExportButton
            onClick={() =>
              exportCSV(
                "product_specification.csv",
                [
                  { header: "ID", key: "id" },
                  { header: "Barcode", key: "barcode" },
                  { header: "SKU", key: "sku" },
                  { header: "Product", key: "name" },
                  { header: "Status", key: "status" },
                  { header: "Type", key: "product_type" },
                  { header: "Category", key: "category" },
                  { header: "Brand", key: "brand" },
                  { header: "Supplier", key: "supplier" },
                  { header: "Price", key: "price" },
                  { header: "Cost", key: "cost_price" },
                  { header: "Tax", key: "tax_name" },
                  { header: "Rate", key: "tax_rate" },
                  { header: "Unit", key: "unit" },
                  { header: "Min Qty", key: "min_qty" },
                  { header: "Max Qty", key: "max_qty" },
                  { header: "Total Stock", key: "total_stock" },
                  { header: "Outlet Count", key: "outlet_count" },
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
            "Master Tags",
            "Commercial",
            "Tax / Control",
            "Stock Footprint",
          ]}
          loading={loading}
          empty={rows.length === 0}
          emptyIcon={Package}
        >
          {rows.map((r) => (
            <tr key={r.id} className="hover:bg-slate-50 transition-colors">
              <td className="px-4 py-3">
                <div className="text-sm font-semibold text-slate-800">{r.name}</div>
                <div className="font-mono text-[11px] text-slate-400">
                  #{r.id} | {r.barcode || "No barcode"}
                </div>
                <div className="text-[11px] text-slate-400">{r.sku || "No SKU"}</div>
              </td>
              <td className="px-4 py-3">
                <div className="text-sm text-slate-700">{r.category}</div>
                <div className="text-[11px] text-slate-400">{r.brand}</div>
                <div className="text-[11px] text-slate-400">{r.supplier}</div>
                <div className="mt-2 flex flex-wrap gap-1">
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
                    {r.status || "unknown"}
                  </span>
                  <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-blue-700">
                    {r.product_type || "standard"}
                  </span>
                </div>
              </td>
              <td className="px-4 py-3 text-sm">
                <div className="text-sm font-bold text-slate-900">
                  Sell: {fmt(r.price)}
                </div>
                <div className="text-[11px] text-slate-500">Cost: {fmt(r.cost_price)}</div>
                <div className="text-[11px] text-slate-400">
                  Unit: {r.unit || "-"} | Min/Max: {r.min_qty ?? 0}/{r.max_qty ?? 0}
                </div>
              </td>
              <td className="px-4 py-3">
                <div className="text-sm text-slate-700">{r.tax_name}</div>
                <div className="text-[11px] font-semibold text-slate-500">
                  {r.tax_rate}%
                </div>
                <div className="text-[11px] text-slate-400">
                  Master status: {r.status || "-"}
                </div>
              </td>
              <td className="px-4 py-3">
                <div className="text-sm font-bold text-slate-900">
                  {Number(r.total_stock || 0)} units
                </div>
                <div className="text-[11px] text-slate-500">
                  {Number(r.outlet_count || 0)} outlets
                </div>
              </td>
            </tr>
          ))}
        </TableShell>
      </CardShell>
    </div>
  );
}

export function HistoryCostTab({ filters }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = buildCatalogParams(filters);
      const res = await fetch(`${API}/api/reports/history-cost?${p}`);
      const d = await res.json();
      setRows(d.items || []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [
    filters.dateFrom,
    filters.dateTo,
    filters.timeFrom,
    filters.timeTo,
    filters.outletId,
    filters.employeeId,
    filters.search,
    filters.categoryId,
    filters.brandId,
    filters.supplierId,
  ]);

  useEffect(() => {
    load();
  }, [load]);

  const totalQty = rows.reduce((sum, row) => sum + Number(row.qty_received || 0), 0);
  const totalValue = rows.reduce((sum, row) => sum + Number(row.received_cost_value || 0), 0);
  const changedCostRows = rows.filter(
    (row) => Number(row.vs_current_cost || 0) !== 0,
  ).length;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Receipt Lines
          </p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{rows.length}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Qty Received
          </p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{totalQty}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Cost Value
          </p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{fmt(totalValue)}</p>
          <p className="mt-1 text-xs text-slate-500">{changedCostRows} rows differ from current master cost</p>
        </div>
      </div>

      <CardShell
        title="History Cost"
        subtitle="GRN-level cost history by product, supplier, and receiving outlet"
        action={
          <ExportButton
            onClick={() =>
              exportCSV(
                "history_cost.csv",
                [
                  { header: "GRN", key: "grn_number" },
                  { header: "Received At", key: "received_at" },
                  { header: "Outlet", key: "outlet_name" },
                  { header: "Product", key: "product_name" },
                  { header: "Barcode", key: "barcode" },
                  { header: "SKU", key: "sku" },
                  { header: "Category", key: "category" },
                  { header: "Brand", key: "brand" },
                  { header: "Supplier", key: "supplier" },
                  { header: "Qty Received", key: "qty_received" },
                  { header: "Received Cost", key: "received_cost_price" },
                  { header: "Current Master Cost", key: "current_master_cost" },
                  { header: "Cost Value", key: "received_cost_value" },
                  { header: "Vs Current Cost", key: "vs_current_cost" },
                ],
                rows,
              )
            }
          />
        }
      >
        <TableShell
          cols={["Receipt", "Product", "Outlet / Supplier", "Qty", "Received Cost", "Variance vs Master"]}
          loading={loading}
          empty={!rows.length}
          emptyIcon={History}
        >
          {rows.map((row, index) => (
            <tr key={`${row.grn_id}-${row.product_id}-${index}`} className="hover:bg-slate-50">
              <td className="px-4 py-3">
                <div className="text-sm font-semibold text-slate-800">{row.grn_number || `GRN #${row.grn_id}`}</div>
                <div className="text-[11px] text-slate-400">{fmtDateTime(row.received_at)}</div>
              </td>
              <td className="px-4 py-3">
                <div className="text-sm font-semibold text-slate-800">{row.product_name}</div>
                <div className="font-mono text-[11px] text-slate-400">{row.barcode || "No barcode"}</div>
                <div className="text-[11px] text-slate-400">{row.sku || "No SKU"}</div>
              </td>
              <td className="px-4 py-3">
                <div className="text-sm text-slate-700">{row.outlet_name}</div>
                <div className="text-[11px] text-slate-400">{row.supplier}</div>
                <div className="text-[11px] text-slate-400">{row.category} | {row.brand}</div>
              </td>
              <td className="px-4 py-3 text-sm font-bold text-slate-900">{row.qty_received}</td>
              <td className="px-4 py-3">
                <div className="text-sm font-semibold text-slate-800">{fmt(row.received_cost_price)}</div>
                <div className="text-[11px] text-slate-400">{fmt(row.received_cost_value)} total</div>
              </td>
              <td className="px-4 py-3">
                <div
                  className={`text-sm font-bold ${Number(row.vs_current_cost || 0) === 0 ? "text-slate-700" : Number(row.vs_current_cost || 0) > 0 ? "text-amber-700" : "text-emerald-700"}`}
                >
                  {fmt(row.vs_current_cost)}
                </div>
                <div className="text-[11px] text-slate-400">Master: {fmt(row.current_master_cost)}</div>
              </td>
            </tr>
          ))}
        </TableShell>
      </CardShell>
    </div>
  );
}

export function HistorySaleTab({ filters }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = buildCatalogParams(filters);
      const res = await fetch(`${API}/api/reports/history-sale?${p}`);
      const d = await res.json();
      setRows(d.items || []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [
    filters.dateFrom,
    filters.dateTo,
    filters.timeFrom,
    filters.timeTo,
    filters.outletId,
    filters.employeeId,
    filters.search,
    filters.categoryId,
    filters.brandId,
    filters.supplierId,
  ]);

  useEffect(() => {
    load();
  }, [load]);

  const totalQty = rows.reduce((sum, row) => sum + Number(row.quantity || 0), 0);
  const totalRevenue = rows.reduce((sum, row) => sum + Number(row.line_revenue || 0), 0);
  const totalGross = rows.reduce((sum, row) => sum + Number(row.line_gross_profit || 0), 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Sale Lines
          </p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{rows.length}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Units Sold
          </p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{totalQty}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Gross Profit
          </p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{fmt(totalGross)}</p>
          <p className="mt-1 text-xs text-slate-500">{fmt(totalRevenue)} revenue in scope</p>
        </div>
      </div>

      <CardShell
        title="History Sale"
        subtitle="Sale-line history by product with realized sell price, cost, and gross profit"
        action={
          <ExportButton
            onClick={() =>
              exportCSV(
                "history_sale.csv",
                [
                  { header: "Sale ID", key: "sale_id" },
                  { header: "Timestamp", key: "timestamp" },
                  { header: "Outlet", key: "outlet_name" },
                  { header: "Employee", key: "employee_name" },
                  { header: "Product", key: "product_name" },
                  { header: "Barcode", key: "barcode" },
                  { header: "SKU", key: "sku" },
                  { header: "Category", key: "category" },
                  { header: "Brand", key: "brand" },
                  { header: "Supplier", key: "supplier" },
                  { header: "Quantity", key: "quantity" },
                  { header: "Price At Sale", key: "price_at_sale" },
                  { header: "Cost At Sale", key: "cost_price_at_sale" },
                  { header: "Revenue", key: "line_revenue" },
                  { header: "Cost", key: "line_cost" },
                  { header: "Gross Profit", key: "line_gross_profit" },
                ],
                rows,
              )
            }
          />
        }
      >
        <TableShell
          cols={["Timestamp", "Product", "Outlet / Staff", "Qty", "Sell / Cost", "Gross Profit"]}
          loading={loading}
          empty={!rows.length}
          emptyIcon={ReceiptText}
        >
          {rows.map((row, index) => (
            <tr key={`${row.sale_id}-${row.product_id}-${index}`} className="hover:bg-slate-50">
              <td className="px-4 py-3">
                <div className="text-sm font-semibold text-slate-800">#{row.sale_id}</div>
                <div className="text-[11px] text-slate-400">{fmtDateTime(row.timestamp)}</div>
              </td>
              <td className="px-4 py-3">
                <div className="text-sm font-semibold text-slate-800">{row.product_name}</div>
                <div className="font-mono text-[11px] text-slate-400">{row.barcode || "No barcode"}</div>
                <div className="text-[11px] text-slate-400">{row.category} | {row.brand}</div>
              </td>
              <td className="px-4 py-3">
                <div className="text-sm text-slate-700">{row.outlet_name}</div>
                <div className="text-[11px] text-slate-400">{row.employee_name}</div>
                <div className="text-[11px] text-slate-400">{row.supplier}</div>
              </td>
              <td className="px-4 py-3 text-sm font-bold text-slate-900">{row.quantity}</td>
              <td className="px-4 py-3">
                <div className="text-sm font-semibold text-slate-800">{fmt(row.price_at_sale)}</div>
                <div className="text-[11px] text-slate-400">Cost: {fmt(row.cost_price_at_sale)}</div>
              </td>
              <td className="px-4 py-3">
                <div className="text-sm font-bold text-emerald-700">{fmt(row.line_gross_profit)}</div>
                <div className="text-[11px] text-slate-400">{fmt(row.line_revenue)} revenue</div>
              </td>
            </tr>
          ))}
        </TableShell>
      </CardShell>
    </div>
  );
}

export function ProductAuditTab({ filters }) {
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [issue, setIssue] = useState("all");
  const [inactivityDays, setInactivityDays] = useState(60);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = buildCatalogParams(filters, {
        issue,
        inactivity_days: String(inactivityDays),
      });
      const res = await fetch(`${API}/api/reports/product-audit?${p}`);
      const d = await res.json();
      setRows(d.rows || []);
      setSummary(d.summary || null);
    } catch {
      setRows([]);
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, [
    filters.dateFrom,
    filters.dateTo,
    filters.timeFrom,
    filters.timeTo,
    filters.outletId,
    filters.employeeId,
    filters.search,
    filters.categoryId,
    filters.brandId,
    filters.supplierId,
    issue,
    inactivityDays,
  ]);

  useEffect(() => {
    load();
  }, [load]);

  const presets = [
    { value: "all", label: "All Issues" },
    { value: "missing_barcode", label: "Missing Barcode" },
    { value: "missing_sku", label: "Missing SKU" },
    { value: "missing_supplier", label: "Missing Supplier" },
    { value: "missing_category", label: "Missing Category" },
    { value: "minmax_unset", label: "Min/Max Unset" },
    { value: "inactive_with_stock", label: "Inactive With Stock" },
    { value: "no_recent_sales", label: "No Recent Sales" },
  ];

  const metricSummary = summary || {};

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex flex-wrap gap-2">
          {presets.map((preset) => (
            <button
              key={preset.value}
              type="button"
              onClick={() => setIssue(preset.value)}
              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                issue === preset.value
                  ? "bg-blue-600 text-white"
                  : "bg-slate-100 text-slate-600"
              }`}
            >
              {preset.label}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-1.5">
          <span className="text-xs font-semibold text-slate-500">Idle Days</span>
          <input
            type="number"
            min="1"
            max="3650"
            value={inactivityDays}
            onChange={(e) => setInactivityDays(Number(e.target.value || 1))}
            className="w-20 border-none bg-transparent p-0 text-sm font-semibold focus:ring-0"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Rows In View</p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{rows.length}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Missing Barcode</p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{metricSummary.missing_barcode || 0}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Missing Supplier</p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{metricSummary.missing_supplier || 0}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">No Recent Sales</p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{metricSummary.no_recent_sales || 0}</p>
        </div>
      </div>

      <CardShell
        title="Product Audit"
        subtitle="Master completeness, stale-stock reference checks, and criteria-style product exceptions from the live schema"
        action={
          <ExportButton
            onClick={() =>
              exportCSV(
                "product_audit.csv",
                [
                  { header: "ID", key: "id" },
                  { header: "Product", key: "name" },
                  { header: "Barcode", key: "barcode" },
                  { header: "SKU", key: "sku" },
                  { header: "Status", key: "status" },
                  { header: "Type", key: "product_type" },
                  { header: "Category", key: "category" },
                  { header: "Brand", key: "brand" },
                  { header: "Supplier", key: "supplier" },
                  { header: "Min Qty", key: "min_qty" },
                  { header: "Max Qty", key: "max_qty" },
                  { header: "Unit", key: "unit" },
                  { header: "Price", key: "price" },
                  { header: "Cost", key: "cost_price" },
                  { header: "Total Stock", key: "total_stock" },
                  { header: "Outlet Count", key: "outlet_count" },
                  { header: "Last Sold", key: "last_sold_at" },
                  { header: "Days Since Sale", key: "days_since_sale" },
                  { header: "Issue Summary", key: "issue_summary" },
                ],
                rows,
              )
            }
          />
        }
      >
        <TableShell
          cols={["Product", "Issue Tags", "Master Context", "Commercial", "Activity"]}
          loading={loading}
          empty={!rows.length}
          emptyIcon={SearchCheck}
        >
          {rows.map((row) => (
            <tr key={row.id} className="hover:bg-slate-50">
              <td className="px-4 py-3">
                <div className="text-sm font-semibold text-slate-800">{row.name}</div>
                <div className="font-mono text-[11px] text-slate-400">#{row.id} | {row.barcode || "No barcode"}</div>
                <div className="text-[11px] text-slate-400">{row.sku || "No SKU"}</div>
              </td>
              <td className="px-4 py-3">
                <div className="flex flex-wrap gap-1">
                  {(row.issue_tags || []).map((tag) => (
                    <span key={tag} className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                      {tag.replaceAll("_", " ")}
                    </span>
                  ))}
                </div>
              </td>
              <td className="px-4 py-3">
                <div className="text-sm text-slate-700">{row.category}</div>
                <div className="text-[11px] text-slate-400">{row.brand}</div>
                <div className="text-[11px] text-slate-400">{row.supplier}</div>
                <div className="mt-1 text-[11px] text-slate-400">
                  {row.status || "unknown"} | {row.product_type || "standard"} | {row.unit || "-"}
                </div>
              </td>
              <td className="px-4 py-3">
                <div className="text-sm font-semibold text-slate-800">Sell: {fmt(row.price)}</div>
                <div className="text-[11px] text-slate-400">Cost: {fmt(row.cost_price)}</div>
                <div className="text-[11px] text-slate-400">Min/Max: {row.min_qty ?? 0}/{row.max_qty ?? 0}</div>
                <div className="text-[11px] text-slate-400">Stock: {Number(row.total_stock || 0)} in {Number(row.outlet_count || 0)} outlets</div>
              </td>
              <td className="px-4 py-3">
                <div className="text-sm text-slate-700">
                  {row.last_sold_at ? fmtDate(row.last_sold_at) : "Never sold"}
                </div>
                <div className="text-[11px] text-slate-400">
                  {row.days_since_sale == null ? "No sale history" : `${row.days_since_sale} days since sale`}
                </div>
                <div className="text-[11px] text-slate-400">{Number(row.lifetime_units_sold || 0)} lifetime units</div>
              </td>
            </tr>
          ))}
        </TableShell>
      </CardShell>
    </div>
  );
}
