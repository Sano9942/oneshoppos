import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  BarChart3,
  BarChart2,
  TrendingUp,
  AlertTriangle,
  FileText,
  ClipboardList,
  Package,
  ShoppingBag,
  Users,
  Activity,
} from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
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

// --- Tab: Overview Dashboard --------------------------------------------------
export function OverviewTab({ filters }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({
        outlet_id: filters.outletId,
      });
      const res = await fetch(`${API}/api/reports/dashboard?${p}`);
      if (!res.ok) throw new Error("Failed to fetch");
      const d = await res.json();
      setData(d);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [filters.outletId]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading)
    return (
      <div className="flex items-center justify-center py-20">
        <div className="flex flex-col items-center">
          <BarChart3 className="text-blue-500 w-12 h-12 mb-4 animate-bounce" />
          <p className="text-slate-500 font-medium italic">
            Gathering your retail insights...
          </p>
        </div>
      </div>
    );

  if (error)
    return (
      <div className="p-10 text-center text-rose-600 bg-rose-50 rounded-2xl border border-rose-100">
        {error}
      </div>
    );

  const todayRevenue = Number(data?.totalRevenueToday || 0);
  const todayPayments = data?.zReport || [];
  const hourlySales = data?.hourlySales || [];
  const totalTransactions = hourlySales.reduce(
    (sum, row) => sum + Number(row.orders || 0),
    0,
  );
  const lowStockItems = Number(data?.inventory?.low_stock_items || 0);
  const totalProducts = Number(data?.inventory?.total_products || 0);
  const topCategories = data?.categoryContribution || data?.categoryPerformance || [];
  const totalCategoryRevenue = topCategories.reduce(
    (sum, row) => sum + Number(row.revenue || 0),
    0,
  );
  const paymentContribution = data?.paymentContribution || [];
  const leakageTotal =
    Number(data?.discountsToday?.value || 0) +
    Number(data?.voidsToday?.value || 0) +
    Number(data?.refundsToday?.value || 0);

  const stats = [
    {
      title: "Today's Sales",
      value: fmt(todayRevenue),
      trend: `${todayPayments.length} tenders`,
      positive: true,
    },
    {
      title: "Average Bill",
      value: fmt(data?.averageBill),
      trend: `${hourlySales.length} active hours`,
      positive: true,
    },
    {
      title: "Current Stock",
      value: Number(data?.currentStockUnits || 0),
      trend: `${totalProducts} products tracked`,
      positive: true,
    },
    {
      title: "Month Gross Margin",
      value: fmt(data?.monthGrossMargin),
      trend: `Sales ${fmt(data?.monthSales)}`,
      positive: true,
    },
  ];

  return (
    <div className="space-y-6">
      {/* Quick Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((s, i) => (
          <div
            key={i}
            className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow group"
          >
            <div className="flex justify-between items-start mb-2">
              <span className="text-sm font-medium text-slate-500 group-hover:text-blue-600 transition-colors">
                {s.title}
              </span>
              <span
                className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                  s.positive
                    ? "bg-emerald-50 text-emerald-600"
                    : "bg-rose-50 text-rose-600"
                }`}
              >
                {s.trend}
              </span>
            </div>
            <div className="text-2xl font-bold text-slate-800">{s.value}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Sales Trend Chart */}
        <div className="lg:col-span-2 bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="font-bold text-slate-800">Revenue Forecast</h3>
              <p className="text-xs text-slate-500">
                Store revenue trend for the last 6 months
              </p>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-blue-500"></div>
              <span className="text-xs font-medium text-slate-600">Actual</span>
            </div>
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data?.monthlyTrend || []}>
                <defs>
                  <linearGradient id="colorSales" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.1} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  strokeDasharray="3 3"
                  vertical={false}
                  stroke="#f1f5f9"
                />
                <XAxis
                  dataKey="month"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 10, fill: "#94a3b8" }}
                  dy={10}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 10, fill: "#94a3b8" }}
                  tickFormatter={(v) => `\u20a8${v / 1000}k`}
                />
                <Tooltip
                  contentStyle={{
                    borderRadius: "12px",
                    border: "none",
                    boxShadow: "0 10px 15px -3px rgb(0 0 0 / 0.1)",
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="total"
                  stroke="#3b82f6"
                  strokeWidth={3}
                  fillOpacity={1}
                  fill="url(#colorSales)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* KPI Rail */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <h3 className="font-bold text-slate-800 mb-4 text-center">Executive KPI Rail</h3>
          <div className="space-y-4">
            {[
              {
                icon: Package,
                label: "Low Stock Items",
                value: lowStockItems,
                note: `${Number(data?.currentStockUnits || 0)} stock units live`,
                tone: "text-violet-600",
              },
              {
                icon: TrendingUp,
                label: "Month Purchases",
                value: fmt(data?.monthPurchases),
                note: `Month sales ${fmt(data?.monthSales)}`,
                tone: "text-indigo-600",
              },
              {
                icon: AlertTriangle,
                label: "Leakage Today",
                value: fmt(leakageTotal),
                note: `Disc ${fmt(data?.discountsToday?.value)} | Void ${fmt(data?.voidsToday?.value)} | Refund ${fmt(data?.refundsToday?.value)}`,
                tone: "text-rose-600",
              },
            ].map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.label} className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
                  <div className="flex items-center gap-2">
                    <Icon size={14} className={item.tone} />
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      {item.label}
                    </p>
                  </div>
                  <p className={`mt-2 text-xl font-bold ${item.tone}`}>{item.value}</p>
                  <p className="mt-1 text-xs text-slate-500">{item.note}</p>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <h3 className="font-bold text-slate-800 mb-4">Category Contribution</h3>
          <div className="space-y-4">
            {topCategories.map((c, i) => {
              const percentage =
                totalCategoryRevenue > 0
                  ? ((Number(c.revenue || 0) / totalCategoryRevenue) * 100).toFixed(1)
                  : "0.0";
              return (
                <div key={i} className="space-y-1.5">
                  <div className="flex justify-between text-xs font-medium">
                    <span className="text-slate-600 truncate mr-2">{c.category}</span>
                    <span className="text-slate-900 font-bold">{percentage}%</span>
                  </div>
                  <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
                    <div
                      className="bg-blue-500 h-full rounded-full transition-all duration-1000"
                      style={{ width: `${percentage}%` }}
                    ></div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <h3 className="font-bold text-slate-800 mb-4">Payment Contribution Today</h3>
          <div className="space-y-4">
            {paymentContribution.map((p, i) => (
              <div key={i} className="space-y-1.5">
                <div className="flex justify-between text-xs font-medium">
                  <span className="text-slate-600 truncate mr-2">{p.payment_method}</span>
                  <span className="text-slate-900 font-bold">
                    {Number(p.contribution_pct || 0).toFixed(1)}%
                  </span>
                </div>
                <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
                  <div
                    className="bg-emerald-500 h-full rounded-full transition-all duration-1000"
                    style={{ width: `${Number(p.contribution_pct || 0).toFixed(1)}%` }}
                  ></div>
                </div>
                <p className="text-[11px] text-slate-400">{fmt(p.total)}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// --- Tab: Sales Summary -------------------------------------------------------
export function SalesSummaryTab({ filters }) {
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
        outlet_id: filters.outletId,
        category_id: filters.categoryId,
        brand_id: filters.brandId,
      });
      const res = await fetch(`${API}/api/reports/sales-summary?${p}`);
      const d = await res.json();
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
    filters.outletId,
    filters.categoryId,
    filters.brandId,
  ]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading)
    return (
      <div className="p-8 text-center text-slate-400 italic">
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
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Revenue</p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{fmt(totalRevenue)}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Orders</p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{totalOrders}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Payment Types</p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{paymentMethods.length}</p>
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
                <div className="text-xs font-bold text-slate-600 w-20">
                  {pm.method}
                </div>
                <div className="flex-1 h-3 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-emerald-500 rounded-full"
                    style={{
                      width: `${totalRevenue > 0 ? (pm.total / totalRevenue) * 100 : 0}%`,
                    }}
                  />
                </div>
                <div className="text-xs font-bold text-slate-800">
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
            <td className="p-4 text-sm font-medium text-slate-500">
              Gross Revenue
            </td>
            <td className="p-4 text-sm font-bold text-slate-900">
              {fmt(data?.total_revenue)}
            </td>
          </tr>
          <tr>
            <td className="p-4 text-sm font-medium text-slate-500">
              Tax Collected
            </td>
            <td className="p-4 text-sm font-bold text-slate-900">
              {fmt(data?.total_tax)}
            </td>
          </tr>
          <tr className="bg-blue-50/50">
            <td className="p-4 text-sm font-bold text-blue-700">Net Sales</td>
            <td className="p-4 text-sm font-bold text-blue-700">
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
        outlet_id: filters.outletId,
      });
      const res = await fetch(`${API}/api/reports/monthly-mop-matrix?${p}`);
      const d = await res.json();
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
    filters.outletId,
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
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Months In Scope</p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{matrix.length}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Orders</p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{totalOrders}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Revenue</p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{fmt(totalRevenue)}</p>
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
            <tr key={row.month_bucket} className="hover:bg-slate-50">
              <td className="px-4 py-3 text-sm font-semibold text-slate-800">{row.month_bucket}</td>
              <td className="px-4 py-3 text-sm text-slate-600">{Number(row.total_orders || 0)}</td>
              <td className="px-4 py-3 text-sm font-bold text-slate-900">{fmt(row.total_amount)}</td>
              {methods.map((method) => (
                <td key={`${row.month_bucket}-${method}`} className="px-4 py-3 text-sm text-slate-600">
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
      });
      const res = await fetch(`${API}/api/reports/subcategory-wise?${p}`);
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
  ]);

  useEffect(() => {
    load();
  }, [load]);

  const totalRevenue = rows.reduce((sum, row) => sum + Number(row.revenue || 0), 0);
  const totalUnits = rows.reduce((sum, row) => sum + Number(row.units_sold || 0), 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Sub-Categories</p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{rows.length}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Units Sold</p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{totalUnits}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Revenue</p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{fmt(totalRevenue)}</p>
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
            <tr key={`${row.category_id}-${index}`} className="hover:bg-slate-50">
              <td className="px-4 py-3 text-sm text-slate-600">{row.category}</td>
              <td className="px-4 py-3 text-sm font-semibold text-slate-800">{row.subcategory}</td>
              <td className="px-4 py-3 text-sm text-slate-600">{Number(row.units_sold || 0)}</td>
              <td className="px-4 py-3 text-sm font-bold text-slate-900">{fmt(row.revenue)}</td>
              <td className="px-4 py-3 text-sm font-semibold text-indigo-700">{fmt(row.profit)}</td>
              <td className="px-4 py-3 text-sm text-slate-600">{Number(row.pct || 0).toFixed(1)}%</td>
            </tr>
          ))}
        </TableShell>
      </CardShell>
    </div>
  );
}

