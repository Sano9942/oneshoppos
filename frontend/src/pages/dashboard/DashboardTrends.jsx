import { SectionCard } from "../../ui/primitives";
import { useCurrency } from "./DashboardShared";
import {
  Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
  Area, AreaChart,
} from "recharts";

const fmtDay = (d) => {
  const dt = new Date(d + "T00:00:00");
  return dt.toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

export function DashboardTrends({ data }) {
  const { fmt } = useCurrency();
  const salesTrend = (data?.salesTrend || []).map((row) => ({
    date: row.day,
    revenue: row.revenue,
    count: row.sale_count,
  }));
  const hourlySales = data?.hourlySales || [];
  const monthlyTrend = data?.monthlyTrend || [];

  // Peak hour
  const peakHour = hourlySales.reduce(
    (best, h) => (Number(h.total) > Number(best.total || 0) ? h : best),
    {},
  );

  if (!salesTrend.length && !hourlySales.length) return null;

  return (
    <div className="flex flex-col gap-4">
      {/* 7-day trend */}
      {salesTrend.length > 0 && (
        <SectionCard className="p-4">
          <h3 className="mb-3 text-sm font-semibold text-(--ui-text)">Revenue — Last 7 Days</h3>
          {peakHour.hour && (
            <p className="mb-3 text-xs text-(--ui-text-muted)">
              Peak hour today: <span className="font-semibold text-(--ui-text)">{peakHour.hour}</span>
              {" · "}{fmt(peakHour.total)} · {peakHour.orders} orders
            </p>
          )}
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={salesTrend} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--ui-border)" />
              <XAxis dataKey="date" tickFormatter={fmtDay} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
              <YAxis hide />
              <Tooltip
                formatter={(v) => fmt(v)}
                labelFormatter={fmtDay}
                contentStyle={{ fontSize: 12 }}
              />
              <Bar dataKey="revenue" fill="var(--ui-primary)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </SectionCard>
      )}

      {/* 6-month sparkline */}
      {monthlyTrend.length > 0 && (
        <SectionCard className="p-4">
          <h3 className="mb-3 text-sm font-semibold text-(--ui-text)">Revenue — Last 6 Months</h3>
          <ResponsiveContainer width="100%" height={120}>
            <AreaChart data={monthlyTrend} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="monthGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--ui-primary)" stopOpacity={0.15} />
                  <stop offset="95%" stopColor="var(--ui-primary)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="month" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
              <YAxis hide />
              <Tooltip formatter={(v) => fmt(v)} contentStyle={{ fontSize: 12 }} />
              <Area
                type="monotone"
                dataKey="total"
                stroke="var(--ui-primary)"
                strokeWidth={2}
                fill="url(#monthGrad)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </SectionCard>
      )}
    </div>
  );
}
