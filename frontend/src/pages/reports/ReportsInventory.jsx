import React, { useState, useEffect, useCallback } from "react";
import {
  Package,
  Search,
  ShoppingCart,
  Building2,
  TrendingUp,
  PackageX,
  AlertTriangle,
} from "lucide-react";
import { API_BASE as API } from "../../config";
import {
  fmt,
  fmtDate,
  exportCSV,
  ExportButton,
  TableShell,
  CardShell,
} from "./ReportShared";

// --- Tab: Sales & Stock -------------------------------------------------------
export function SalesStockTab({ filters }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({
        date_from: filters.dateFrom,
        date_to: filters.dateTo,
        outlet_id: filters.outletId,
      });
      const res = await fetch(`${API}/api/reports/sales-stock?${p}`);
      const d = await res.json();
      setRows(d.items || []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [filters.dateFrom, filters.dateTo, filters.outletId]);

  useEffect(() => {
    load();
  }, [load]);

  const totalUnits = rows.reduce((sum, row) => sum + Number(row.units_sold || 0), 0);
  const totalStock = rows.reduce((sum, row) => sum + Number(row.total_stock || 0), 0);
  const totalRevenue = rows.reduce((sum, row) => sum + Number(row.revenue || 0), 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Units Sold</p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{totalUnits}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Current Stock</p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{totalStock}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Revenue</p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{fmt(totalRevenue)}</p>
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
            <tr key={i} className="hover:bg-slate-50">
              <td className="p-4">
                <div className="text-sm font-bold text-slate-800">{r.name}</div>
                <div className="text-[10px] text-slate-400 font-mono italic">{r.barcode}</div>
              </td>
              <td className="p-4 text-sm text-slate-600">{r.category}</td>
              <td className="p-4 text-sm font-bold text-slate-900">{r.units_sold}</td>
              <td className="p-4">
                <div
                  className={`text-sm font-bold ${Number(r.total_stock || 0) <= 5 ? "text-rose-600" : "text-slate-900"}`}
                >
                  {r.total_stock}
                </div>
              </td>
              <td className="p-4 text-sm font-semibold text-emerald-700">{fmt(r.revenue)}</td>
            </tr>
          ))}
        </TableShell>
      </CardShell>
    </div>
  );
}

// --- Tab: Inventory Dump ------------------------------------------------------
export function InventoryDumpTab({ filters }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({
        outlet_id: filters.outletId,
        category_id: filters.categoryId,
        brand_id: filters.brandId,
      });
      const res = await fetch(`${API}/api/reports/inventory-dump?${p}`);
      const d = await res.json();
      setRows(d.items || []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [filters.outletId, filters.categoryId, filters.brandId]);

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

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Cost Value
          </p>
          <p className="mt-2 text-2xl font-bold text-slate-900">
            {fmt(totalCostValue)}
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Retail Value
          </p>
          <p className="mt-2 text-2xl font-bold text-slate-900">
            {fmt(totalRetailValue)}
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Low Stock Rows
          </p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{lowStockRows}</p>
        </div>
      </div>

      <CardShell
        title="Master Inventory Audit"
        subtitle="Outlet-level stock positions with retail and cost valuation"
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
            <tr key={`${r.outlet_name}-${r.barcode}-${i}`} className="hover:bg-slate-50">
              <td className="px-4 py-3">
                <div className="text-sm font-semibold text-slate-800">
                  {r.product_name}
                </div>
                <div className="font-mono text-[11px] text-slate-400">
                  {r.barcode}
                </div>
              </td>
              <td className="px-4 py-3 text-sm text-slate-600">{r.outlet_name}</td>
              <td className="px-4 py-3">
                <div className="text-sm text-slate-700">{r.category}</div>
                <div className="text-[11px] text-slate-400">{r.brand}</div>
              </td>
              <td className="px-4 py-3">
                <span
                  className={`inline-flex rounded-full px-2 py-1 text-xs font-bold ${
                    Number(r.quantity || 0) <= 5
                      ? "bg-rose-50 text-rose-700"
                      : "bg-slate-100 text-slate-700"
                  }`}
                >
                  {r.quantity}
                </span>
              </td>
              <td className="px-4 py-3 text-sm font-semibold text-slate-700">
                {fmt(r.cost_value)}
              </td>
              <td className="px-4 py-3 text-sm font-bold text-slate-900">
                {fmt(r.retail_value)}
              </td>
            </tr>
          ))}
        </TableShell>
      </CardShell>
    </div>
  );
}