// --- Tab: Sales Detail --------------------------------------------------------
export function SalesDetailTab({ filters }) {
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
        employee_id: filters.employeeId,
      });
      const res = await fetch(`${API}/api/reports/sales-detail?${p}`);
      const d = await res.json();
      setRows(d.sales || []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [filters.dateFrom, filters.dateTo, filters.timeFrom, filters.timeTo, filters.outletId, filters.employeeId]);

  useEffect(() => {
    load();
  }, [load]);

  const totalRevenue = rows.reduce(
    (sum, row) => sum + Number(row.line_total || 0),
    0,
  );
  const uniqueSales = new Set(rows.map((row) => row.sale_id)).size;
  const uniqueProducts = new Set(rows.map((row) => row.product_name)).size;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Sales in View
          </p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{uniqueSales}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Line Revenue
          </p>
          <p className="mt-2 text-2xl font-bold text-slate-900">
            {fmt(totalRevenue)}
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Products Touched
          </p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{uniqueProducts}</p>
        </div>
      </div>

      <CardShell
        title="Transaction Journal"
        subtitle="Line-level sales ledger for audit, lookup, and exception tracing"
        action={
          <ExportButton
            onClick={() =>
              exportCSV(
                "sales_detail.csv",
                [
                  { header: "Sale ID", key: "sale_id" },
                  { header: "Timestamp", key: "timestamp" },
                  { header: "Customer", key: "customer_name" },
                  { header: "Product", key: "product_name" },
                  { header: "Barcode", key: "barcode" },
                  { header: "Quantity", key: "quantity" },
                  { header: "Price", key: "price_at_sale" },
                  { header: "Line Total", key: "line_total" },
                ],
                rows,
              )
            }
          />
        }
      >
        <TableShell
          cols={["Timestamp", "Sale", "Customer", "Product", "Qty", "Price", "Line Total"]}
          loading={loading}
          empty={!rows.length}
        >
          {rows.map((r, i) => (
            <tr key={`${r.sale_id}-${r.barcode}-${i}`} className="hover:bg-slate-50">
              <td className="px-4 py-3 text-sm text-slate-600">
                <div className="font-medium text-slate-700">
                  {fmtDateTime(r.timestamp)}
                </div>
              </td>
              <td className="px-4 py-3">
                <div className="font-mono text-xs font-bold text-slate-800">
                  #{r.sale_id}
                </div>
              </td>
              <td className="px-4 py-3 text-sm text-slate-600">
                {r.customer_name}
              </td>
              <td className="px-4 py-3">
                <div className="text-sm font-semibold text-slate-800">
                  {r.product_name}
                </div>
                <div className="font-mono text-[11px] text-slate-400">
                  {r.barcode}
                </div>
              </td>
              <td className="px-4 py-3 text-sm font-semibold text-slate-700">
                {r.quantity}
              </td>
              <td className="px-4 py-3 text-sm text-slate-600">
                {fmt(r.price_at_sale)}
              </td>
              <td className="px-4 py-3 text-sm font-bold text-slate-900">
                {fmt(r.line_total)}
              </td>
            </tr>
          ))}
        </TableShell>
      </CardShell>
    </div>
  );
}

