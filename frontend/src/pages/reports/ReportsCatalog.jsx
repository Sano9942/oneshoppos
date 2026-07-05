import React, { useState, useEffect, useCallback } from "react";
import { Tag, Package, SearchCheck, ReceiptText, History } from "lucide-react";
import { api } from "../../api";
import {
  fmtDate,
  fmtDateTime,
  exportCSV,
  ExportButton,
  TableShell,
  CardShell,
} from "./ReportShared";
import { useCurrency } from "../../contexts/CurrencyContext";

function buildCatalogParams(filters, extra = {}) {
  const p = new URLSearchParams({
    date_from: filters.dateFrom || "",
    date_to: filters.dateTo || "",
    time_from: filters.timeFrom || "",
    time_to: filters.timeTo || "",
    employee_id: filters.employeeId || "",
    search: filters.search || "",
    category_id: filters.categoryId || "",
    brand_id: filters.brandId || "",
    supplier_id: filters.supplierId || "",
    ...extra,
  });
  if (filters.outletIds && filters.outletIds.length) p.set("outlet_id", filters.outletIds.join(","));
  return p;
}

// --- Tab: Category Wise -------------------------------------------------------
export function CategoryWiseTab({ filters }) {
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
      const d = await api.get(`/api/reports/category-wise?${p}`);
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
          <tr key={i} className="hover:bg-(--ui-muted-surface)">
            <td className="p-4 font-bold text-(--ui-text) text-sm italic">
              {r.category}
            </td>
            <td className="p-4">
              <span className="bg-(--ui-muted-surface) text-(--ui-text) px-2 py-0.5 rounded text-xs font-bold">
                {r.units_sold} items
              </span>
            </td>
            <td className="p-4 font-bold text-(--ui-link)">
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
  const { fmt } = useCurrency();
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
      const d = await api.get(`/api/reports/product-spec?${p}`);
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
        <div className="rounded-2xl border border-(--ui-border) bg-(--ui-surface) p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">
            Categorized
          </p>
          <p className="mt-2 text-2xl font-bold text-(--ui-text)">
            {categorizedRows} / {rows.length}
          </p>
        </div>
        <div className="rounded-2xl border border-(--ui-border) bg-(--ui-surface) p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">
            Branded
          </p>
          <p className="mt-2 text-2xl font-bold text-(--ui-text)">
            {brandedRows} / {rows.length}
          </p>
        </div>
        <div className="rounded-2xl border border-(--ui-border) bg-(--ui-surface) p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">
            With Supplier
          </p>
          <p className="mt-2 text-2xl font-bold text-(--ui-text)">
            {supplierRows} / {rows.length}
          </p>
        </div>
        <div className="rounded-2xl border border-(--ui-border) bg-(--ui-surface) p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">
            Active Masters
          </p>
          <p className="mt-2 text-2xl font-bold text-(--ui-text)">
            {activeRows} / {rows.length}
          </p>
        </div>
        <div className="rounded-2xl border border-(--ui-border) bg-(--ui-surface) p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">
            Multi-Outlet
          </p>
          <p className="mt-2 text-2xl font-bold text-(--ui-text)">
            {multiOutletRows}
          </p>
          <p className="mt-1 text-xs text-(--ui-text-muted)">{totalStock} units in scope</p>
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
            <tr key={r.id} className="hover:bg-(--ui-muted-surface) transition-colors">
              <td className="px-4 py-3">
                <div className="text-sm font-semibold text-(--ui-text)">{r.name}</div>
                <div className="font-mono text-[11px] text-(--ui-text-muted)">
                  #{r.id} | {r.barcode || "No barcode"}
                </div>
                <div className="text-[11px] text-(--ui-text-muted)">{r.sku || "No SKU"}</div>
              </td>
              <td className="px-4 py-3">
                <div className="text-sm text-(--ui-text)">{r.category}</div>
                <div className="text-[11px] text-(--ui-text-muted)">{r.brand}</div>
                <div className="text-[11px] text-(--ui-text-muted)">{r.supplier}</div>
                <div className="mt-2 flex flex-wrap gap-1">
                  <span className="rounded-full bg-(--ui-muted-surface) px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-(--ui-text-muted)">
                    {r.status || "unknown"}
                  </span>
                  <span className="rounded-full bg-(--ui-muted-surface) px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-(--ui-link)">
                    {r.product_type || "standard"}
                  </span>
                </div>
              </td>
              <td className="px-4 py-3 text-sm">
                <div className="text-sm font-bold text-(--ui-text)">
                  Sell: {fmt(r.price)}
                </div>
                <div className="text-[11px] text-(--ui-text-muted)">Cost: {fmt(r.cost_price)}</div>
                <div className="text-[11px] text-(--ui-text-muted)">
                  Unit: {r.unit || "-"} | Min/Max: {r.min_qty ?? 0}/{r.max_qty ?? 0}
                </div>
              </td>
              <td className="px-4 py-3">
                <div className="text-sm text-(--ui-text)">{r.tax_name}</div>
                <div className="text-[11px] font-semibold text-(--ui-text-muted)">
                  {r.tax_rate}%
                </div>
                <div className="text-[11px] text-(--ui-text-muted)">
                  Master status: {r.status || "-"}
                </div>
              </td>
              <td className="px-4 py-3">
                <div className="text-sm font-bold text-(--ui-text)">
                  {Number(r.total_stock || 0)} units
                </div>
                <div className="text-[11px] text-(--ui-text-muted)">
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
  const { fmt } = useCurrency();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = buildCatalogParams(filters);
      const d = await api.get(`/api/reports/history-cost?${p}`);
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
    filters.outletIds,
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
        <div className="rounded-2xl border border-(--ui-border) bg-(--ui-surface) p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">
            Receipt Lines
          </p>
          <p className="mt-2 text-2xl font-bold text-(--ui-text)">{rows.length}</p>
        </div>
        <div className="rounded-2xl border border-(--ui-border) bg-(--ui-surface) p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">
            Qty Received
          </p>
          <p className="mt-2 text-2xl font-bold text-(--ui-text)">{totalQty}</p>
        </div>
        <div className="rounded-2xl border border-(--ui-border) bg-(--ui-surface) p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">
            Cost Value
          </p>
          <p className="mt-2 text-2xl font-bold text-(--ui-text)">{fmt(totalValue)}</p>
          <p className="mt-1 text-xs text-(--ui-text-muted)">{changedCostRows} rows differ from current master cost</p>
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
            <tr key={`${row.grn_id}-${row.product_id}-${index}`} className="hover:bg-(--ui-muted-surface)">
              <td className="px-4 py-3">
                <div className="text-sm font-semibold text-(--ui-text)">{row.grn_number || `GRN #${row.grn_id}`}</div>
                <div className="text-[11px] text-(--ui-text-muted)">{fmtDateTime(row.received_at)}</div>
              </td>
              <td className="px-4 py-3">
                <div className="text-sm font-semibold text-(--ui-text)">{row.product_name}</div>
                <div className="font-mono text-[11px] text-(--ui-text-muted)">{row.barcode || "No barcode"}</div>
                <div className="text-[11px] text-(--ui-text-muted)">{row.sku || "No SKU"}</div>
              </td>
              <td className="px-4 py-3">
                <div className="text-sm text-(--ui-text)">{row.outlet_name}</div>
                <div className="text-[11px] text-(--ui-text-muted)">{row.supplier}</div>
                <div className="text-[11px] text-(--ui-text-muted)">{row.category} | {row.brand}</div>
              </td>
              <td className="px-4 py-3 text-sm font-bold text-(--ui-text)">{row.qty_received}</td>
              <td className="px-4 py-3">
                <div className="text-sm font-semibold text-(--ui-text)">{fmt(row.received_cost_price)}</div>
                <div className="text-[11px] text-(--ui-text-muted)">{fmt(row.received_cost_value)} total</div>
              </td>
              <td className="px-4 py-3">
                <div
                  className={`text-sm font-bold ${Number(row.vs_current_cost || 0) === 0 ? "text-(--ui-text)" : Number(row.vs_current_cost || 0) > 0 ? "text-(--ui-warning-fg)" : "text-(--ui-success-fg)"}`}
                >
                  {fmt(row.vs_current_cost)}
                </div>
                <div className="text-[11px] text-(--ui-text-muted)">Master: {fmt(row.current_master_cost)}</div>
              </td>
            </tr>
          ))}
        </TableShell>
      </CardShell>
    </div>
  );
}

