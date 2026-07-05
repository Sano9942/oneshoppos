import React, { useState, useEffect, useCallback } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { api } from "../../api";
import {
  exportCSV,
  ExportButton,
  TableShell,
  CardShell,
} from "./ReportShared";
import { useCurrency } from "../../contexts/CurrencyContext";

// --- Tab: Sales Summary -------------------------------------------------------
export function SalesSummaryTab({ filters }) {
  const { fmt } = useCurrency();

  const [data, setData] = useState(null);
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
      });
      if (filters.outletIds && filters.outletIds.length) p.set("outlet_id", filters.outletIds.join(","));
      const d = await api.get(`/api/reports/sales-summary?${p}`);
      setData(d);
    } catch {
      setData(null);
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
  ]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading)
    return (
      <div className="p-8 text-center text-(--ui-text-muted) italic">
        Processing sales data...
      </div>
    );

  const dailySales = data?.daily_sales || [];
  const paymentMethods = data?.payment_methods || [];
  const totalRevenue = Number(data?.total_revenue || 0);
  const totalOrders = dailySales.reduce(
    (sum, row) => sum + Number(row.orders || 0),
    0,
  );

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="rounded-2xl border border-(--ui-border) bg-(--ui-surface) p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">Revenue</p>
          <p className="mt-2 text-2xl font-bold text-(--ui-text)">{fmt(totalRevenue)}</p>
        </div>
        <div className="rounded-2xl border border-(--ui-border) bg-(--ui-surface) p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">Orders</p>
          <p className="mt-2 text-2xl font-bold text-(--ui-text)">{totalOrders}</p>
        </div>
        <div className="rounded-2xl border border-(--ui-border) bg-(--ui-surface) p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">Payment Types</p>
          <p className="mt-2 text-2xl font-bold text-(--ui-text)">{paymentMethods.length}</p>
        </div>
      </div>

      {/* Visual Analytics */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <CardShell
          title="Daily Revenue Trend"
          subtitle="Day-over-day sales breakdown"
        >
          <div className="h-64 p-4">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data?.daily_sales || []}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  vertical={false}
                  stroke="#f1f5f9"
                />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip />
                <Area
                  type="monotone"
                  dataKey="total"
                  stroke="#3b82f6"
                  fill="#eff6ff"
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </CardShell>

        <CardShell
          title="Payment Method Mix"
          subtitle="Transaction volume by tender type"
        >
          <div className="p-4 space-y-4">
            {paymentMethods.map((pm, i) => (
              <div key={i} className="flex items-center gap-4">
                <div className="text-xs font-bold text-(--ui-text-muted) w-20">
                  {pm.method}
                </div>
                <div className="flex-1 h-3 bg-(--ui-muted-surface) rounded-full overflow-hidden">
                  <div
                    className="h-full bg-(--ui-success-fg) rounded-full"
                    style={{
                      width: `${totalRevenue > 0 ? (pm.total / totalRevenue) * 100 : 0}%`,
                    }}
                  />
                </div>
                <div className="text-xs font-bold text-(--ui-text)">
                  {fmt(pm.total)}
                </div>
              </div>
            ))}
          </div>
        </CardShell>
      </div>

      <CardShell
        title="Revenue Breakdown"
        subtitle="Detailed summary of sales, taxes, and net earnings"
        action={
          <ExportButton
            onClick={() =>
              exportCSV(
                "sales_summary.csv",
                [
                  { header: "Date", key: "date" },
                  { header: "Orders", key: "orders" },
                  { header: "Revenue", key: "total" },
                ],
        dailySales,
              )
            }
          />
        }
      >
        <TableShell cols={["Metric", "Value"]}>
          <tr>
            <td className="p-4 text-sm font-medium text-(--ui-text-muted)">
              Gross Revenue
            </td>
            <td className="p-4 text-sm font-bold text-(--ui-text)">
              {fmt(data?.total_revenue)}
            </td>
          </tr>
          <tr>
            <td className="p-4 text-sm font-medium text-(--ui-text-muted)">
              Tax Collected
            </td>
            <td className="p-4 text-sm font-bold text-(--ui-text)">
              {fmt(data?.total_tax)}
            </td>
          </tr>
          <tr className="bg-(--ui-muted-surface)/50">
            <td className="p-4 text-sm font-bold text-(--ui-link)">Net Sales</td>
            <td className="p-4 text-sm font-bold text-(--ui-link)">
              {fmt(data?.total_revenue - data?.total_tax)}
            </td>
          </tr>
        </TableShell>
      </CardShell>
    </div>
  );
}

