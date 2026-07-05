import React, { useState, useEffect, useCallback } from "react";
import {
  BarChart3,
  TrendingUp,
  AlertTriangle,
  Package,
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
import { api } from "../../api";
import { useCurrency } from "../../contexts/CurrencyContext";

// --- Tab: Overview Dashboard --------------------------------------------------
export function OverviewTab({ filters }) {
  const { fmt } = useCurrency();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams();
      if (filters.outletIds && filters.outletIds.length) p.set("outlet_id", filters.outletIds.join(","));
      const d = await api.get(`/api/reports/dashboard?${p}`);
      setData(d);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [filters.outletIds]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading)
    return (
      <div className="flex items-center justify-center py-20">
        <div className="flex flex-col items-center">
          <BarChart3 className="text-(--ui-link) w-12 h-12 mb-4 animate-bounce" />
          <p className="text-(--ui-text-muted) font-medium italic">
            Gathering your retail insights...
          </p>
        </div>
      </div>
    );

  if (error)
    return (
      <div className="p-10 text-center text-(--ui-danger-fg) bg-(--ui-danger-bg) rounded-2xl border border-(--ui-danger-bg)">
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
            className="bg-(--ui-surface) p-5 rounded-2xl border border-(--ui-border) hover:shadow-md transition-shadow group"
          >
            <div className="flex justify-between items-start mb-2">
              <span className="text-sm font-medium text-(--ui-text-muted) group-hover:text-(--ui-link) transition-colors">
                {s.title}
              </span>
              <span
                className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                  s.positive
                    ? "bg-(--ui-success-bg) text-(--ui-success-fg)"
                    : "bg-(--ui-danger-bg) text-(--ui-danger-fg)"
                }`}
              >
                {s.trend}
              </span>
            </div>
            <div className="text-2xl font-bold text-(--ui-text)">{s.value}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Sales Trend Chart */}
        <div className="lg:col-span-2 bg-(--ui-surface) p-6 rounded-2xl border border-(--ui-border)">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="font-bold text-(--ui-text)">Revenue Forecast</h3>
              <p className="text-xs text-(--ui-text-muted)">
                Store revenue trend for the last 6 months
              </p>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-(--ui-primary)"></div>
              <span className="text-xs font-medium text-(--ui-text-muted)">Actual</span>
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
        <div className="bg-(--ui-surface) p-6 rounded-2xl border border-(--ui-border)">
          <h3 className="font-bold text-(--ui-text) mb-4 text-center">Executive KPI Rail</h3>
          <div className="space-y-4">
            {[
              {
                icon: Package,
        label: "Low Stock Items",
        value: lowStockItems,
        note: `${Number(data?.currentStockUnits || 0)} stock units live`,
        tone: "text-(--ui-text-muted)",
              },
              {
                icon: TrendingUp,
        label: "Month Purchases",
        value: fmt(data?.monthPurchases),
        note: `Month sales ${fmt(data?.monthSales)}`,
        tone: "text-(--ui-link)",
              },
              {
                icon: AlertTriangle,
        label: "Leakage Today",
        value: fmt(leakageTotal),
        note: `Disc ${fmt(data?.discountsToday?.value)} | Void ${fmt(data?.voidsToday?.value)} | Refund ${fmt(data?.refundsToday?.value)}`,
        tone: "text-(--ui-danger-fg)",
              },
            ].map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.label} className="rounded-xl border border-(--ui-border) bg-(--ui-muted-surface) px-4 py-3">
                  <div className="flex items-center gap-2">
                    <Icon size={14} className={item.tone} />
                    <p className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">
                      {item.label}
                    </p>
                  </div>
                  <p className={`mt-2 text-xl font-bold ${item.tone}`}>{item.value}</p>
                  <p className="mt-1 text-xs text-(--ui-text-muted)">{item.note}</p>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-(--ui-surface) p-6 rounded-2xl border border-(--ui-border)">
          <h3 className="font-bold text-(--ui-text) mb-4">Category Contribution</h3>
          <div className="space-y-4">
            {topCategories.map((c, i) => {
              const percentage =
                totalCategoryRevenue > 0
                  ? ((Number(c.revenue || 0) / totalCategoryRevenue) * 100).toFixed(1)
                  : "0.0";
              return (
                <div key={i} className="space-y-1.5">
                  <div className="flex justify-between text-xs font-medium">
                    <span className="text-(--ui-text-muted) truncate mr-2">{c.category}</span>
                    <span className="text-(--ui-text) font-bold">{percentage}%</span>
                  </div>
                  <div className="w-full bg-(--ui-muted-surface) h-1.5 rounded-full overflow-hidden">
                    <div
                      className="bg-(--ui-primary) h-full rounded-full transition-all duration-1000"
                      style={{ width: `${percentage}%` }}
                    ></div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="bg-(--ui-surface) p-6 rounded-2xl border border-(--ui-border)">
          <h3 className="font-bold text-(--ui-text) mb-4">Payment Contribution Today</h3>
          <div className="space-y-4">
            {paymentContribution.map((p, i) => (
              <div key={i} className="space-y-1.5">
                <div className="flex justify-between text-xs font-medium">
                  <span className="text-(--ui-text-muted) truncate mr-2">{p.payment_method}</span>
                  <span className="text-(--ui-text) font-bold">{fmt(p.total)}</span>
                </div>
                <div className="w-full bg-(--ui-muted-surface) h-1.5 rounded-full overflow-hidden">
                  <div
                    className="bg-(--ui-success-fg) h-full rounded-full transition-all duration-1000"
                    style={{
                      width: `${todayRevenue > 0 ? (Number(p.total || 0) / todayRevenue) * 100 : 0}%`,
                    }}
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