// --- Tab: Product Performance -------------------------------------------------
export function ProductPerformanceTab({ filters }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({
        date_from: filters.dateFrom,
        date_to: filters.dateTo,
        outlet_id: filters.outletId,
      });
      const res = await fetch(`${API}/api/reports/product-performance?${p}`);
      const d = await res.json();
      setRows(d.items || []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [filters.dateFrom, filters.dateTo, filters.outletId]);

  useEffect(() => {
    load();
  }, [load]);

  const totalUnits = rows.reduce(
    (sum, row) => sum + Number(row.units_sold || 0),
    0,
  );
  const totalRevenue = rows.reduce(
    (sum, row) => sum + Number(row.revenue || 0),
    0,
  );
  const totalGrossProfit = rows.reduce(
    (sum, row) => sum + Number(row.gross_profit || 0),
    0,
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Units Sold
          </p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{totalUnits}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Revenue
          </p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{fmt(totalRevenue)}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Gross Profit
          </p>
          <p className="mt-2 text-2xl font-bold text-slate-900">
            {fmt(totalGrossProfit)}
          </p>
        </div>
      </div>

      <CardShell
        title="Product Alpha Performance"
        subtitle="Ranking products by volume, revenue, gross profit, and realized margin"
        action={
          <ExportButton
            onClick={() =>
              exportCSV(
                "performance.csv",
                [
                  { header: "Product", key: "product_name" },
                  { header: "Barcode", key: "barcode" },
                  { header: "Units Sold", key: "units_sold" },
                  { header: "Revenue", key: "revenue" },
                  { header: "Total Cost", key: "total_cost" },
                  { header: "Gross Profit", key: "gross_profit" },
                  { header: "Margin %", key: "margin_pct" },
                ],
                rows,
              )
            }
          />
        }
      >
        <TableShell
          cols={["Product", "Units Sold", "Revenue", "Gross Profit", "Margin %"]}
          loading={loading}
          empty={!rows.length}
        >
          {rows.map((r, i) => (
            <tr key={`${r.id}-${i}`} className="hover:bg-slate-50 transition-colors">
              <td className="px-4 py-3">
                <div className="text-sm font-semibold text-slate-800">
                  {r.product_name}
                </div>
                <div className="font-mono text-[11px] text-slate-400">
                  {r.barcode}
                </div>
              </td>
              <td className="px-4 py-3 text-sm font-bold text-slate-900">
                {r.units_sold}
              </td>
              <td className="px-4 py-3 text-sm font-semibold text-slate-700">
                {fmt(r.revenue)}
              </td>
              <td className="px-4 py-3 text-sm font-bold text-indigo-700">
                {fmt(r.gross_profit)}
              </td>
              <td className="px-4 py-3">
                <div className="text-sm font-bold text-emerald-600">
                  {r.margin_pct}%
                </div>
                <div className="mt-1 h-1 w-16 rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-emerald-500"
                    style={{ width: `${Math.max(0, Math.min(100, Number(r.margin_pct || 0)))}%` }}
                  />
                </div>
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
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({
        outlet_id: filters.outletId,
        category_id: filters.categoryId,
      });
      const res = await fetch(`${API}/api/reports/on-hand?${p}`);
      const d = await res.json();
      setRows(d.items || []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [filters.outletId, filters.categoryId]);

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

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Retail Value
          </p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{fmt(totalRetail)}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Cost Value
          </p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{fmt(totalCost)}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Low Stock Rows
          </p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{lowStockRows}</p>
        </div>
      </div>

      <CardShell
        title="Real-time Shelf Position"
        subtitle={`Current valuation at retail: ${fmt(totalRetail)}`}
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
            <tr key={`${r.outlet_name}-${r.barcode}-${i}`} className="hover:bg-slate-50">
              <td className="px-4 py-3">
                <div className="text-sm font-semibold text-slate-800">
                  {r.product_name}
                </div>
                <div className="font-mono text-[11px] text-slate-400">
                  {r.barcode}
                </div>
              </td>
              <td className="px-4 py-3 text-sm text-slate-600">{r.outlet_name}</td>
              <td className="px-4 py-3">
                <span
                  className={`inline-flex rounded-full px-2 py-1 text-xs font-bold ${
                    Number(r.quantity || 0) <= 5
                      ? "bg-rose-50 text-rose-700"
                      : "bg-slate-100 text-slate-700"
                  }`}
                >
                  {r.quantity}
                </span>
              </td>
              <td className="px-4 py-3 text-sm font-bold text-slate-900">
                {fmt(r.retail_value)}
              </td>
              <td className="px-4 py-3 text-sm font-semibold text-slate-600">
                {fmt(r.cost_value)}
              </td>
            </tr>
          ))}
        </TableShell>
      </CardShell>
    </div>
  );
}

