import React, { useState, useEffect, useCallback } from "react";
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
import { api } from "../../api";
import {
  exportCSV,
  ExportButton,
  TableShell,
  CardShell,
} from "./ReportShared";
import { useCurrency } from "../../contexts/CurrencyContext";

// --- Tab: Product Performance -------------------------------------------------
export function ProductPerformanceTab({ filters }) {
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
        category_id: filters.categoryId,
        brand_id: filters.brandId,
        supplier_id: filters.supplierId,
        search: filters.search,
      });
      if (filters.outletIds && filters.outletIds.length) p.set("outlet_id", filters.outletIds.join(","));
      const d = await api.get(`/api/reports/product-performance?${p}`);
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
        <div className="rounded-2xl border border-(--ui-border) bg-(--ui-surface) p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">
            Units Sold
          </p>
          <p className="mt-2 text-2xl font-bold text-(--ui-text)">{totalUnits}</p>
        </div>
        <div className="rounded-2xl border border-(--ui-border) bg-(--ui-surface) p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">
            Revenue
          </p>
          <p className="mt-2 text-2xl font-bold text-(--ui-text)">{fmt(totalRevenue)}</p>
        </div>
        <div className="rounded-2xl border border-(--ui-border) bg-(--ui-surface) p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">
            Gross Profit
          </p>
          <p className="mt-2 text-2xl font-bold text-(--ui-text)">
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
            <tr key={`${r.id}-${i}`} className="hover:bg-(--ui-muted-surface) transition-colors">
              <td className="px-4 py-3">
                <div className="text-sm font-semibold text-(--ui-text)">
                  {r.product_name}
                </div>
                <div className="font-mono text-[11px] text-(--ui-text-muted)">
                  {r.barcode}
                </div>
              </td>
              <td className="px-4 py-3">
                <div className="text-sm text-(--ui-text)">{r.category}</div>
                <div className="text-[11px] text-(--ui-text-muted)">{r.brand}</div>
                <div className="text-[11px] text-(--ui-text-muted)">{r.supplier}</div>
              </td>
              <td className="px-4 py-3 text-sm font-bold text-(--ui-text)">
                {r.units_sold}
              </td>
              <td className="px-4 py-3 text-sm font-semibold text-(--ui-text)">
                {fmt(r.revenue)}
              </td>
              <td className="px-4 py-3 text-sm font-bold text-(--ui-link)">
                {fmt(r.gross_profit)}
              </td>
              <td className="px-4 py-3">
                <div className="text-sm font-bold text-(--ui-success-fg)">
                  {r.margin_pct}%
                </div>
                <div className="mt-1 h-1 w-16 rounded-full bg-(--ui-muted-surface)">
                  <div
                    className="h-full rounded-full bg-(--ui-success-fg)"
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
        category_id: filters.categoryId,
        brand_id: filters.brandId,
        supplier_id: filters.supplierId,
        search: filters.search,
      });
      if (filters.outletIds && filters.outletIds.length) p.set("outlet_id", filters.outletIds.join(","));
      const d = await api.get(`/api/reports/brand-wise?${p}`);
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
        <div className="rounded-2xl border border-(--ui-border) bg-(--ui-surface) p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">
            Brands in View
          </p>
          <p className="mt-2 text-2xl font-bold text-(--ui-text)">{rows.length}</p>
        </div>
        <div className="rounded-2xl border border-(--ui-border) bg-(--ui-surface) p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">
            Revenue
          </p>
          <p className="mt-2 text-2xl font-bold text-(--ui-text)">{fmt(totalRevenue)}</p>
        </div>
        <div className="rounded-2xl border border-(--ui-border) bg-(--ui-surface) p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">
            Gross Profit
          </p>
          <p className="mt-2 text-2xl font-bold text-(--ui-text)">{fmt(totalGrossProfit)}</p>
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
            <tr key={r.brand_id} className="hover:bg-(--ui-muted-surface)">
              <td className="px-4 py-3 text-sm font-semibold text-(--ui-text)">{r.brand}</td>
              <td className="px-4 py-3 text-sm text-(--ui-text-muted)">{r.order_count}</td>
              <td className="px-4 py-3 text-sm font-semibold text-(--ui-text)">{r.units_sold}</td>
              <td className="px-4 py-3 text-sm font-bold text-(--ui-text)">{fmt(r.revenue)}</td>
              <td className="px-4 py-3 text-sm font-semibold text-(--ui-success-fg)">{fmt(r.gross_profit)}</td>
              <td className="px-4 py-3">
                <div className="text-sm font-bold text-(--ui-text)">{r.contribution_pct}%</div>
                <div className="mt-1 h-1.5 w-20 rounded-full bg-(--ui-muted-surface)">
                  <div
                    className="h-full rounded-full bg-(--ui-primary)"
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
  const { fmt } = useCurrency();
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
        category_id: filters.categoryId,
        brand_id: filters.brandId,
        supplier_id: filters.supplierId,
        search: filters.search,
      });
      if (filters.outletIds && filters.outletIds.length) p.set("outlet_id", filters.outletIds.join(","));
      const [workspaceRes, comparisonRes] = await Promise.all([
        api.get(`/api/reports/performance-workspace?${p}`),
        api.get(`/api/reports/performance-comparison?${p}`),
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
    filters.outletIds,
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
        <div className="rounded-2xl border border-(--ui-border) bg-(--ui-surface) p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">
            Revenue
          </p>
          <p className="mt-2 text-2xl font-bold text-(--ui-text)">{fmt(summary.revenue)}</p>
          <p className="mt-1 text-xs text-(--ui-text-muted)">{summary.order_count || 0} orders</p>
        </div>
        <div className="rounded-2xl border border-(--ui-border) bg-(--ui-surface) p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">
            Gross Profit
          </p>
          <p className="mt-2 text-2xl font-bold text-(--ui-text)">{fmt(summary.gross_profit)}</p>
          <p className="mt-1 text-xs text-(--ui-text-muted)">{summary.units_sold || 0} units sold</p>
        </div>
        <div className="rounded-2xl border border-(--ui-border) bg-(--ui-surface) p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">
            Brands / Suppliers
          </p>
          <p className="mt-2 text-2xl font-bold text-(--ui-text)">
            {summary.brand_count || 0} / {summary.supplier_count || 0}
          </p>
          <p className="mt-1 text-xs text-(--ui-text-muted)">Dimensions represented</p>
        </div>
        <div className="rounded-2xl border border-(--ui-border) bg-(--ui-surface) p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">
            SKUs / Categories
          </p>
          <p className="mt-2 text-2xl font-bold text-(--ui-text)">
            {summary.sku_count || 0} / {summary.category_count || 0}
          </p>
          <p className="mt-1 text-xs text-(--ui-text-muted)">Active in current view</p>
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
          <div className="rounded-2xl border border-(--ui-border)">
            <div className="border-b border-(--ui-border) bg-(--ui-muted-surface) px-4 py-3">
              <h3 className="font-bold text-(--ui-text)">Top Items</h3>
              <p className="text-xs text-(--ui-text-muted)">Top revenue-driving products with cross-dimension tags</p>
            </div>
            <TableShell
              cols={["Product", "Dimension Tags", "Revenue", "Margin %"]}
              loading={loading}
              empty={!items.length}
            >
              {items.map((row) => (
                <tr key={row.id} className="hover:bg-(--ui-muted-surface)">
                  <td className="px-4 py-3">
                    <div className="text-sm font-semibold text-(--ui-text)">{row.product_name}</div>
                    <div className="font-mono text-[11px] text-(--ui-text-muted)">{row.barcode}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-sm text-(--ui-text)">{row.category}</div>
                    <div className="text-[11px] text-(--ui-text-muted)">{row.brand}</div>
                    <div className="text-[11px] text-(--ui-text-muted)">{row.supplier}</div>
                  </td>
                  <td className="px-4 py-3 text-sm font-bold text-(--ui-text)">{fmt(row.revenue)}</td>
                  <td className="px-4 py-3 text-sm font-semibold text-(--ui-success-fg)">{row.margin_pct}%</td>
                </tr>
              ))}
              </TableShell>
          </div>

          <div className="grid grid-cols-1 gap-4">
            <div className="rounded-2xl border border-(--ui-border)">
              <div className="border-b border-(--ui-border) bg-(--ui-muted-surface) px-4 py-3">
                <h3 className="font-bold text-(--ui-text)">Category Leaders</h3>
              </div>
              <TableShell cols={["Category", "Units", "Revenue"]} loading={loading} empty={!categories.length}>
                {categories.map((row) => (
                  <tr key={row.category_id} className="hover:bg-(--ui-muted-surface)">
                    <td className="px-4 py-3">
                      <div className="text-sm font-semibold text-(--ui-text)">{row.category}</div>
                      <button
                        type="button"
                        onClick={() =>
                          drillToProductPerformance({
                            categoryId: String(row.category_id || ""),
                          })
                        }
                        className="mt-1 text-[11px] font-semibold text-(--ui-link) hover:text-(--ui-link)"
                      >
                        Open in product performance
                      </button>
                    </td>
                    <td className="px-4 py-3 text-sm text-(--ui-text-muted)">{row.units_sold}</td>
                    <td className="px-4 py-3 text-sm font-bold text-(--ui-text)">{fmt(row.revenue)}</td>
                  </tr>
                ))}
              </TableShell>
            </div>

            <div className="rounded-2xl border border-(--ui-border)">
              <div className="border-b border-(--ui-border) bg-(--ui-muted-surface) px-4 py-3">
                <h3 className="font-bold text-(--ui-text)">Brand Leaders</h3>
              </div>
              <TableShell cols={["Brand", "Units", "Revenue"]} loading={loading} empty={!brands.length}>
                {brands.map((row) => (
                  <tr key={row.brand_id} className="hover:bg-(--ui-muted-surface)">
                    <td className="px-4 py-3">
                      <div className="text-sm font-semibold text-(--ui-text)">{row.brand}</div>
                      <button
                        type="button"
                        onClick={() =>
                          drillToProductPerformance({
                            brandId: String(row.brand_id || ""),
                          })
                        }
                        className="mt-1 text-[11px] font-semibold text-(--ui-link) hover:text-(--ui-link)"
                      >
                        Open in product performance
                      </button>
                    </td>
                    <td className="px-4 py-3 text-sm text-(--ui-text-muted)">{row.units_sold}</td>
                    <td className="px-4 py-3 text-sm font-bold text-(--ui-text)">{fmt(row.revenue)}</td>
                  </tr>
                ))}
              </TableShell>
            </div>

            <div className="rounded-2xl border border-(--ui-border)">
              <div className="border-b border-(--ui-border) bg-(--ui-muted-surface) px-4 py-3">
                <h3 className="font-bold text-(--ui-text)">Supplier Leaders</h3>
              </div>
              <TableShell cols={["Supplier", "Units", "Revenue"]} loading={loading} empty={!suppliers.length}>
                {suppliers.map((row) => (
                  <tr key={row.supplier_id} className="hover:bg-(--ui-muted-surface)">
                    <td className="px-4 py-3">
                      <div className="text-sm font-semibold text-(--ui-text)">{row.supplier}</div>
                      <button
                        type="button"
                        onClick={() =>
                          drillToProductPerformance({
                            supplierId: String(row.supplier_id || ""),
                          })
                        }
                        className="mt-1 text-[11px] font-semibold text-(--ui-link) hover:text-(--ui-link)"
                      >
                        Open in product performance
                      </button>
                    </td>
                    <td className="px-4 py-3 text-sm text-(--ui-text-muted)">{row.units_sold}</td>
                    <td className="px-4 py-3 text-sm font-bold text-(--ui-text)">{fmt(row.revenue)}</td>
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
            <div className="rounded-2xl border border-(--ui-border) bg-(--ui-surface) p-4">
              <div className="mb-3">
                <h3 className="font-bold text-(--ui-text)">Comparison Overview</h3>
                <p className="text-xs text-(--ui-text-muted)">Current-period revenue against the previous matching window</p>
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

            <div className="rounded-2xl border border-(--ui-border)">
              <div className="border-b border-(--ui-border) bg-(--ui-muted-surface) px-4 py-3">
                <h3 className="font-bold text-(--ui-text)">Top Item Comparison</h3>
              </div>
              <TableShell cols={["Item", "Current", "Previous", "Delta"]} loading={loading} empty={!itemComparison.length}>
                {itemComparison.map((row) => (
                  <tr
                    key={row.entity_id}
                    className="cursor-pointer hover:bg-(--ui-muted-surface)"
                    onClick={() => drillComparisonRow("item", row)}
                  >
                    <td className="px-4 py-3">
                      <div className="text-sm font-semibold text-(--ui-text)">{row.entity_label}</div>
                      <div className="text-[11px] font-semibold text-(--ui-link)">Open in product performance</div>
                    </td>
                    <td className="px-4 py-3 text-sm font-bold text-(--ui-text)">{fmt(row.current_revenue)}</td>
                    <td className="px-4 py-3 text-sm text-(--ui-text-muted)">{fmt(row.previous_revenue)}</td>
                    <td className={`px-4 py-3 text-sm font-semibold ${Number(row.revenue_delta || 0) >= 0 ? "text-(--ui-success-fg)" : "text-(--ui-danger-fg)"}`}>
                      {fmt(row.revenue_delta)} ({row.revenue_delta_pct}%)
                    </td>
                  </tr>
                ))}
              </TableShell>
            </div>

            <div className="rounded-2xl border border-(--ui-border)">
              <div className="border-b border-(--ui-border) bg-(--ui-muted-surface) px-4 py-3">
                <h3 className="font-bold text-(--ui-text)">Top Category Comparison</h3>
              </div>
              <TableShell cols={["Category", "Current", "Previous", "Delta"]} loading={loading} empty={!categoryComparison.length}>
                {categoryComparison.map((row) => (
                  <tr
                    key={row.entity_id}
                    className="cursor-pointer hover:bg-(--ui-muted-surface)"
                    onClick={() => drillComparisonRow("category", row)}
                  >
                    <td className="px-4 py-3">
                      <div className="text-sm font-semibold text-(--ui-text)">{row.entity_label}</div>
                      <div className="text-[11px] font-semibold text-(--ui-link)">Open in product performance</div>
                    </td>
                    <td className="px-4 py-3 text-sm font-bold text-(--ui-text)">{fmt(row.current_revenue)}</td>
                    <td className="px-4 py-3 text-sm text-(--ui-text-muted)">{fmt(row.previous_revenue)}</td>
                    <td className={`px-4 py-3 text-sm font-semibold ${Number(row.revenue_delta || 0) >= 0 ? "text-(--ui-success-fg)" : "text-(--ui-danger-fg)"}`}>
                      {fmt(row.revenue_delta)} ({row.revenue_delta_pct}%)
                    </td>
                  </tr>
                ))}
              </TableShell>
            </div>

            <div className="rounded-2xl border border-(--ui-border)">
              <div className="border-b border-(--ui-border) bg-(--ui-muted-surface) px-4 py-3">
                <h3 className="font-bold text-(--ui-text)">Top Brand Comparison</h3>
              </div>
              <TableShell cols={["Brand", "Current", "Previous", "Delta"]} loading={loading} empty={!brandComparison.length}>
                {brandComparison.map((row) => (
                  <tr
                    key={row.entity_id}
                    className="cursor-pointer hover:bg-(--ui-muted-surface)"
                    onClick={() => drillComparisonRow("brand", row)}
                  >
                    <td className="px-4 py-3">
                      <div className="text-sm font-semibold text-(--ui-text)">{row.entity_label}</div>
                      <div className="text-[11px] font-semibold text-(--ui-link)">Open in product performance</div>
                    </td>
                    <td className="px-4 py-3 text-sm font-bold text-(--ui-text)">{fmt(row.current_revenue)}</td>
                    <td className="px-4 py-3 text-sm text-(--ui-text-muted)">{fmt(row.previous_revenue)}</td>
                    <td className={`px-4 py-3 text-sm font-semibold ${Number(row.revenue_delta || 0) >= 0 ? "text-(--ui-success-fg)" : "text-(--ui-danger-fg)"}`}>
                      {fmt(row.revenue_delta)} ({row.revenue_delta_pct}%)
                    </td>
                  </tr>
                ))}
              </TableShell>
            </div>

            <div className="rounded-2xl border border-(--ui-border)">
              <div className="border-b border-(--ui-border) bg-(--ui-muted-surface) px-4 py-3">
                <h3 className="font-bold text-(--ui-text)">Top Supplier Comparison</h3>
              </div>
              <TableShell cols={["Supplier", "Current", "Previous", "Delta"]} loading={loading} empty={!supplierComparison.length}>
                {supplierComparison.map((row) => (
                  <tr
                    key={row.entity_id}
                    className="cursor-pointer hover:bg-(--ui-muted-surface)"
                    onClick={() => drillComparisonRow("supplier", row)}
                  >
                    <td className="px-4 py-3">
                      <div className="text-sm font-semibold text-(--ui-text)">{row.entity_label}</div>
                      <div className="text-[11px] font-semibold text-(--ui-link)">Open in product performance</div>
                    </td>
                    <td className="px-4 py-3 text-sm font-bold text-(--ui-text)">{fmt(row.current_revenue)}</td>
                    <td className="px-4 py-3 text-sm text-(--ui-text-muted)">{fmt(row.previous_revenue)}</td>
                    <td className={`px-4 py-3 text-sm font-semibold ${Number(row.revenue_delta || 0) >= 0 ? "text-(--ui-success-fg)" : "text-(--ui-danger-fg)"}`}>
                      {fmt(row.revenue_delta)} ({row.revenue_delta_pct}%)
                    </td>
                  </tr>
                ))}
              </TableShell>
            </div>

            <div className="rounded-2xl border border-(--ui-border)">
              <div className="border-b border-(--ui-border) bg-(--ui-muted-surface) px-4 py-3">
                <h3 className="font-bold text-(--ui-text)">Top Sub-Category Comparison</h3>
              </div>
              <TableShell cols={["Sub-Category", "Current", "Previous", "Delta"]} loading={loading} empty={!subcategoryComparison.length}>
                {subcategoryComparison.map((row) => (
                  <tr
                    key={row.entity_id}
                    className="cursor-pointer hover:bg-(--ui-muted-surface)"
                    onClick={() => drillComparisonRow("subcategory", row)}
                  >
                    <td className="px-4 py-3">
                      <div className="text-sm font-semibold text-(--ui-text)">{row.entity_label}</div>
                      <div className="text-[11px] font-semibold text-(--ui-link)">Open in product performance</div>
                    </td>
                    <td className="px-4 py-3 text-sm font-bold text-(--ui-text)">{fmt(row.current_revenue)}</td>
                    <td className="px-4 py-3 text-sm text-(--ui-text-muted)">{fmt(row.previous_revenue)}</td>
                    <td className={`px-4 py-3 text-sm font-semibold ${Number(row.revenue_delta || 0) >= 0 ? "text-(--ui-success-fg)" : "text-(--ui-danger-fg)"}`}>
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
            <div className="rounded-2xl border border-(--ui-border) bg-(--ui-surface) p-4">
              <div className="mb-3">
                <h3 className="font-bold text-(--ui-text)">Trend Lines</h3>
                <p className="text-xs text-(--ui-text-muted)">Monthly revenue leaders by dimension</p>
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

            <div className="rounded-2xl border border-(--ui-border)">
              <div className="border-b border-(--ui-border) bg-(--ui-muted-surface) px-4 py-3">
                <h3 className="font-bold text-(--ui-text)">Item Leaders by Month</h3>
              </div>
              <TableShell cols={["Month", "Leader", "Revenue"]} loading={loading} empty={!itemMonthly.length}>
                {itemMonthly.map((row, index) => (
                  <tr key={`${row.month_bucket}-${row.entity_id}-${index}`} className="hover:bg-(--ui-muted-surface)">
                    <td className="px-4 py-3 text-sm text-(--ui-text-muted)">{row.month_bucket}</td>
                    <td className="px-4 py-3 text-sm font-semibold text-(--ui-text)">{row.entity_label}</td>
                    <td className="px-4 py-3 text-sm font-bold text-(--ui-text)">{fmt(row.revenue)}</td>
                  </tr>
                ))}
              </TableShell>
            </div>

            <div className="rounded-2xl border border-(--ui-border)">
              <div className="border-b border-(--ui-border) bg-(--ui-muted-surface) px-4 py-3">
                <h3 className="font-bold text-(--ui-text)">Category Leaders by Month</h3>
              </div>
              <TableShell cols={["Month", "Leader", "Revenue"]} loading={loading} empty={!categoryMonthly.length}>
                {categoryMonthly.map((row, index) => (
                  <tr key={`${row.month_bucket}-${row.entity_id}-${index}`} className="hover:bg-(--ui-muted-surface)">
                    <td className="px-4 py-3 text-sm text-(--ui-text-muted)">{row.month_bucket}</td>
                    <td className="px-4 py-3 text-sm font-semibold text-(--ui-text)">{row.entity_label}</td>
                    <td className="px-4 py-3 text-sm font-bold text-(--ui-text)">{fmt(row.revenue)}</td>
                  </tr>
                ))}
              </TableShell>
            </div>

            <div className="rounded-2xl border border-(--ui-border)">
              <div className="border-b border-(--ui-border) bg-(--ui-muted-surface) px-4 py-3">
                <h3 className="font-bold text-(--ui-text)">Brand Leaders by Month</h3>
              </div>
              <TableShell cols={["Month", "Leader", "Revenue"]} loading={loading} empty={!brandMonthly.length}>
                {brandMonthly.map((row, index) => (
                  <tr key={`${row.month_bucket}-${row.entity_id}-${index}`} className="hover:bg-(--ui-muted-surface)">
                    <td className="px-4 py-3 text-sm text-(--ui-text-muted)">{row.month_bucket}</td>
                    <td className="px-4 py-3 text-sm font-semibold text-(--ui-text)">{row.entity_label}</td>
                    <td className="px-4 py-3 text-sm font-bold text-(--ui-text)">{fmt(row.revenue)}</td>
                  </tr>
                ))}
              </TableShell>
            </div>

            <div className="rounded-2xl border border-(--ui-border)">
              <div className="border-b border-(--ui-border) bg-(--ui-muted-surface) px-4 py-3">
                <h3 className="font-bold text-(--ui-text)">Supplier Leaders by Month</h3>
              </div>
              <TableShell cols={["Month", "Leader", "Revenue"]} loading={loading} empty={!supplierMonthly.length}>
                {supplierMonthly.map((row, index) => (
                  <tr key={`${row.month_bucket}-${row.entity_id}-${index}`} className="hover:bg-(--ui-muted-surface)">
                    <td className="px-4 py-3 text-sm text-(--ui-text-muted)">{row.month_bucket}</td>
                    <td className="px-4 py-3 text-sm font-semibold text-(--ui-text)">{row.entity_label}</td>
                    <td className="px-4 py-3 text-sm font-bold text-(--ui-text)">{fmt(row.revenue)}</td>
                  </tr>
                ))}
              </TableShell>
            </div>

            <div className="rounded-2xl border border-(--ui-border)">
              <div className="border-b border-(--ui-border) bg-(--ui-muted-surface) px-4 py-3">
                <h3 className="font-bold text-(--ui-text)">Sub-Category Leaders by Month</h3>
              </div>
              <TableShell cols={["Month", "Leader", "Revenue"]} loading={loading} empty={!subcategoryMonthly.length}>
                {subcategoryMonthly.map((row, index) => (
                  <tr key={`${row.month_bucket}-${row.entity_id}-${index}`} className="hover:bg-(--ui-muted-surface)">
                    <td className="px-4 py-3 text-sm text-(--ui-text-muted)">{row.month_bucket}</td>
                    <td className="px-4 py-3 text-sm font-semibold text-(--ui-text)">{row.entity_label}</td>
                    <td className="px-4 py-3 text-sm font-bold text-(--ui-text)">{fmt(row.revenue)}</td>
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