// --- Tab: Monthly MOP Matrix --------------------------------------------------
export function MonthlyMOPMatrixTab({ filters }) {
  const { fmt } = useCurrency();

  const [data, setData] = useState(null);
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
      const d = await api.get(`/api/reports/monthly-mop-matrix?${p}`);
      setData(d);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [
    filters.dateFrom,
    filters.dateTo,
    filters.timeFrom,
    filters.timeTo,
    filters.outletIds,
  ]);

  useEffect(() => {
    load();
  }, [load]);

  const methods = data?.methods || [];
  const matrix = data?.matrix || [];
  const totalRevenue = matrix.reduce((sum, row) => sum + Number(row.total_amount || 0), 0);
  const totalOrders = matrix.reduce((sum, row) => sum + Number(row.total_orders || 0), 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="rounded-2xl border border-(--ui-border) bg-(--ui-surface) p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">Months In Scope</p>
          <p className="mt-2 text-2xl font-bold text-(--ui-text)">{matrix.length}</p>
        </div>
        <div className="rounded-2xl border border-(--ui-border) bg-(--ui-surface) p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">Orders</p>
          <p className="mt-2 text-2xl font-bold text-(--ui-text)">{totalOrders}</p>
        </div>
        <div className="rounded-2xl border border-(--ui-border) bg-(--ui-surface) p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">Revenue</p>
          <p className="mt-2 text-2xl font-bold text-(--ui-text)">{fmt(totalRevenue)}</p>
        </div>
      </div>

      <CardShell
        title="Monthly MOP Matrix"
        subtitle="Month-wise sales against payment methods like cash/card in one matrix view"
        action={
          <ExportButton
            onClick={() =>
              exportCSV(
                "monthly_mop_matrix.csv",
                [
                  { header: "Month", key: "month_bucket" },
                  { header: "Total Orders", key: "total_orders" },
                  { header: "Total Revenue", key: "total_amount" },
                  ...methods.map((m) => ({ header: m, key: m })),
                ],
        matrix,
              )
            }
          />
        }
      >
        <TableShell
          cols={["Month", "Orders", "Total Revenue", ...methods]}
          loading={loading}
          empty={!matrix.length}
        >
          {matrix.map((row) => (
            <tr key={row.month_bucket} className="hover:bg-(--ui-muted-surface)">
              <td className="px-4 py-3 text-sm font-semibold text-(--ui-text)">{row.month_bucket}</td>
              <td className="px-4 py-3 text-sm text-(--ui-text-muted)">{Number(row.total_orders || 0)}</td>
              <td className="px-4 py-3 text-sm font-bold text-(--ui-text)">{fmt(row.total_amount)}</td>
              {methods.map((method) => (
                <td key={`${row.month_bucket}-${method}`} className="px-4 py-3 text-sm text-(--ui-text-muted)">
                  {fmt(row[method])}
                </td>
              ))}
            </tr>
          ))}
        </TableShell>
      </CardShell>
    </div>
  );
}

// --- Tab: Sub-Category Wise ---------------------------------------------------
export function SubcategoryWiseTab({ filters }) {
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
      });
      if (filters.outletIds && filters.outletIds.length) p.set("outlet_id", filters.outletIds.join(","));
      const d = await api.get(`/api/reports/subcategory-wise?${p}`);
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
  ]);

  useEffect(() => {
    load();
  }, [load]);

  const totalRevenue = rows.reduce((sum, row) => sum + Number(row.revenue || 0), 0);
  const totalUnits = rows.reduce((sum, row) => sum + Number(row.units_sold || 0), 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="rounded-2xl border border-(--ui-border) bg-(--ui-surface) p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">Sub-Categories</p>
          <p className="mt-2 text-2xl font-bold text-(--ui-text)">{rows.length}</p>
        </div>
        <div className="rounded-2xl border border-(--ui-border) bg-(--ui-surface) p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">Units Sold</p>
          <p className="mt-2 text-2xl font-bold text-(--ui-text)">{totalUnits}</p>
        </div>
        <div className="rounded-2xl border border-(--ui-border) bg-(--ui-surface) p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">Revenue</p>
          <p className="mt-2 text-2xl font-bold text-(--ui-text)">{fmt(totalRevenue)}</p>
        </div>
      </div>

      <CardShell
        title="Sub-Category Wise Sale"
        subtitle="Sales view by sub-category with parent category context"
        action={
          <ExportButton
            onClick={() =>
              exportCSV(
                "subcategory_wise.csv",
                [
                  { header: "Category", key: "category" },
                  { header: "Sub-Category", key: "subcategory" },
                  { header: "Units Sold", key: "units_sold" },
                  { header: "Revenue", key: "revenue" },
                  { header: "Cost", key: "cost" },
                  { header: "Profit", key: "profit" },
                  { header: "Contribution %", key: "pct" },
                ],
        rows,
              )
            }
          />
        }
      >
        <TableShell
          cols={["Category", "Sub-Category", "Units", "Revenue", "Profit", "Share"]}
          loading={loading}
          empty={!rows.length}
        >
          {rows.map((row, index) => (
            <tr key={`${row.category_id}-${index}`} className="hover:bg-(--ui-muted-surface)">
              <td className="px-4 py-3 text-sm text-(--ui-text-muted)">{row.category}</td>
              <td className="px-4 py-3 text-sm font-semibold text-(--ui-text)">{row.subcategory}</td>
              <td className="px-4 py-3 text-sm text-(--ui-text-muted)">{Number(row.units_sold || 0)}</td>
              <td className="px-4 py-3 text-sm font-bold text-(--ui-text)">{fmt(row.revenue)}</td>
              <td className="px-4 py-3 text-sm font-semibold text-(--ui-link)">{fmt(row.profit)}</td>
              <td className="px-4 py-3 text-sm text-(--ui-text-muted)">{Number(row.pct || 0).toFixed(1)}%</td>
            </tr>
          ))}
        </TableShell>
      </CardShell>
    </div>
  );
}
