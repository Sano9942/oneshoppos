import { SectionCard } from "../../ui/primitives";
import { useCurrency } from "./DashboardShared";

function ExceptionRow({ label, item, fmt, warnPct, dangerPct, onClick }) {
  const pct = item?.pct_of_sales ?? 0;
  const color =
    pct >= dangerPct ? "text-red-600" :
    pct >= warnPct ? "text-amber-600" :
    "text-(--ui-text-muted)";

  return (
    <button
      onClick={onClick}
      className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left hover:bg-(--ui-muted-surface) transition"
    >
      <span className="text-sm text-(--ui-text)">{label}</span>
      <div className="flex items-center gap-4 text-xs">
        <span className="text-(--ui-text-muted)">{fmt(item?.value ?? 0)}</span>
        <span className={`font-semibold ${color}`}>{pct.toFixed(1)}% of sales</span>
        <span className="text-(--ui-text-muted)">{item?.count ?? 0} orders</span>
      </div>
    </button>
  );
}

export function DashboardExceptions({ data, onNavigate }) {
  const fmt = useCurrency(data);
  const r = data?.refundsToday;
  const v = data?.voidsToday;
  const d = data?.discountsToday;
  const refundWarn = data?.targets?.refund_threshold_pct ?? 5;
  const voidWarn = data?.targets?.void_threshold_pct ?? 3;

  const allZero = !r?.value && !v?.value && !d?.value;
  if (allZero) {
    return (
      <SectionCard className="p-4">
        <p className="text-sm text-(--ui-text-muted)">No exceptions today.</p>
      </SectionCard>
    );
  }

  const goExceptions = () => onNavigate?.("/reports?tab=governance&sub=exceptions");

  return (
    <SectionCard className="p-4">
      <h3 className="mb-2 text-sm font-semibold text-(--ui-text)">Exceptions Today</h3>
      <div className="flex flex-col gap-0.5">
        <ExceptionRow label="Discounts" item={d} fmt={fmt} warnPct={10}       dangerPct={20}             onClick={goExceptions} />
        <ExceptionRow label="Voids"     item={v} fmt={fmt} warnPct={voidWarn}  dangerPct={voidWarn * 2}   onClick={goExceptions} />
        <ExceptionRow label="Refunds"   item={r} fmt={fmt} warnPct={refundWarn} dangerPct={refundWarn * 2} onClick={goExceptions} />
      </div>
    </SectionCard>
  );
}
