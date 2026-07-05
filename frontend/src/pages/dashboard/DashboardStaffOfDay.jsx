import { Trophy } from "lucide-react";
import { useCurrency } from "../../contexts/CurrencyContext";
import { SectionCard } from "../../ui/primitives";

/**
 * Staff-of-the-day podium (2-G.16 Merchant home).
 *
 * Reads `data.staffOfDay` injected by /api/reports/dashboard — top 3 cashiers
 * by today's non-voided sales. Renders a simple podium (1/2/3 highlight) so
 * the owner can see who's driving revenue without digging into reports.
 */
export default function DashboardStaffOfDay({ data }) {
  const { fmt } = useCurrency();
  const rows = Array.isArray(data?.staffOfDay) ? data.staffOfDay : [];
  if (rows.length === 0) return null;

  // Monochrome podium: #1 gets the black tag, runners-up go gray.
  const rankStyle = (i) => {
    if (i === 0) return { tag: "bg-(--ui-primary) text-white", border: "border-(--ui-border-strong)" };
    return { tag: "bg-(--ui-muted-surface) text-(--ui-text)", border: "border-(--ui-border)" };
  };

  return (
    <SectionCard>
      <div className="flex items-center justify-between mb-3">
        <h3 className="flex items-center gap-2 text-sm font-bold text-(--ui-text)">
          <Trophy size={14} className="text-(--ui-warning-fg)" />
          Staff of the day
          <span className="text-xs font-normal text-(--ui-text-muted)">(top {rows.length})</span>
        </h3>
      </div>
      <div className="space-y-2">
        {rows.map((r, i) => {
          const s = rankStyle(i);
          return (
            <div
              key={r.id}
              className={`flex items-center justify-between gap-3 py-2 px-3 rounded-lg border ${s.border} bg-(--ui-surface)`}
            >
              <div className="flex items-center gap-3 min-w-0">
                <span
                  className={`inline-flex items-center justify-center shrink-0 w-6 h-6 rounded-full text-xs font-black ${s.tag}`}
                >
                  {i + 1}
                </span>
                <div className="min-w-0">
                  <div className="font-semibold truncate">{r.name}</div>
                  <div className="text-xs text-(--ui-text-muted)">
                    {Number(r.sale_count)} sale{Number(r.sale_count) === 1 ? "" : "s"}
                  </div>
                </div>
              </div>
              <div className="shrink-0 font-bold text-(--ui-text)">{fmt(r.total)}</div>
            </div>
          );
        })}
      </div>
    </SectionCard>
  );
}
