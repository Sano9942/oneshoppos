import { SectionCard } from "../../ui/primitives";
import { useCurrency, DeltaArrow } from "./DashboardShared";

/** Absolute-value delta: "↑ PKR 1,200 vs yesterday" */
function AbsDelta({ today, yesterday, fmt, invert = false }) {
  if (yesterday == null) return null;
  const diff = today - yesterday;
  if (diff === 0) return <span className="text-xs text-(--ui-text-muted)">→ no change vs yesterday</span>;
  const isPositive = invert ? diff < 0 : diff > 0;
  const arrow = diff > 0 ? "↑" : "↓";
  return (
    <span className={`text-xs font-medium ${isPositive ? "text-(--ui-success-fg)" : "text-(--ui-danger-fg)"}`}>
      {arrow} {fmt(Math.abs(diff))} vs yesterday
    </span>
  );
}

function KPICard({ label, value, yesterday, fmt, invert = false, onClick }) {
  return (
    <SectionCard className="flex cursor-pointer flex-col gap-1 p-5 transition hover:border-(--ui-border-strong)" onClick={onClick}>
      <p className="text-[13px] font-medium text-(--ui-text-muted)">{label}</p>
      <p className="text-2xl font-bold text-(--ui-text)">{fmt(value)}</p>
      <div className="flex items-center gap-2">
        <DeltaArrow today={value} yesterday={yesterday} invert={invert} />
        {yesterday != null && (
          <span className="text-xs text-(--ui-text-muted)">vs yesterday</span>
        )}
      </div>
    </SectionCard>
  );
}

/** Smaller secondary KPI card — no yesterday delta, just label + value */
function SecondaryKPICard({ label, value, fmt, onClick, colorClass = "text-(--ui-text)" }) {
  return (
    <SectionCard className="flex cursor-pointer flex-col gap-0.5 p-4 transition hover:border-(--ui-border-strong)" onClick={onClick}>
      <p className="text-[13px] font-medium text-(--ui-text-muted)">{label}</p>
      <p className={`text-xl font-bold ${colorClass}`}>{fmt(value)}</p>
    </SectionCard>
  );
}

export function DashboardKPICards({ data, isCashier, onNavigate }) {
  const { fmt } = useCurrency();
  const totalRevenue = data?.totalRevenueToday ?? 0;
  const allZero = totalRevenue === 0 && !data?.todayProfit && !data?.saleCount;

  if (allZero) {
    return (
      <SectionCard className="p-4 text-center">
        <p className="text-sm text-(--ui-text-muted)">
          No sales yet today.{" "}
          <button
            onClick={() => onNavigate?.("/pos")}
            className="font-medium text-(--ui-primary) underline underline-offset-2"
          >
            Open POS to start selling
          </button>
        </p>
      </SectionCard>
    );
  }

  if (isCashier) {
    return (
      <div className="grid grid-cols-2 gap-4">
        <KPICard
          label="Revenue Today"
          value={totalRevenue}
          yesterday={data?.yesterdayRevenue}
          fmt={fmt}
          onClick={() => onNavigate?.("/reports?tab=sales&date=today")}
        />
        <KPICard
          label="Avg Bill"
          value={data?.averageBill ?? 0}
          fmt={fmt}
          onClick={() => onNavigate?.("/reports?tab=sales&date=today")}
        />
      </div>
    );
  }

  const monthTarget = data?.targets?.monthly_sales_target ?? 0;
  const monthSales = data?.monthSales ?? 0;
  const todayExpenses = data?.todayExpenses ?? 0;

  return (
    <div className="flex flex-col gap-4">
      {/* Primary KPI row */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <SectionCard
          className="flex cursor-pointer flex-col gap-1 p-5 transition hover:border-(--ui-border-strong)"
          onClick={() => onNavigate?.("/reports?tab=sales&date=today")}
        >
          <p className="text-[13px] font-medium text-(--ui-text-muted)">Revenue Today</p>
          <p className="text-2xl font-bold text-(--ui-text)">{fmt(totalRevenue)}</p>
          <AbsDelta today={totalRevenue} yesterday={data?.yesterdayRevenue} fmt={fmt} />
          {monthTarget > 0 && (
            <div className="mt-1">
              <div className="h-1.5 w-full rounded-full bg-(--ui-muted-surface)">
                <div
                  className="h-1.5 rounded-full bg-(--ui-primary)"
                  style={{ width: `${Math.min(100, (monthSales / monthTarget) * 100).toFixed(1)}%` }}
                />
              </div>
              <p className="mt-0.5 text-xs text-(--ui-text-muted)">
                {((monthSales / monthTarget) * 100).toFixed(1)}% of monthly target
              </p>
            </div>
          )}
        </SectionCard>
        <SectionCard
          className="flex cursor-pointer flex-col gap-1 p-5 transition hover:border-(--ui-border-strong)"
          onClick={() => onNavigate?.("/reports?tab=finance&date=today")}
        >
          <p className="text-[13px] font-medium text-(--ui-text-muted)">Net Profit</p>
          <p className="text-2xl font-bold text-(--ui-text)">{fmt(data?.todayProfit ?? 0)}</p>
          <AbsDelta today={data?.todayProfit ?? 0} yesterday={data?.yesterdayProfit} fmt={fmt} />
        </SectionCard>
        <KPICard
          label="Avg Bill"
          value={data?.averageBill ?? 0}
          fmt={fmt}
          onClick={() => onNavigate?.("/reports?tab=sales&date=today")}
        />
        <SectionCard
          className="flex cursor-pointer flex-col gap-1 p-5 transition hover:border-(--ui-border-strong)"
          onClick={() => onNavigate?.("/reports?tab=governance&sub=exceptions")}
        >
          <p className="text-[13px] font-medium text-(--ui-text-muted)">Refunds</p>
          <p className="text-2xl font-bold text-(--ui-text)">{fmt(data?.refundsToday?.value ?? 0)}</p>
          <div className="flex items-center gap-2">
            <DeltaArrow today={data?.refundsToday?.value ?? 0} yesterday={data?.yesterdayRefunds} invert />
            {data?.yesterdayRefunds != null && (
              <span className="text-xs text-(--ui-text-muted)">vs yesterday</span>
            )}
          </div>
        </SectionCard>
      </div>

      {/* Secondary KPI row — expenses (the month's gross margin moved to the
          G4 "This month" row, DashboardMonth.jsx, with its margin %) */}
      {todayExpenses > 0 && (
        <div className="grid grid-cols-2 gap-4">
          <SecondaryKPICard
            label="Expenses Today"
            value={todayExpenses}
            fmt={fmt}
            colorClass="text-(--ui-danger-fg)"
            onClick={() => onNavigate?.("/reports?tab=finance&date=today")}
          />
        </div>
      )}
    </div>
  );
}
