import { SectionCard } from "../../ui/primitives";
import { useCurrency } from "./DashboardShared";

export function DashboardOutletRanking({ data, onNavigate }) {
  const fmt = useCurrency(data);
  const outlets = data?.salesByOutlet || [];
  const readiness = data?.operationalReadiness || [];
  const refundPct = data?.refundsToday?.pct_of_sales ?? 0;

  const anomalies = [];
  readiness.forEach((o) => {
    if (!o.shift_open) anomalies.push(`${o.outlet_name}: no shift open`);
  });
  if (refundPct >= 5) anomalies.push(`Refunds at ${refundPct}% of sales`);

  if (outlets.length === 0) return null;

  return (
    <SectionCard className="p-4">
      <h3 className="mb-3 text-sm font-semibold text-(--ui-text)">Outlet Revenue Ranking</h3>
      <div className="flex flex-col gap-1">
        {outlets.map((o, i) => {
          const ready = readiness.find((r) => r.outlet_name === o.name);
          return (
            <button
              key={o.name}
              onClick={() => onNavigate?.(`/reports?tab=sales&outlet_id=${ready?.outlet_id || ""}`)}
              className="flex items-center gap-3 rounded-md px-2 py-1.5 text-left hover:bg-(--ui-muted-surface) transition"
            >
              <span className="w-5 text-xs font-bold text-(--ui-text-muted)">#{i + 1}</span>
              <span className="flex-1 text-sm text-(--ui-text)">{o.name}</span>
              <span className="text-sm font-semibold text-(--ui-text)">{fmt(o.total)}</span>
              <span className={`h-2 w-2 rounded-full ${ready?.shift_open ? "bg-emerald-500" : "bg-amber-400"}`} />
            </button>
          );
        })}
      </div>
      {anomalies.length > 0 && (
        <div className="mt-3 rounded-md bg-amber-50 px-3 py-2">
          <p className="text-xs font-semibold text-amber-700 mb-1">Attention</p>
          {anomalies.map((a, i) => (
            <p key={i} className="text-xs text-amber-700">• {a}</p>
          ))}
        </div>
      )}
    </SectionCard>
  );
}
