import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Clock,
  Coffee,
  CreditCard,
  Package,
  ShoppingBag,
  TrendingDown,
  TrendingUp,
  UserCheck,
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
import { fmtTime } from "../../utils/dates";
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
  const paymentContribution = data?.paymentContribution || [];
  const categoryContribution = data?.categoryContribution || [];
  const comparison = data?.salePurchaseComparison || [];
  const refundsToday = data?.refundsToday || { count: 0, value: 0 };
  const voidsToday = data?.voidsToday || { count: 0, value: 0 };
  const discountsToday = data?.discountsToday || { count: 0, value: 0 };
  const leakageTotal =
    Number(refundsToday.value || 0) +
    Number(voidsToday.value || 0) +
    Number(discountsToday.value || 0);

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
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SectionCard className="flex items-stretch overflow-hidden">
          <div className="w-1 shrink-0 bg-sky-500 rounded-l-(--ui-radius-md)" />
          <div className="p-5">
            {loading ? (
              <>
                <Skeleton className="mb-2 h-3 w-24" />
                <Skeleton className="h-7 w-32" />
              </>
            ) : (
              <>
                <p className="mb-1 flex items-center gap-1.5 text-xs font-medium text-(--ui-text-muted)">
                  <BarChart3 size={12} className="text-sky-500" />
                  Average Bill Today
                </p>
                <p className="text-2xl font-bold text-sky-600">{fmt(data?.averageBill)}</p>
                <p className="mt-1 text-xs text-(--ui-text-muted)">
                  {data?.saleCount || 0} completed sales
                </p>
              </>
            )}
          </div>
        </SectionCard>

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

        <SectionCard className="flex items-stretch overflow-hidden">
          <div className="w-1 shrink-0 bg-rose-500 rounded-l-(--ui-radius-md)" />
          <div className="p-5">
            {loading ? (
              <>
                <Skeleton className="mb-2 h-3 w-24" />
                <Skeleton className="h-7 w-32" />
              </>
            ) : (
              <>
                <p className="mb-1 flex items-center gap-1.5 text-xs font-medium text-(--ui-text-muted)">
                  <AlertTriangle size={12} className="text-rose-500" />
                  Refunds Today
                </p>
                <p className="text-2xl font-bold text-rose-600">{fmt(refundsToday.value)}</p>
                <p className="mt-1 text-xs text-(--ui-text-muted)">
                  {refundsToday.count || 0} refund events
                </p>
              </>
            )}
          </div>
        </SectionCard>

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
                  Month Sales / Purchases
                </p>
                <p className="text-xl font-bold text-indigo-600">
                  {fmt(data?.monthSales)} / {fmt(data?.monthPurchases)}
                </p>
                <p className="mt-1 text-xs text-(--ui-text-muted)">
                  Sales against received purchase cost this month
                </p>
              </>
            )}
          </div>
        </SectionCard>
      </div>

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <SectionCard className="flex items-stretch overflow-hidden">
          <div className="w-1 shrink-0 bg-violet-500 rounded-l-(--ui-radius-md)" />
          <div className="p-5">
            {loading ? (
              <>
                <Skeleton className="mb-2 h-3 w-24" />
                <Skeleton className="h-7 w-32" />
              </>
            ) : (
              <>
                <p className="mb-1 flex items-center gap-1.5 text-xs font-medium text-(--ui-text-muted)">
                  <Package size={12} className="text-violet-500" />
                  Current Stock Units
                </p>
                <p className="text-2xl font-bold text-violet-600">{Number(data?.currentStockUnits || 0)}</p>
                <p className="mt-1 text-xs text-(--ui-text-muted)">
                  Retail value {fmt(data?.inventoryValue?.retail_value)}
                </p>
              </>
            )}
          </div>
        </SectionCard>

        <SectionCard className="flex items-stretch overflow-hidden">
          <div className="w-1 shrink-0 bg-fuchsia-500 rounded-l-(--ui-radius-md)" />
          <div className="p-5">
            {loading ? (
              <>
                <Skeleton className="mb-2 h-3 w-24" />
                <Skeleton className="h-7 w-32" />
              </>
            ) : (
              <>
                <p className="mb-1 flex items-center gap-1.5 text-xs font-medium text-(--ui-text-muted)">
                  <TrendingUp size={12} className="text-fuchsia-500" />
                  Month Gross Margin
                </p>
                <p className="text-2xl font-bold text-fuchsia-600">{fmt(data?.monthGrossMargin)}</p>
                <p className="mt-1 text-xs text-(--ui-text-muted)">
                  Current month sales margin
                </p>
              </>
            )}
          </div>
        </SectionCard>

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
                  Top Selling Snapshot
                </p>
                <p className="text-lg font-bold text-(--ui-text) truncate">
                  {topSelling[0]?.name || "—"}
                </p>
                <p className="mt-1 text-xs text-(--ui-text-muted)">
                  {topSelling[0] ? `${topSelling[0].total_sold} units sold in 30 days` : "No data yet"}
                </p>
              </>
            )}
          </div>
        </SectionCard>
      </div>

      <div className="mb-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <SectionCard className="xl:col-span-1">
          <CardHeader
            icon={AlertTriangle}
            title="Executive Exceptions"
            action={<Badge tone={leakageTotal > 0 ? "warning" : "success"}>{loading ? "…" : fmt(leakageTotal)}</Badge>}
          />
          <div className="grid grid-cols-1 gap-px border-t border-(--ui-border) bg-(--ui-border)">
            {[
              {
                label: "Discounts",
                value: discountsToday.value,
                count: discountsToday.count,
                tone: "text-amber-600",
              },
              {
                label: "Voids",
                value: voidsToday.value,
                count: voidsToday.count,
                tone: "text-rose-600",
              },
              {
                label: "Refunds",
                value: refundsToday.value,
                count: refundsToday.count,
                tone: "text-slate-700",
              },
            ].map((item) => (
              <div key={item.label} className="bg-(--ui-surface) px-5 py-4">
                {loading ? (
                  <>
                    <Skeleton className="mb-2 h-3 w-20" />
                    <Skeleton className="mb-1 h-6 w-28" />
                    <Skeleton className="h-3 w-16" />
                  </>
                ) : (
                  <>
                    <p className="text-xs font-medium text-(--ui-text-muted)">{item.label}</p>
                    <p className={`mt-1 text-xl font-bold ${item.tone}`}>{fmt(item.value)}</p>
                    <p className="mt-1 text-xs text-(--ui-text-muted)">{item.count || 0} events today</p>
                  </>
                )}
              </div>
            ))}
          </div>
          {!loading && (
            <div className="px-5 pb-4 pt-3">
              <Button size="sm" className="w-full" onClick={() => navigate("/reports")}>
                <ArrowRight size={13} className="mr-1 inline" /> Open revenue leak reports
              </Button>
            </div>
          )}
        </SectionCard>

        <SectionCard className="xl:col-span-2">
          <CardHeader
            icon={TrendingUp}
            title="Contribution Snapshot"
            action={
              <Button size="sm" onClick={() => navigate("/reports")}>
                <ArrowRight size={13} className="mr-1 inline" /> Deep dive analytics
              </Button>
            }
          />
          <div className="grid grid-cols-1 gap-px border-t border-(--ui-border) bg-(--ui-border) lg:grid-cols-2">
            <div className="bg-(--ui-surface)">
              <div className="px-5 py-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">
                  Category Contribution (30 Days)
                </p>
              </div>
              <div className="divide-y divide-(--ui-border) pb-3">
                {loading ? (
                  Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="px-5 py-3">
                      <Skeleton className="mb-2 h-3 w-28" />
                      <Skeleton className="h-3 w-40" />
                    </div>
                  ))
                ) : categoryContribution.length === 0 ? (
                  <p className="px-5 py-6 text-sm text-(--ui-text-muted)">No category contribution data.</p>
                ) : (
                  categoryContribution.map((item) => (
                    <div key={item.category} className="px-5 py-3">
                      <div className="mb-1 flex items-center justify-between gap-3">
                        <p className="truncate text-sm font-medium text-(--ui-text)">{item.category}</p>
                        <span className="text-xs font-semibold text-(--ui-text-muted)">
                          {Number(item.contribution_pct || 0).toFixed(1)}%
                        </span>
                      </div>
                      <div className="h-2 rounded-full bg-(--ui-muted-surface)">
                        <div
                          className="h-2 rounded-full bg-(--ui-primary)"
                          style={{ width: `${Math.min(100, Number(item.contribution_pct || 0))}%` }}
                        />
                      </div>
                      <p className="mt-1 text-xs text-(--ui-text-muted)">{fmt(item.revenue)}</p>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="bg-(--ui-surface)">
              <div className="px-5 py-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">
                  Payment Contribution (Today)
                </p>
              </div>
              <div className="divide-y divide-(--ui-border) pb-3">
                {loading ? (
                  Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="px-5 py-3">
                      <Skeleton className="mb-2 h-3 w-24" />
                      <Skeleton className="h-3 w-40" />
                    </div>
                  ))
                ) : paymentContribution.length === 0 ? (
                  <p className="px-5 py-6 text-sm text-(--ui-text-muted)">No payment contribution data.</p>
                ) : (
                  paymentContribution.map((item) => (
                    <div key={item.payment_method} className="px-5 py-3">
                      <div className="mb-1 flex items-center justify-between gap-3">
                        <p className="truncate text-sm font-medium text-(--ui-text)">{item.payment_method}</p>
                        <span className="text-xs font-semibold text-(--ui-text-muted)">
                          {Number(item.contribution_pct || 0).toFixed(1)}%
                        </span>
                      </div>
                      <div className="h-2 rounded-full bg-(--ui-muted-surface)">
                        <div
                          className="h-2 rounded-full bg-emerald-500"
                          style={{ width: `${Math.min(100, Number(item.contribution_pct || 0))}%` }}
                        />
                      </div>
                      <p className="mt-1 text-xs text-(--ui-text-muted)">{fmt(item.total)}</p>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </SectionCard>
      </div>

      {/* Attendance Today */}
      {(() => {
        const att = data?.attendanceSummary;
        const tiles = [
          { label: "Clocked In",   value: att?.clocked_in   ?? 0, icon: UserCheck, color: "text-emerald-600", bg: "bg-emerald-500" },
          { label: "On Break",     value: att?.on_break      ?? 0, icon: Coffee,    color: "text-amber-600",  bg: "bg-amber-400"  },
          { label: "Clocked Out",  value: att?.clocked_out  ?? 0, icon: Clock,     color: "text-slate-500",  bg: "bg-slate-400"  },
          { label: "Not Started",  value: att?.not_started  ?? 0, icon: Users,     color: "text-rose-500",   bg: "bg-rose-400"   },
        ];
        return (
          <SectionCard className="mb-4">
            <CardHeader
              icon={UserCheck}
              title="Attendance Today"
              action={
                <Button size="sm" onClick={() => navigate("/attendance")}>
                  <ArrowRight size={13} className="mr-1 inline" /> View All
                </Button>
              }
            />
            <div className="grid grid-cols-2 gap-px sm:grid-cols-4 bg-(--ui-border) border-t border-(--ui-border)">
              {tiles.map(({ label, value, icon: Icon, color, bg }) => (
                <div key={label} className="flex items-center gap-3 bg-(--ui-surface) px-5 py-4">
                  <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${bg}/10`}>
                    <Icon size={16} className={color} />
                  </div>
                  <div>
                    {loading ? (
                      <>
                        <Skeleton className="mb-1 h-6 w-8" />
                        <Skeleton className="h-3 w-20" />
                      </>
                    ) : (
                      <>
                        <p className={`text-2xl font-bold ${color}`}>{value}</p>
                        <p className="text-xs text-(--ui-text-muted)">{label}</p>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
            {!loading && att?.details?.length > 0 && (
              <div className="flex flex-wrap gap-2 px-5 py-3 border-t border-(--ui-border)">
                {att.details.map((emp) => {
                  const tone =
                    emp.status === "clocked_in"  ? "text-emerald-700 bg-emerald-50 border-emerald-200" :
                    emp.status === "on_break"    ? "text-amber-700 bg-amber-50 border-amber-200" :
                    emp.status === "clocked_out" ? "text-slate-600 bg-slate-50 border-slate-200" :
                                                   "text-rose-600 bg-rose-50 border-rose-200";
                  const label =
                    emp.status === "clocked_in"  ? "In" :
                    emp.status === "on_break"    ? `Break${emp.break_reason ? ` (${emp.break_reason})` : ""}` :
                    emp.status === "clocked_out" ? "Done" : "—";
                  return (
                    <span
                      key={emp.id}
                      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${tone}`}
                    >
                      {emp.name}
                      <span className="opacity-60">·</span>
                      {label}
                    </span>
                  );
                })}
              </div>
            )}
          </SectionCard>
        );
      })()}

      {/* Middle row: executive trend + low stock */}
      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Sales vs purchases chart */}
        <SectionCard className="lg:col-span-2">
          <CardHeader
            icon={BarChart3}
            title="Sales vs Purchases"
            action={
              <Button size="sm" onClick={() => navigate("/reports")}>
                <ArrowRight size={13} className="mr-1 inline" /> Open reports
              </Button>
            }
          />
          <div className="h-52 px-2 pb-3 pt-2">
            {loading ? (
              <Skeleton className="h-full w-full" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={comparison} barSize={18}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--ui-border)" />
                  <XAxis
                    dataKey="day"
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
                  <Tooltip />
                  <Bar dataKey="sales_total" name="Sales" fill="var(--ui-primary)" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="purchase_total" name="Purchases" fill="#f59e0b" radius={[4, 4, 0, 0]} />
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
          <CardHeader
            icon={ShoppingBag}
            title="Top Selling Products (30 Days)"
            action={<Badge tone="default">Snapshot</Badge>}
          />
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
                const time = fmtTime(sale.timestamp, { hour: "2-digit", minute: "2-digit" });
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