// --- Tab: Order Wise ----------------------------------------------------------
export function OrderWiseTab({ filters }) {
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
      const res = await fetch(`${API}/api/reports/order-wise?${p}`);
      const d = await res.json();
      setRows(d.orders || []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [filters.dateFrom, filters.dateTo, filters.timeFrom, filters.timeTo, filters.outletId]);

  useEffect(() => {
    load();
  }, [load]);

  const totalOrders = rows.length;
  const grossSales = rows.reduce(
    (sum, row) => sum + Number(row.total_amount || 0),
    0,
  );
  const discountedOrders = rows.filter(
    (row) => Number(row.discount_amount || 0) > 0,
  ).length;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Orders in View
          </p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{totalOrders}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Gross Sales
          </p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{fmt(grossSales)}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Discounted Orders
          </p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{discountedOrders}</p>
        </div>
      </div>

      <CardShell
        title="Order Fulfillment"
        subtitle="Operational register of completed orders and payment mix"
        action={
          <ExportButton
            onClick={() =>
              exportCSV(
                "orders.csv",
                [
                  { header: "Order ID", key: "id" },
                  { header: "Timestamp", key: "timestamp" },
                  { header: "Customer", key: "customer_name" },
                  { header: "Outlet", key: "outlet_name" },
                  { header: "Payment", key: "payment_method" },
                  { header: "Discount", key: "discount_amount" },
                  { header: "Total", key: "total_amount" },
                ],
                rows,
              )
            }
          />
        }
      >
        <TableShell
          cols={["Timestamp", "Order", "Customer", "Outlet", "Payment", "Total"]}
          loading={loading}
          empty={!rows.length}
        >
          {rows.map((r, i) => (
            <tr key={`${r.id}-${i}`} className="hover:bg-slate-50 transition-colors">
              <td className="px-4 py-3 text-sm text-slate-600">
                {fmtDateTime(r.timestamp)}
              </td>
              <td className="px-4 py-3">
                <div className="font-mono text-xs font-bold text-slate-800">
                  #{r.id}
                </div>
                {Number(r.discount_amount || 0) > 0 ? (
                  <div className="mt-1 inline-flex rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-700">
                    Discounted
                  </div>
                ) : null}
              </td>
              <td className="px-4 py-3 text-sm text-slate-600">{r.customer_name}</td>
              <td className="px-4 py-3 text-sm text-slate-600">{r.outlet_name}</td>
              <td className="px-4 py-3 text-sm font-medium text-slate-600">
                {r.payment_method || "N/A"}
              </td>
              <td className="px-4 py-3 text-sm font-bold text-slate-900">
                {fmt(r.total_amount)}
              </td>
            </tr>
          ))}
        </TableShell>
      </CardShell>
    </div>
  );
}

