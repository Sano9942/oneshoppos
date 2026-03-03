import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  BarChart3,
  TrendingUp,
  DollarSign,
  PackageX,
  ShoppingBag,
  AlertTriangle,
  TrendingDown,
  Users,
  ClipboardList,
  Search,
  X,
  Package,
  Truck,
  Archive,
  RotateCcw,
  Layers,
  Tag,
  ArrowLeftRight,
  ShoppingCart,
  Star,
  Recycle,
  BarChart2,
  FileText,
  Clock,
  Download,
  Building2,
  GitBranch,
  LayoutGrid,
  Target,
  Activity,
  ShieldAlert,
} from "lucide-react";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";

import { API_BASE as API } from "../config";

const fmt = (n) => "PKRs " + Number(n || 0).toFixed(2);
const fmtDate = (d) =>
  d
    ? new Date(d).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : "�";
const fmtDateTime = (d) =>
  d
    ? new Date(d).toLocaleString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "�";

// --- CSV Export Utilities -----------------------------------------------------

const exportCSV = (filename, cols, rows) => {
  const headers = cols.map((c) => (typeof c === "string" ? c : c.header));
  const keys = cols.map((c) => (typeof c === "string" ? c : c.key));
  const lines = [
    headers.map((h) => `"${String(h).replace(/"/g, '""')}"`).join(","),
    ...rows.map((r) =>
      keys
        .map((k) => {
          const v = r[k] ?? "";
          return `"${String(v).replace(/"/g, '""')}"`;
        })
        .join(","),
    ),
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};

function ExportButton({ onClick }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-blue-600 hover:bg-blue-50 border border-slate-200 rounded-lg px-2.5 py-1.5 transition-colors"
    >
      <Download size={12} /> Export CSV
    </button>
  );
}

// --- Shared UI Helpers --------------------------------------------------------

function TableShell({
  cols,
  loading,
  empty,
  emptyIcon: Icon = ClipboardList,
  children,
}) {
  return (
    <div className="overflow-auto">
      <table className="w-full text-left border-collapse">
        <thead>
          <tr className="bg-slate-50 border-b border-slate-200 text-xs uppercase tracking-wider text-slate-500 font-semibold sticky top-0 z-10">
            {cols.map((c) => (
              <th key={c} className="p-4 whitespace-nowrap">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {loading ? (
            <tr>
              <td
                colSpan={cols.length}
                className="p-8 text-center text-slate-400"
              >
                Loading...
              </td>
            </tr>
          ) : empty ? (
            <tr>
              <td colSpan={cols.length} className="p-10 text-center">
                <Icon size={40} className="mx-auto text-slate-300 mb-2" />
                <p className="text-slate-500 font-medium">No data found</p>
              </td>
            </tr>
          ) : (
            children
          )}
        </tbody>
      </table>
    </div>
  );
}

function DateRangeFilter({
  dateFrom,
  setDateFrom,
  dateTo,
  setDateTo,
  search,
  setSearch,
  searchPlaceholder,
}) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-3 flex flex-wrap gap-2 items-center">
      {setSearch && (
        <div className="relative flex-1 min-w-40">
          <Search
            size={13}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400"
          />
          <input
            type="text"
            placeholder={searchPlaceholder || "Search..."}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
          />
        </div>
      )}
      <div className="flex items-center gap-1.5">
        <label className="text-xs font-medium text-slate-500">From</label>
        <input
          type="date"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          className="px-2 py-1.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
        />
      </div>
      <div className="flex items-center gap-1.5">
        <label className="text-xs font-medium text-slate-500">To</label>
        <input
          type="date"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
          className="px-2 py-1.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
        />
      </div>
      {(search || dateFrom || dateTo) && (
        <button
          onClick={() => {
            setSearch?.("");
            setDateFrom("");
            setDateTo("");
          }}
          className="text-xs text-slate-500 hover:text-red-600 flex items-center gap-1 px-2 py-1.5 rounded-lg hover:bg-red-50 transition-colors"
        >
          <X size={12} /> Clear
        </button>
      )}
    </div>
  );
}

function GlobalFilterBar({ filters, setFilters, meta }) {
  const { outlets = [], categories = [], brands = [], employees = [] } = meta;

  const handleReset = () => {
    setFilters({
      dateFrom: "",
      dateTo: "",
      outletId: "",
      employeeId: "",
      categoryId: "",
      brandId: "",
      search: "",
    });
  };

  const hasActiveFilters = Object.values(filters).some((v) => !!v);

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-3 mb-4 flex flex-wrap gap-3 items-center sticky top-0 z-10">
      {/* Search */}
      <div className="relative min-w-50 flex-1">
        <Search
          size={14}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
        />
        <input
          type="text"
          placeholder="Global search..."
          value={filters.search}
          onChange={(e) => setFilters({ ...filters, search: e.target.value })}
          className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/10 focus:border-blue-500 transition-all font-medium"
        />
      </div>

      {/* Date Range */}
      <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5">
        <Clock size={14} className="text-slate-400" />
        <input
          type="date"
          value={filters.dateFrom}
          onChange={(e) => setFilters({ ...filters, dateFrom: e.target.value })}
          className="bg-transparent border-none text-xs font-semibold focus:ring-0 p-0 w-28"
          title="Date From"
        />
        <span className="text-slate-300">|</span>
        <input
          type="date"
          value={filters.dateTo}
          onChange={(e) => setFilters({ ...filters, dateTo: e.target.value })}
          className="bg-transparent border-none text-xs font-semibold focus:ring-0 p-0 w-28"
          title="Date To"
        />
      </div>

      {/* Outlet Selector */}
      <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 min-w-35">
        <Building2 size={14} className="text-slate-400" />
        <select
          value={filters.outletId}
          onChange={(e) => setFilters({ ...filters, outletId: e.target.value })}
          className="bg-transparent border-none text-xs font-semibold focus:ring-0 p-0 flex-1 cursor-pointer"
        >
          <option value="">All Outlets</option>
          {outlets.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      </div>

      {/* Category Selector */}
      <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 min-w-35">
        <LayoutGrid size={14} className="text-slate-400" />
        <select
          value={filters.categoryId}
          onChange={(e) =>
            setFilters({ ...filters, categoryId: e.target.value })
          }
          className="bg-transparent border-none text-xs font-semibold focus:ring-0 p-0 flex-1 cursor-pointer"
        >
          <option value="">All Categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.path_label || c.name}
            </option>
          ))}
        </select>
      </div>

      {/* Brand Selector */}
      <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 min-w-30">
        <Tag size={14} className="text-slate-400" />
        <select
          value={filters.brandId}
          onChange={(e) => setFilters({ ...filters, brandId: e.target.value })}
          className="bg-transparent border-none text-xs font-semibold focus:ring-0 p-0 flex-1 cursor-pointer"
        >
          <option value="">All Brands</option>
          {brands.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </div>

      {/* Employee Selector */}
      <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 min-w-30">
        <Users size={14} className="text-slate-400" />
        <select
          value={filters.employeeId}
          onChange={(e) =>
            setFilters({ ...filters, employeeId: e.target.value })
          }
          className="bg-transparent border-none text-xs font-semibold focus:ring-0 p-0 flex-1 cursor-pointer"
        >
          <option value="">All Staff</option>
          {employees.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
      </div>

      {/* Reset */}
      {hasActiveFilters && (
        <button
          onClick={handleReset}
          className="ml-auto flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-red-600 hover:bg-red-50 rounded-xl transition-colors border border-red-100"
        >
          <RotateCcw size={12} /> Reset
        </button>
      )}
    </div>
  );
}

function CardShell({ title, subtitle, action, children }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
      <div className="p-4 border-b border-slate-200 bg-slate-50 shrink-0 flex items-start justify-between gap-2">
        <div className="flex-1">
          <h2 className="font-bold text-slate-700">{title}</h2>
          {subtitle && (
            <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>
          )}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {children}
    </div>
  );
}

// --- Tab: Overview Dashboard --------------------------------------------------

