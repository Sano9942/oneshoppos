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
          {anomalyPresets.map((preset) => (
            <button
              key={preset.value || "all"}
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
                <div className="text-[11px] text-slate-400">{r.supplier}</div>
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
          {anomalyPresets.map((preset) => (
            <button
              key={preset.value || "all"}
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
                <div>{fmt(r.cost_value)}</div>
                <div className="text-[11px] text-slate-400">
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
