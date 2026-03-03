import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  BarChart3,
  BarChart2,
  TrendingUp,
  FileText,
  ClipboardList,
  ShoppingBag,
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
  const topCategories = data?.categoryPerformance || [];
  const totalCategoryRevenue = topCategories.reduce(
    (sum, row) => sum + Number(row.revenue || 0),
    0,
  );

  const stats = [
    {
      title: "Today's Sales",
      value: fmt(todayRevenue),
      trend: `${todayPayments.length} tenders`,
      positive: true,
    },
    {
      title: "Today's Orders",
      value: totalTransactions,
      trend: `${hourlySales.length} active hours`,
      positive: true,
    },
    {
      title: "Low Stock Items",
      value: lowStockItems,
      trend: `${totalProducts} products tracked`,
      positive: false,
    },
    {
      title: "Top Products",
      value: (data?.topProducts || []).length,
      trend: "7-day view",
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

        {/* Top Product Types */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <h3 className="font-bold text-slate-800 mb-4 text-center">
            Category Contribution
          </h3>
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
            )})}
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
  }, [filters.dateFrom, filters.dateTo, filters.outletId, filters.employeeId]);

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
  }, [filters.dateFrom, filters.dateTo, filters.outletId]);

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
