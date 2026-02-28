import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowRight,
  BarChart3,
  CreditCard,
  Package,
  ShoppingBag,
  TrendingDown,
  TrendingUp,
  Users,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { API_BASE as API } from "../../config";
import { useAuth } from "../../auth/AuthProvider";
import { Badge, Button, PageShell, SectionCard, Skeleton } from "../../ui/primitives";

const fmt = (n) => "PKRs " + (Number(n) || 0).toFixed(2);
const fmtDay = (d) => {
  const dt = new Date(d + "T00:00:00");
  return dt.toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

const PAYMENT_TONE = { cash: "success", card: "default", wallet: "warning" };

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-(--ui-border) bg-(--ui-surface) px-3 py-2 text-sm shadow-lg">
      <p className="font-medium text-(--ui-text)">{fmtDay(label)}</p>
      <p className="text-(--ui-primary)">{fmt(payload[0]?.value)}</p>
      <p className="text-xs text-(--ui-text-muted)">{payload[1]?.value || 0} sales</p>
    </div>
  );
}

function CardHeader({ icon: Icon, title, action }) {
  return (
    <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-(--ui-border)">
      <p className="flex items-center gap-2 text-sm font-semibold text-(--ui-text)">
        {Icon && <Icon size={15} className="text-(--ui-primary)" />}
        {title}
      </p>
      {action}
    </div>
  );
}

