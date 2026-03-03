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

  const stats = [
    {
      title: "Today's Sales",
      value: fmt(data?.today_sales),
      trend: "+12.5%",
      positive: true,
    },
    {
      title: "Active Orders",
      value: data?.active_orders || 0,
      trend: "+3",
      positive: true,
    },
    {
      title: "Low Stock Items",
      value: data?.low_stock_count || 0,
      trend: "-2",
      positive: false,
    },
    {
      title: "Total Customers",
      value: data?.total_customers || 0,
      trend: "+24",
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
                Sales trend for last 7 days
              </p>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-blue-500"></div>
              <span className="text-xs font-medium text-slate-600">Actual</span>
            </div>
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data?.daily_sales || []}>
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
                  dataKey="date"
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
            {(data?.category_distribution || []).map((c, i) => (
              <div key={i} className="space-y-1.5">
                <div className="flex justify-between text-xs font-medium">
                  <span className="text-slate-600 truncate mr-2">{c.name}</span>
                  <span className="text-slate-900 font-bold">
                    {c.percentage}%
                  </span>
                </div>
                <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
                  <div
                    className="bg-blue-500 h-full rounded-full transition-all duration-1000"
                    style={{ width: `${c.percentage}%` }}
                  ></div>
                </div>
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

  return (
    <div className="space-y-6">
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
            {(data?.payment_methods || []).map((pm, i) => (
              <div key={i} className="flex items-center gap-4">
                <div className="text-xs font-bold text-slate-600 w-20">
                  {pm.method}
                </div>
                <div className="flex-1 h-3 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-emerald-500 rounded-full"
                    style={{
                      width: `${(pm.total / data.total_revenue) * 100}%`,
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
                ["Date", "Orders", "Revenue"],
                data.daily_sales,
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

  return (
    <CardShell
      title="Transaction Journal"
      subtitle="Complete list of all sales records"
      action={
        <ExportButton
          onClick={() =>
            exportCSV(
              "sales_detail.csv",
              ["Date", "Order #", "Outlet", "Employee", "Amount"],
              rows,
            )
          }
        />
      }
    >
      <TableShell
        cols={["Date", "Order #", "Outlet", "Employee", "Total"]}
        loading={loading}
        empty={!rows.length}
      >
        {rows.map((r, i) => (
          <tr key={i} className="hover:bg-slate-50">
            <td className="p-4 text-sm whitespace-nowrap text-slate-600 underline font-medium cursor-pointer decoration-slate-300">
              {fmtDateTime(r.created_at)}
            </td>
            <td className="p-4 text-sm font-bold text-slate-800">
              #{r.order_number}
            </td>
            <td className="p-4 text-sm text-slate-600">{r.outlet_name}</td>
            <td className="p-4 text-sm text-slate-600 font-medium">
              {r.employee_name}
            </td>
            <td className="p-4 text-sm font-bold text-slate-900">
              {fmt(r.total_amount)}
            </td>
          </tr>
        ))}
      </TableShell>
    </CardShell>
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

  return (
    <CardShell
      title="Order Fulfillment"
      subtitle="Operational view of order status and payment"
      action={
        <ExportButton
          onClick={() =>
            exportCSV(
              "orders.csv",
              ["ID", "Outlet", "Status", "Payment", "Total"],
              rows,
            )
          }
        />
      }
    >
      <TableShell
        cols={["ID", "Outlet", "Status", "Payment", "Total"]}
        loading={loading}
        empty={!rows.length}
      >
        {rows.map((r, i) => (
          <tr key={i} className="hover:bg-slate-50 transition-colors">
            <td className="p-4 text-sm font-bold text-slate-900">#{r.id}</td>
            <td className="p-4 text-sm text-slate-600">{r.outlet_name}</td>
            <td className="p-4">
              <span
                className={`text-[10px] font-bold px-2 py-1 rounded-full uppercase tracking-tighter ${
                  r.status === "completed"
                    ? "bg-emerald-100 text-emerald-700"
                    : "bg-slate-100 text-slate-600"
                }`}
              >
                {r.status}
              </span>
            </td>
            <td className="p-4 text-sm text-slate-500 font-medium">
              {r.payment_method || "N/A"}
            </td>
            <td className="p-4 text-sm font-bold text-slate-900">
              {fmt(r.total_amount)}
            </td>
          </tr>
        ))}
      </TableShell>
    </CardShell>
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

  return (
    <CardShell
      title="Merchandise Velocity"
      subtitle="Unit sales and revenue per individual SKU"
      action={
        <ExportButton
          onClick={() =>
            exportCSV("items.csv", ["SKU", "Product", "Qty", "Revenue"], rows)
          }
        />
      }
    >
      <TableShell
        cols={["Product / SKU", "Units Sold", "Total Revenue"]}
        loading={loading}
        empty={!rows.length}
      >
        {rows.map((r, i) => (
          <tr key={i} className="hover:bg-slate-50">
            <td className="p-4">
              <div className="text-sm font-bold text-slate-800">
                {r.product_name}
              </div>
              <div className="text-[10px] text-slate-400 font-medium uppercase tracking-widest">
                {r.sku}
              </div>
            </td>
            <td className="p-4">
              <div className="text-sm font-bold text-slate-900">
                {r.total_qty}
              </div>
              <div className="text-[10px] text-slate-400 font-medium">
                SKUs sold
              </div>
            </td>
            <td className="p-4 text-sm font-bold text-slate-900">
              {fmt(r.total_revenue)}
            </td>
          </tr>
        ))}
      </TableShell>
    </CardShell>
  );
}