function OverviewTab({ filters }) {
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
          <p className="text-slate-500 font-medium">
            Crunching your numbers...
          </p>
        </div>
      </div>
    );
  if (error)
    return (
      <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl flex items-center gap-3">
        <AlertTriangle size={20} />
        {error}
      </div>
    );

  const {
    totalRevenueToday,
    todayProfit,
    inventoryValue,
    topSelling,
    lowStock,
    zReport,
  } = data;
  return (
    <div className="space-y-6">
      {/* Hero: Revenue */}
      <div className="bg-linear-to-br from-blue-600 to-blue-800 rounded-2xl p-7 shadow-md text-white">
        <p className="text-sm font-medium text-blue-200 mb-2 uppercase tracking-wider">
          Total Revenue Today
        </p>
        <h2 className="text-5xl font-bold tracking-tight mb-3">
          {fmt(totalRevenueToday)}
        </h2>
        <div className="flex flex-wrap gap-3 text-sm text-blue-100">
          {zReport.length > 0 ? (
            zReport.map((z) => (
              <span
                key={z.payment_method}
                className="flex items-center gap-1.5"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-blue-300 inline-block" />
                {z.payment_method}:{" "}
                <span className="font-semibold text-white">{fmt(z.total)}</span>
              </span>
            ))
          ) : (
            <span className="text-blue-300 italic">No sales yet today</span>
          )}
        </div>
      </div>

      {/* Supporting KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200">
          <div className="flex justify-between items-start mb-3">
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">
                Net Profit Today
              </p>
              <h3 className="text-3xl font-bold text-emerald-600">
                {fmt(todayProfit)}
              </h3>
            </div>
            <div className="bg-emerald-100 p-3 rounded-xl">
              <TrendingUp className="text-emerald-600 w-5 h-5" />
            </div>
          </div>
          <p className="text-xs text-slate-400 border-t border-slate-100 pt-3">
            Gross Sales minus Cost of Goods Sold
          </p>
        </div>
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200">
          <div className="flex justify-between items-start mb-3">
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">
                Est. Inventory Retail Value
              </p>
              <h3 className="text-3xl font-bold text-indigo-600">
                {fmt(inventoryValue.retail_value)}
              </h3>
            </div>
            <div className="bg-indigo-100 p-3 rounded-xl">
              <PackageX className="text-indigo-600 w-5 h-5" />
            </div>
          </div>
          <p className="text-xs text-slate-400 border-t border-slate-100 pt-3">
            Base Cost Value:{" "}
            <span className="font-semibold text-slate-600">
              {fmt(inventoryValue.cost_value)}
            </span>
          </p>
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="px-6 py-5 border-b border-slate-100 bg-slate-50/50 flex items-center gap-2">
            <ShoppingBag className="text-blue-500 w-5 h-5" />
            <h3 className="font-bold text-slate-800">
              Top Selling Products (All Time)
            </h3>
          </div>
          {topSelling.length > 0 ? (
            <ul className="divide-y divide-slate-100">
              {topSelling.map((item, i) => (
                <li
                  key={i}
                  className="flex justify-between items-center px-6 py-4 hover:bg-slate-50"
                >
                  <span className="font-medium text-slate-700">
                    {i + 1}. {item.name}
                  </span>
                  <span className="bg-blue-100 text-blue-800 py-1 px-3 rounded-full text-xs font-bold">
                    {item.total_sold} Sold
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="p-6 text-center text-slate-500">
              No sales data available yet.
            </div>
          )}
        </div>
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="px-6 py-5 border-b border-slate-100 bg-slate-50/50 flex items-center gap-2">
            <TrendingDown className="text-rose-500 w-5 h-5" />
            <h3 className="font-bold text-slate-800">
              Low Stock Alerts (10 or fewer)
            </h3>
          </div>
          {lowStock.length > 0 ? (
            <ul className="divide-y divide-slate-100 max-h-80 overflow-y-auto">
              {lowStock.map((item, i) => (
                <li
                  key={i}
                  className="flex justify-between items-center px-6 py-4 hover:bg-slate-50"
                >
                  <div>
                    <span className="block font-medium text-slate-700">
                      {item.name}
                    </span>
                    <span className="block text-xs text-slate-400 font-mono mt-0.5">
                      {item.barcode}
                    </span>
                  </div>
                  <span
                    className={`py-1 px-3 rounded-full text-xs font-bold ${item.stock === 0 ? "bg-rose-100 text-rose-800" : "bg-orange-100 text-orange-800"}`}
                  >
                    {item.stock} Left
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="p-6 text-center text-emerald-600 font-medium">
              All items are well stocked!
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// --- Tab: Sales Summary -------------------------------------------------------

function SalesSummaryTab({ filters }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({
        search: filters.search,
        date_from: filters.dateFrom,
        date_to: filters.dateTo,
        outlet_id: filters.outletId,
        employee_id: filters.employeeId,
      });
      const res = await fetch(`${API}/api/reports/sales-summary?${p}`);
      const d = await res.json();
      setRows(d.sales || []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [
    filters.search,
    filters.dateFrom,
    filters.dateTo,
    filters.outletId,
    filters.employeeId,
  ]);

  useEffect(() => {
    load();
  }, [load]);

  const total = rows.reduce((s, r) => s + r.total_amount, 0);
  const avgBasket = rows.length ? total / rows.length : 0;

  const trendData = useMemo(() => {
    const map = {};
    rows.forEach((r) => {
      const day = (r.timestamp || "").slice(0, 10);
      if (!day) return;
      map[day] = (map[day] || 0) + r.total_amount;
    });
    return Object.entries(map)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, revenue]) => ({
        date: new Date(date + "T00:00:00").toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
        }),
        revenue: +revenue.toFixed(2),
      }));
  }, [rows]);

  return (
    <div className="flex flex-col gap-3">
      {/* KPI Strip */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-blue-100 flex items-center justify-center shrink-0">
            <DollarSign size={18} className="text-blue-600" />
          </div>
          <div>
            <p className="text-xs text-slate-500">Total Revenue</p>
            <p className="text-xl font-bold text-slate-900">{fmt(total)}</p>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-emerald-100 flex items-center justify-center shrink-0">
            <ShoppingBag size={18} className="text-emerald-600" />
          </div>
          <div>
            <p className="text-xs text-slate-500">Avg Basket</p>
            <p className="text-xl font-bold text-slate-900">{fmt(avgBasket)}</p>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-violet-100 flex items-center justify-center shrink-0">
            <ClipboardList size={18} className="text-violet-600" />
          </div>
          <div>
            <p className="text-xs text-slate-500">Orders</p>
            <p className="text-xl font-bold text-slate-900">{rows.length}</p>
          </div>
        </div>
      </div>

      {/* Revenue Trend Chart */}
      {trendData.length > 1 && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
          <p className="text-sm font-semibold text-slate-700 mb-3">
            Revenue Trend
          </p>
          <ResponsiveContainer width="100%" height={160}>
            <AreaChart
              data={trendData}
              margin={{ top: 4, right: 4, left: 0, bottom: 0 }}
            >
              <defs>
                <linearGradient id="revenueGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.15} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 10, fill: "#94a3b8" }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 10, fill: "#94a3b8" }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v) => `PKRs ${v}`}
              />
              <Tooltip
                formatter={(v) => [fmt(v), "Revenue"]}
                contentStyle={{
                  fontSize: 12,
                  borderRadius: 8,
                  border: "1px solid #e2e8f0",
                }}
              />
              <Area
                type="monotone"
                dataKey="revenue"
                stroke="#3b82f6"
                strokeWidth={2}
                fill="url(#revenueGrad)"
                dot={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      <CardShell
        title="Sales Summary"
        subtitle={`${rows.length} sale${rows.length !== 1 ? "s" : ""} � Total: ${fmt(total)}`}
        action={
          <ExportButton
            onClick={() =>
              exportCSV(
                "sales-summary.csv",
                [
                  { header: "Date", key: "timestamp" },
                  { header: "Order #", key: "id" },
                  { header: "Customer", key: "customer_name" },
                  { header: "Outlet", key: "outlet_name" },
                  { header: "Employee", key: "employee_name" },
                  { header: "Payment", key: "payment_methods" },
                  { header: "Total", key: "total_amount" },
                ],
                rows,
              )
            }
          />
        }
      >
        <TableShell
          cols={[
            "Date",
            "Order #",
            "Customer",
            "Outlet",
            "Employee",
            "Payment",
            "Total",
          ]}
          loading={loading}
          empty={rows.length === 0}
        >
          {rows.map((r) => (
            <tr key={r.id} className="hover:bg-slate-50 transition-colors">
              <td className="p-4 text-sm text-slate-500 whitespace-nowrap">
                {fmtDateTime(r.timestamp)}
              </td>
              <td className="p-4 font-mono font-bold text-slate-800">
                #{r.id}
              </td>
              <td className="p-4 text-sm font-medium text-slate-800">
                {r.customer_name}
              </td>
              <td className="p-4 text-sm text-slate-600">{r.outlet_name}</td>
              <td className="p-4 text-sm text-slate-600">{r.employee_name}</td>
              <td className="p-4 text-sm text-slate-600">
                {r.payment_methods}
              </td>
              <td className="p-4 text-right font-bold text-slate-900">
                {fmt(r.total_amount)}
              </td>
            </tr>
          ))}
        </TableShell>
      </CardShell>
    </div>
  );
}

// --- Tab: Sales Detail --------------------------------------------------------

function SalesDetailTab({ filters }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({
        search: filters.search,
        date_from: filters.dateFrom,
        date_to: filters.dateTo,
        outlet_id: filters.outletId,
        employee_id: filters.employeeId,
      });
      const res = await fetch(`${API}/api/reports/sales-detail?${p}`);
      const d = await res.json();
      setRows(d.items || []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [
    filters.search,
    filters.dateFrom,
    filters.dateTo,
    filters.outletId,
    filters.employeeId,
  ]);

  useEffect(() => {
    load();
  }, [load]);
  const totalRevenue = rows.reduce((s, r) => s + r.line_total, 0);

  return (
    <div className="flex flex-col gap-3">
      <CardShell
        title="Sales Detail"
        subtitle={`${rows.length} line item${rows.length !== 1 ? "s" : ""} � Revenue: ${fmt(totalRevenue)}`}
        action={
          <ExportButton
            onClick={() =>
              exportCSV(
                "sales-detail.csv",
                [
                  { header: "Order #", key: "sale_id" },
                  { header: "Date", key: "timestamp" },
                  { header: "Customer", key: "customer_name" },
                  { header: "Product", key: "product_name" },
                  { header: "Barcode", key: "barcode" },
                  { header: "Qty", key: "quantity" },
                  { header: "Price", key: "price_at_sale" },
                  { header: "Cost", key: "cost_price_at_sale" },
                  { header: "Line Total", key: "line_total" },
                ],
                rows,
              )
            }
          />
        }
      >
        <TableShell
          cols={[
            "Order #",
            "Date",
            "Customer",
            "Product",
            "Barcode",
            "Qty",
            "Price",
            "Cost",
            "Line Total",
          ]}
          loading={loading}
          empty={rows.length === 0}
        >
          {rows.map((r, i) => (
            <tr key={i} className="hover:bg-slate-50 transition-colors">
              <td className="p-4 font-mono font-bold text-slate-800">
                #{r.sale_id}
              </td>
              <td className="p-4 text-sm text-slate-500 whitespace-nowrap">
                {fmtDateTime(r.timestamp)}
              </td>
              <td className="p-4 text-sm text-slate-700">{r.customer_name}</td>
              <td className="p-4 text-sm font-medium text-slate-800">
                {r.product_name}
              </td>
              <td className="p-4 text-xs font-mono text-slate-500">
                {r.barcode}
              </td>
              <td className="p-4 text-center font-semibold text-slate-700">
                {r.quantity}
              </td>
              <td className="p-4 text-right text-sm text-slate-700">
                {fmt(r.price_at_sale)}
              </td>
              <td className="p-4 text-right text-sm text-slate-500">
                {fmt(r.cost_price_at_sale)}
              </td>
              <td className="p-4 text-right font-bold text-slate-900">
                {fmt(r.line_total)}
              </td>
            </tr>
          ))}
        </TableShell>
      </CardShell>
    </div>
  );
}

// --- Tab: Sales & Stock -------------------------------------------------------

function SalesStockTab({ filters }) {
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
      const res = await fetch(`${API}/api/reports/sales-stock?${p}`);
      const d = await res.json();
      setRows(d.rows || []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [filters.outletId, filters.categoryId, filters.brandId]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <CardShell
      title="Sales & Stock"
      subtitle="All-time sales performance vs. current stock level per product"
    >
      <TableShell
        cols={[
          "Product",
          "Barcode",
          "Category",
          "Units Sold",
          "Revenue",
          "Current Stock",
        ]}
        loading={loading}
        empty={rows.length === 0}
        emptyIcon={Package}
      >
        {rows.map((r) => (
          <tr key={r.id} className="hover:bg-slate-50 transition-colors">
            <td className="p-4 font-medium text-slate-800">{r.name}</td>
            <td className="p-4 text-xs font-mono text-slate-500">
              {r.barcode}
            </td>
            <td className="p-4 text-sm text-slate-600">{r.category}</td>
            <td className="p-4 text-center">
              <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full text-xs font-semibold">
                {r.units_sold}
              </span>
            </td>
            <td className="p-4 text-right font-bold text-slate-900">
              {fmt(r.revenue)}
            </td>
            <td className="p-4 text-center">
              <span
                className={`px-2 py-0.5 rounded-full text-xs font-semibold ${r.total_stock === 0 ? "bg-rose-100 text-rose-700" : r.total_stock <= 10 ? "bg-orange-100 text-orange-700" : "bg-emerald-100 text-emerald-700"}`}
              >
                {r.total_stock}
              </span>
            </td>
          </tr>
        ))}
      </TableShell>
    </CardShell>
  );
}

// --- Tab: Inventory Dump ------------------------------------------------------

function InventoryDumpTab({ filters }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({
        outlet_id: filters.outletId,
        category_id: filters.categoryId,
        brand_id: filters.brandId,
        search: filters.search,
      });
      const res = await fetch(`${API}/api/reports/inventory-dump?${p}`);
      const d = await res.json();
      setRows(d.rows || []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [filters.outletId, filters.categoryId, filters.brandId, filters.search]);

  useEffect(() => {
    load();
  }, [load]);

  const totalRetail = rows.reduce((s, r) => s + r.retail_value, 0);
  const totalCost = rows.reduce((s, r) => s + r.cost_value, 0);

  return (
    <div className="flex flex-col gap-3">
      <CardShell
        title="Inventory Dump"
        subtitle={`${rows.length} records • Retail Value: ${fmt(totalRetail)} • Cost Value: ${fmt(totalCost)}`}
        action={
          <ExportButton
            onClick={() =>
              exportCSV(
                "inventory-dump.csv",
                [
                  { header: "Outlet", key: "outlet_name" },
                  { header: "Product", key: "product_name" },
                  { header: "Barcode", key: "barcode" },
                  { header: "Category", key: "category" },
                  { header: "Brand", key: "brand" },
                  { header: "Price", key: "price" },
                  { header: "Cost", key: "cost_price" },
                  { header: "Qty", key: "quantity" },
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
          cols={[
            "Outlet",
            "Product",
            "Barcode",
            "Category",
            "Brand",
            "Price",
            "Cost",
            "Qty",
            "Retail Value",
            "Cost Value",
          ]}
          loading={loading}
          empty={rows.length === 0}
          emptyIcon={Archive}
        >
          {rows.map((r, i) => (
            <tr key={i} className="hover:bg-slate-50 transition-colors">
              <td className="p-4 text-sm text-slate-600">{r.outlet_name}</td>
              <td className="p-4 font-medium text-slate-800">
                {r.product_name}
              </td>
              <td className="p-4 text-xs font-mono text-slate-500">
                {r.barcode}
              </td>
              <td className="p-4 text-sm text-slate-600">{r.category}</td>
              <td className="p-4 text-sm text-slate-600">{r.brand}</td>
              <td className="p-4 text-right text-sm text-slate-700">
                {fmt(r.price)}
              </td>
              <td className="p-4 text-right text-sm text-slate-500">
                {fmt(r.cost_price)}
              </td>
              <td className="p-4 text-center font-semibold text-slate-700">
                {r.quantity}
              </td>
              <td className="p-4 text-right font-bold text-slate-900">
                {fmt(r.retail_value)}
              </td>
              <td className="p-4 text-right text-slate-600">
                {fmt(r.cost_value)}
              </td>
            </tr>
          ))}
        </TableShell>
      </CardShell>
    </div>
  );
}

// --- Tab: Category Wise -------------------------------------------------------

function CategoryWiseTab({ filters }) {
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
      const res = await fetch(`${API}/api/reports/category-wise?${p}`);
      const d = await res.json();
      setRows(d.data || []);
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
    <div className="flex flex-col gap-3">
      <CardShell
        title="Category Wise Sales"
        subtitle="Revenue and profit breakdown by product category"
        action={
          <ExportButton
            onClick={() =>
              exportCSV(
                "category-wise.csv",
                [
                  { header: "Category", key: "category" },
                  { header: "Units Sold", key: "units_sold" },
                  { header: "Revenue", key: "revenue" },
                  { header: "COGS", key: "cost" },
                  { header: "Gross Profit", key: "profit" },
                  { header: "% of Revenue", key: "pct" },
                ],
                rows,
              )
            }
          />
        }
      >
        <TableShell
          cols={[
            "Category",
            "Units Sold",
            "Revenue",
            "COGS",
            "Gross Profit",
            "% of Revenue",
          ]}
          loading={loading}
          empty={rows.length === 0}
          emptyIcon={Tag}
        >
          {rows.map((r, i) => (
            <tr key={i} className="hover:bg-slate-50 transition-colors">
              <td className="p-4 font-medium text-slate-800">{r.category}</td>
              <td className="p-4 text-center">
                <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full text-xs font-semibold">
                  {r.units_sold}
                </span>
              </td>
              <td className="p-4 text-right font-bold text-slate-900">
                {fmt(r.revenue)}
              </td>
              <td className="p-4 text-right text-sm text-slate-500">
                {fmt(r.cost)}
              </td>
              <td className="p-4 text-right font-semibold text-emerald-700">
                {fmt(r.profit)}
              </td>
              <td className="p-4 text-center">
                <span className="bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full text-xs font-semibold">
                  {r.pct}%
                </span>
              </td>
            </tr>
          ))}
        </TableShell>
      </CardShell>
    </div>
  );
}

// --- Tab: Customer Details ----------------------------------------------------

function CustomerDetailsTab({ filters }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({
        search: filters.search,
        outlet_id: filters.outletId,
      });
      const res = await fetch(`${API}/api/reports/customer-details?${p}`);
      const data = await res.json();
      setRows(data.customers || []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [filters.search, filters.outletId]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <CardShell title="Customer Details">
      <TableShell
        cols={[
          "Date Created",
          "Customer",
          "Amount Spent",
          "Orders",
          "Mobile",
          "Email",
        ]}
        loading={loading}
        empty={rows.length === 0}
        emptyIcon={Users}
      >
        {rows.map((c) => (
          <tr key={c.id} className="hover:bg-slate-50 transition-colors">
            <td className="p-4 text-sm text-slate-500">
              {fmtDate(c.created_at)}
            </td>
            <td className="p-4">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-full bg-linear-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white text-xs font-bold shrink-0">
                  {c.name.charAt(0).toUpperCase()}
                </div>
                <span className="font-semibold text-slate-800">{c.name}</span>
              </div>
            </td>
            <td className="p-4 text-right font-bold text-slate-900">
              {fmt(c.total_spent)}
            </td>
            <td className="p-4 text-center">
              <span className="bg-slate-100 text-slate-700 px-2 py-0.5 rounded-full text-xs font-semibold">
                {c.order_count}
              </span>
            </td>
            <td className="p-4 text-sm text-slate-600">
              {c.mobile || <span className="italic text-slate-400">�</span>}
            </td>
            <td className="p-4 text-sm text-slate-600">
              {c.email || <span className="italic text-slate-400">�</span>}
            </td>
          </tr>
        ))}
      </TableShell>
    </CardShell>
  );
}

// --- Tab: Customer Wise -------------------------------------------------------

function CustomerWiseTab({ filters }) {
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
      const res = await fetch(`${API}/api/reports/customer-wise?${p}`);
      const d = await res.json();
      setRows(d.data || []);
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
      title="Customer Wise Summary"
      subtitle="Total orders and revenue per customer, ranked by spend."
    >
      <TableShell
        cols={["#", "Customer", "Order Count", "Amount"]}
        loading={loading}
        empty={rows.length === 0}
        emptyIcon={Users}
      >
        {rows.map((r, i) => (
          <tr key={i} className="hover:bg-slate-50 transition-colors">
            <td className="p-4 text-sm text-slate-400 font-mono">{i + 1}</td>
            <td className="p-4">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-full bg-linear-to-br from-violet-500 to-purple-600 flex items-center justify-center text-white text-xs font-bold shrink-0">
                  {r.customer.charAt(0).toUpperCase()}
                </div>
                <span className="font-semibold text-slate-800">
                  {r.customer}
                </span>
              </div>
            </td>
            <td className="p-4 text-center">
              <span className="bg-blue-100 text-blue-700 px-2.5 py-0.5 rounded-full text-xs font-semibold">
                {r.order_count}
              </span>
            </td>
            <td className="p-4 text-right font-bold text-slate-900">
              {fmt(r.total_amount)}
            </td>
          </tr>
        ))}
      </TableShell>
    </CardShell>
  );
}

// --- Tab: Order Wise ----------------------------------------------------------

function OrderWiseTab({ filters }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({
        search: filters.search,
        date_from: filters.dateFrom,
        date_to: filters.dateTo,
        outlet_id: filters.outletId,
        employee_id: filters.employeeId,
      });
      const res = await fetch(`${API}/api/reports/order-wise?${p}`);
      const d = await res.json();
      setRows(d.orders || []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [
    filters.search,
    filters.dateFrom,
    filters.dateTo,
    filters.outletId,
    filters.employeeId,
  ]);

  useEffect(() => {
    load();
  }, [load]);
  const totalExcl = rows.reduce((s, r) => s + r.sale_excl_tax, 0);
  const totalIncl = rows.reduce((s, r) => s + r.total_amount, 0);

  return (
    <div className="flex flex-col gap-3">
      <CardShell
        title="Order Wise Report"
        subtitle={`${rows.length} order${rows.length !== 1 ? "s" : ""} � Excl. Tax ${fmt(totalExcl)} � Incl. Tax ${fmt(totalIncl)}`}
        action={
          <ExportButton
            onClick={() =>
              exportCSV(
                "order-wise.csv",
                [
                  { header: "Date", key: "timestamp" },
                  { header: "Customer", key: "customer_name" },
                  { header: "Order #", key: "id" },
                  { header: "Sale Excl. Tax", key: "sale_excl_tax" },
                  { header: "Discount", key: "discount_amount" },
                  { header: "Sale Incl. Tax", key: "total_amount" },
                  { header: "Payment", key: "payment_method" },
                ],
                rows,
              )
            }
          />
        }
      >
        <TableShell
          cols={[
            "Date",
            "Customer",
            "Order #",
            "Sale Excl. Tax",
            "Discount",
            "Sale Incl. Tax",
            "Payment",
          ]}
          loading={loading}
          empty={rows.length === 0}
        >
          {rows.map((r) => (
            <tr key={r.id} className="hover:bg-slate-50 transition-colors">
              <td className="p-4 text-sm text-slate-600 whitespace-nowrap">
                {fmtDateTime(r.timestamp)}
              </td>
              <td className="p-4 text-sm font-medium text-slate-800">
                {r.customer_name}
              </td>
              <td className="p-4 font-mono font-bold text-slate-800">
                #{r.id}
              </td>
              <td className="p-4 text-right text-sm text-slate-700">
                {fmt(r.sale_excl_tax)}
              </td>
              <td className="p-4 text-right text-sm">
                {r.discount_amount > 0 ? (
                  <span className="text-rose-600 font-semibold">
                    -{fmt(r.discount_amount)}
                  </span>
                ) : (
                  <span className="text-slate-400">�</span>
                )}
              </td>
              <td className="p-4 text-right font-bold text-slate-900">
                {fmt(r.total_amount)}
              </td>
              <td className="p-4 text-sm text-slate-600">{r.payment_method}</td>
            </tr>
          ))}
        </TableShell>
      </CardShell>
    </div>
  );
}

// --- Tab: Item Wise -----------------------------------------------------------

function ItemWiseTab({ filters }) {
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
        search: filters.search,
      });
      const res = await fetch(`${API}/api/reports/item-wise?${p}`);
      const d = await res.json();
      setRows(d.rows || []);
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
    filters.search,
  ]);

  useEffect(() => {
    load();
  }, [load]);
  const totalRevenue = rows.reduce((s, r) => s + r.revenue, 0);
  const totalProfit = rows.reduce((s, r) => s + r.gross_profit, 0);

  return (
    <div className="flex flex-col gap-3">
      <CardShell
        title="Item Wise Report"
        subtitle={`${rows.length} product${rows.length !== 1 ? "s" : ""} � Revenue: ${fmt(totalRevenue)} � Profit: ${fmt(totalProfit)}`}
        action={
          <ExportButton
            onClick={() =>
              exportCSV(
                "item-wise.csv",
                [
                  { header: "Product", key: "product_name" },
                  { header: "Barcode", key: "barcode" },
                  { header: "Units Sold", key: "units_sold" },
                  { header: "Revenue", key: "revenue" },
                  { header: "COGS", key: "total_cost" },
                  { header: "Gross Profit", key: "gross_profit" },
                ],
                rows,
              )
            }
          />
        }
      >
        <TableShell
          cols={[
            "#",
            "Product",
            "Barcode",
            "Units Sold",
            "Revenue",
            "COGS",
            "Gross Profit",
          ]}
          loading={loading}
          empty={rows.length === 0}
          emptyIcon={ShoppingBag}
        >
          {rows.map((r, i) => (
            <tr key={r.id} className="hover:bg-slate-50 transition-colors">
              <td className="p-4 text-sm text-slate-400 font-mono">{i + 1}</td>
              <td className="p-4 font-medium text-slate-800">
                {r.product_name}
              </td>
              <td className="p-4 text-xs font-mono text-slate-500">
                {r.barcode}
              </td>
              <td className="p-4 text-center">
                <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full text-xs font-semibold">
                  {r.units_sold}
                </span>
              </td>
              <td className="p-4 text-right font-bold text-slate-900">
                {fmt(r.revenue)}
              </td>
              <td className="p-4 text-right text-sm text-slate-500">
                {fmt(r.total_cost)}
              </td>
              <td className="p-4 text-right font-semibold text-emerald-700">
                {fmt(r.gross_profit)}
              </td>
            </tr>
          ))}
        </TableShell>
      </CardShell>
    </div>
  );
}

