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
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  LineChart,
  Line,
} from "recharts";
import { API_BASE as API } from "../../config";
import {
  fmt,
  fmtDate,
  exportCSV,
  ExportButton,
  TableShell,
  CardShell,
} from "./ReportShared";
import { useAuth } from "../../auth/AuthProvider";

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
        time_from: filters.timeFrom,
        time_to: filters.timeTo,
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
  }, [filters.dateFrom, filters.dateTo, filters.timeFrom, filters.timeTo, filters.outletId]);

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
  const [aggregate, setAggregate] = useState(false);
  const [anomaly, setAnomaly] = useState("");
  const [marginThreshold, setMarginThreshold] = useState(15);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({
        outlet_id: filters.outletId,
        category_id: filters.categoryId,
        brand_id: filters.brandId,
        supplier_id: filters.supplierId,
        search: filters.search,
        aggregate: aggregate ? "1" : "0",
        anomaly,
        margin_threshold: String(marginThreshold),
      });
      const res = await fetch(`${API}/api/reports/inventory-dump?${p}`);
      const d = await res.json();
      setRows(d.items || []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [
    filters.outletId,
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
        time_from: filters.timeFrom,
        time_to: filters.timeTo,
        outlet_id: filters.outletId,
        category_id: filters.categoryId,
        brand_id: filters.brandId,
        supplier_id: filters.supplierId,
        search: filters.search,
      });
      const res = await fetch(`${API}/api/reports/product-performance?${p}`);
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
    filters.categoryId,
    filters.brandId,
    filters.supplierId,
    filters.search,
  ]);

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
        title="Product Performance"
        subtitle="Cross-dimension view of item performance with category, brand, supplier, and realized margin"
        action={
          <ExportButton
            onClick={() =>
              exportCSV(
                "performance.csv",
                [
                  { header: "Product", key: "product_name" },
                  { header: "Barcode", key: "barcode" },
                  { header: "Category", key: "category" },
                  { header: "Brand", key: "brand" },
                  { header: "Supplier", key: "supplier" },
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
          cols={["Product", "Dimension Tags", "Units Sold", "Revenue", "Gross Profit", "Margin %"]}
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
              <td className="px-4 py-3">
                <div className="text-sm text-slate-700">{r.category}</div>
                <div className="text-[11px] text-slate-400">{r.brand}</div>
                <div className="text-[11px] text-slate-400">{r.supplier}</div>
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

// --- Tab: Brand Wise ----------------------------------------------------------
export function BrandWiseTab({ filters }) {
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
        category_id: filters.categoryId,
        brand_id: filters.brandId,
        supplier_id: filters.supplierId,
        search: filters.search,
      });
      const res = await fetch(`${API}/api/reports/brand-wise?${p}`);
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
    filters.categoryId,
    filters.brandId,
    filters.supplierId,
    filters.search,
  ]);

  useEffect(() => {
    load();
  }, [load]);

  const totalRevenue = rows.reduce((sum, row) => sum + Number(row.revenue || 0), 0);
  const totalGrossProfit = rows.reduce(
    (sum, row) => sum + Number(row.gross_profit || 0),
    0,
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Brands in View
          </p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{rows.length}</p>
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
          <p className="mt-2 text-2xl font-bold text-slate-900">{fmt(totalGrossProfit)}</p>
        </div>
      </div>

      <CardShell
        title="Brand Performance"
        subtitle="Sales, unit velocity, contribution, and gross profit by brand"
        action={
          <ExportButton
            onClick={() =>
              exportCSV(
                "brand_wise.csv",
                [
                  { header: "Brand", key: "brand" },
                  { header: "Orders", key: "order_count" },
                  { header: "Units Sold", key: "units_sold" },
                  { header: "Revenue", key: "revenue" },
                  { header: "Total Cost", key: "total_cost" },
                  { header: "Gross Profit", key: "gross_profit" },
                  { header: "Contribution %", key: "contribution_pct" },
                ],
                rows,
              )
            }
          />
        }
      >
        <TableShell
          cols={["Brand", "Orders", "Units Sold", "Revenue", "Gross Profit", "Contribution"]}
          loading={loading}
          empty={!rows.length}
        >
          {rows.map((r) => (
            <tr key={r.brand_id} className="hover:bg-slate-50">
              <td className="px-4 py-3 text-sm font-semibold text-slate-800">{r.brand}</td>
              <td className="px-4 py-3 text-sm text-slate-600">{r.order_count}</td>
              <td className="px-4 py-3 text-sm font-semibold text-slate-700">{r.units_sold}</td>
              <td className="px-4 py-3 text-sm font-bold text-slate-900">{fmt(r.revenue)}</td>
              <td className="px-4 py-3 text-sm font-semibold text-emerald-700">{fmt(r.gross_profit)}</td>
              <td className="px-4 py-3">
                <div className="text-sm font-bold text-slate-800">{r.contribution_pct}%</div>
                <div className="mt-1 h-1.5 w-20 rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-blue-500"
                    style={{ width: `${Math.max(0, Math.min(100, Number(r.contribution_pct || 0)))}%` }}
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

// --- Tab: Merchandising Workspace --------------------------------------------
export function MerchandisingWorkspaceTab({ filters, setFilters, setActiveTab }) {
  const [data, setData] = useState(null);
  const [comparison, setComparison] = useState(null);
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
        category_id: filters.categoryId,
        brand_id: filters.brandId,
        supplier_id: filters.supplierId,
        search: filters.search,
      });
      const [workspaceRes, comparisonRes] = await Promise.all([
        fetch(`${API}/api/reports/performance-workspace?${p}`).then((r) => r.json()),
        fetch(`${API}/api/reports/performance-comparison?${p}`).then((r) => r.json()),
      ]);
      setData(workspaceRes);
      setComparison(comparisonRes);
    } catch {
      setData(null);
      setComparison(null);
    } finally {
      setLoading(false);
    }
  }, [
    filters.dateFrom,
    filters.dateTo,
    filters.timeFrom,
    filters.timeTo,
    filters.outletId,
    filters.categoryId,
    filters.brandId,
    filters.supplierId,
    filters.search,
  ]);

  useEffect(() => {
    load();
  }, [load]);

  const summary = data?.summary || {};
  const items = data?.items || [];
  const categories = data?.categories || [];
  const brands = data?.brands || [];
  const suppliers = data?.suppliers || [];
  const comparisonRanges = comparison?.ranges || {};
  const itemComparison = comparison?.item_comparison || [];
  const categoryComparison = comparison?.category_comparison || [];
  const brandComparison = comparison?.brand_comparison || [];
  const supplierComparison = comparison?.supplier_comparison || [];
  const subcategoryComparison = comparison?.subcategory_comparison || [];
  const itemMonthly = comparison?.item_monthly || [];
  const categoryMonthly = comparison?.category_monthly || [];
  const brandMonthly = comparison?.brand_monthly || [];
  const supplierMonthly = comparison?.supplier_monthly || [];
  const subcategoryMonthly = comparison?.subcategory_monthly || [];
  const applyDrillFilter = (patch) => {
    setFilters?.((current) => ({
      ...current,
      ...patch,
    }));
  };
  const drillToProductPerformance = (patch) => {
    applyDrillFilter({
      search: "",
      ...patch,
    });
    setActiveTab?.("product-performance");
  };
  const comparisonExportRows = [
    ...itemComparison.map((row) => ({ dimension: "Item", ...row })),
    ...categoryComparison.map((row) => ({ dimension: "Category", ...row })),
    ...subcategoryComparison.map((row) => ({ dimension: "Sub-Category", ...row })),
    ...brandComparison.map((row) => ({ dimension: "Brand", ...row })),
    ...supplierComparison.map((row) => ({ dimension: "Supplier", ...row })),
  ];
  const monthlyExportRows = [
    ...itemMonthly.map((row) => ({ dimension: "Item", ...row })),
    ...categoryMonthly.map((row) => ({ dimension: "Category", ...row })),
    ...subcategoryMonthly.map((row) => ({ dimension: "Sub-Category", ...row })),
    ...brandMonthly.map((row) => ({ dimension: "Brand", ...row })),
    ...supplierMonthly.map((row) => ({ dimension: "Supplier", ...row })),
  ];
  const drillComparisonRow = (dimension, row) => {
    if (dimension === "brand") {
      drillToProductPerformance({ brandId: String(row.entity_id || "") });
      return;
    }
    if (dimension === "supplier") {
      drillToProductPerformance({ supplierId: String(row.entity_id || "") });
      return;
    }
    if (dimension === "category" || dimension === "subcategory") {
      drillToProductPerformance({ categoryId: String(row.entity_id || "") });
      return;
    }
    if (dimension === "item") {
      drillToProductPerformance({ search: row.entity_label || "" });
    }
  };
  const comparisonChartRows = [
    {
      label: "Items",
      current: itemComparison.reduce(
        (sum, row) => sum + Number(row.current_revenue || 0),
        0,
      ),
      previous: itemComparison.reduce(
        (sum, row) => sum + Number(row.previous_revenue || 0),
        0,
      ),
    },
    {
      label: "Categories",
      current: categoryComparison.reduce(
        (sum, row) => sum + Number(row.current_revenue || 0),
        0,
      ),
      previous: categoryComparison.reduce(
        (sum, row) => sum + Number(row.previous_revenue || 0),
        0,
      ),
    },
    {
      label: "Brands",
      current: brandComparison.reduce(
        (sum, row) => sum + Number(row.current_revenue || 0),
        0,
      ),
      previous: brandComparison.reduce(
        (sum, row) => sum + Number(row.previous_revenue || 0),
        0,
      ),
    },
    {
      label: "Suppliers",
      current: supplierComparison.reduce(
        (sum, row) => sum + Number(row.current_revenue || 0),
        0,
      ),
      previous: supplierComparison.reduce(
        (sum, row) => sum + Number(row.previous_revenue || 0),
        0,
      ),
    },
  ];
  const monthlyTrendRows = Array.from(
    new Set([
      ...itemMonthly.map((row) => row.month_bucket),
      ...categoryMonthly.map((row) => row.month_bucket),
      ...brandMonthly.map((row) => row.month_bucket),
      ...supplierMonthly.map((row) => row.month_bucket),
    ]),
  )
    .sort()
    .map((month) => ({
      month,
      itemRevenue: itemMonthly
        .filter((row) => row.month_bucket === month)
        .reduce((sum, row) => sum + Number(row.revenue || 0), 0),
      categoryRevenue: categoryMonthly
        .filter((row) => row.month_bucket === month)
        .reduce((sum, row) => sum + Number(row.revenue || 0), 0),
      brandRevenue: brandMonthly
        .filter((row) => row.month_bucket === month)
        .reduce((sum, row) => sum + Number(row.revenue || 0), 0),
      supplierRevenue: supplierMonthly
        .filter((row) => row.month_bucket === month)
        .reduce((sum, row) => sum + Number(row.revenue || 0), 0),
    }));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Revenue
          </p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{fmt(summary.revenue)}</p>
          <p className="mt-1 text-xs text-slate-500">{summary.order_count || 0} orders</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Gross Profit
          </p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{fmt(summary.gross_profit)}</p>
          <p className="mt-1 text-xs text-slate-500">{summary.units_sold || 0} units sold</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Brands / Suppliers
          </p>
          <p className="mt-2 text-2xl font-bold text-slate-900">
            {summary.brand_count || 0} / {summary.supplier_count || 0}
          </p>
          <p className="mt-1 text-xs text-slate-500">Dimensions represented</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            SKUs / Categories
          </p>
          <p className="mt-2 text-2xl font-bold text-slate-900">
            {summary.sku_count || 0} / {summary.category_count || 0}
          </p>
          <p className="mt-1 text-xs text-slate-500">Active in current view</p>
        </div>
      </div>

      <CardShell
        title="Unified Performance Workspace"
        subtitle="Single merchandising view across item, category, brand, and supplier"
        action={
          <ExportButton
            onClick={() =>
              exportCSV(
                "merchandising_workspace_items.csv",
                [
                  { header: "Product", key: "product_name" },
                  { header: "Barcode", key: "barcode" },
                  { header: "Category", key: "category" },
                  { header: "Brand", key: "brand" },
                  { header: "Supplier", key: "supplier" },
                  { header: "Units Sold", key: "units_sold" },
                  { header: "Revenue", key: "revenue" },
                  { header: "Gross Profit", key: "gross_profit" },
                  { header: "Margin %", key: "margin_pct" },
                ],
                items,
              )
            }
          />
        }
      >
        <div className="grid grid-cols-1 gap-4 p-4 xl:grid-cols-2">
          <div className="rounded-2xl border border-slate-200">
            <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
              <h3 className="font-bold text-slate-700">Top Items</h3>
              <p className="text-xs text-slate-500">Top revenue-driving products with cross-dimension tags</p>
            </div>
            <TableShell
              cols={["Product", "Dimension Tags", "Revenue", "Margin %"]}
              loading={loading}
              empty={!items.length}
            >
              {items.map((row) => (
                <tr key={row.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <div className="text-sm font-semibold text-slate-800">{row.product_name}</div>
                    <div className="font-mono text-[11px] text-slate-400">{row.barcode}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-sm text-slate-700">{row.category}</div>
                    <div className="text-[11px] text-slate-400">{row.brand}</div>
                    <div className="text-[11px] text-slate-400">{row.supplier}</div>
                  </td>
                  <td className="px-4 py-3 text-sm font-bold text-slate-900">{fmt(row.revenue)}</td>
                  <td className="px-4 py-3 text-sm font-semibold text-emerald-700">{row.margin_pct}%</td>
                </tr>
              ))}
              </TableShell>
          </div>

          <div className="grid grid-cols-1 gap-4">
            <div className="rounded-2xl border border-slate-200">
              <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
                <h3 className="font-bold text-slate-700">Category Leaders</h3>
              </div>
              <TableShell cols={["Category", "Units", "Revenue"]} loading={loading} empty={!categories.length}>
                {categories.map((row) => (
                  <tr key={row.category_id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <div className="text-sm font-semibold text-slate-800">{row.category}</div>
                      <button
                        type="button"
                        onClick={() =>
                          drillToProductPerformance({
                            categoryId: String(row.category_id || ""),
                          })
                        }
                        className="mt-1 text-[11px] font-semibold text-blue-600 hover:text-blue-700"
                      >
                        Open in product performance
                      </button>
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600">{row.units_sold}</td>
                    <td className="px-4 py-3 text-sm font-bold text-slate-900">{fmt(row.revenue)}</td>
                  </tr>
                ))}
              </TableShell>
            </div>

            <div className="rounded-2xl border border-slate-200">
              <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
                <h3 className="font-bold text-slate-700">Brand Leaders</h3>
              </div>
              <TableShell cols={["Brand", "Units", "Revenue"]} loading={loading} empty={!brands.length}>
                {brands.map((row) => (
                  <tr key={row.brand_id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <div className="text-sm font-semibold text-slate-800">{row.brand}</div>
                      <button
                        type="button"
                        onClick={() =>
                          drillToProductPerformance({
                            brandId: String(row.brand_id || ""),
                          })
                        }
                        className="mt-1 text-[11px] font-semibold text-blue-600 hover:text-blue-700"
                      >
                        Open in product performance
                      </button>
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600">{row.units_sold}</td>
                    <td className="px-4 py-3 text-sm font-bold text-slate-900">{fmt(row.revenue)}</td>
                  </tr>
                ))}
              </TableShell>
            </div>

            <div className="rounded-2xl border border-slate-200">
              <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
                <h3 className="font-bold text-slate-700">Supplier Leaders</h3>
              </div>
              <TableShell cols={["Supplier", "Units", "Revenue"]} loading={loading} empty={!suppliers.length}>
                {suppliers.map((row) => (
                  <tr key={row.supplier_id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <div className="text-sm font-semibold text-slate-800">{row.supplier}</div>
                      <button
                        type="button"
                        onClick={() =>
                          drillToProductPerformance({
                            supplierId: String(row.supplier_id || ""),
                          })
                        }
                        className="mt-1 text-[11px] font-semibold text-blue-600 hover:text-blue-700"
                      >
                        Open in product performance
                      </button>
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600">{row.units_sold}</td>
                    <td className="px-4 py-3 text-sm font-bold text-slate-900">{fmt(row.revenue)}</td>
                  </tr>
                ))}
              </TableShell>
            </div>
          </div>
        </div>
      </CardShell>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <CardShell
          title="Date Comparison"
          subtitle={`Current ${comparisonRanges.current?.from || "-"} to ${comparisonRanges.current?.to || "-"} compared with ${comparisonRanges.previous?.from || "-"} to ${comparisonRanges.previous?.to || "-"}`}
          action={
            <ExportButton
              onClick={() =>
                exportCSV(
                  "performance_comparison.csv",
                  [
                    { header: "Dimension", key: "dimension" },
                    { header: "Label", key: "entity_label" },
                    { header: "Current Revenue", key: "current_revenue" },
                    { header: "Previous Revenue", key: "previous_revenue" },
                    { header: "Revenue Delta", key: "revenue_delta" },
                    { header: "Revenue Delta %", key: "revenue_delta_pct" },
                    { header: "Current Units", key: "current_units" },
                    { header: "Previous Units", key: "previous_units" },
                  ],
                  comparisonExportRows,
                )
              }
            />
          }
        >
          <div className="grid grid-cols-1 gap-4 p-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="mb-3">
                <h3 className="font-bold text-slate-700">Comparison Overview</h3>
                <p className="text-xs text-slate-500">Current-period revenue against the previous matching window</p>
              </div>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={comparisonChartRows}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                    <Tooltip formatter={(value) => fmt(value)} />
                    <Bar dataKey="current" fill="#2563eb" radius={[6, 6, 0, 0]} />
                    <Bar dataKey="previous" fill="#cbd5e1" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200">
              <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
                <h3 className="font-bold text-slate-700">Top Item Comparison</h3>
              </div>
              <TableShell cols={["Item", "Current", "Previous", "Delta"]} loading={loading} empty={!itemComparison.length}>
                {itemComparison.map((row) => (
                  <tr
                    key={row.entity_id}
                    className="cursor-pointer hover:bg-slate-50"
                    onClick={() => drillComparisonRow("item", row)}
                  >
                    <td className="px-4 py-3">
                      <div className="text-sm font-semibold text-slate-800">{row.entity_label}</div>
                      <div className="text-[11px] font-semibold text-blue-600">Open in product performance</div>
                    </td>
                    <td className="px-4 py-3 text-sm font-bold text-slate-900">{fmt(row.current_revenue)}</td>
                    <td className="px-4 py-3 text-sm text-slate-600">{fmt(row.previous_revenue)}</td>
                    <td className={`px-4 py-3 text-sm font-semibold ${Number(row.revenue_delta || 0) >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                      {fmt(row.revenue_delta)} ({row.revenue_delta_pct}%)
                    </td>
                  </tr>
                ))}
              </TableShell>
            </div>

            <div className="rounded-2xl border border-slate-200">
              <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
                <h3 className="font-bold text-slate-700">Top Category Comparison</h3>
              </div>
              <TableShell cols={["Category", "Current", "Previous", "Delta"]} loading={loading} empty={!categoryComparison.length}>
                {categoryComparison.map((row) => (
                  <tr
                    key={row.entity_id}
                    className="cursor-pointer hover:bg-slate-50"
                    onClick={() => drillComparisonRow("category", row)}
                  >
                    <td className="px-4 py-3">
                      <div className="text-sm font-semibold text-slate-800">{row.entity_label}</div>
                      <div className="text-[11px] font-semibold text-blue-600">Open in product performance</div>
                    </td>
                    <td className="px-4 py-3 text-sm font-bold text-slate-900">{fmt(row.current_revenue)}</td>
                    <td className="px-4 py-3 text-sm text-slate-600">{fmt(row.previous_revenue)}</td>
                    <td className={`px-4 py-3 text-sm font-semibold ${Number(row.revenue_delta || 0) >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                      {fmt(row.revenue_delta)} ({row.revenue_delta_pct}%)
                    </td>
                  </tr>
                ))}
              </TableShell>
            </div>

            <div className="rounded-2xl border border-slate-200">
              <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
                <h3 className="font-bold text-slate-700">Top Brand Comparison</h3>
              </div>
              <TableShell cols={["Brand", "Current", "Previous", "Delta"]} loading={loading} empty={!brandComparison.length}>
                {brandComparison.map((row) => (
                  <tr
                    key={row.entity_id}
                    className="cursor-pointer hover:bg-slate-50"
                    onClick={() => drillComparisonRow("brand", row)}
                  >
                    <td className="px-4 py-3">
                      <div className="text-sm font-semibold text-slate-800">{row.entity_label}</div>
                      <div className="text-[11px] font-semibold text-blue-600">Open in product performance</div>
                    </td>
                    <td className="px-4 py-3 text-sm font-bold text-slate-900">{fmt(row.current_revenue)}</td>
                    <td className="px-4 py-3 text-sm text-slate-600">{fmt(row.previous_revenue)}</td>
                    <td className={`px-4 py-3 text-sm font-semibold ${Number(row.revenue_delta || 0) >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                      {fmt(row.revenue_delta)} ({row.revenue_delta_pct}%)
                    </td>
                  </tr>
                ))}
              </TableShell>
            </div>

            <div className="rounded-2xl border border-slate-200">
              <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
                <h3 className="font-bold text-slate-700">Top Supplier Comparison</h3>
              </div>
              <TableShell cols={["Supplier", "Current", "Previous", "Delta"]} loading={loading} empty={!supplierComparison.length}>
                {supplierComparison.map((row) => (
                  <tr
                    key={row.entity_id}
                    className="cursor-pointer hover:bg-slate-50"
                    onClick={() => drillComparisonRow("supplier", row)}
                  >
                    <td className="px-4 py-3">
                      <div className="text-sm font-semibold text-slate-800">{row.entity_label}</div>
                      <div className="text-[11px] font-semibold text-blue-600">Open in product performance</div>
                    </td>
                    <td className="px-4 py-3 text-sm font-bold text-slate-900">{fmt(row.current_revenue)}</td>
                    <td className="px-4 py-3 text-sm text-slate-600">{fmt(row.previous_revenue)}</td>
                    <td className={`px-4 py-3 text-sm font-semibold ${Number(row.revenue_delta || 0) >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                      {fmt(row.revenue_delta)} ({row.revenue_delta_pct}%)
                    </td>
                  </tr>
                ))}
              </TableShell>
            </div>

            <div className="rounded-2xl border border-slate-200">
              <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
                <h3 className="font-bold text-slate-700">Top Sub-Category Comparison</h3>
              </div>
              <TableShell cols={["Sub-Category", "Current", "Previous", "Delta"]} loading={loading} empty={!subcategoryComparison.length}>
                {subcategoryComparison.map((row) => (
                  <tr
                    key={row.entity_id}
                    className="cursor-pointer hover:bg-slate-50"
                    onClick={() => drillComparisonRow("subcategory", row)}
                  >
                    <td className="px-4 py-3">
                      <div className="text-sm font-semibold text-slate-800">{row.entity_label}</div>
                      <div className="text-[11px] font-semibold text-blue-600">Open in product performance</div>
                    </td>
                    <td className="px-4 py-3 text-sm font-bold text-slate-900">{fmt(row.current_revenue)}</td>
                    <td className="px-4 py-3 text-sm text-slate-600">{fmt(row.previous_revenue)}</td>
                    <td className={`px-4 py-3 text-sm font-semibold ${Number(row.revenue_delta || 0) >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                      {fmt(row.revenue_delta)} ({row.revenue_delta_pct}%)
                    </td>
                  </tr>
                ))}
              </TableShell>
            </div>
          </div>
        </CardShell>

        <CardShell
          title="Monthly Leaders"
          subtitle="Top item, category, and brand for each month in the selected window"
          action={
            <ExportButton
              onClick={() =>
                exportCSV(
                  "performance_monthly_leaders.csv",
                  [
                    { header: "Dimension", key: "dimension" },
                    { header: "Month", key: "month_bucket" },
                    { header: "Leader", key: "entity_label" },
                    { header: "Units Sold", key: "units_sold" },
                    { header: "Revenue", key: "revenue" },
                  ],
                  monthlyExportRows,
                )
              }
            />
          }
        >
          <div className="grid grid-cols-1 gap-4 p-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="mb-3">
                <h3 className="font-bold text-slate-700">Trend Lines</h3>
                <p className="text-xs text-slate-500">Monthly revenue leaders by dimension</p>
              </div>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={monthlyTrendRows}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                    <Tooltip formatter={(value) => fmt(value)} />
                    <Line type="monotone" dataKey="itemRevenue" stroke="#2563eb" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="categoryRevenue" stroke="#16a34a" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="brandRevenue" stroke="#ea580c" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="supplierRevenue" stroke="#7c3aed" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200">
              <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
                <h3 className="font-bold text-slate-700">Item Leaders by Month</h3>
              </div>
              <TableShell cols={["Month", "Leader", "Revenue"]} loading={loading} empty={!itemMonthly.length}>
                {itemMonthly.map((row, index) => (
                  <tr key={`${row.month_bucket}-${row.entity_id}-${index}`} className="hover:bg-slate-50">
                    <td className="px-4 py-3 text-sm text-slate-600">{row.month_bucket}</td>
                    <td className="px-4 py-3 text-sm font-semibold text-slate-800">{row.entity_label}</td>
                    <td className="px-4 py-3 text-sm font-bold text-slate-900">{fmt(row.revenue)}</td>
                  </tr>
                ))}
              </TableShell>
            </div>

            <div className="rounded-2xl border border-slate-200">
              <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
                <h3 className="font-bold text-slate-700">Category Leaders by Month</h3>
              </div>
              <TableShell cols={["Month", "Leader", "Revenue"]} loading={loading} empty={!categoryMonthly.length}>
                {categoryMonthly.map((row, index) => (
                  <tr key={`${row.month_bucket}-${row.entity_id}-${index}`} className="hover:bg-slate-50">
                    <td className="px-4 py-3 text-sm text-slate-600">{row.month_bucket}</td>
                    <td className="px-4 py-3 text-sm font-semibold text-slate-800">{row.entity_label}</td>
                    <td className="px-4 py-3 text-sm font-bold text-slate-900">{fmt(row.revenue)}</td>
                  </tr>
                ))}
              </TableShell>
            </div>

            <div className="rounded-2xl border border-slate-200">
              <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
                <h3 className="font-bold text-slate-700">Brand Leaders by Month</h3>
              </div>
              <TableShell cols={["Month", "Leader", "Revenue"]} loading={loading} empty={!brandMonthly.length}>
                {brandMonthly.map((row, index) => (
                  <tr key={`${row.month_bucket}-${row.entity_id}-${index}`} className="hover:bg-slate-50">
                    <td className="px-4 py-3 text-sm text-slate-600">{row.month_bucket}</td>
                    <td className="px-4 py-3 text-sm font-semibold text-slate-800">{row.entity_label}</td>
                    <td className="px-4 py-3 text-sm font-bold text-slate-900">{fmt(row.revenue)}</td>
                  </tr>
                ))}
              </TableShell>
            </div>

            <div className="rounded-2xl border border-slate-200">
              <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
                <h3 className="font-bold text-slate-700">Supplier Leaders by Month</h3>
              </div>
              <TableShell cols={["Month", "Leader", "Revenue"]} loading={loading} empty={!supplierMonthly.length}>
                {supplierMonthly.map((row, index) => (
                  <tr key={`${row.month_bucket}-${row.entity_id}-${index}`} className="hover:bg-slate-50">
                    <td className="px-4 py-3 text-sm text-slate-600">{row.month_bucket}</td>
                    <td className="px-4 py-3 text-sm font-semibold text-slate-800">{row.entity_label}</td>
                    <td className="px-4 py-3 text-sm font-bold text-slate-900">{fmt(row.revenue)}</td>
                  </tr>
                ))}
              </TableShell>
            </div>

            <div className="rounded-2xl border border-slate-200">
              <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
                <h3 className="font-bold text-slate-700">Sub-Category Leaders by Month</h3>
              </div>
              <TableShell cols={["Month", "Leader", "Revenue"]} loading={loading} empty={!subcategoryMonthly.length}>
                {subcategoryMonthly.map((row, index) => (
                  <tr key={`${row.month_bucket}-${row.entity_id}-${index}`} className="hover:bg-slate-50">
                    <td className="px-4 py-3 text-sm text-slate-600">{row.month_bucket}</td>
                    <td className="px-4 py-3 text-sm font-semibold text-slate-800">{row.entity_label}</td>
                    <td className="px-4 py-3 text-sm font-bold text-slate-900">{fmt(row.revenue)}</td>
                  </tr>
                ))}
              </TableShell>
            </div>
          </div>
        </CardShell>
      </div>
    </div>
  );
}

// --- Tab: On Hand Inventory ---------------------------------------------------
export function OnHandTab({ filters }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [aggregate, setAggregate] = useState(false);
  const [anomaly, setAnomaly] = useState("");
  const [marginThreshold, setMarginThreshold] = useState(15);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({
        outlet_id: filters.outletId,
        category_id: filters.categoryId,
        brand_id: filters.brandId,
        supplier_id: filters.supplierId,
        search: filters.search,
        aggregate: aggregate ? "1" : "0",
        anomaly,
        margin_threshold: String(marginThreshold),
      });
      const res = await fetch(`${API}/api/reports/on-hand?${p}`);
      const d = await res.json();
      setRows(d.items || []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [
    filters.outletId,
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

// --- Tab: Replenishment -------------------------------------------------------
export function ReplenishmentTab({ filters }) {
  const { authHeaders } = useAuth();
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
      const candidates = rowsWithSuggestion.filter(
        (row) => Number(row.suggested_order || 0) > 0 && Number(row.supplier_id || 0) > 0,
      );
      const grouped = new Map();
      candidates.forEach((row) => {
        const sid = Number(row.supplier_id || 0);
        if (!grouped.has(sid)) grouped.set(sid, []);
        grouped.get(sid).push(row);
      });

      let createdCount = 0;
      const failed = [];
      for (const [supplierId, supplierRows] of grouped.entries()) {
        const items = supplierRows.map((row) => ({
          product_id: Number(row.product_id),
          quantity: Number(row.suggested_order || 0),
          cost_price: Number(row.cost_price || 0),
        }));
        const total_cost = items.reduce(
          (sum, item) => sum + Number(item.quantity || 0) * Number(item.cost_price || 0),
          0,
        );

        const res = await fetch(`${API}/api/purchase-orders`, {
          method: "POST",
          headers: authHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({
            supplier_id: supplierId,
            total_cost,
            items,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
          createdCount += 1;
        } else {
          failed.push(`Supplier ${supplierId}: ${data.error || "Request failed"}`);
        }
      }

      const result = {
        success: failed.length === 0,
        created_count: createdCount,
        failed,
      };
      setDraftResult(result);
      if (result.success) load();
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
  const [aggregate, setAggregate] = useState(false);
  const [anomaly, setAnomaly] = useState("margin_risk");
  const [marginThreshold, setMarginThreshold] = useState(15);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({
        outlet_id: filters.outletId,
        category_id: filters.categoryId,
        brand_id: filters.brandId,
        supplier_id: filters.supplierId,
        search: filters.search,
        aggregate: aggregate ? "1" : "0",
        anomaly,
        margin_threshold: String(marginThreshold),
      });
      const res = await fetch(`${API}/api/reports/pricing-exceptions?${p}`);
      const d = await res.json();
      setRows(d.items || []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [
    filters.outletId,
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

// --- Tab: Dead Stock ---------------------------------------------------------
export function DeadStockTab({ filters }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [inactiveDays, setInactiveDays] = useState(60);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({
        outlet_id: filters.outletId,
        category_id: filters.categoryId,
        brand_id: filters.brandId,
        supplier_id: filters.supplierId,
        search: filters.search,
        inactive_days: String(inactiveDays),
      });
      const res = await fetch(`${API}/api/reports/dead-stock?${p}`);
      const d = await res.json();
      setRows(d.items || d.rows || []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [
    filters.outletId,
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
export function StockAgingTab({ filters }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({
        outlet_id: filters.outletId,
        category_id: filters.categoryId,
        brand_id: filters.brandId,
        supplier_id: filters.supplierId,
        search: filters.search,
      });
      const res = await fetch(`${API}/api/reports/stock-aging?${p}`);
      const d = await res.json();
      setRows(d.items || d.rows || []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [
    filters.outletId,
    filters.categoryId,
    filters.brandId,
    filters.supplierId,
    filters.search,
  ]);

  useEffect(() => {
    load();
  }, [load]);

  const olderThan90 = rows.filter((row) => Number(row.days_since_sale || 99999) >= 90).length;
  const olderThan180 = rows.filter((row) => Number(row.days_since_sale || 99999) >= 180).length;
  const totalCost = rows.reduce((sum, row) => sum + Number(row.stock_cost_value || 0), 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <InventoryHealthStat label="Rows" value={rows.length} />
        <InventoryHealthStat label="90+ Days" value={olderThan90} />
        <InventoryHealthStat label="180+ Days" value={olderThan180} />
        <InventoryHealthStat label="Cost at Risk" value={fmt(totalCost)} />
      </div>

      <CardShell
        title="Stock Aging"
        subtitle="Outlet-level aging ladder by last sale date to identify stale inventory before it turns into dead stock"
        action={
          <ExportButton
            onClick={() =>
              exportCSV(
                "stock_aging.csv",
                [
                  { header: "Product", key: "product_name" },
                  { header: "Barcode", key: "barcode" },
                  { header: "Outlet", key: "outlet_name" },
                  { header: "Category", key: "category" },
                  { header: "Brand", key: "brand" },
                  { header: "Supplier", key: "supplier" },
                  { header: "Stock Qty", key: "stock_qty" },
                  { header: "Cost Value", key: "stock_cost_value" },
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
          cols={["Product", "Outlet / Tags", "Stock", "Last Sold", "Age Bucket", "Cost Value"]}
          loading={loading}
          empty={!rows.length}
          emptyIcon={AlertTriangle}
        >
          {rows.map((row, i) => {
            const age = Number(row.days_since_sale || 99999);
            const ageLabel = age >= 180 ? "180+ Days" : age >= 90 ? "90+ Days" : age >= 30 ? "30+ Days" : "< 30 Days";
            const tone = age >= 180 ? "bg-rose-50 text-rose-700" : age >= 90 ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-700";
            return (
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
                  <span className={`rounded-full px-2 py-1 text-xs font-bold ${tone}`}>
                    {ageLabel}
                  </span>
                </td>
                <td className="px-4 py-3 text-sm font-semibold text-slate-800">{fmt(row.stock_cost_value)}</td>
              </tr>
            );
          })}
        </TableShell>
      </CardShell>
    </div>
  );
}

// --- Tab: Stockout Risk ------------------------------------------------------
export function StockoutRiskTab({ filters }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lookbackDays, setLookbackDays] = useState(30);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({
        outlet_id: filters.outletId,
        category_id: filters.categoryId,
        brand_id: filters.brandId,
        supplier_id: filters.supplierId,
        search: filters.search,
        lookback_days: String(lookbackDays),
      });
      const res = await fetch(`${API}/api/reports/stockout-risk?${p}`);
      const d = await res.json();
      setRows(d.items || d.rows || []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [
    filters.outletId,
    filters.categoryId,
    filters.brandId,
    filters.supplierId,
    filters.search,
    lookbackDays,
  ]);

  useEffect(() => {
    load();
  }, [load]);

  const highRisk = rows.filter((row) => row.risk_level === "high").length;
  const mediumRisk = rows.filter((row) => row.risk_level === "medium").length;
  const stable = rows.filter((row) => row.risk_level === "stable").length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-1.5">
          <span className="text-xs font-semibold text-slate-500">Lookback Days</span>
          <input
            type="number"
            min="7"
            max="365"
            value={lookbackDays}
            onChange={(e) => setLookbackDays(Number(e.target.value || 7))}
            className="w-20 border-none bg-transparent p-0 text-sm font-semibold focus:ring-0"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <InventoryHealthStat label="High Risk" value={highRisk} />
        <InventoryHealthStat label="Medium Risk" value={mediumRisk} />
        <InventoryHealthStat label="Stable" value={stable} />
        <InventoryHealthStat label="Rows" value={rows.length} />
      </div>

      <CardShell
        title="Stockout Risk"
        subtitle="Velocity-based days-of-cover view to spot fast movers that will run out soon"
        action={
          <ExportButton
            onClick={() =>
              exportCSV(
                "stockout_risk.csv",
                [
                  { header: "Product", key: "product_name" },
                  { header: "Barcode", key: "barcode" },
                  { header: "Outlet", key: "outlet_name" },
                  { header: "Category", key: "category" },
                  { header: "Brand", key: "brand" },
                  { header: "Supplier", key: "supplier" },
                  { header: "Stock Qty", key: "stock_qty" },
                  { header: "Average Daily Units", key: "avg_daily_units" },
                  { header: "Days of Cover", key: "days_of_cover" },
                  { header: "Risk Level", key: "risk_level" },
                ],
                rows,
              )
            }
          />
        }
      >
        <TableShell
          cols={["Product", "Outlet / Tags", "On Hand", "Velocity", "Days of Cover", "Risk"]}
          loading={loading}
          empty={!rows.length}
          emptyIcon={AlertTriangle}
        >
          {rows.map((row, i) => {
            const riskTone =
              row.risk_level === "high"
                ? "bg-rose-50 text-rose-700"
                : row.risk_level === "medium"
                  ? "bg-amber-50 text-amber-700"
                  : "bg-slate-100 text-slate-700";
            return (
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
                <td className="px-4 py-3 text-sm text-slate-600">{Number(row.avg_daily_units || 0).toFixed(2)} / day</td>
                <td className="px-4 py-3 text-sm font-semibold text-slate-800">
                  {row.days_of_cover == null ? "N/A" : row.days_of_cover}
                </td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-1 text-xs font-bold uppercase ${riskTone}`}>
                    {row.risk_level || "stable"}
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

// --- Tab: Forecast Demand ----------------------------------------------------
export function ForecastDemandTab({ filters }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lookbackDays, setLookbackDays] = useState(28);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({
        outlet_id: filters.outletId,
        category_id: filters.categoryId,
        brand_id: filters.brandId,
        supplier_id: filters.supplierId,
        search: filters.search,
        lookback_days: String(lookbackDays),
      });
      const res = await fetch(`${API}/api/reports/forecast-demand?${p}`);
      const d = await res.json();
      setRows(d.items || d.rows || []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [
    filters.outletId,
    filters.categoryId,
    filters.brandId,
    filters.supplierId,
    filters.search,
    lookbackDays,
  ]);

  useEffect(() => {
    load();
  }, [load]);

  const totalForecast7d = rows.reduce((sum, row) => sum + Number(row.forecast_7d_units || 0), 0);
  const totalForecast14d = rows.reduce((sum, row) => sum + Number(row.forecast_14d_units || 0), 0);
  const atRisk = rows.filter((row) => Number(row.days_of_cover || 99999) < 14).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-1.5">
          <span className="text-xs font-semibold text-slate-500">Lookback Days</span>
          <input
            type="number"
            min="7"
            max="365"
            value={lookbackDays}
            onChange={(e) => setLookbackDays(Number(e.target.value || 7))}
            className="w-20 border-none bg-transparent p-0 text-sm font-semibold focus:ring-0"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <InventoryHealthStat label="Rows" value={rows.length} />
        <InventoryHealthStat label="7-Day Forecast" value={Math.round(totalForecast7d)} />
        <InventoryHealthStat label="14-Day Forecast" value={Math.round(totalForecast14d)} />
        <InventoryHealthStat label="Cover < 14 Days" value={atRisk} />
      </div>

      <CardShell
        title="Forecast Demand"
        subtitle="Moving-average demand projection using recent sales velocity by outlet"
        action={
          <ExportButton
            onClick={() =>
              exportCSV(
                "forecast_demand.csv",
                [
                  { header: "Product", key: "product_name" },
                  { header: "Barcode", key: "barcode" },
                  { header: "Outlet", key: "outlet_name" },
                  { header: "Category", key: "category" },
                  { header: "Brand", key: "brand" },
                  { header: "Supplier", key: "supplier" },
                  { header: "Units Lookback", key: "units_lookback" },
                  { header: "Average Daily Units", key: "avg_daily_units" },
                  { header: "On Hand", key: "on_hand_qty" },
                  { header: "Forecast 7D", key: "forecast_7d_units" },
                  { header: "Forecast 14D", key: "forecast_14d_units" },
                  { header: "Days of Cover", key: "days_of_cover" },
                ],
                rows,
              )
            }
          />
        }
      >
        <TableShell
          cols={["Product", "Outlet / Tags", "Avg Daily", "On Hand", "Forecast 7D / 14D", "Cover"]}
          loading={loading}
          empty={!rows.length}
          emptyIcon={TrendingUp}
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
              <td className="px-4 py-3 text-sm font-semibold text-slate-800">
                {Number(row.avg_daily_units || 0).toFixed(2)}
              </td>
              <td className="px-4 py-3 text-sm font-bold text-slate-900">{row.on_hand_qty}</td>
              <td className="px-4 py-3 text-sm text-slate-600">
                <div>7D: {Number(row.forecast_7d_units || 0).toFixed(2)}</div>
                <div className="text-[11px] text-slate-400">14D: {Number(row.forecast_14d_units || 0).toFixed(2)}</div>
              </td>
              <td className="px-4 py-3 text-sm font-semibold text-slate-800">
                {row.days_of_cover == null ? "N/A" : row.days_of_cover}
              </td>
            </tr>
          ))}
        </TableShell>
      </CardShell>
    </div>
  );
}

// --- Tab: Replenishment Smart ------------------------------------------------
export function ReplenishmentSmartTab({ filters }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lookbackDays, setLookbackDays] = useState(28);
  const [forecastDays, setForecastDays] = useState(14);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({
        outlet_id: filters.outletId,
        category_id: filters.categoryId,
        brand_id: filters.brandId,
        supplier_id: filters.supplierId,
        search: filters.search,
        lookback_days: String(lookbackDays),
        forecast_days: String(forecastDays),
      });
      const res = await fetch(`${API}/api/reports/replenishment-smart?${p}`);
      const d = await res.json();
      setRows(d.items || d.rows || []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [
    filters.outletId,
    filters.categoryId,
    filters.brandId,
    filters.supplierId,
    filters.search,
    lookbackDays,
    forecastDays,
  ]);

  useEffect(() => {
    load();
  }, [load]);

  const reorderRows = rows.filter((row) => Number(row.suggested_reorder_qty || 0) > 0);
  const totalSuggested = reorderRows.reduce((sum, row) => sum + Number(row.suggested_reorder_qty || 0), 0);
  const totalTarget = reorderRows.reduce((sum, row) => sum + Number(row.target_cover_units || 0), 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-1.5">
          <span className="text-xs font-semibold text-slate-500">Lookback</span>
          <input
            type="number"
            min="7"
            max="365"
            value={lookbackDays}
            onChange={(e) => setLookbackDays(Number(e.target.value || 7))}
            className="w-16 border-none bg-transparent p-0 text-sm font-semibold focus:ring-0"
          />
        </div>
        <div className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-1.5">
          <span className="text-xs font-semibold text-slate-500">Forecast</span>
          <input
            type="number"
            min="7"
            max="90"
            value={forecastDays}
            onChange={(e) => setForecastDays(Number(e.target.value || 7))}
            className="w-16 border-none bg-transparent p-0 text-sm font-semibold focus:ring-0"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <InventoryHealthStat label="Reorder Rows" value={reorderRows.length} />
        <InventoryHealthStat label="Suggested Qty" value={totalSuggested} />
        <InventoryHealthStat label="Target Cover Units" value={Math.round(totalTarget)} />
        <InventoryHealthStat label="Rows in Scope" value={rows.length} />
      </div>

      <CardShell
        title="Replenishment Smart"
        subtitle="Suggested reorder quantities from velocity, on-hand, and chosen forecast cover window"
        action={
          <ExportButton
            onClick={() =>
              exportCSV(
                "replenishment_smart.csv",
                [
                  { header: "Product", key: "product_name" },
                  { header: "Barcode", key: "barcode" },
                  { header: "Outlet", key: "outlet_name" },
                  { header: "Category", key: "category" },
                  { header: "Brand", key: "brand" },
                  { header: "Supplier", key: "supplier" },
                  { header: "Average Daily Units", key: "avg_daily_units" },
                  { header: "On Hand", key: "on_hand_qty" },
                  { header: "Days of Cover", key: "days_of_cover" },
                  { header: "Target Cover Units", key: "target_cover_units" },
                  { header: "Suggested Reorder Qty", key: "suggested_reorder_qty" },
                ],
                reorderRows,
              )
            }
          />
        }
      >
        <TableShell
          cols={["Product", "Outlet / Tags", "Avg Daily", "On Hand", "Target Cover", "Suggested Reorder"]}
          loading={loading}
          empty={!reorderRows.length}
          emptyIcon={ShoppingCart}
        >
          {reorderRows.map((row, i) => (
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
              <td className="px-4 py-3 text-sm font-semibold text-slate-800">
                {Number(row.avg_daily_units || 0).toFixed(2)}
              </td>
              <td className="px-4 py-3 text-sm font-bold text-slate-900">{row.on_hand_qty}</td>
              <td className="px-4 py-3 text-sm text-slate-600">
                <div>{Number(row.target_cover_units || 0).toFixed(2)} units</div>
                <div className="text-[11px] text-slate-400">{row.days_of_cover ?? "N/A"} days cover</div>
              </td>
              <td className="px-4 py-3">
                <span className="rounded-full bg-blue-50 px-2 py-1 text-xs font-bold text-blue-700">
                  +{row.suggested_reorder_qty}
                </span>
              </td>
            </tr>
          ))}
        </TableShell>
      </CardShell>
    </div>
  );
}
