import { useNavigate } from "react-router-dom";
import { SectionCard } from "../../ui/primitives";
import { fmtDateTime } from "../../utils/dates";
import { useCurrency } from "./DashboardShared";

export function DashboardRecentSales({ recentSales, data, isSingleBranch, onNavigate }) {
  const navigate = useNavigate();
  const { fmt } = useCurrency();

  if (!recentSales?.length) {
    return (
      <SectionCard className="p-4">
        <p className="text-sm text-(--ui-text-muted)">
          No transactions yet. First sale will appear here.
        </p>
      </SectionCard>
    );
  }

  return (
    <SectionCard className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-(--ui-text)">Recent Sales</h3>
        <button
          onClick={() => navigate("/sales-history")}
          className="text-xs font-medium text-(--ui-primary) hover:underline"
        >
          View all →
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-(--ui-border) text-xs text-(--ui-text-muted)">
              <th className="pb-2 text-left font-medium">Time</th>
              {!isSingleBranch && <th className="pb-2 text-left font-medium">Outlet</th>}
              <th className="pb-2 text-left font-medium">Items</th>
              <th className="pb-2 text-right font-medium">Amount</th>
              <th className="pb-2 text-right font-medium">Method</th>
            </tr>
          </thead>
          <tbody>
            {recentSales.map((s) => (
              <tr
                key={s.id}
                onClick={() => navigate(`/sales-history?sale_id=${s.id}`)}
                className="cursor-pointer border-b border-(--ui-border) last:border-0 hover:bg-(--ui-muted-surface)"
              >
                <td className="py-2 text-xs text-(--ui-text-muted)">{fmtDateTime(s.timestamp)}</td>
                {!isSingleBranch && (
                  <td className="py-2 text-xs text-(--ui-text-muted)">{s.outlet_name || "—"}</td>
                )}
                <td className="py-2 text-xs text-(--ui-text-muted)">{s.item_count ?? "—"}</td>
                <td className="py-2 text-right font-medium text-(--ui-text)">{fmt(s.total_amount)}</td>
                <td className="py-2 text-right text-xs text-(--ui-text-muted)">{s.payment_method || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );
}