// --- Tab: Product Performance -------------------------------------------------

function ProductPerformanceTab({ filters }) {
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
      const res = await fetch(`${API}/api/reports/product-performance?${p}`);
      const d = await res.json();
      setRows(d.rows || []);
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
    <div className="flex flex-col gap-3">
      <CardShell
        title="Product Performance"
        subtitle="Products ranked by gross profit margin %"
      >
        <TableShell
          cols={[
            "#",
            "Product",
            "Units Sold",
            "Revenue",
            "COGS",
            "Gross Profit",
            "Margin %",
          ]}
          loading={loading}
          empty={rows.length === 0}
          emptyIcon={Star}
        >
          {rows.map((r, i) => (
            <tr key={r.id} className="hover:bg-slate-50 transition-colors">
              <td className="p-4 text-sm text-slate-400 font-mono">{i + 1}</td>
              <td className="p-4 font-medium text-slate-800">
                {r.product_name}
              </td>
              <td className="p-4 text-center">
                <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full text-xs font-semibold">
                  {r.units_sold}
                </span>
              </td>
              <td className="p-4 text-right font-bold text-slate-900">
                {fmt(r.revenue)}
              </td>
              <td className="p-4 text-right text-sm text-slate-500">
                {fmt(r.total_cost)}
              </td>
              <td className="p-4 text-right font-semibold text-emerald-700">
                {fmt(r.gross_profit)}
              </td>
              <td className="p-4 text-center">
                <span
                  className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${r.margin_pct >= 40 ? "bg-emerald-100 text-emerald-700" : r.margin_pct >= 20 ? "bg-yellow-100 text-yellow-700" : "bg-rose-100 text-rose-700"}`}
                >
                  {r.margin_pct}%
                </span>
              </td>
            </tr>
          ))}
        </TableShell>
      </CardShell>
    </div>
  );
}

// --- Tab: Product Specification -----------------------------------------------

function ProductSpecTab({ filters }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({
        search: filters.search,
        category_id: filters.categoryId,
        brand_id: filters.brandId,
      });
      const res = await fetch(`${API}/api/reports/product-spec?${p}`);
      const d = await res.json();
      setRows(d.rows || []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [filters.search, filters.categoryId, filters.brandId]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <CardShell
      title="Product Specification"
      subtitle="Full product catalogue with all fields"
    >
      <TableShell
        cols={[
          "ID",
          "Barcode",
          "Product",
          "Category",
          "Brand",
          "Supplier",
          "Price",
          "Cost",
          "Tax",
          "Rate",
        ]}
        loading={loading}
        empty={rows.length === 0}
        emptyIcon={Package}
      >
        {rows.map((r) => (
          <tr key={r.id} className="hover:bg-slate-50 transition-colors">
            <td className="p-4 text-xs font-mono text-slate-400">{r.id}</td>
            <td className="p-4 text-xs font-mono text-slate-500">
              {r.barcode}
            </td>
            <td className="p-4 font-medium text-slate-800">{r.name}</td>
            <td className="p-4 text-sm text-slate-600">{r.category}</td>
            <td className="p-4 text-sm text-slate-600">{r.brand}</td>
            <td className="p-4 text-sm text-slate-600">{r.supplier}</td>
            <td className="p-4 text-right font-bold text-slate-900">
              {fmt(r.price)}
            </td>
            <td className="p-4 text-right text-sm text-slate-500">
              {fmt(r.cost_price)}
            </td>
            <td className="p-4 text-sm text-slate-600">{r.tax_name}</td>
            <td className="p-4 text-center text-sm font-semibold text-slate-700">
              {r.tax_rate}%
            </td>
          </tr>
        ))}
      </TableShell>
    </CardShell>
  );
}

// --- Tab: On Hand Inventory ---------------------------------------------------

function OnHandTab({ filters }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({
        outlet_id: filters.outletId,
        category_id: filters.categoryId,
        brand_id: filters.brandId,
        search: filters.search,
      });
      const res = await fetch(`${API}/api/reports/on-hand?${p}`);
      const d = await res.json();
      setRows(d.rows || []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [filters.outletId, filters.categoryId, filters.brandId, filters.search]);

  useEffect(() => {
    load();
  }, [load]);
  const totalRetail = rows.reduce((s, r) => s + r.retail_value, 0);

  return (
    <div className="flex flex-col gap-3">
      <CardShell
        title="On Hand Inventory"
        subtitle={`${rows.length} records � Retail Value: ${fmt(totalRetail)}`}
        action={
          <ExportButton
            onClick={() =>
              exportCSV(
                "on-hand-inventory.csv",
                [
                  { header: "Product", key: "product_name" },
                  { header: "Barcode", key: "barcode" },
                  { header: "Outlet", key: "outlet_name" },
                  { header: "Qty on Hand", key: "quantity" },
                  { header: "Price", key: "price" },
                  { header: "Cost", key: "cost_price" },
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
          cols={[
            "Product",
            "Barcode",
            "Outlet",
            "Qty on Hand",
            "Price",
            "Cost",
            "Retail Value",
            "Cost Value",
          ]}
          loading={loading}
          empty={rows.length === 0}
          emptyIcon={Layers}
        >
          {rows.map((r, i) => (
            <tr key={i} className="hover:bg-slate-50 transition-colors">
              <td className="p-4 font-medium text-slate-800">
                {r.product_name}
              </td>
              <td className="p-4 text-xs font-mono text-slate-500">
                {r.barcode}
              </td>
              <td className="p-4 text-sm text-slate-600">{r.outlet_name}</td>
              <td className="p-4 text-center">
                <span
                  className={`px-2 py-0.5 rounded-full text-xs font-semibold ${r.quantity === 0 ? "bg-rose-100 text-rose-700" : r.quantity <= 10 ? "bg-orange-100 text-orange-700" : "bg-emerald-100 text-emerald-700"}`}
                >
                  {r.quantity}
                </span>
              </td>
              <td className="p-4 text-right text-sm text-slate-700">
                {fmt(r.price)}
              </td>
              <td className="p-4 text-right text-sm text-slate-500">
                {fmt(r.cost_price)}
              </td>
              <td className="p-4 text-right font-bold text-slate-900">
                {fmt(r.retail_value)}
              </td>
              <td className="p-4 text-right text-slate-600">
                {fmt(r.cost_value)}
              </td>
            </tr>
          ))}
        </TableShell>
      </CardShell>
    </div>
  );
}

// --- Tab: Inventory Loss ------------------------------------------------------

function InventoryLossTab({ filters }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({
        date_from: filters.dateFrom,
        date_to: filters.dateTo,
        outlet_id: filters.outletId,
        search: filters.search,
      });
      const res = await fetch(`${API}/api/reports/inventory-loss?${p}`);
      const d = await res.json();
      setRows(d.rows || []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [filters.dateFrom, filters.dateTo, filters.outletId, filters.search]);

  useEffect(() => {
    load();
  }, [load]);
  const totalLoss = rows.reduce((s, r) => s + Math.abs(r.quantity_change), 0);

  return (
    <div className="flex flex-col gap-3">
      <CardShell
        title="Inventory Loss"
        subtitle={`${rows.length} adjustment${rows.length !== 1 ? "s" : ""} � Total units lost: ${totalLoss}`}
      >
        <TableShell
          cols={[
            "Date",
            "Product",
            "Barcode",
            "Outlet",
            "Employee",
            "Qty Change",
            "Reason",
          ]}
          loading={loading}
          empty={rows.length === 0}
          emptyIcon={TrendingDown}
        >
          {rows.map((r, i) => (
            <tr key={i} className="hover:bg-slate-50 transition-colors">
              <td className="p-4 text-sm text-slate-500 whitespace-nowrap">
                {fmtDateTime(r.timestamp)}
              </td>
              <td className="p-4 font-medium text-slate-800">
                {r.product_name}
              </td>
              <td className="p-4 text-xs font-mono text-slate-500">
                {r.barcode}
              </td>
              <td className="p-4 text-sm text-slate-600">{r.outlet_name}</td>
              <td className="p-4 text-sm text-slate-600">{r.employee_name}</td>
              <td className="p-4 text-center font-bold text-rose-700">
                {r.quantity_change}
              </td>
              <td className="p-4 text-sm text-slate-600">{r.reason}</td>
            </tr>
          ))}
        </TableShell>
      </CardShell>
    </div>
  );
}

// --- Tab: Wastage -------------------------------------------------------------

function WastageTab({ filters }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({
        date_from: filters.dateFrom,
        date_to: filters.dateTo,
        outlet_id: filters.outletId,
        search: filters.search,
      });
      const res = await fetch(`${API}/api/reports/wastage?${p}`);
      const d = await res.json();
      setRows(d.rows || []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [filters.dateFrom, filters.dateTo, filters.outletId, filters.search]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="flex flex-col gap-3">
      <CardShell
        title="Wastage Report"
        subtitle="Stock adjustments with Damaged or Expired reason"
      >
        <TableShell
          cols={[
            "Date",
            "Product",
            "Barcode",
            "Outlet",
            "Employee",
            "Qty",
            "Reason",
          ]}
          loading={loading}
          empty={rows.length === 0}
          emptyIcon={Recycle}
        >
          {rows.map((r, i) => (
            <tr key={i} className="hover:bg-slate-50 transition-colors">
              <td className="p-4 text-sm text-slate-500 whitespace-nowrap">
                {fmtDateTime(r.timestamp)}
              </td>
              <td className="p-4 font-medium text-slate-800">
                {r.product_name}
              </td>
              <td className="p-4 text-xs font-mono text-slate-500">
                {r.barcode}
              </td>
              <td className="p-4 text-sm text-slate-600">{r.outlet_name}</td>
              <td className="p-4 text-sm text-slate-600">{r.employee_name}</td>
              <td className="p-4 text-center font-bold text-orange-700">
                {r.quantity_change}
              </td>
              <td className="p-4">
                <span
                  className={`px-2 py-0.5 rounded-full text-xs font-semibold ${r.reason === "Damaged" ? "bg-rose-100 text-rose-700" : "bg-orange-100 text-orange-700"}`}
                >
                  {r.reason}
                </span>
              </td>
            </tr>
          ))}
        </TableShell>
      </CardShell>
    </div>
  );
}

// --- Tab: Product Movement ----------------------------------------------------

function ProductMovementTab({ filters }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({
        date_from: filters.dateFrom,
        date_to: filters.dateTo,
        outlet_id: filters.outletId,
        search: filters.search,
      });
      const res = await fetch(`${API}/api/transfers?${p}`);
      const d = await res.json();
      setRows(Array.isArray(d) ? d : []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [filters.dateFrom, filters.dateTo, filters.outletId, filters.search]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <CardShell
      title="Product Movement"
      subtitle="All inter-outlet inventory transfers"
    >
      <TableShell
        cols={[
          "Date",
          "Product",
          "From Outlet",
          "To Outlet",
          "Qty",
          "Employee",
          "Note",
        ]}
        loading={loading}
        empty={rows.length === 0}
        emptyIcon={ArrowLeftRight}
      >
        {rows.map((r) => (
          <tr key={r.id} className="hover:bg-slate-50 transition-colors">
            <td className="p-4 text-sm text-slate-500 whitespace-nowrap">
              {fmtDateTime(r.timestamp)}
            </td>
            <td className="p-4 font-medium text-slate-800">{r.product_name}</td>
            <td className="p-4 text-sm text-slate-600">{r.from_outlet_name}</td>
            <td className="p-4 text-sm text-slate-600">{r.to_outlet_name}</td>
            <td className="p-4 text-center">
              <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full text-xs font-semibold">
                {r.quantity}
              </span>
            </td>
            <td className="p-4 text-sm text-slate-600">
              {r.employee_name || "�"}
            </td>
            <td className="p-4 text-sm text-slate-500 italic">
              {r.note || "�"}
            </td>
          </tr>
        ))}
      </TableShell>
    </CardShell>
  );
}

// --- Tab: STR Report ----------------------------------------------------------

function STRReportTab({ filters }) {
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
      const res = await fetch(`${API}/api/reports/str-report?${p}`);
      const d = await res.json();
      setRows(d.rows || d || []);
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
    <div className="flex flex-col gap-3">
      <CardShell
        title="STR Report � Stock Transfer"
        subtitle={`${rows.length} transfer${rows.length !== 1 ? "s" : ""}`}
      >
        <TableShell
          cols={[
            "Transfer #",
            "Date",
            "Product",
            "From",
            "To",
            "Qty",
            "Employee",
            "Notes",
          ]}
          loading={loading}
          empty={rows.length === 0}
          emptyIcon={ArrowLeftRight}
        >
          {rows.map((r, i) => (
            <tr key={r.id} className="hover:bg-slate-50 transition-colors">
              <td className="p-4 text-xs font-mono text-slate-400">
                {String(i + 1).padStart(4, "0")}
              </td>
              <td className="p-4 text-sm text-slate-500 whitespace-nowrap">
                {fmtDateTime(r.timestamp)}
              </td>
              <td className="p-4 font-medium text-slate-800">
                {r.product_name}
              </td>
              <td className="p-4 text-sm text-slate-600">
                {r.from_outlet_name}
              </td>
              <td className="p-4 text-sm text-slate-600">{r.to_outlet_name}</td>
              <td className="p-4 text-center">
                <span className="bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full text-xs font-semibold">
                  {r.quantity}
                </span>
              </td>
              <td className="p-4 text-sm text-slate-600">
                {r.employee_name || "�"}
              </td>
              <td className="p-4 text-sm text-slate-500 italic">
                {r.note || "�"}
              </td>
            </tr>
          ))}
        </TableShell>
      </CardShell>
    </div>
  );
}

// --- Tab: Replenishment -------------------------------------------------------

function ReplenishmentTab({ filters }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [threshold] = useState(10);
  const [drafting, setDrafting] = useState(false);
  const [draftResult, setDraftResult] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({
        threshold,
        outlet_id: filters.outletId,
        category_id: filters.categoryId,
        brand_id: filters.brandId,
      });
      const res = await fetch(`${API}/api/reports/replenishment?${p}`);
      const d = await res.json();
      setRows(d.rows || []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [threshold, filters.outletId, filters.categoryId, filters.brandId]);

  useEffect(() => {
    load();
  }, [load]);

  // Group items by supplier ? one Draft PO per supplier
  const handleCreateDraftPOs = async () => {
    const withSupplier = rows.filter((r) => r.supplier_id);
    if (!withSupplier.length) {
      setDraftResult({
        error:
          "No items have a supplier assigned. Edit products to add suppliers.",
      });
      return;
    }
    const bySupplier = {};
    withSupplier.forEach((r) => {
      if (!bySupplier[r.supplier_id])
        bySupplier[r.supplier_id] = {
          supplier_name: r.supplier_name,
          items: [],
        };
      const reorderQty = Math.max(1, (r.min_qty || 10) - r.quantity);
      bySupplier[r.supplier_id].items.push({
        product_id: r.product_id,
        quantity: reorderQty,
        cost_price: r.cost_price || 0,
      });
    });

    setDrafting(true);
    setDraftResult(null);
    const created = [];
    const failed = [];
    for (const [supplierId, { supplier_name, items }] of Object.entries(
      bySupplier,
    )) {
      const totalCost = items.reduce(
        (s, i) => s + i.quantity * i.cost_price,
        0,
      );
      try {
        const res = await fetch(`${API}/api/purchase-orders`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            supplier_id: parseInt(supplierId),
            total_cost: totalCost,
            items,
          }),
        });
        if (res.ok) created.push(supplier_name);
        else failed.push(supplier_name);
      } catch {
        failed.push(supplier_name);
      }
    }
    setDrafting(false);
    setDraftResult({ created, failed });
  };

  const suppliersWithItems = useMemo(() => {
    const ids = new Set(
      rows.filter((r) => r.supplier_id).map((r) => r.supplier_id),
    );
    return ids.size;
  }, [rows]);

  return (
    <div className="flex flex-col gap-3">
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-3 flex flex-wrap items-center gap-3">
        <span className="text-sm font-medium text-slate-600">
          Replenishment Tools
        </span>
        <span className="text-xs text-slate-500">
          Products at or below threshold (10 units)
        </span>
        {rows.length > 0 && (
          <button
            onClick={handleCreateDraftPOs}
            disabled={drafting}
            className="ml-auto flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors"
          >
            <ShoppingCart size={13} />
            {drafting
              ? "Creating�"
              : `Create Draft POs (${suppliersWithItems} supplier${suppliersWithItems !== 1 ? "s" : ""})`}
          </button>
        )}
      </div>

      {draftResult && (
        <div
          className={`rounded-xl border px-4 py-3 text-sm flex items-start gap-2 ${draftResult.error ? "bg-rose-50 border-rose-200 text-rose-700" : "bg-emerald-50 border-emerald-200 text-emerald-800"}`}
        >
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <div>
            {draftResult.error ? (
              draftResult.error
            ) : (
              <>
                {draftResult.created.length > 0 && (
                  <p>
                    <strong>Draft POs created</strong> for:{" "}
                    {draftResult.created.join(", ")}
                  </p>
                )}
                {draftResult.failed.length > 0 && (
                  <p className="text-rose-600 mt-1">
                    Failed: {draftResult.failed.join(", ")} � check permissions
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      )}

      <CardShell
        title="Replenishment Report"
        subtitle={`${rows.length} product${rows.length !== 1 ? "s" : ""} need restocking (= ${threshold} units)`}
      >
        <TableShell
          cols={[
            "Product",
            "Barcode",
            "Supplier",
            "Outlet",
            "Qty on Hand",
            "Reorder Qty",
            "Status",
          ]}
          loading={loading}
          empty={rows.length === 0}
          emptyIcon={RotateCcw}
        >
          {rows.map((r, i) => {
            const reorderQty = Math.max(1, (r.min_qty || 10) - r.quantity);
            return (
              <tr key={i} className="hover:bg-slate-50 transition-colors">
                <td className="p-4 font-medium text-slate-800">
                  {r.product_name}
                </td>
                <td className="p-4 text-xs font-mono text-slate-500">
                  {r.barcode}
                </td>
                <td className="p-4 text-sm text-slate-600">
                  {r.supplier_name}
                </td>
                <td className="p-4 text-sm text-slate-600">{r.outlet_name}</td>
                <td className="p-4 text-center">
                  <span
                    className={`px-2 py-0.5 rounded-full text-xs font-bold ${r.quantity === 0 ? "bg-rose-100 text-rose-800" : "bg-orange-100 text-orange-800"}`}
                  >
                    {r.quantity}
                  </span>
                </td>
                <td className="p-4 text-center">
                  <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full text-xs font-semibold">
                    {reorderQty}
                  </span>
                </td>
                <td className="p-4">
                  <span
                    className={`px-2.5 py-1 rounded-full text-xs font-semibold ${r.quantity === 0 ? "bg-rose-100 text-rose-700" : "bg-orange-100 text-orange-700"}`}
                  >
                    {r.quantity === 0 ? "Out of Stock" : "Low Stock"}
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

// --- Tab: Supplier Wise -------------------------------------------------------

function SupplierWiseTab({ filters }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({
        outlet_id: filters.outletId,
      });
      const res = await fetch(`${API}/api/reports/supplier-wise?${p}`);
      const d = await res.json();
      setRows(d.rows || []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [filters.outletId]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <CardShell
      title="Supplier Wise"
      subtitle="Purchase order spending aggregated per supplier"
    >
      <TableShell
        cols={[
          "Supplier",
          "Contact",
          "Phone",
          "Total POs",
          "Items Ordered",
          "Total Cost",
        ]}
        loading={loading}
        empty={rows.length === 0}
        emptyIcon={Truck}
      >
        {rows.map((r) => (
          <tr key={r.id} className="hover:bg-slate-50 transition-colors">
            <td className="p-4 font-medium text-slate-800">
              {r.supplier_name}
            </td>
            <td className="p-4 text-sm text-slate-600">
              {r.contact_person || "�"}
            </td>
            <td className="p-4 text-sm text-slate-600">{r.phone || "�"}</td>
            <td className="p-4 text-center">
              <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full text-xs font-semibold">
                {r.total_pos}
              </span>
            </td>
            <td className="p-4 text-center text-sm text-slate-700">
              {r.total_items}
            </td>
            <td className="p-4 text-right font-bold text-slate-900">
              {fmt(r.total_cost)}
            </td>
          </tr>
        ))}
      </TableShell>
    </CardShell>
  );
}

// --- Tab: Purchase Orders Report ----------------------------------------------

function PurchaseOrdersReportTab({ filters }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({
        outlet_id: filters.outletId,
        search: filters.search,
        date_from: filters.dateFrom,
        date_to: filters.dateTo,
      });
      const res = await fetch(`${API}/api/purchase-orders?${p}`);
      const d = await res.json();
      setRows(d.purchase_orders || []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [filters.outletId, filters.search, filters.dateFrom, filters.dateTo]);

  useEffect(() => {
    load();
  }, [load]);

  const statusColor = (s) =>
    s === "Received"
      ? "bg-emerald-100 text-emerald-700"
      : s === "Ordered"
        ? "bg-blue-100 text-blue-700"
        : "bg-slate-100 text-slate-700";

  return (
    <CardShell
      title="Purchase Orders"
      subtitle={`${rows.length} purchase order${rows.length !== 1 ? "s" : ""}`}
    >
      <TableShell
        cols={["Date", "PO #", "Supplier", "Status", "Total Cost"]}
        loading={loading}
        empty={rows.length === 0}
        emptyIcon={ShoppingCart}
      >
        {rows.map((r) => (
          <tr key={r.id} className="hover:bg-slate-50 transition-colors">
            <td className="p-4 text-sm text-slate-500 whitespace-nowrap">
              {fmtDate(r.created_at)}
            </td>
            <td className="p-4 font-mono font-bold text-slate-800">
              PO-{String(r.id).padStart(4, "0")}
            </td>
            <td className="p-4 font-medium text-slate-800">
              {r.supplier_name}
            </td>
            <td className="p-4">
              <span
                className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${statusColor(r.status)}`}
              >
                {r.status}
              </span>
            </td>
            <td className="p-4 text-right font-bold text-slate-900">
              {fmt(r.total_cost)}
            </td>
          </tr>
        ))}
      </TableShell>
    </CardShell>
  );
}