// --- Tab: Replenishment -------------------------------------------------------
export function ReplenishmentTab({ filters }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [drafting, setDrafting] = useState(false);
  const [draftResult, setDraftResult] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({
        outlet_id: filters.outletId,
      });
      const res = await fetch(`${API}/api/reports/replenishment?${p}`);
      const d = await res.json();
      setRows(d.items || []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [filters.outletId]);

  useEffect(() => {
    load();
  }, [load]);

  const rowsWithSuggestion = rows.map((row) => ({
    ...row,
    suggested_order: Math.max(0, Number(row.min_qty || 0) - Number(row.quantity || 0)),
  }));

  const handleCreateDraftPOs = async () => {
    if (!window.confirm("Create Draft Purchase Orders for all items below?"))
      return;
    setDrafting(true);
    setDraftResult(null);
    try {
      const res = await fetch(
        `${API}/api/reports/replenishment/create-draft-pos`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items: rowsWithSuggestion, outlet_id: filters.outletId }),
        },
      );
      const d = await res.json();
      setDraftResult(d);
      if (d.success) load();
    } catch (e) {
      alert("Error creating drafts: " + e.message);
    } finally {
      setDrafting(false);
    }
  };

  const suppliersWithItems = new Set(
    rowsWithSuggestion.filter((r) => r.suggested_order > 0).map((r) => r.supplier_id),
  ).size;
  const totalSuggested = rowsWithSuggestion.reduce(
    (sum, row) => sum + Number(row.suggested_order || 0),
    0,
  );

  return (
    <div className="space-y-4">
      {draftResult && (
        <div
          className={`p-4 rounded-xl border ${draftResult.success ? "bg-emerald-50 border-emerald-100 text-emerald-800" : "bg-rose-50 border-rose-100 text-rose-800"}`}
        >
          <div className="flex items-center gap-2 font-bold mb-1">
            {draftResult.success ? "Success!" : "Drafting Incomplete"}
          </div>
          <p className="text-sm">
            Created {draftResult.created_count} Draft POs.{" "}
            {draftResult.failed?.length > 0 &&
              `Failed: ${draftResult.failed.join(", ")}`}
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Items Below Min
          </p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{rowsWithSuggestion.length}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Suggested Units
          </p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{totalSuggested}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Suppliers Impacted
          </p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{suppliersWithItems}</p>
        </div>
      </div>

      <CardShell
        title="Replenishment Engine"
        subtitle="Automatic stock out prevention and purchase suggestions"
        action={
          <div className="flex gap-2">
            {suppliersWithItems > 0 && (
              <button
                onClick={handleCreateDraftPOs}
                disabled={drafting}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-bold hover:bg-blue-700 disabled:bg-slate-300 transition-colors shadow-sm"
              >
                <ShoppingCart size={14} />
                {drafting
                  ? "Creating..."
                  : `Draft POs for ${suppliersWithItems} Suppliers`}
              </button>
            )}
            <ExportButton
              onClick={() =>
                exportCSV(
                  "replenishment.csv",
                  [
                    { header: "Product", key: "product_name" },
                    { header: "Barcode", key: "barcode" },
                    { header: "Outlet", key: "outlet_name" },
                    { header: "On Hand", key: "quantity" },
                    { header: "Minimum", key: "min_qty" },
                    { header: "Suggested", key: "suggested_order" },
                    { header: "Supplier", key: "supplier_name" },
                  ],
                  rowsWithSuggestion,
                )
              }
            />
          </div>
        }
      >
        <TableShell
          cols={["Product", "Current Stock", "Threshold", "Suggestion"]}
          loading={loading}
          empty={!rows.length}
        >
          {rowsWithSuggestion.map((r, i) => (
            <tr key={`${r.outlet_id}-${r.product_id}-${i}`} className="hover:bg-slate-50 transition-colors">
              <td className="px-4 py-3">
                <div className="text-sm font-bold text-slate-800">{r.product_name}</div>
                <div className="text-[10px] font-mono text-slate-400">
                  {r.barcode}
                </div>
                <div className="text-[10px] text-slate-400 font-medium">
                  Supplier: {r.supplier_name || "Generic"}
                </div>
              </td>
              <td className="px-4 py-3">
                <div
                  className={`text-sm font-bold ${r.quantity <= r.min_qty ? "text-rose-600" : "text-slate-900"}`}
                >
                  {r.quantity}
                </div>
                <div className="text-[10px] text-slate-400 font-medium leading-none mt-1">
                  {r.outlet_name}
                </div>
              </td>
              <td className="px-4 py-3 text-sm font-medium text-slate-600">
                {r.min_qty} units
              </td>
              <td className="px-4 py-3">
                <div className="text-sm font-bold text-blue-700">
                  +{r.suggested_order}
                </div>
                <div className="text-[10px] text-blue-500/70 font-bold uppercase tracking-tighter">
                  Required
                </div>
              </td>
            </tr>
          ))}
        </TableShell>
      </CardShell>
    </div>
  );
}

// --- Tab: Pricing & Margin Matrix ---------------------------------------------
export function PricingMarginTab({ filters }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({
        date_from: filters.dateFrom,
        date_to: filters.dateTo,
        outlet_id: filters.outletId,
      });
      const res = await fetch(`${API}/api/reports/retail-matrix?${p}`);
      const d = await res.json();
      setRows(d.matrix || []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [filters.dateFrom, filters.dateTo, filters.outletId]);

  useEffect(() => {
    load();
  }, [load]);

  const rowsWithMargin = rows.map((row) => {
    const revenue = Number(row.total_revenue || 0);
    const volume = Number(row.volume || 0);
    const avgUnitMargin = Number(row.avg_unit_margin || 0);
    const avgSellPrice = volume > 0 ? revenue / volume : 0;
    const avgCostPrice = avgSellPrice - avgUnitMargin;
    return {
      ...row,
      avg_sell_price: avgSellPrice,
      avg_cost_price: avgCostPrice,
      total_margin_value: avgUnitMargin * volume,
    };
  });

  const categoryCounts = rowsWithMargin.reduce((acc, row) => {
    acc[row.matrix_category] = (acc[row.matrix_category] || 0) + 1;
    return acc;
  }, {});
  const totalRevenue = rowsWithMargin.reduce(
    (sum, row) => sum + Number(row.total_revenue || 0),
    0,
  );
  const totalMarginValue = rowsWithMargin.reduce(
    (sum, row) => sum + Number(row.total_margin_value || 0),
    0,
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Stars
          </p>
          <p className="mt-2 text-2xl font-bold text-slate-900">
            {categoryCounts.Star || 0}
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Plowhorses
          </p>
          <p className="mt-2 text-2xl font-bold text-slate-900">
            {categoryCounts.Plowhorse || 0}
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Revenue
          </p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{fmt(totalRevenue)}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Margin Value
          </p>
          <p className="mt-2 text-2xl font-bold text-slate-900">
            {fmt(totalMarginValue)}
          </p>
        </div>
      </div>

      <CardShell
        title="Pricing & Margin Matrix"
        subtitle="Menu-engineering style view of velocity, unit margin, and product class"
        action={
          <ExportButton
            onClick={() =>
              exportCSV(
                "retail_matrix.csv",
                [
                  { header: "Product", key: "product_name" },
                  { header: "Barcode", key: "barcode" },
                  { header: "Volume", key: "volume" },
                  { header: "Revenue", key: "total_revenue" },
                  { header: "Avg Unit Margin", key: "avg_unit_margin" },
                  { header: "Estimated Avg Cost", key: "avg_cost_price" },
                  { header: "Estimated Avg Sell", key: "avg_sell_price" },
                  { header: "Matrix Category", key: "matrix_category" },
                ],
                rowsWithMargin,
              )
            }
          />
        }
      >
        <TableShell
          cols={["Product", "Volume / Revenue", "Avg Sell vs Cost", "Unit Margin", "Class"]}
          loading={loading}
          empty={!rowsWithMargin.length}
        >
          {rowsWithMargin.map((r, i) => (
            <tr key={`${r.product_id}-${i}`} className="hover:bg-slate-50">
              <td className="px-4 py-3">
                <div className="text-sm font-bold text-slate-800">{r.product_name}</div>
                <div className="font-mono text-[11px] text-slate-400">{r.barcode}</div>
              </td>
              <td className="px-4 py-3">
                <div className="text-sm font-bold text-slate-900">{r.volume}</div>
                <div className="text-[11px] text-slate-400">{fmt(r.total_revenue)}</div>
              </td>
              <td className="px-4 py-3 text-sm">
                <div className="text-slate-700">Sell: {fmt(r.avg_sell_price)}</div>
                <div className="text-[11px] text-slate-400">
                  Cost: {fmt(r.avg_cost_price)}
                </div>
              </td>
              <td className="px-4 py-3 text-sm font-bold text-indigo-700">
                {fmt(r.avg_unit_margin)}
              </td>
              <td className="px-4 py-3">
                <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-bold uppercase text-slate-700">
                  {r.matrix_category}
                </span>
              </td>
            </tr>
          ))}
        </TableShell>
      </CardShell>
    </div>
  );
}
