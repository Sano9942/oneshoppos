import { SectionCard } from "../../ui/primitives";
import { useCurrency, DeltaArrow } from "./DashboardShared";

function KPICard({ label, value, yesterday, fmt, invert = false, link, onClick }) {
  return (
    <SectionCard className="p-4 flex flex-col gap-1 cursor-pointer hover:shadow-md transition" onClick={onClick}>
      <p className="text-xs font-medium text-(--ui-text-muted) uppercase tracking-wide">{label}</p>
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

export function DashboardKPICards({ data, isCashier, onNavigate }) {
  const fmt = useCurrency(data);
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

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      <SectionCard
        className="p-4 flex flex-col gap-1 cursor-pointer hover:shadow-md transition"
        onClick={() => onNavigate?.("/reports?tab=sales&date=today")}
      >
        <p className="text-xs font-medium text-(--ui-text-muted) uppercase tracking-wide">Revenue Today</p>
        <p className="text-2xl font-bold text-(--ui-text)">{fmt(totalRevenue)}</p>
        <div className="flex items-center gap-2">
          <DeltaArrow today={totalRevenue} yesterday={data?.yesterdayRevenue} />
          {data?.yesterdayRevenue != null && (
            <span className="text-xs text-(--ui-text-muted)">vs yesterday</span>
          )}
        </div>
        {monthTarget > 0 && (
          <div className="mt-1">
            <div className="h-1.5 w-full rounded-full bg-(--ui-muted-surface)">
              <div
                className="h-1.5 rounded-full bg-sky-500"
                style={{ width: `${Math.min(100, (monthSales / monthTarget) * 100).toFixed(1)}%` }}
              />
            </div>
            <p className="mt-0.5 text-xs text-(--ui-text-muted)">
              {((monthSales / monthTarget) * 100).toFixed(1)}% of monthly target
            </p>
          </div>
        )}
      </SectionCard>
      <KPICard
        label="Net Profit"
        value={data?.todayProfit ?? 0}
        yesterday={data?.yesterdayProfit}
        fmt={fmt}
        onClick={() => onNavigate?.("/reports?tab=finance&date=today")}
      />
      <KPICard
        label="Avg Bill"
        value={data?.averageBill ?? 0}
        fmt={fmt}
        onClick={() => onNavigate?.("/reports?tab=sales&date=today")}
      />
      <KPICard
        label="Refunds"
        value={data?.refundsToday?.value ?? 0}
        yesterday={data?.yesterdayRefunds}
        fmt={fmt}
        invert
        onClick={() => onNavigate?.("/reports?tab=governance&sub=exceptions")}
      />
    </div>
  );
}