// --- GRN Report Tab -----------------------------------------------------------

function GRNReportTab({ filters }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({
        date_from: filters.dateFrom,
        date_to: filters.dateTo,
        outlet_id: filters.outletId,
        search: filters.search,
      });
      const r = await fetch(`${API}/api/grn?${p}`);
      const d = await r.json();
      setRows(d.grns || []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [filters.dateFrom, filters.dateTo, filters.outletId, filters.search]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="flex flex-col gap-3">
      <CardShell
        title="GRN Report"
        subtitle={`${rows.length} goods received note${rows.length !== 1 ? "s" : ""}`}
        icon={Archive}
      >
        <TableShell
          cols={[
            "GRN #",
            "Date",
            "PO #",
            "Supplier",
            "Outlet",
            "Received By",
            "Lines",
          ]}
          loading={loading}
          empty={rows.length === 0}
          emptyIcon={Archive}
        >
          {rows.map((r) => (
            <tr key={r.id} className="hover:bg-slate-50 transition-colors">
              <td className="p-4 font-mono font-bold text-slate-800">
                {r.grn_number}
              </td>
              <td className="p-4 text-sm text-slate-500 whitespace-nowrap">
                {fmtDate(r.received_at)}
              </td>
              <td className="p-4 font-mono text-slate-700">
                {r.po_number || "�"}
              </td>
              <td className="p-4 font-medium text-slate-800">
                {r.supplier_name || "�"}
              </td>
              <td className="p-4 text-slate-600">{r.outlet_name || "�"}</td>
              <td className="p-4 text-slate-600">
                {r.received_by_name || "�"}
              </td>
              <td className="p-4 text-center">
                <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full text-xs font-semibold">
                  {r.line_count}
                </span>
              </td>
            </tr>
          ))}
        </TableShell>
      </CardShell>
    </div>
  );
}