export function HistorySaleTab({ filters }) {
  const { fmt } = useCurrency();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = buildCatalogParams(filters);
      const d = await api.get(`/api/reports/history-sale?${p}`);
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
    filters.outletIds,
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
        <div className="rounded-2xl border border-(--ui-border) bg-(--ui-surface) p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">
            Sale Lines
          </p>
          <p className="mt-2 text-2xl font-bold text-(--ui-text)">{rows.length}</p>
        </div>
        <div className="rounded-2xl border border-(--ui-border) bg-(--ui-surface) p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">
            Units Sold
          </p>
          <p className="mt-2 text-2xl font-bold text-(--ui-text)">{totalQty}</p>
        </div>
        <div className="rounded-2xl border border-(--ui-border) bg-(--ui-surface) p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">
            Gross Profit
          </p>
          <p className="mt-2 text-2xl font-bold text-(--ui-text)">{fmt(totalGross)}</p>
          <p className="mt-1 text-xs text-(--ui-text-muted)">{fmt(totalRevenue)} revenue in scope</p>
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
            <tr key={`${row.sale_id}-${row.product_id}-${index}`} className="hover:bg-(--ui-muted-surface)">
              <td className="px-4 py-3">
                <div className="text-sm font-semibold text-(--ui-text)">#{row.sale_id}</div>
                <div className="text-[11px] text-(--ui-text-muted)">{fmtDateTime(row.timestamp)}</div>
              </td>
              <td className="px-4 py-3">
                <div className="text-sm font-semibold text-(--ui-text)">{row.product_name}</div>
                <div className="font-mono text-[11px] text-(--ui-text-muted)">{row.barcode || "No barcode"}</div>
                <div className="text-[11px] text-(--ui-text-muted)">{row.category} | {row.brand}</div>
              </td>
              <td className="px-4 py-3">
                <div className="text-sm text-(--ui-text)">{row.outlet_name}</div>
                <div className="text-[11px] text-(--ui-text-muted)">{row.employee_name}</div>
                <div className="text-[11px] text-(--ui-text-muted)">{row.supplier}</div>
              </td>
              <td className="px-4 py-3 text-sm font-bold text-(--ui-text)">{row.quantity}</td>
              <td className="px-4 py-3">
                <div className="text-sm font-semibold text-(--ui-text)">{fmt(row.price_at_sale)}</div>
                <div className="text-[11px] text-(--ui-text-muted)">Cost: {fmt(row.cost_price_at_sale)}</div>
              </td>
              <td className="px-4 py-3">
                <div className="text-sm font-bold text-(--ui-success-fg)">{fmt(row.line_gross_profit)}</div>
                <div className="text-[11px] text-(--ui-text-muted)">{fmt(row.line_revenue)} revenue</div>
              </td>
            </tr>
          ))}
        </TableShell>
      </CardShell>
    </div>
  );
}

