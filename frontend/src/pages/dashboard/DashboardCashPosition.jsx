import { Banknote } from "lucide-react";
import { useCurrency } from "../../contexts/CurrencyContext";
import { SectionCard } from "../../ui/primitives";

/**
 * Live cash-position card (2-G.16 Merchant home).
 *
 * Reads `data.cashPosition` injected by /api/reports/dashboard:
 *   { by_outlet: [{ outlet_name, opening_float, cash_in, cash_out, paid_out,
 *                   paid_in, expected_cash }],
 *     total_expected }
 * Renders per-outlet rows + a total so the merchant can see what should be
 * in each drawer right now without opening close-shift.
 */
export default function DashboardCashPosition({ data }) {
  const { fmt } = useCurrency();
  const pos = data?.cashPosition || { by_outlet: [], total_expected: 0 };
  const rows = Array.isArray(pos.by_outlet) ? pos.by_outlet : [];
  if (rows.length === 0) return null;

  return (
    <SectionCard>
      <div className="flex items-center justify-between mb-3">
        <h3 className="flex items-center gap-2 text-sm font-bold text-(--ui-text)">
          <Banknote size={14} className="text-(--ui-text-muted)" />
          Cash in drawer
          <span className="text-xs font-normal text-(--ui-text-muted)">({rows.length} open)</span>
        </h3>
        <div className="text-xs text-(--ui-text-muted)">
          Total: <span className="font-bold text-(--ui-text)">{fmt(pos.total_expected)}</span>
        </div>
      </div>
      <div className="divide-y divide-(--ui-border)">
        {rows.map((r) => (
          <div key={r.shift_id} className="flex items-center justify-between py-2 text-sm">
            <div className="min-w-0">
              <div className="font-semibold truncate">{r.outlet_name}</div>
              <div className="text-xs text-(--ui-text-muted) truncate">
                {r.employee_name || "—"} · Float {fmt(r.opening_float)}
              </div>
            </div>
            <div className="text-right shrink-0 ml-3">
              <div className="font-bold text-(--ui-text)">{fmt(r.expected_cash)}</div>
              <div className="text-xs text-(--ui-text-muted)">
                <span className="text-(--ui-success-fg)">+{fmt(r.cash_in)}</span>
                <span className="mx-1">/</span>
                <span className="text-(--ui-danger-fg)">-{fmt(r.cash_out)}</span>
              </div>
              {(Number(r.paid_out) > 0 || Number(r.paid_in) > 0) && (
                <div className="text-xs text-(--ui-text-muted)">
                  Paid out {fmt(r.paid_out)} · Paid in {fmt(r.paid_in)}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}