// --- Attendance Tab -----------------------------------------------------------

function AttendanceTab({ filters }) {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({
        date_from: filters.dateFrom,
        date_to: filters.dateTo,
        employee_id: filters.employeeId,
        outlet_id: filters.outletId,
      });
      const r = await fetch(`${API}/api/attendance?${p}`);
      const d = await r.json();
      setRecords(d.records || []);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [filters.dateFrom, filters.dateTo, filters.employeeId, filters.outletId]);

  useEffect(() => {
    load();
  }, [load]);

  const totalHours = records.reduce((s, r) => s + (r.hours || 0), 0);

  const fmtTime = (dt) =>
    dt
      ? new Date(dt).toLocaleTimeString(undefined, {
          hour: "2-digit",
          minute: "2-digit",
        })
      : "�";

  return (
    <CardShell title="Attendance Report" icon={Clock}>
      <div className="flex flex-wrap gap-3 items-end mb-4">
        <span className="ml-auto text-sm font-semibold text-slate-600 bg-emerald-50 border border-emerald-200 px-3 py-2 rounded-lg">
          Total: {totalHours.toFixed(2)}h
        </span>
      </div>
      <TableShell
        cols={[
          "Date",
          "Employee",
          "Role",
          "Outlet",
          "Check In",
          "Check Out",
          "Hours",
          "Status",
        ]}
        loading={loading}
        empty={records.length === 0}
      >
        {records.map((r) => (
          <tr key={r.id} className="hover:bg-slate-50">
            <td className="px-4 py-3 text-slate-700 whitespace-nowrap">
              {fmtDate(r.check_in)}
            </td>
            <td className="px-4 py-3 font-semibold text-slate-800 whitespace-nowrap">
              {r.employee_name}
            </td>
            <td className="px-4 py-3 text-slate-500 capitalize whitespace-nowrap">
              {r.role}
            </td>
            <td className="px-4 py-3 text-slate-600 whitespace-nowrap">
              {r.outlet_name}
            </td>
            <td className="px-4 py-3 font-mono text-slate-700 whitespace-nowrap">
              {fmtTime(r.check_in)}
            </td>
            <td className="px-4 py-3 font-mono text-slate-700 whitespace-nowrap">
              {fmtTime(r.check_out)}
            </td>
            <td className="px-4 py-3 font-semibold text-slate-800 whitespace-nowrap">
              {r.hours != null ? `${r.hours.toFixed(2)}h` : "�"}
            </td>
            <td className="px-4 py-3">
              <span
                className={`px-2.5 py-0.5 rounded-full text-xs font-bold capitalize ${
                  r.status === "present"
                    ? "bg-emerald-100 text-emerald-800"
                    : "bg-rose-100 text-rose-800"
                }`}
              >
                {r.status}
              </span>
            </td>
          </tr>
        ))}
      </TableShell>
    </CardShell>
  );
}

// --- Tab: Outlet Comparison ---------------------------------------------------

