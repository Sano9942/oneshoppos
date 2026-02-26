import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowRight,
  BarChart3,
  CreditCard,
  DollarSign,
  Package,
  ShoppingBag,
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

function KPICard({ title, value, sub, icon: Icon }) {
  return (
    <SectionCard className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-[var(--ui-text-muted)]">{title}</p>
          <p className="mt-1 text-2xl font-bold text-[var(--ui-text)]">{value}</p>
          {sub && <p className="mt-1 text-xs text-[var(--ui-text-muted)]">{sub}</p>}
        </div>
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--ui-accent)]/10">
          <Icon size={18} className="text-[var(--ui-accent)]" />
        </div>
      </div>
    </SectionCard>
  );
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-[var(--ui-border)] bg-[var(--ui-surface)] px-3 py-2 text-sm shadow-lg">
      <p className="font-medium text-[var(--ui-text)]">{fmtDay(label)}</p>
      <p className="text-[var(--ui-accent)]">{fmt(payload[0]?.value)}</p>
      <p className="text-xs text-[var(--ui-text-muted)]">{payload[1]?.value || 0} sales</p>
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
    setLoading(true);
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

  const kpis = data
    ? [
        {
          title: "Today's Revenue",
          value: fmt(data.totalRevenueToday),
          sub: `${data.saleCount || 0} transactions`,
          icon: DollarSign,
        },
        {
          title: "Net Profit Today",
          value: fmt(data.todayProfit),
          sub: "Gross Sales minus Cost of Goods Sold",
          icon: TrendingUp,
        },
        {
          title: "Est. Inventory Retail Value",
          value: fmt(data.inventoryValue?.retail_value),
          sub: `Base Cost: ${fmt(data.inventoryValue?.cost_value)}`,
          icon: Package,
        },
        {
          title: "Top Selling (All Time)",
          value: data.topSelling?.[0]?.name || "—",
          sub: data.topSelling?.[0]
            ? `${data.topSelling[0].total_sold} units sold`
            : "No data yet",
          icon: Users,
        },
      ]
    : [];

  const trend = (data?.salesTrend || []).map((row) => ({
    date: row.day,
    revenue: row.revenue,
    count: row.sale_count,
  }));

  const alerts = data?.lowStock || [];

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

      {/* KPI row */}
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {loading
          ? Array.from({ length: 4 }).map((_, i) => (
              <SectionCard key={i} className="p-5">
                <Skeleton className="mb-2 h-3 w-24" />
                <Skeleton className="h-7 w-32" />
              </SectionCard>
            ))
          : kpis.map((k) => <KPICard key={k.title} {...k} />)}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Sales trend chart */}
        <SectionCard className="lg:col-span-2">
          <div className="mb-3 flex items-center justify-between px-4 pt-4">
            <p className="flex items-center gap-2 font-medium text-[var(--ui-text)]">
              <BarChart3 size={16} className="text-[var(--ui-accent)]" />
              7-Day Sales Trend
            </p>
            <Button size="sm" onClick={() => navigate("/reports")}>
              <ArrowRight size={13} className="mr-1 inline" /> Reports
            </Button>
          </div>
          <div className="h-52 px-2 pb-3">
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
                  <Bar dataKey="revenue" fill="var(--ui-accent)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </SectionCard>

        {/* Low stock alerts */}
        <SectionCard>
          <div className="mb-2 flex items-center justify-between px-4 pt-4">
            <p className="font-medium text-[var(--ui-text)]">Low Stock Alerts</p>
            <Badge tone={alerts.length > 0 ? "warning" : "success"}>
              {alerts.length}
            </Badge>
          </div>
          <div className="divide-y divide-[var(--ui-border)] px-2 pb-3">
            {loading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="py-2 px-2">
                  <Skeleton className="mb-1 h-3 w-32" />
                  <Skeleton className="h-3 w-20" />
                </div>
              ))
            ) : alerts.length === 0 ? (
              <p className="py-6 text-center text-sm text-[var(--ui-text-muted)]">
                All stock levels are healthy.
              </p>
            ) : (
              alerts.slice(0, 8).map((item, i) => (
                <div key={i} className="flex items-center justify-between px-2 py-2">
                  <p className="truncate text-sm text-[var(--ui-text)]">{item.name}</p>
                  <Badge tone={item.stock <= 0 ? "danger" : "warning"}>
                    {item.stock ?? 0} left
                  </Badge>
                </div>
              ))
            )}
          </div>
          {alerts.length > 0 && (
            <div className="px-4 pb-3">
              <Button size="sm" className="w-full" onClick={() => navigate("/inventory")}>
                View Inventory
              </Button>
            </div>
          )}
        </SectionCard>
      </div>

      {/* Bottom row: top sellers + recent transactions */}
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Top Selling Products */}
        <SectionCard>
          <div className="px-4 pt-4 pb-2">
            <p className="font-medium text-[var(--ui-text)]">Top Selling Products (All Time)</p>
          </div>
          <div className="divide-y divide-[var(--ui-border)] px-4 pb-3">
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex justify-between py-2">
                  <Skeleton className="h-3 w-40" />
                  <Skeleton className="h-3 w-16" />
                </div>
              ))
            ) : (data?.topSelling || []).length === 0 ? (
              <p className="py-6 text-center text-sm text-[var(--ui-text-muted)]">No sales data yet.</p>
            ) : (
              (data.topSelling || []).slice(0, 5).map((item, i) => (
                <div key={i} className="flex items-center justify-between py-2">
                  <span className="text-sm text-[var(--ui-text)]">
                    {i + 1}. {item.name}
                  </span>
                  <Badge tone="default">{item.total_sold} Sold</Badge>
                </div>
              ))
            )}
          </div>
        </SectionCard>

        {/* Recent transactions */}
        <SectionCard>
          <div className="flex items-center justify-between px-4 pt-4 pb-2">
            <p className="flex items-center gap-2 font-medium text-[var(--ui-text)]">
              <CreditCard size={15} className="text-[var(--ui-accent)]" />
              Recent Transactions
            </p>
            <Button size="sm" onClick={() => navigate("/sales-history")}>
              <ArrowRight size={13} className="mr-1 inline" /> View all
            </Button>
          </div>
          <div className="divide-y divide-[var(--ui-border)] px-4 pb-3">
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex justify-between py-2">
                  <Skeleton className="h-3 w-32" />
                  <Skeleton className="h-3 w-16" />
                </div>
              ))
            ) : recentSales.length === 0 ? (
              <p className="py-6 text-center text-sm text-[var(--ui-text-muted)]">
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
                  <div key={sale.id} className="flex items-center justify-between py-2">
                    <div>
                      <p className="text-sm font-medium text-[var(--ui-text)]">
                        {sale.customer_name || "Walk-in"}
                      </p>
                      <p className="text-xs text-[var(--ui-text-muted)]">{time}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge tone={PAYMENT_TONE[method] || "default"} className="capitalize">
                        {method}
                      </Badge>
                      <span className="text-sm font-semibold text-[var(--ui-text)]">
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