// --- Tab: Item Wise -----------------------------------------------------------
export function ItemWiseTab({ filters }) {
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
      });
      const res = await fetch(`${API}/api/reports/item-wise?${p}`);
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
        title="Merchandise Velocity"
        subtitle="SKU-level sales volume, revenue, and gross profit performance"
        action={
          <ExportButton
            onClick={() =>
              exportCSV(
                "items.csv",
                [
                  { header: "Product", key: "product_name" },
                  { header: "Barcode", key: "barcode" },
                  { header: "Units Sold", key: "units_sold" },
                  { header: "Revenue", key: "revenue" },
                  { header: "Total Cost", key: "total_cost" },
                  { header: "Gross Profit", key: "gross_profit" },
                ],
                rows,
              )
            }
          />
        }
      >
        <TableShell
          cols={["Product", "Barcode", "Units Sold", "Revenue", "Gross Profit"]}
          loading={loading}
          empty={!rows.length}
        >
          {rows.map((r, i) => (
            <tr key={`${r.id}-${i}`} className="hover:bg-slate-50">
              <td className="px-4 py-3 text-sm font-semibold text-slate-800">
                {r.product_name}
              </td>
              <td className="px-4 py-3 font-mono text-[11px] text-slate-400">
                {r.barcode}
              </td>
              <td className="px-4 py-3 text-sm font-semibold text-slate-700">
                {r.units_sold}
              </td>
              <td className="px-4 py-3 text-sm font-bold text-slate-900">
                {fmt(r.revenue)}
              </td>
              <td className="px-4 py-3 text-sm font-semibold text-emerald-700">
                {fmt(r.gross_profit)}
              </td>
            </tr>
          ))}
        </TableShell>
      </CardShell>
    </div>
  );
}