function OutletComparisonTab({ filters }) {
  const [outlets, setOutlets] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({
        date_from: filters.dateFrom,
        date_to: filters.dateTo,
      });
      const res = await fetch(`${API}/api/reports/outlet-comparison?${p}`);
      const d = await res.json();
      setOutlets(d.outlets || []);
    } catch {
      setOutlets([]);
    } finally {
      setLoading(false);
    }
  }, [filters.dateFrom, filters.dateTo]);

  useEffect(() => {
    load();
  }, [load]);

  const totalRevenue = outlets.reduce((s, o) => s + o.revenue, 0);
  const chartData = outlets.map((o) => ({
    name: o.name,
    revenue: +o.revenue.toFixed(2),
    orders: o.order_count,
  }));

  return (
    <div className="flex flex-col gap-3">
      {/* Bar chart */}
      {!loading && chartData.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
          <p className="text-sm font-semibold text-slate-700 mb-3">
            Revenue by Outlet
          </p>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart
              data={chartData}
              margin={{ top: 4, right: 4, left: 0, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis
                dataKey="name"
                tick={{ fontSize: 11, fill: "#64748b" }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 10, fill: "#94a3b8" }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v) => `PKRs ${v}`}
              />
              <Tooltip
                formatter={(v, name) => [
                  name === "revenue" ? fmt(v) : v,
                  name === "revenue" ? "Revenue" : "Orders",
                ]}
                contentStyle={{
                  fontSize: 12,
                  borderRadius: 8,
                  border: "1px solid #e2e8f0",
                }}
              />
              <Bar dataKey="revenue" fill="#3b82f6" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <CardShell
        title="Outlet Comparison"
        subtitle={`${outlets.length} outlet${outlets.length !== 1 ? "s" : ""} � Total Revenue: ${fmt(totalRevenue)}`}
        action={
          <ExportButton
            onClick={() =>
              exportCSV(
                "outlet-comparison.csv",
                [
                  { header: "Outlet", key: "name" },
                  { header: "Orders", key: "order_count" },
                  { header: "Revenue", key: "revenue" },
                  { header: "Avg Basket", key: "avg_basket" },
                  { header: "Unique Customers", key: "unique_customers" },
                ],
                outlets,
              )
            }
          />
        }
      >
        <TableShell
          cols={[
            "Outlet",
            "Orders",
            "Revenue",
            "Avg Basket",
            "Unique Customers",
            "% of Total",
          ]}
          loading={loading}
          empty={outlets.length === 0}
          emptyIcon={Building2}
        >
          {outlets.map((o) => (
            <tr key={o.id} className="hover:bg-slate-50 transition-colors">
              <td className="p-4 font-semibold text-slate-800">{o.name}</td>
              <td className="p-4 text-center">
                <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full text-xs font-semibold">
                  {o.order_count}
                </span>
              </td>
              <td className="p-4 text-right font-bold text-slate-900">
                {fmt(o.revenue)}
              </td>
              <td className="p-4 text-right text-sm text-slate-600">
                {fmt(o.avg_basket)}
              </td>
              <td className="p-4 text-center text-sm text-slate-600">
                {o.unique_customers}
              </td>
              <td className="p-4 text-center">
                <span className="bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full text-xs font-semibold">
                  {totalRevenue > 0
                    ? ((o.revenue / totalRevenue) * 100).toFixed(1)
                    : "0.0"}
                  %
                </span>
              </td>
            </tr>
          ))}
        </TableShell>
      </CardShell>
    </div>
  );
}

// --- Tab: Customer RFM Segmentation -------------------------------------------

const RFM_SEGMENTS = {
  Champions: {
    color: "bg-emerald-100 text-emerald-800",
    desc: "Buy recently, often, and spend the most",
  },
  Loyal: {
    color: "bg-blue-100 text-blue-800",
    desc: "Regular buyers with solid spend",
  },
  "Potential Loyalist": {
    color: "bg-sky-100 text-sky-800",
    desc: "Recent buyers, starting to buy more",
  },
  "New Customer": {
    color: "bg-teal-100 text-teal-800",
    desc: "Bought recently for the first time",
  },
  "Need Attention": {
    color: "bg-yellow-100 text-yellow-800",
    desc: "Were good, but activity slowing",
  },
  "At Risk": {
    color: "bg-orange-100 text-orange-800",
    desc: "Used to buy often � haven't returned",
  },
  "Can't Lose Them": {
    color: "bg-rose-100 text-rose-800",
    desc: "High-value, now dormant � act fast",
  },
  "About to Sleep": {
    color: "bg-slate-100 text-slate-700",
    desc: "Low engagement, fading",
  },
  Lost: {
    color: "bg-gray-100 text-gray-600",
    desc: "Inactive, minimal engagement",
  },
};

function getSegment(r, f) {
  if (r >= 4 && f >= 4) return "Champions";
  if (r >= 3 && f >= 4) return "Loyal";
  if (r >= 4 && f >= 2) return "Potential Loyalist";
  if (r === 5 && f === 1) return "New Customer";
  if (r >= 3 && f >= 3) return "Need Attention";
  if (r >= 2 && f >= 3) return "At Risk";
  if (r === 1 && f >= 4) return "Can't Lose Them";
  if (r >= 2) return "About to Sleep";
  return "Lost";
}

function scoreRFMCustomers(customers) {
  if (!customers.length) return [];
  const n = customers.length;
  const byRecency = [...customers].sort(
    (a, b) => a.recency_days - b.recency_days,
  );
  const byFreq = [...customers].sort((a, b) => b.order_count - a.order_count);
  const rRank = new Map(
    byRecency.map((c, i) => [c.id, Math.max(1, 5 - Math.floor((i / n) * 5))]),
  );
  const fRank = new Map(
    byFreq.map((c, i) => [c.id, Math.max(1, 5 - Math.floor((i / n) * 5))]),
  );
  return customers.map((c) => {
    const r = rRank.get(c.id) || 1;
    const f = fRank.get(c.id) || 1;
    return { ...c, r_score: r, f_score: f, segment: getSegment(r, f) };
  });
}

function CustomerRFMTab({ filters }) {
  const [raw, setRaw] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterSeg, setFilterSeg] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({
        outlet_id: filters.outletId,
      });
      const res = await fetch(`${API}/api/reports/customer-rfm?${p}`);
      const d = await res.json();
      setRaw(d.customers || []);
    } catch {
      setRaw([]);
    } finally {
      setLoading(false);
    }
  }, [filters.outletId]);

  useEffect(() => {
    load();
  }, [load]);

  const scored = useMemo(() => scoreRFMCustomers(raw), [raw]);
  const filtered = filterSeg
    ? scored.filter((c) => c.segment === filterSeg)
    : scored;

  const segmentCounts = useMemo(() => {
    const map = {};
    scored.forEach((c) => {
      map[c.segment] = (map[c.segment] || 0) + 1;
    });
    return map;
  }, [scored]);

  const ScoreBox = ({ value }) => (
    <span
      className={`inline-flex items-center justify-center w-6 h-6 rounded text-xs font-bold
      ${value >= 4 ? "bg-emerald-100 text-emerald-800" : value === 3 ? "bg-yellow-100 text-yellow-800" : "bg-rose-100 text-rose-800"}`}
    >
      {value}
    </span>
  );

  return (
    <div className="flex flex-col gap-3">
      {/* Segment distribution */}
      {!loading && (
        <div className="grid grid-cols-3 md:grid-cols-5 gap-2">
          {Object.entries(RFM_SEGMENTS).map(([seg, { color }]) => (
            <button
              key={seg}
              onClick={() => setFilterSeg(filterSeg === seg ? "" : seg)}
              className={`text-left p-3 rounded-xl border transition-all ${
                filterSeg === seg
                  ? "border-blue-400 ring-2 ring-blue-200 bg-white"
                  : "border-slate-200 bg-white hover:border-slate-300"
              }`}
            >
              <p className="text-xl font-bold text-slate-900">
                {segmentCounts[seg] || 0}
              </p>
              <span
                className={`inline-block mt-1 px-1.5 py-0.5 rounded text-[10px] font-semibold ${color}`}
              >
                {seg}
              </span>
            </button>
          ))}
        </div>
      )}

      <CardShell
        title="Customer RFM Analysis"
        subtitle={`${filtered.length} customer${filtered.length !== 1 ? "s" : ""}${filterSeg ? ` � Filtered: ${filterSeg}` : ""} � Recency / Frequency scoring (1=low, 5=high)`}
        action={
          <div className="flex items-center gap-2">
            {filterSeg && (
              <button
                onClick={() => setFilterSeg("")}
                className="text-xs text-slate-500 hover:text-red-600 flex items-center gap-1 px-2 py-1.5 rounded-lg hover:bg-red-50 transition-colors"
              >
                <X size={11} /> Clear
              </button>
            )}
            <ExportButton
              onClick={() =>
                exportCSV(
                  "customer-rfm.csv",
                  [
                    { header: "Customer", key: "name" },
                    { header: "Mobile", key: "mobile" },
                    { header: "Email", key: "email" },
                    { header: "Orders", key: "order_count" },
                    { header: "Total Spent", key: "total_spent" },
                    { header: "Recency (days)", key: "recency_days" },
                    { header: "R Score", key: "r_score" },
                    { header: "F Score", key: "f_score" },
                    { header: "Segment", key: "segment" },
                  ],
                  filtered,
                )
              }
            />
          </div>
        }
      >
        <TableShell
          cols={[
            "Customer",
            "Last Purchase",
            "Orders",
            "Total Spent",
            "R",
            "F",
            "Segment",
          ]}
          loading={loading}
          empty={filtered.length === 0}
          emptyIcon={Users}
        >
          {filtered.map((c) => {
            const seg = RFM_SEGMENTS[c.segment] || {
              color: "bg-slate-100 text-slate-700",
            };
            return (
              <tr key={c.id} className="hover:bg-slate-50 transition-colors">
                <td className="p-4">
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-full bg-linear-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white text-xs font-bold shrink-0">
                      {c.name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <p className="font-semibold text-slate-800 text-sm">
                        {c.name}
                      </p>
                      {c.mobile && (
                        <p className="text-xs text-slate-400">{c.mobile}</p>
                      )}
                    </div>
                  </div>
                </td>
                <td className="p-4 text-sm text-slate-500 whitespace-nowrap">
                  {fmtDate(c.last_order_at)}
                  <span className="block text-xs text-slate-400">
                    {c.recency_days}d ago
                  </span>
                </td>
                <td className="p-4 text-center">
                  <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full text-xs font-semibold">
                    {c.order_count}
                  </span>
                </td>
                <td className="p-4 text-right font-bold text-slate-900">
                  {fmt(c.total_spent)}
                </td>
                <td className="p-4 text-center">
                  <ScoreBox value={c.r_score} />
                </td>
                <td className="p-4 text-center">
                  <ScoreBox value={c.f_score} />
                </td>
                <td className="p-4">
                  <span
                    className={`px-2 py-0.5 rounded-full text-xs font-semibold ${seg.color}`}
                  >
                    {c.segment}
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

// --- Main Reports Page --------------------------------------------------------

// ==============================================================================
// ADVANCED REPORTING TABS
// ==============================================================================

const MetricCard = ({ title, value, compPct, compLabel }) => (
  <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm flex flex-col gap-2">
    <h3 className="text-sm font-medium text-slate-500">{title}</h3>
    <div className="text-2xl font-bold text-slate-900">{value}</div>
    <div
      className={
        "text-xs font-semibold " +
        (compPct > 0
          ? "text-emerald-600"
          : compPct < 0
            ? "text-rose-600"
            : "text-slate-500")
      }
    >
      {compPct > 0 ? "↑" : compPct < 0 ? "↓" : ""} {Math.abs(compPct)}%
      <span className="font-normal text-slate-400 ml-1">vs {compLabel}</span>
    </div>
  </div>
);

// --- Tab: Comparative Trends --------------------------------------------------
function ComparativeTrendsTab({ filters }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({
        outlet_id: filters.outletId,
      });
      const res = await fetch(`${API}/api/reports/comparative-trends?${p}`);
      const d = await res.json();
      setData(d);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [filters.outletId]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading)
    return <div className="p-4 text-slate-500">Loading trends...</div>;
  if (!data || !data.data)
    return <div className="p-4 text-slate-500">No data available</div>;

  const { today } = data.data;
  const { comparisons } = data;

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-bold text-slate-800">Today's Performance</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          title="Revenue (vs Yesterday)"
          value={fmt(today.revenue)}
          compPct={comparisons.day_over_day_revenue_pct}
          compLabel="Yesterday"
        />
        <MetricCard
          title="Orders (vs Yesterday)"
          value={today.orders}
          compPct={comparisons.day_over_day_orders_pct}
          compLabel="Yesterday"
        />
        <MetricCard
          title="Revenue (vs Last Week)"
          value={fmt(today.revenue)}
          compPct={comparisons.week_over_week_revenue_pct}
          compLabel="Last Week"
        />
        <MetricCard
          title="Orders (vs Last Week)"
          value={today.orders}
          compPct={comparisons.week_over_week_orders_pct}
          compLabel="Last Week"
        />
      </div>
    </div>
  );
}

// --- Tab: Heatmaps ------------------------------------------------------------
function HeatmapsTab({ filters }) {
  const [heatmap, setHeatmap] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({
        date_from: filters.dateFrom,
        date_to: filters.dateTo,
        outlet_id: filters.outletId,
      });
      const res = await fetch(`${API}/api/reports/heatmaps?${p}`);
      const d = await res.json();
      setHeatmap(d.heatmap || []);
    } catch {
      setHeatmap([]);
    } finally {
      setLoading(false);
    }
  }, [filters.dateFrom, filters.dateTo, filters.outletId]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading)
    return <div className="p-4 text-slate-500">Loading heatmap...</div>;

  const days = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ];
  const maxRev = Math.max(...heatmap.map((h) => h.revenue), 1);

  return (
    <CardShell
      title="Hourly Sales Heatmap"
      subtitle="Revenue density by hour of day"
    >
      <div className="overflow-x-auto">
        <div className="min-w-200 grid grid-cols-[auto_repeat(24,1fr)] gap-1 text-xs">
          <div className="font-semibold text-slate-500 pt-6 pr-2 text-right">
            Day
          </div>
          {Array.from({ length: 24 }).map((_, h) => (
            <div
              key={h}
              className="text-center font-medium text-slate-400 pb-2"
            >
              {h === 0
                ? "12a"
                : h < 12
                  ? h + "a"
                  : h === 12
                    ? "12p"
                    : h - 12 + "p"}
            </div>
          ))}
          {days.map((dayName, d) => (
            <React.Fragment key={dayName}>
              <div className="font-semibold text-slate-600 self-center pr-2 text-right">
                {dayName.slice(0, 3)}
              </div>
              {Array.from({ length: 24 }).map((_, h) => {
                const cell = heatmap.find(
                  (x) => x.day_of_week === d && x.hour_of_day === h,
                );
                const rev = cell ? cell.revenue : 0;
                const intensity = Math.min(
                  100,
                  Math.round((rev / maxRev) * 100),
                );
                return (
                  <div
                    key={h}
                    title={dayName + " " + cell?.label + ": " + fmt(rev)}
                    className="aspect-square rounded flex items-center justify-center relative group"
                    style={{
                      backgroundColor:
                        "rgba(59, 130, 246, " + intensity / 100 + ")",
                    }}
                  >
                    {rev > 0 && (
                      <span className="opacity-0 group-hover:opacity-100 absolute bg-gray-900 text-white text-[10px] p-1 rounded z-10 whitespace-nowrap">
                        {fmt(rev)}
                      </span>
                    )}
                  </div>
                );
              })}
            </React.Fragment>
          ))}
        </div>
      </div>
    </CardShell>
  );
}