export function ProductAuditTab({ filters }) {
  const { fmt } = useCurrency();
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
      const d = await api.get(`/api/reports/product-audit?${p}`);
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
    filters.outletIds,
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
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-(--ui-border) bg-(--ui-surface) p-3">
        <div className="flex flex-wrap gap-2">
          {presets.map((preset) => (
            <button
              key={preset.value}
              type="button"
              onClick={() => setIssue(preset.value)}
              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                issue === preset.value
                  ? "bg-(--ui-primary) text-(--ui-on-primary)"
                  : "bg-(--ui-muted-surface) text-(--ui-text-muted)"
              }`}
            >
              {preset.label}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2 rounded-xl border border-(--ui-border) px-3 py-1.5">
          <span className="text-xs font-semibold text-(--ui-text-muted)">Idle Days</span>
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
        <div className="rounded-2xl border border-(--ui-border) bg-(--ui-surface) p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">Rows In View</p>
          <p className="mt-2 text-2xl font-bold text-(--ui-text)">{rows.length}</p>
        </div>
        <div className="rounded-2xl border border-(--ui-border) bg-(--ui-surface) p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">Missing Barcode</p>
          <p className="mt-2 text-2xl font-bold text-(--ui-text)">{metricSummary.missing_barcode || 0}</p>
        </div>
        <div className="rounded-2xl border border-(--ui-border) bg-(--ui-surface) p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">Missing Supplier</p>
          <p className="mt-2 text-2xl font-bold text-(--ui-text)">{metricSummary.missing_supplier || 0}</p>
        </div>
        <div className="rounded-2xl border border-(--ui-border) bg-(--ui-surface) p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">No Recent Sales</p>
          <p className="mt-2 text-2xl font-bold text-(--ui-text)">{metricSummary.no_recent_sales || 0}</p>
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
            <tr key={row.id} className="hover:bg-(--ui-muted-surface)">
              <td className="px-4 py-3">
                <div className="text-sm font-semibold text-(--ui-text)">{row.name}</div>
                <div className="font-mono text-[11px] text-(--ui-text-muted)">#{row.id} | {row.barcode || "No barcode"}</div>
                <div className="text-[11px] text-(--ui-text-muted)">{row.sku || "No SKU"}</div>
              </td>
              <td className="px-4 py-3">
                <div className="flex flex-wrap gap-1">
                  {(row.issue_tags || []).map((tag) => (
                    <span key={tag} className="rounded-full bg-(--ui-warning-bg) px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-(--ui-warning-fg)">
                      {tag.replaceAll("_", " ")}
                    </span>
                  ))}
                </div>
              </td>
              <td className="px-4 py-3">
                <div className="text-sm text-(--ui-text)">{row.category}</div>
                <div className="text-[11px] text-(--ui-text-muted)">{row.brand}</div>
                <div className="text-[11px] text-(--ui-text-muted)">{row.supplier}</div>
                <div className="mt-1 text-[11px] text-(--ui-text-muted)">
                  {row.status || "unknown"} | {row.product_type || "standard"} | {row.unit || "-"}
                </div>
              </td>
              <td className="px-4 py-3">
                <div className="text-sm font-semibold text-(--ui-text)">Sell: {fmt(row.price)}</div>
                <div className="text-[11px] text-(--ui-text-muted)">Cost: {fmt(row.cost_price)}</div>
                <div className="text-[11px] text-(--ui-text-muted)">Min/Max: {row.min_qty ?? 0}/{row.max_qty ?? 0}</div>
                <div className="text-[11px] text-(--ui-text-muted)">Stock: {Number(row.total_stock || 0)} in {Number(row.outlet_count || 0)} outlets</div>
              </td>
              <td className="px-4 py-3">
                <div className="text-sm text-(--ui-text)">
                  {row.last_sold_at ? fmtDate(row.last_sold_at) : "Never sold"}
                </div>
                <div className="text-[11px] text-(--ui-text-muted)">
                  {row.days_since_sale == null ? "No sale history" : `${row.days_since_sale} days since sale`}
                </div>
                <div className="text-[11px] text-(--ui-text-muted)">{Number(row.lifetime_units_sold || 0)} lifetime units</div>
              </td>
            </tr>
          ))}
        </TableShell>
      </CardShell>
    </div>
  );
}