// --- Tab: Refunds & Voids ----------------------------------------------------
export function RefundsVoidsTab({ filters }) {
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
        outlet_id: filters.outletId,
        employee_id: filters.employeeId,
      });
      const res = await fetch(`${API}/api/reports/refunds-voids?${p}`);
      const d = await res.json();
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
    filters.outletId,
    filters.employeeId,
  ]);

  useEffect(() => {
    load();
  }, [load]);

  const summary = data?.summary || {};
  const voids = data?.voids || [];
  const refunds = data?.refunds || [];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Voids
          </p>
          <p className="mt-2 text-2xl font-bold text-rose-700">
            {Number(summary.void_count || 0)}
          </p>
          <p className="mt-1 text-xs text-slate-500">{fmt(summary.void_value)}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Refunds
          </p>
          <p className="mt-2 text-2xl font-bold text-amber-700">
            {Number(summary.refund_count || 0)}
          </p>
          <p className="mt-1 text-xs text-slate-500">{fmt(summary.refund_value)}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Combined Leakage
          </p>
          <p className="mt-2 text-2xl font-bold text-slate-900">
            {fmt(summary.leakage_total)}
          </p>
        </div>
      </div>

      <CardShell
        title="Voided Transactions"
        subtitle="Sales that were voided in the selected reporting window"
        action={
          <ExportButton
            onClick={() =>
              exportCSV(
                "voided_sales.csv",
                [
                  { header: "Timestamp", key: "timestamp" },
                  { header: "Sale ID", key: "sale_id" },
                  { header: "Outlet", key: "outlet_name" },
                  { header: "Employee", key: "employee_name" },
                  { header: "Customer", key: "customer_name" },
                  { header: "Total", key: "total_amount" },
                ],
                voids,
              )
            }
          />
        }
      >
        <TableShell
          cols={["Timestamp", "Sale", "Outlet", "Employee", "Customer", "Total"]}
          loading={loading}
          empty={!voids.length}
        >
          {voids.map((r) => (
            <tr key={r.sale_id} className="hover:bg-slate-50">
              <td className="px-4 py-3 text-sm text-slate-600">{fmtDateTime(r.timestamp)}</td>
              <td className="px-4 py-3 font-mono text-xs font-bold text-slate-800">#{r.sale_id}</td>
              <td className="px-4 py-3 text-sm text-slate-600">{r.outlet_name}</td>
              <td className="px-4 py-3 text-sm text-slate-600">{r.employee_name}</td>
              <td className="px-4 py-3 text-sm text-slate-600">{r.customer_name}</td>
              <td className="px-4 py-3 text-sm font-bold text-rose-700">{fmt(r.total_amount)}</td>
            </tr>
          ))}
        </TableShell>
      </CardShell>

      <CardShell
        title="Refund Journal"
        subtitle="Returns processed in the selected reporting window"
        action={
          <ExportButton
            onClick={() =>
              exportCSV(
                "refund_journal.csv",
                [
                  { header: "Timestamp", key: "timestamp" },
                  { header: "Return ID", key: "return_id" },
                  { header: "Outlet", key: "outlet_name" },
                  { header: "Employee", key: "employee_name" },
                  { header: "Customer", key: "customer_name" },
                  { header: "Method", key: "refund_method" },
                  { header: "Total Refund", key: "total_refund" },
                ],
                refunds,
              )
            }
          />
        }
      >
        <TableShell
          cols={["Timestamp", "Return", "Outlet", "Employee", "Customer", "Method", "Total"]}
          loading={loading}
          empty={!refunds.length}
        >
          {refunds.map((r) => (
            <tr key={r.return_id} className="hover:bg-slate-50">
              <td className="px-4 py-3 text-sm text-slate-600">{fmtDateTime(r.timestamp)}</td>
              <td className="px-4 py-3 font-mono text-xs font-bold text-slate-800">#{r.return_id}</td>
              <td className="px-4 py-3 text-sm text-slate-600">{r.outlet_name}</td>
              <td className="px-4 py-3 text-sm text-slate-600">{r.employee_name}</td>
              <td className="px-4 py-3 text-sm text-slate-600">{r.customer_name}</td>
              <td className="px-4 py-3 text-sm text-slate-600">{r.refund_method}</td>
              <td className="px-4 py-3 text-sm font-bold text-amber-700">{fmt(r.total_refund)}</td>
            </tr>
          ))}
        </TableShell>
      </CardShell>
    </div>
  );
}

// --- Tab: Cashier Wise -------------------------------------------------------
export function CashierWiseTab({ filters }) {
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
        employee_id: filters.employeeId,
      });
      const res = await fetch(`${API}/api/reports/cashier-wise?${p}`);
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
  ]);

  useEffect(() => {
    load();
  }, [load]);

  const grossSales = rows.reduce((sum, row) => sum + Number(row.sales_value || 0), 0);
  const totalRefunds = rows.reduce((sum, row) => sum + Number(row.refund_value || 0), 0);
  const totalVoids = rows.reduce((sum, row) => sum + Number(row.void_value || 0), 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Cashiers
          </p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{rows.length}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Gross Sales
          </p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{fmt(grossSales)}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Refunds
          </p>
          <p className="mt-2 text-2xl font-bold text-amber-700">{fmt(totalRefunds)}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Voids
          </p>
          <p className="mt-2 text-2xl font-bold text-rose-700">{fmt(totalVoids)}</p>
        </div>
      </div>

      <CardShell
        title="Cashier Sales Performance"
        subtitle="Sales, discounts, refunds, and voids grouped by cashier"
        action={
          <ExportButton
            onClick={() =>
              exportCSV(
                "cashier_wise.csv",
                [
                  { header: "Cashier", key: "employee_name" },
                  { header: "Sales Count", key: "sale_count" },
                  { header: "Gross Sales", key: "sales_value" },
                  { header: "Discounts", key: "discount_value" },
                  { header: "Refund Count", key: "refund_count" },
                  { header: "Refund Value", key: "refund_value" },
                  { header: "Void Count", key: "void_count" },
                  { header: "Void Value", key: "void_value" },
                  { header: "Net Sales", key: "net_sales" },
                ],
                rows,
              )
            }
          />
        }
      >
        <TableShell
          cols={["Cashier", "Sales", "Gross", "Discounts", "Refunds", "Voids", "Net"]}
          loading={loading}
          empty={!rows.length}
        >
          {rows.map((r) => (
            <tr key={r.employee_id} className="hover:bg-slate-50">
              <td className="px-4 py-3">
                <div className="text-sm font-semibold text-slate-800">{r.employee_name}</div>
              </td>
              <td className="px-4 py-3 text-sm text-slate-600">{r.sale_count}</td>
              <td className="px-4 py-3 text-sm font-bold text-slate-900">{fmt(r.sales_value)}</td>
              <td className="px-4 py-3 text-sm text-amber-700">{fmt(r.discount_value)}</td>
              <td className="px-4 py-3 text-sm text-amber-700">
                {r.refund_count} / {fmt(r.refund_value)}
              </td>
              <td className="px-4 py-3 text-sm text-rose-700">
                {r.void_count} / {fmt(r.void_value)}
              </td>
              <td className="px-4 py-3 text-sm font-bold text-emerald-700">{fmt(r.net_sales)}</td>
            </tr>
          ))}
        </TableShell>
      </CardShell>
    </div>
  );
}