// --- Tab: Revenue Leaks -------------------------------------------------------
function RevenueLeaksTab({ filters }) {
  const [data, setData] = useState(null);

  const load = useCallback(async () => {
    try {
      const p = new URLSearchParams({
        date_from: filters.dateFrom,
        date_to: filters.dateTo,
        outlet_id: filters.outletId,
        employee_id: filters.employeeId,
      });
      const res = await fetch(`${API}/api/reports/revenue-leaks?${p}`);
      const d = await res.json();
      setData(d);
    } catch {
      setData(null);
    }
  }, [filters.dateFrom, filters.dateTo, filters.outletId, filters.employeeId]);

  useEffect(() => {
    load();
  }, [load]);
  if (!data) return <div className="p-4 text-slate-500">Loading...</div>;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-rose-50 text-rose-800 p-4 rounded-xl border border-rose-200">
          <div className="text-sm font-medium">Total Leakage</div>
          <div className="text-2xl font-bold">
            {fmt(data.summary.leakage_total)}
          </div>
        </div>
        <div className="bg-orange-50 text-orange-800 p-4 rounded-xl border border-orange-200">
          <div className="text-sm font-medium">Total Voids</div>
          <div className="text-2xl font-bold">{fmt(data.summary.voids)}</div>
          <div className="text-xs">
            {data.transactions.voided} voided transactions
          </div>
        </div>
        <div className="bg-indigo-50 text-indigo-800 p-4 rounded-xl border border-indigo-200">
          <div className="text-sm font-medium">Total Discounts</div>
          <div className="text-2xl font-bold">
            {fmt(data.summary.discounts)}
          </div>
          <div className="text-xs">
            {data.transactions.discounted} discounted transactions
          </div>
        </div>
      </div>
      <CardShell title="Top Linkage by Employee">
        <TableShell
          cols={["Employee", "Total Leakage", "Voids", "Discounts"]}
          empty={!data.top_leak_employees.length}
        >
          {data.top_leak_employees.map((e) => (
            <tr key={e.employee_id} className="hover:bg-slate-50">
              <td className="p-4 text-sm font-medium text-slate-800">
                {e.employee_name}
              </td>
              <td className="p-4 text-sm font-bold text-rose-600">
                {fmt(e.total_leakage)}
              </td>
              <td className="p-4 text-sm text-slate-600">
                {fmt(e.void_value)}
              </td>
              <td className="p-4 text-sm text-slate-600">
                {fmt(e.discount_value)}
              </td>
            </tr>
          ))}
        </TableShell>
      </CardShell>
    </div>
  );
}

