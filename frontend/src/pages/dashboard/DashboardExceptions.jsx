import { SectionCard } from "../../ui/primitives";
import { useCurrency } from "./DashboardShared";

function ExceptionRow({ label, item, fmt, warnPct, dangerPct, onClick }) {
  const pct = item?.pct_of_sales ?? 0;
  const color =
    pct >= dangerPct ? "text-(--ui-danger-fg)" :
    pct >= warnPct ? "text-(--ui-warning-fg)" :
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
  const { fmt } = useCurrency();
  const r = data?.refundsToday;
  const v = data?.voidsToday;
  const d = data?.discountsToday;
  // One Toy Store F3b part 2: staff toys at cost are not an exception; shown
  // on their own line, never added to the customer discounts above.
  const sd = data?.staffDiscountsToday;
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
      {sd?.count > 0 && (
        <p className="mt-2 text-xs text-(--ui-text-muted)">
          Staff toys at cost: {sd.count} bills, staff discount {fmt(sd.value)}
        </p>
      )}
    </SectionCard>
  );
}