// --- Tab: Daily Operations ---------------------------------------------------
export function DailyOperationsTab({ filters }) {
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState(null);
  const [refundsVoids, setRefundsVoids] = useState(null);
  const [cashiers, setCashiers] = useState([]);
  const [selectedShiftSummary, setSelectedShiftSummary] = useState(null);
  const [selectedShiftPayments, setSelectedShiftPayments] = useState([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const common = new URLSearchParams({
        date_from: filters.dateFrom,
        date_to: filters.dateTo,
        time_from: filters.timeFrom,
        time_to: filters.timeTo,
        outlet_id: filters.outletId,
        employee_id: filters.employeeId,
      }).toString();

      const [salesRes, refundRes, cashierRes] = await Promise.all([
        fetch(`${API}/api/reports/sales-summary?${common}`).then((r) => r.json()),
        fetch(`${API}/api/reports/refunds-voids?${common}`).then((r) => r.json()),
        fetch(`${API}/api/reports/cashier-wise?${common}`).then((r) => r.json()),
      ]);

      setSummary(salesRes);
      setRefundsVoids(refundRes);
      setCashiers(cashierRes.items || []);

      if (filters.shiftId) {
        const [shiftSummaryRes, shiftPaymentRes] = await Promise.all([
          fetch(`${API}/api/reports/shift-summary?session_id=${filters.shiftId}`).then((r) => r.json()),
          fetch(`${API}/api/reports/payment-summary?session_id=${filters.shiftId}`).then((r) => r.json()),
        ]);
        setSelectedShiftSummary(shiftSummaryRes);
        setSelectedShiftPayments(shiftPaymentRes.payments || []);
      } else {
        setSelectedShiftSummary(null);
        setSelectedShiftPayments([]);
      }
    } catch {
      setSummary(null);
      setRefundsVoids(null);
      setCashiers([]);
      setSelectedShiftSummary(null);
      setSelectedShiftPayments([]);
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
    filters.shiftId,
  ]);

  useEffect(() => {
    load();
  }, [load]);

  const paymentMethods = summary?.payment_methods || [];
  const topCashiers = cashiers.slice(0, 5);
  const topVoids = (refundsVoids?.voids || []).slice(0, 5);
  const topRefunds = (refundsVoids?.refunds || []).slice(0, 5);
  const totalRevenue = Number(summary?.total_revenue || 0);
  const totalOrders = (summary?.daily_sales || []).reduce(
    (sum, row) => sum + Number(row.orders || 0),
    0,
  );
  const leakageTotal = Number(refundsVoids?.summary?.leakage_total || 0);
  const totalRefunds = Number(refundsVoids?.summary?.refund_value || 0);
  const totalVoids = Number(refundsVoids?.summary?.void_value || 0);
  const netSales = totalRevenue - leakageTotal;
  const averageOrderValue = totalOrders ? totalRevenue / totalOrders : 0;
  const leakageRate = totalRevenue ? (leakageTotal / totalRevenue) * 100 : 0;
  const primaryTender = paymentMethods[0];
  const shift = selectedShiftSummary?.shift || null;
  const shiftOperationalSummary = selectedShiftSummary?.summary || null;
  const shiftSales = Number(shiftOperationalSummary?.total_sales || 0);
  const shiftReturns = Number(shiftOperationalSummary?.total_returns || 0);
  const shiftOrders = Number(shiftOperationalSummary?.order_count || 0);
  const shiftDifference = totalRevenue - shiftSales;
  const shiftPaymentTotal = selectedShiftPayments.reduce(
    (sum, row) => sum + Number(row.total || 0),
    0,
  );
  const selectedWindow = [
    filters.dateFrom || "Start not set",
    filters.dateTo || "End not set",
  ].join(" to ");
  const selectedTime = filters.timeFrom || filters.timeTo
    ? `${filters.timeFrom || "00:00"} to ${filters.timeTo || "23:59"}`
    : "Full day";
  const scopeBadges = [
    `Window: ${selectedWindow}`,
    `Time: ${selectedTime}`,
    filters.outletId ? `Outlet filtered` : "All outlets",
    filters.employeeId ? "Single cashier filter" : "All cashiers",
  ];

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="h-4 w-40 animate-pulse rounded bg-slate-200" />
          <div className="mt-3 flex flex-wrap gap-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="h-7 w-32 animate-pulse rounded-full bg-slate-100"
              />
            ))}
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
            >
              <div className="h-3 w-20 animate-pulse rounded bg-slate-200" />
              <div className="mt-3 h-8 w-24 animate-pulse rounded bg-slate-100" />
              <div className="mt-2 h-3 w-28 animate-pulse rounded bg-slate-100" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
              Daily Operations Brief
            </p>
            <h2 className="mt-1 text-lg font-bold text-slate-900">
              Manager view for sales, leakage, and tender mix
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              This view consolidates sales, refunds, voids, and cashier activity for the selected reporting window.
            </p>
          </div>
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 xl:max-w-md">
            Shift-linked sales and returns are not stored in the live schema. Shift and cash tabs are validated from
            <span className="mx-1 font-mono text-[12px]">cash_shifts</span>
            time windows instead of direct session IDs.
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {scopeBadges.map((badge) => (
            <span
              key={badge}
              className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600"
            >
              {badge}
            </span>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Revenue
          </p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{fmt(totalRevenue)}</p>
          <p className="mt-1 text-xs text-slate-500">
            Avg order {fmt(averageOrderValue)}
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Net Sales
          </p>
          <p className="mt-2 text-2xl font-bold text-emerald-700">{fmt(netSales)}</p>
          <p className="mt-1 text-xs text-slate-500">
            After refunds and voids
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Leakage
          </p>
          <p className="mt-2 text-2xl font-bold text-rose-700">{fmt(leakageTotal)}</p>
          <p className="mt-1 text-xs text-slate-500">
            {leakageRate.toFixed(1)}% of gross revenue
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Orders
          </p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{totalOrders}</p>
          <p className="mt-1 text-xs text-slate-500">
            {cashiers.length} cashiers in view
          </p>
        </div>
      </div>

      {filters.shiftId ? (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.5fr_1fr]">
          <CardShell
            title="Shift Reconciliation"
            subtitle="Selected shift compared with the broader daily reporting window"
          >
            <div className="grid grid-cols-1 gap-3 p-4 md:grid-cols-4">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Shift Sales
                </div>
                <div className="mt-2 text-2xl font-bold text-slate-900">
                  {fmt(shiftSales)}
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  {shiftOrders} orders in shift #{filters.shiftId}
                </div>
              </div>
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-amber-700">
                  Shift Returns
                </div>
                <div className="mt-2 text-2xl font-bold text-amber-700">
                  {fmt(shiftReturns)}
                </div>
                <div className="mt-1 text-xs text-amber-700">
                  Derived from returns in the shift window
                </div>
              </div>
              <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-blue-700">
                  Opening to Closing Cash
                </div>
                <div className="mt-2 text-2xl font-bold text-blue-700">
                  {fmt(shift?.opening_float || 0)} to {fmt(shift?.closing_cash || 0)}
                </div>
                <div className="mt-1 text-xs text-blue-700">
                  Expected {fmt(shift?.expected_cash || 0)}
                </div>
              </div>
              <div className="rounded-xl border border-rose-200 bg-rose-50 p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-rose-700">
                  Daily vs Shift Delta
                </div>
                <div className="mt-2 text-2xl font-bold text-rose-700">
                  {fmt(shiftDifference)}
                </div>
                <div className="mt-1 text-xs text-rose-700">
                  Revenue outside the selected shift
                </div>
              </div>
            </div>
            <div className="border-t border-slate-100 px-4 py-3 text-sm text-slate-500">
              {shift ? (
                <>
                  Shift window {fmtDateTime(shift.opened_at)} to{" "}
                  {shift.closed_at ? fmtDateTime(shift.closed_at) : "Open shift"}.
                  Variance {fmt(shift.variance || 0)}
                  {shift.variance_reason ? ` (${shift.variance_reason})` : ""}.
                </>
              ) : (
                "Shift data unavailable for the selected filter."
              )}
            </div>
          </CardShell>

          <CardShell
            title="Selected Shift Tender Mix"
            subtitle="Tender totals for the currently selected shift"
          >
            <TableShell
              cols={["Method", "Total", "Count"]}
              loading={loading}
              empty={!selectedShiftPayments.length}
            >
              {selectedShiftPayments.map((row) => (
                <tr key={row.payment_method} className="hover:bg-slate-50">
                  <td className="px-4 py-3 text-sm font-semibold text-slate-800">
                    {row.payment_method}
                  </td>
                  <td className="px-4 py-3 text-sm font-bold text-slate-900">
                    {fmt(row.total)}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-600">
                    {row.count}
                  </td>
                </tr>
              ))}
            </TableShell>
            {!!selectedShiftPayments.length && (
              <div className="border-t border-slate-100 px-4 py-3 text-sm text-slate-500">
                Shift tender total {fmt(shiftPaymentTotal)}.
              </div>
            )}
          </CardShell>
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-5 py-4 text-sm text-slate-600">
          Select a shift in the global filters when you need end-of-day reconciliation against cash, payment mix, and variance.
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <CardShell
          title="Payment Mix"
          subtitle="Tender mix for the selected reporting window"
        >
          <TableShell cols={["Method", "Total"]} loading={loading} empty={!paymentMethods.length}>
            {paymentMethods.map((row) => (
              <tr key={row.method} className="hover:bg-slate-50">
                <td className="px-4 py-3 text-sm font-semibold text-slate-800">
                  <div>{row.method}</div>
                  <div className="text-[11px] font-medium text-slate-400">
                    {totalRevenue ? `${((Number(row.total || 0) / totalRevenue) * 100).toFixed(1)}% of revenue` : "0.0% of revenue"}
                  </div>
                </td>
                <td className="px-4 py-3 text-sm font-bold text-slate-900">{fmt(row.total)}</td>
              </tr>
            ))}
          </TableShell>
        </CardShell>

        <CardShell
          title="Top Cashiers"
          subtitle="Highest grossing cashiers in the current view"
        >
          <TableShell cols={["Cashier", "Gross", "Net"]} loading={loading} empty={!topCashiers.length}>
            {topCashiers.map((row) => (
              <tr key={row.employee_id} className="hover:bg-slate-50">
                <td className="px-4 py-3 text-sm font-semibold text-slate-800">{row.employee_name}</td>
                <td className="px-4 py-3 text-sm text-slate-900">{fmt(row.sales_value)}</td>
                <td className="px-4 py-3 text-sm font-bold text-emerald-700">{fmt(row.net_sales)}</td>
              </tr>
            ))}
          </TableShell>
        </CardShell>

        <CardShell
          title="Operations Snapshot"
          subtitle="Quick risk and throughput read for the current view"
        >
          <div className="grid grid-cols-2 gap-3 p-4">
            <div className="rounded-xl bg-slate-50 p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Primary Tender</div>
              <div className="mt-2 text-2xl font-bold text-rose-700">
                {primaryTender?.method || "N/A"}
              </div>
              <div className="mt-1 text-xs text-slate-500">
                {primaryTender ? fmt(primaryTender.total) : "No payments in view"}
              </div>
            </div>
            <div className="rounded-xl bg-emerald-50 p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-emerald-600">Active Cashiers</div>
              <div className="mt-2 text-2xl font-bold text-emerald-700">
                {cashiers.length}
              </div>
              <div className="mt-1 text-xs text-emerald-700">
                Top performer {topCashiers[0]?.employee_name || "N/A"}
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 border-t border-slate-100 p-4">
            <div className="rounded-xl bg-rose-50 p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-rose-600">Voids</div>
              <div className="mt-2 text-2xl font-bold text-rose-700">
                {Number(refundsVoids?.summary?.void_count || 0)}
              </div>
              <div className="mt-1 text-xs text-rose-700">{fmt(totalVoids)}</div>
            </div>
            <div className="rounded-xl bg-amber-50 p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-amber-600">Refunds</div>
              <div className="mt-2 text-2xl font-bold text-amber-700">
                {Number(refundsVoids?.summary?.refund_count || 0)}
              </div>
              <div className="mt-1 text-xs text-amber-700">{fmt(totalRefunds)}</div>
            </div>
          </div>
        </CardShell>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <CardShell
          title="Latest Voids"
          subtitle="Most recent voided transactions in view"
        >
          <TableShell cols={["Time", "Sale", "Employee", "Total"]} loading={loading} empty={!topVoids.length}>
            {topVoids.map((row) => (
              <tr key={row.sale_id} className="hover:bg-slate-50">
                <td className="px-4 py-3 text-sm text-slate-600">{fmtDateTime(row.timestamp)}</td>
                <td className="px-4 py-3 font-mono text-xs font-bold text-slate-800">#{row.sale_id}</td>
                <td className="px-4 py-3 text-sm text-slate-600">{row.employee_name}</td>
                <td className="px-4 py-3 text-sm font-bold text-rose-700">{fmt(row.total_amount)}</td>
              </tr>
            ))}
          </TableShell>
        </CardShell>

        <CardShell
          title="Latest Refunds"
          subtitle="Most recent refunds in view"
        >
          <TableShell cols={["Time", "Return", "Employee", "Total"]} loading={loading} empty={!topRefunds.length}>
            {topRefunds.map((row) => (
              <tr key={row.return_id} className="hover:bg-slate-50">
                <td className="px-4 py-3 text-sm text-slate-600">{fmtDateTime(row.timestamp)}</td>
                <td className="px-4 py-3 font-mono text-xs font-bold text-slate-800">#{row.return_id}</td>
                <td className="px-4 py-3 text-sm text-slate-600">{row.employee_name}</td>
                <td className="px-4 py-3 text-sm font-bold text-amber-700">{fmt(row.total_refund)}</td>
              </tr>
            ))}
          </TableShell>
        </CardShell>
      </div>
    </div>
  );
}