// --- Tab: Product Mix ---------------------------------------------------------
function ProductMixTab({ filters }) {
  const [rows, setRows] = useState([]);

  const load = useCallback(async () => {
    try {
      const p = new URLSearchParams({
        date_from: filters.dateFrom,
        date_to: filters.dateTo,
        outlet_id: filters.outletId,
        category_id: filters.categoryId,
        brand_id: filters.brandId,
      });
      const res = await fetch(`${API}/api/reports/product-mix?${p}`);
      const d = await res.json();
      setRows(d.product_mix || []);
    } catch {
      setRows([]);
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
      title="Product Mix (Market Basket)"
      subtitle="Items frequently bought together"
    >
      <TableShell
        cols={["Item A", "Item B", "Co-occurrences"]}
        empty={!rows.length}
      >
        {rows.map((r, i) => (
          <tr key={i} className="hover:bg-slate-50">
            <td className="p-4 font-medium text-slate-800">{r.pname1}</td>
            <td className="p-4 font-medium text-slate-800">{r.pname2}</td>
            <td className="p-4 text-center font-bold text-blue-600">
              {r.co_occurrences}
            </td>
          </tr>
        ))}
      </TableShell>
    </CardShell>
  );
}

// --- Tab: Retail Matrix -------------------------------------------------------
function RetailMatrixTab({ filters }) {
  const [matrix, setMatrix] = useState(null);

  const load = useCallback(async () => {
    try {
      const p = new URLSearchParams({
        date_from: filters.dateFrom,
        date_to: filters.dateTo,
        outlet_id: filters.outletId,
        category_id: filters.categoryId,
        brand_id: filters.brandId,
      });
      const res = await fetch(`${API}/api/reports/retail-matrix?${p}`);
      const d = await res.json();
      setMatrix(d);
    } catch {
      setMatrix(null);
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
  if (!matrix) return <div className="p-4 text-slate-500">Loading...</div>;

  return (
    <CardShell
      title="Retail Engineering Matrix"
      subtitle="Stars, Plowhorses, Puzzles, and Dogs"
    >
      <TableShell
        cols={["Product", "Category", "Sales Vol", "Margin", "Quadrant"]}
        empty={!matrix.matrix.length}
      >
        {matrix.matrix.map((r, i) => (
          <tr key={i} className="hover:bg-slate-50">
            <td className="p-4 font-medium text-slate-800">{r.product_name}</td>
            <td className="p-4 text-sm text-slate-500">{r.category}</td>
            <td className="p-4 text-sm text-center">{r.volume_sold}</td>
            <td className="p-4 text-sm text-right font-mono">
              {fmt(r.avg_margin)}
            </td>
            <td className="p-4 text-center">
              <span
                className={
                  "px-2 py-1 rounded-full text-xs font-bold " +
                  (r.quadrant === "Star"
                    ? "bg-amber-100 text-amber-700"
                    : r.quadrant === "Plowhorse"
                      ? "bg-emerald-100 text-emerald-700"
                      : r.quadrant === "Puzzle"
                        ? "bg-blue-100 text-blue-700"
                        : "bg-rose-100 text-rose-700")
                }
              >
                {r.quadrant}
              </span>
            </td>
          </tr>
        ))}
      </TableShell>
    </CardShell>
  );
}

// --- Tab: Customer Retention ----------------------------------------------------
function CustomerRetentionTab({ filters }) {
  const [data, setData] = useState(null);

  const load = useCallback(async () => {
    try {
      const p = new URLSearchParams({
        date_from: filters.dateFrom,
        date_to: filters.dateTo,
        outlet_id: filters.outletId,
      });
      const res = await fetch(`${API}/api/reports/customer-retention?${p}`);
      const d = await res.json();
      setData(d);
    } catch {
      setData(null);
    }
  }, [filters.dateFrom, filters.dateTo, filters.outletId]);

  useEffect(() => {
    load();
  }, [load]);
  if (!data) return <div className="p-4 text-slate-500">Loading...</div>;

  return (
    <CardShell
      title="New vs Returning Customers"
      subtitle="Revenue split by customer lifecycle"
    >
      <TableShell
        cols={[
          "Date",
          "Walk-in Sales",
          "New Customer Sales",
          "Returning Sales",
          "Total",
        ]}
        empty={!data.retention.length}
      >
        {data.retention.map((r, i) => (
          <tr key={i} className="hover:bg-slate-50">
            <td className="p-4 text-sm font-medium text-slate-600">
              {r.sale_date}
            </td>
            <td className="p-4 text-sm text-slate-600">
              {fmt(r.walkin_sales)}
            </td>
            <td className="p-4 text-sm text-emerald-600 font-medium">
              {fmt(r.new_customer_sales)} ({r.new_customers_count} ppl)
            </td>
            <td className="p-4 text-sm text-blue-600 font-medium">
              {fmt(r.returning_customer_sales)} ({r.returning_customers_count}{" "}
              ppl)
            </td>
            <td className="p-4 text-sm font-bold text-slate-900">
              {fmt(
                r.walkin_sales +
                  r.new_customer_sales +
                  r.returning_customer_sales,
              )}
            </td>
          </tr>
        ))}
      </TableShell>
    </CardShell>
  );
}

// --- Tab: Customer Capture Rate -------------------------------------------------
function CustomerCaptureRateTab({ filters }) {
  const [data, setData] = useState([]);

  const load = useCallback(async () => {
    try {
      const p = new URLSearchParams({
        date_from: filters.dateFrom,
        date_to: filters.dateTo,
        outlet_id: filters.outletId,
      });
      const res = await fetch(`${API}/api/reports/customer-capture-rate?${p}`);
      const d = await res.json();
      setData(d.staff_breakdown || []);
    } catch {
      setData([]);
    }
  }, [filters.dateFrom, filters.dateTo, filters.outletId]);

  useEffect(() => {
    load();
  }, [load]);
  return (
    <CardShell
      title="Customer Profile Capture Rate"
      subtitle="Which staff members are attaching profiles to transactions?"
    >
      <TableShell
        cols={[
          "Employee",
          "Named Profiles",
          "Walk-ins",
          "Capture Rate",
          "Named Revenue",
          "Walk-in Revenue",
        ]}
        empty={!data.length}
      >
        {data.map((r, i) => (
          <tr key={i} className="hover:bg-slate-50">
            <td className="p-4 font-medium text-slate-800">
              {r.employee_name}
            </td>
            <td className="p-4 text-sm text-center text-slate-600">
              {r.named_transactions}
            </td>
            <td className="p-4 text-sm text-center text-slate-600">
              {r.walkin_transactions}
            </td>
            <td className="p-4 text-sm text-center font-bold text-indigo-600">
              {r.capture_rate_pct}%
            </td>
            <td className="p-4 text-sm text-right text-emerald-600">
              {fmt(r.named_revenue)}
            </td>
            <td className="p-4 text-sm text-right text-slate-500">
              {fmt(r.walkin_revenue)}
            </td>
          </tr>
        ))}
      </TableShell>
    </CardShell>
  );
}

// --- Tab: Labor Performance ---------------------------------------------------
function LaborPerformanceTab({ filters }) {
  const [data, setData] = useState([]);

  const load = useCallback(async () => {
    try {
      const p = new URLSearchParams({
        date_from: filters.dateFrom,
        date_to: filters.dateTo,
        outlet_id: filters.outletId,
      });
      const res = await fetch(`${API}/api/reports/labor-performance?${p}`);
      const d = await res.json();
      setData(d.labor_performance || []);
    } catch {
      setData([]);
    }
  }, [filters.dateFrom, filters.dateTo, filters.outletId]);

  useEffect(() => {
    load();
  }, [load]);
  return (
    <CardShell
      title="Labor Performance"
      subtitle="Revenue generated per hour worked"
    >
      <TableShell
        cols={["Employee", "Hours Worked", "Total Revenue", "Rev / Hour"]}
        empty={!data.length}
      >
        {data.map((r, i) => (
          <tr key={i} className="hover:bg-slate-50">
            <td className="p-4 font-medium text-slate-800">
              {r.employee_name}
            </td>
            <td className="p-4 text-sm text-center text-slate-600">
              {r.total_hours}
            </td>
            <td className="p-4 text-sm text-right text-slate-700">
              {fmt(r.total_revenue)}
            </td>
            <td className="p-4 text-sm text-right font-bold text-amber-600">
              {fmt(r.revenue_per_hour)}/hr
            </td>
          </tr>
        ))}
      </TableShell>
    </CardShell>
  );
}

// --- Tab: Loss Prevention -----------------------------------------------------
function LossPreventionTab({ filters }) {
  const [data, setData] = useState([]);

  const load = useCallback(async () => {
    try {
      const p = new URLSearchParams({
        date_from: filters.dateFrom,
        date_to: filters.dateTo,
        outlet_id: filters.outletId,
      });
      const res = await fetch(`${API}/api/reports/loss-prevention?${p}`);
      const d = await res.json();
      setData(d.loss_prevention || []);
    } catch {
      setData([]);
    }
  }, [filters.dateFrom, filters.dateTo, filters.outletId]);

  useEffect(() => {
    load();
  }, [load]);
  return (
    <CardShell
      title="Loss Prevention (Risk Ratio)"
      subtitle="Staff ranked by Void + Refund value / Sales"
    >
      <TableShell
        cols={[
          "Employee",
          "Valid Sales",
          "Voids ($)",
          "Refunds ($)",
          "Risk Ratio",
        ]}
        empty={!data.length}
      >
        {data.map((r, i) => (
          <tr key={i} className="hover:bg-slate-50">
            <td className="p-4 font-medium text-slate-800">
              {r.employee_name}
            </td>
            <td className="p-4 text-sm text-right text-slate-600">
              {fmt(r.total_revenue)}
            </td>
            <td className="p-4 text-sm text-right text-rose-500">
              {fmt(r.void_value)} ({r.void_count})
            </td>
            <td className="p-4 text-sm text-right text-orange-500">
              {fmt(r.refund_value)} ({r.refund_count})
            </td>
            <td className="p-4 text-sm text-center font-bold text-rose-700">
              {r.risk_ratio_pct}%
            </td>
          </tr>
        ))}
      </TableShell>
    </CardShell>
  );
}

const GROUPS = [
  {
    label: "Sales",
    tabs: [
      { id: "overview", label: "Overview", icon: BarChart3 },
      {
        id: "comparative-trends",
        label: "Comparative Trends",
        icon: TrendingUp,
      },
      { id: "heatmaps", label: "Sales Heatmap", icon: Clock },
      { id: "revenue-leaks", label: "Revenue Leaks", icon: AlertTriangle },
      { id: "product-mix", label: "Product Mix", icon: ShoppingBag },
      { id: "sales-summary", label: "Sales Summary", icon: BarChart2 },
      { id: "sales-detail", label: "Sales Detail", icon: FileText },
      { id: "order-wise", label: "Order Wise", icon: ClipboardList },
      { id: "item-wise", label: "Item Wise", icon: ShoppingBag },
      { id: "category-wise", label: "Category Wise", icon: Tag },
    ],
  },
  {
    label: "Customers",
    tabs: [
      { id: "customer-details", label: "Customer Details", icon: Users },
      { id: "customer-wise", label: "Customer Wise", icon: TrendingUp },
      { id: "customer-rfm", label: "RFM Analysis", icon: GitBranch },
      { id: "customer-retention", label: "Customer Retention", icon: Users },
      { id: "customer-capture", label: "Capture Rate", icon: Target },
    ],
  },
  {
    label: "Inventory",
    tabs: [
      { id: "product-performance", label: "Product Performance", icon: Star },
      { id: "retail-matrix", label: "Retail Matrix", icon: LayoutGrid },
      { id: "sales-stock", label: "Sales & Stock", icon: Package },
      { id: "inventory-dump", label: "Inventory Dump", icon: Archive },
      { id: "on-hand", label: "On Hand", icon: Layers },
      { id: "product-spec", label: "Product Spec", icon: Package },
      { id: "replenishment", label: "Replenishment", icon: RotateCcw },
    ],
  },
  {
    label: "Operations",
    tabs: [
      { id: "outlet-comparison", label: "Outlet Comparison", icon: Building2 },
      { id: "inventory-loss", label: "Inventory Loss", icon: TrendingDown },
      { id: "wastage", label: "Wastage", icon: Recycle },
      {
        id: "product-movement",
        label: "Product Movement",
        icon: ArrowLeftRight,
      },
      { id: "str-report", label: "STR Report", icon: ArrowLeftRight },
    ],
  },
  {
    label: "Procurement",
    tabs: [
      { id: "supplier-wise", label: "Supplier Wise", icon: Truck },
      {
        id: "purchase-orders-report",
        label: "Purchase Orders",
        icon: ShoppingCart,
      },
      { id: "grn-report", label: "GRN Report", icon: Archive },
    ],
  },
  {
    label: "HR",
    tabs: [
      { id: "attendance", label: "Attendance", icon: Clock },
      { id: "labor-performance", label: "Labor Performance", icon: Activity },
      { id: "loss-prevention", label: "Loss Prevention", icon: ShieldAlert },
    ],
  },
];

function TabBreadcrumb({ activeTab }) {
  for (const group of GROUPS) {
    const tab = group.tabs.find((t) => t.id === activeTab);
    if (!tab) continue;
    const GroupIcon = group.tabs[0].icon;
    const TabIcon = tab.icon;
    return (
      <div className="flex items-center gap-2 text-xs text-slate-400 mb-4 shrink-0">
        <GroupIcon size={13} className="text-slate-400" />
        <span className="font-medium text-slate-500">{group.label}</span>
        <span className="text-slate-300">/</span>
        <TabIcon size={13} className="text-blue-500" />
        <span className="font-semibold text-slate-700">{tab.label}</span>
      </div>
    );
  }
  return null;
}

function TabContent({ activeTab, filters }) {
  switch (activeTab) {
    case "comparative-trends":
      return <ComparativeTrendsTab filters={filters} />;
    case "heatmaps":
      return <HeatmapsTab filters={filters} />;
    case "revenue-leaks":
      return <RevenueLeaksTab filters={filters} />;
    case "product-mix":
      return <ProductMixTab filters={filters} />;
    case "retail-matrix":
      return <RetailMatrixTab filters={filters} />;
    case "customer-retention":
      return <CustomerRetentionTab filters={filters} />;
    case "customer-capture":
      return <CustomerCaptureRateTab filters={filters} />;
    case "labor-performance":
      return <LaborPerformanceTab filters={filters} />;
    case "loss-prevention":
      return <LossPreventionTab filters={filters} />;
    case "overview":
      return <OverviewTab filters={filters} />;
    case "sales-summary":
      return <SalesSummaryTab filters={filters} />;
    case "sales-detail":
      return <SalesDetailTab filters={filters} />;
    case "sales-stock":
      return <SalesStockTab filters={filters} />;
    case "inventory-dump":
      return <InventoryDumpTab filters={filters} />;
    case "category-wise":
      return <CategoryWiseTab filters={filters} />;
    case "customer-details":
      return <CustomerDetailsTab filters={filters} />;
    case "customer-wise":
      return <CustomerWiseTab filters={filters} />;
    case "customer-rfm":
      return <CustomerRFMTab filters={filters} />;
    case "outlet-comparison":
      return <OutletComparisonTab filters={filters} />;
    case "order-wise":
      return <OrderWiseTab filters={filters} />;
    case "item-wise":
      return <ItemWiseTab filters={filters} />;
    case "product-performance":
      return <ProductPerformanceTab filters={filters} />;
    case "product-spec":
      return <ProductSpecTab filters={filters} />;
    case "on-hand":
      return <OnHandTab filters={filters} />;
    case "inventory-loss":
      return <InventoryLossTab filters={filters} />;
    case "wastage":
      return <WastageTab filters={filters} />;
    case "product-movement":
      return <ProductMovementTab filters={filters} />;
    case "str-report":
      return <STRReportTab filters={filters} />;
    case "replenishment":
      return <ReplenishmentTab filters={filters} />;
    case "supplier-wise":
      return <SupplierWiseTab filters={filters} />;
    case "purchase-orders-report":
      return <PurchaseOrdersReportTab filters={filters} />;
    case "grn-report":
      return <GRNReportTab filters={filters} />;
    case "attendance":
      return <AttendanceTab filters={filters} />;
    default:
      return null;
  }
}

export function ReportTabStandalone({ tabId }) {
  return (
    <div className="flex-1 flex flex-col h-full bg-transparent">
      <div className="flex-1 overflow-auto min-h-0">
        <TabContent activeTab={tabId} />
      </div>
    </div>
  );
}

export default function Reports() {
  const [activeTab, setActiveTab] = useState("overview");
  const [filters, setFilters] = useState({
    dateFrom: "",
    dateTo: "",
    outletId: "",
    employeeId: "",
    categoryId: "",
    brandId: "",
    search: "",
  });

  const [meta, setMeta] = useState({
    outlets: [],
    categories: [],
    brands: [],
    employees: [],
  });

  useEffect(() => {
    // Basic meta loader for dropdowns
    const loadMeta = async () => {
      try {
        const [outlets, categories, brands, employees] = await Promise.all([
          fetch(`${API}/api/outlets`).then((r) => r.json()),
          fetch(`${API}/api/categories`).then((r) => r.json()),
          fetch(`${API}/api/brands`).then((r) => r.json()),
          fetch(`${API}/api/employees`).then((r) => r.json()),
        ]);
        setMeta({
          outlets: outlets.outlets || outlets || [],
          categories: categories.categories || categories || [],
          brands: brands.brands || brands || [],
          employees: employees.employees || employees || [],
        });
      } catch (err) {
        console.error("Failed to load metadata", err);
      }
    };
    loadMeta();
  }, []);

  const activeGroup = GROUPS.find((g) =>
    g.tabs.some((t) => t.id === activeTab),
  );

  return (
    <div className="flex flex-col h-full gap-4">
      {/* Header */}
      <div className="shrink-0 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 mb-1">
            Reports
          </h1>
          <p className="text-slate-500">
            {GROUPS.reduce((n, g) => n + g.tabs.length, 0)} reports across
            sales, inventory, operations, and procurement.
          </p>
        </div>
      </div>

      {/* Global Filter Bar */}
      <GlobalFilterBar filters={filters} setFilters={setFilters} meta={meta} />

      {/* Two-panel layout: group sidebar + sub-tabs + content */}
      <div className="flex flex-1 min-h-0 gap-0">
        {/* Left: group icon sidebar */}
        <div className="flex flex-col gap-1 shrink-0 w-18 py-1 pr-2 border-r border-slate-200">
          {GROUPS.map((group) => {
            const isActive = group === activeGroup;
            const GroupIcon = group.tabs[0].icon;
            return (
              <button
                key={group.label}
                onClick={() => setActiveTab(group.tabs[0].id)}
                title={group.label}
                className={`flex flex-col items-center gap-1 px-2 py-3 rounded-xl text-xs font-medium transition-all ${
                  isActive
                    ? "bg-blue-50 text-blue-700"
                    : "text-slate-400 hover:text-slate-700 hover:bg-slate-100"
                }`}
              >
                <GroupIcon size={18} />
                <span className="text-[10px] leading-tight text-center">
                  {group.label}
                </span>
              </button>
            );
          })}
        </div>

        {/* Right: sub-tab strip + content */}
        <div className="flex flex-col flex-1 min-w-0 pl-4 gap-3">
          {/* Sub-tab pill strip for the active group */}
          {activeGroup && (
            <div className="flex gap-1 shrink-0 bg-slate-100 rounded-xl p-1 w-fit">
              {activeGroup.tabs.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  onClick={() => setActiveTab(id)}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all whitespace-nowrap ${
                    activeTab === id
                      ? "bg-white text-slate-900 shadow-sm"
                      : "text-slate-500 hover:text-slate-700"
                  }`}
                >
                  <Icon size={13} />
                  {label}
                </button>
              ))}
            </div>
          )}

          {/* Content area */}
          <div className="flex-1 overflow-auto min-h-0 flex flex-col">
            <TabBreadcrumb activeTab={activeTab} />
            <div className="flex-1 min-h-0">
              <TabContent activeTab={activeTab} filters={filters} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