export default function DashboardRedesign() {
  const navigate = useNavigate();
  const { authHeaders } = useAuth();
  const [data, setData] = useState(null);
  const [recentSales, setRecentSales] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;
    Promise.all([
      fetch(`${API}/api/reports/dashboard`, { headers: authHeaders() }).then((r) => r.json()),
      fetch(`${API}/api/sales?limit=10`, { headers: authHeaders() })
        .then((r) => r.json())
        .catch(() => ({ sales: [] })),
    ])
      .then(([dash, salesData]) => {
        if (!mounted) return;
        setData(dash);
        setRecentSales(salesData.sales || []);
      })
      .catch((e) => {
        if (mounted) setError(e.message || "Failed to load dashboard");
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => { mounted = false; };
  }, [authHeaders]);

  const trend = (data?.salesTrend || []).map((row) => ({
    date: row.day,
    revenue: row.revenue,
    count: row.sale_count,
  }));

  const alerts = data?.lowStock || [];
  const zReport = data?.zReport || [];
  const topSelling = data?.topSelling || [];

  return (
    <PageShell
      title="Dashboard"
      subtitle="Today's overview and key metrics."
      right={
        <Button tone="primary" onClick={() => navigate("/pos")}>
          <ShoppingBag size={14} className="mr-1 inline" /> Open POS
        </Button>
      }
    >
      {error ? (
        <SectionCard className="mb-4 border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
          {error}
        </SectionCard>
      ) : null}

      {/* Hero: Revenue banner */}
      <div className="mb-4 rounded-xl bg-(--ui-primary) p-6 text-white shadow-md">
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-3 w-32 bg-white/20" />
            <Skeleton className="h-10 w-48 bg-white/20" />
            <Skeleton className="h-3 w-56 bg-white/20" />
          </div>
        ) : (
          <>
            <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-white/70">
              Total Revenue Today
            </p>
            <p className="text-4xl font-bold tracking-tight">
              {fmt(data?.totalRevenueToday)}
            </p>
            <div className="mt-3 flex flex-wrap gap-4 border-t border-white/20 pt-3">
              <span className="text-sm text-white/70">
                <span className="font-semibold text-white">{data?.saleCount || 0}</span> transactions
              </span>
              {zReport.map((z) => (
                <span key={z.payment_method} className="flex items-center gap-1.5 text-sm text-white/70">
                  <span className="h-1.5 w-1.5 rounded-full bg-white/50 inline-block" />
                  {z.payment_method}:{" "}
                  <span className="font-semibold text-white">{fmt(z.total)}</span>
                </span>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Supporting KPI row */}
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {/* Net Profit */}
        <SectionCard className="flex items-stretch overflow-hidden">
          <div className="w-1 shrink-0 bg-emerald-500 rounded-l-(--ui-radius-md)" />
          <div className="p-5">
            {loading ? (
              <>
                <Skeleton className="mb-2 h-3 w-24" />
                <Skeleton className="h-7 w-32" />
              </>
            ) : (
              <>
                <p className="mb-1 flex items-center gap-1.5 text-xs font-medium text-(--ui-text-muted)">
                  <TrendingUp size={12} className="text-emerald-500" />
                  Net Profit Today
                </p>
                <p className="text-2xl font-bold text-emerald-600">{fmt(data?.todayProfit)}</p>
                <p className="mt-1 text-xs text-(--ui-text-muted)">Gross Sales minus COGS</p>
              </>
            )}
          </div>
        </SectionCard>

        {/* Inventory Value */}
        <SectionCard className="flex items-stretch overflow-hidden">
          <div className="w-1 shrink-0 bg-indigo-500 rounded-l-(--ui-radius-md)" />
          <div className="p-5">
            {loading ? (
              <>
                <Skeleton className="mb-2 h-3 w-24" />
                <Skeleton className="h-7 w-32" />
              </>
            ) : (
              <>
                <p className="mb-1 flex items-center gap-1.5 text-xs font-medium text-(--ui-text-muted)">
                  <Package size={12} className="text-indigo-500" />
                  Est. Inventory Retail Value
                </p>
                <p className="text-2xl font-bold text-indigo-600">
                  {fmt(data?.inventoryValue?.retail_value)}
                </p>
                <p className="mt-1 text-xs text-(--ui-text-muted)">
                  Base Cost: {fmt(data?.inventoryValue?.cost_value)}
                </p>
              </>
            )}
          </div>
        </SectionCard>

        {/* Top Seller */}
        <SectionCard className="flex items-stretch overflow-hidden">
          <div className="w-1 shrink-0 bg-amber-400 rounded-l-(--ui-radius-md)" />
          <div className="p-5">
            {loading ? (
              <>
                <Skeleton className="mb-2 h-3 w-24" />
                <Skeleton className="h-7 w-32" />
              </>
            ) : (
              <>
                <p className="mb-1 flex items-center gap-1.5 text-xs font-medium text-(--ui-text-muted)">
                  <Users size={12} className="text-amber-500" />
                  Top Selling (All Time)
                </p>
                <p className="text-lg font-bold text-(--ui-text) truncate">
                  {topSelling[0]?.name || "—"}
                </p>
                <p className="mt-1 text-xs text-(--ui-text-muted)">
                  {topSelling[0] ? `${topSelling[0].total_sold} units sold` : "No data yet"}
                </p>
              </>
            )}
          </div>
        </SectionCard>
      </div>

      {/* Middle row: chart + low stock */}
      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Sales trend chart */}
        <SectionCard className="lg:col-span-2">
          <CardHeader
            icon={BarChart3}
            title="7-Day Sales Trend"
            action={
              <Button size="sm" onClick={() => navigate("/reports")}>
                <ArrowRight size={13} className="mr-1 inline" /> Reports
              </Button>
            }
          />
          <div className="h-52 px-2 pb-3 pt-2">
            {loading ? (
              <Skeleton className="h-full w-full" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={trend} barSize={20}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--ui-border)" />
                  <XAxis
                    dataKey="date"
                    tickFormatter={fmtDay}
                    tick={{ fontSize: 11, fill: "var(--ui-text-muted)" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tickFormatter={(v) => "PKRs " + v}
                    tick={{ fontSize: 11, fill: "var(--ui-text-muted)" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="revenue" fill="var(--ui-primary)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </SectionCard>

        {/* Low stock alerts */}
        <SectionCard>
          <CardHeader
            icon={TrendingDown}
            title="Low Stock Alerts"
            action={
              <Badge tone={alerts.length > 0 ? "warning" : "success"}>
                {loading ? "…" : alerts.length}
              </Badge>
            }
          />
          <div className="divide-y divide-(--ui-border) pb-3">
            {loading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="px-5 py-2.5">
                  <Skeleton className="mb-1 h-3 w-32" />
                  <Skeleton className="h-3 w-20" />
                </div>
              ))
            ) : alerts.length === 0 ? (
              <p className="py-6 text-center text-sm text-(--ui-text-muted)">
                All stock levels are healthy.
              </p>
            ) : (
              alerts.slice(0, 8).map((item, i) => (
                <div key={i} className="flex items-center justify-between px-5 py-2.5">
                  <p className="truncate text-sm text-(--ui-text)">{item.name}</p>
                  <Badge tone={item.stock <= 0 ? "danger" : "warning"}>
                    {item.stock ?? 0} left
                  </Badge>
                </div>
              ))
            )}
          </div>
          {!loading && alerts.length > 0 && (
            <div className="px-5 pb-4">
              <Button size="sm" className="w-full" onClick={() => navigate("/inventory")}>
                View Inventory
              </Button>
            </div>
          )}
        </SectionCard>
      </div>

      {/* Bottom row: top sellers + recent transactions */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <SectionCard>
          <CardHeader icon={ShoppingBag} title="Top Selling Products (All Time)" />
          <div className="divide-y divide-(--ui-border) pb-3">
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex justify-between px-5 py-3">
                  <Skeleton className="h-3 w-40" />
                  <Skeleton className="h-3 w-16" />
                </div>
              ))
            ) : topSelling.length === 0 ? (
              <p className="py-6 text-center text-sm text-(--ui-text-muted)">No sales data yet.</p>
            ) : (
              topSelling.slice(0, 5).map((item, i) => (
                <div key={i} className="flex items-center justify-between px-5 py-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-xs font-bold text-(--ui-text-muted) w-4 shrink-0">
                      {i + 1}
                    </span>
                    <span className="truncate text-sm text-(--ui-text)">{item.name}</span>
                  </div>
                  <Badge tone="default">{item.total_sold} sold</Badge>
                </div>
              ))
            )}
          </div>
        </SectionCard>

        <SectionCard>
          <CardHeader
            icon={CreditCard}
            title="Recent Transactions"
            action={
              <Button size="sm" onClick={() => navigate("/sales-history")}>
                <ArrowRight size={13} className="mr-1 inline" /> View all
              </Button>
            }
          />
          <div className="divide-y divide-(--ui-border) pb-3">
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex justify-between px-5 py-3">
                  <Skeleton className="h-3 w-32" />
                  <Skeleton className="h-3 w-16" />
                </div>
              ))
            ) : recentSales.length === 0 ? (
              <p className="py-6 text-center text-sm text-(--ui-text-muted)">
                No transactions today.
              </p>
            ) : (
              recentSales.slice(0, 8).map((sale) => {
                const method = (sale.payment_method || "cash").toLowerCase();
                const time = new Date(sale.timestamp).toLocaleTimeString(undefined, {
                  hour: "2-digit",
                  minute: "2-digit",
                });
                return (
                  <div key={sale.id} className="flex items-center justify-between px-5 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-(--ui-text)">
                        {sale.customer_name || "Walk-in"}
                      </p>
                      <p className="text-xs text-(--ui-text-muted)">{time}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge tone={PAYMENT_TONE[method] || "default"} className="capitalize">
                        {method}
                      </Badge>
                      <span className="text-sm font-semibold text-(--ui-text)">
                        {fmt(sale.total_amount)}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </SectionCard>
      </div>
    </PageShell>
  );
}
