// One Toy Store G5 (owner, 2026-10-19): daily sale vs purchase for the last
// 7 shop days, from the server's `salePurchaseComparison` series. Sale =
// money taken (same base as "Month sale"); Purchase = toys received on
// supplier bills × cost (same base as "Month purchase"). Newest day first,
// Sale − Purchase with a minus in red, and a 7-day total. Finance roles
// only: the server strips purchase figures for other roles and the card
// then shows nothing.
import { SectionCard } from "../../ui/primitives";
import { useCurrency } from "./DashboardShared";

const dayLabel = (day) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "short", day: "numeric", month: "short", timeZone: "UTC",
  });

function Diff({ value, fmt }) {
  const minus = value < 0;
  return (
    <span data-testid="sale-purchase-diff" className={minus ? "text-(--ui-danger)" : "text-(--ui-text)"}>
      {minus ? `−${fmt(-value)}` : fmt(value)}
    </span>
  );
}

export function DashboardSalePurchase({ data, canFinancial }) {
  const { fmt } = useCurrency();
  const series = data?.salePurchaseComparison || [];
  if (!canFinancial || !series.length || series.some((r) => r.purchase_total === undefined)) return null;

  const rows = series
    .map((r) => ({ day: r.day, sale: Number(r.sales_total || 0), purchase: Number(r.purchase_total || 0) }))
    .reverse();
  const total = rows.reduce((t, r) => ({ sale: t.sale + r.sale, purchase: t.purchase + r.purchase }), { sale: 0, purchase: 0 });

  return (
    <div data-testid="sale-purchase">
      <SectionCard className="p-4">
        <h3 className="mb-3 text-sm font-semibold text-(--ui-text)">Sale vs Purchase (7 days)</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-(--ui-text-muted)">
              <th className="py-1 pr-2 font-medium">Day</th>
              <th className="py-1 pr-2 text-right font-medium">Sale</th>
              <th className="py-1 pr-2 text-right font-medium">Purchase</th>
              <th className="py-1 text-right font-medium">Sale − Purchase</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.day} data-testid="sale-purchase-day" className="border-t border-(--ui-border)">
                <td className="py-1.5 pr-2 text-(--ui-text)">{i === 0 ? "Today" : dayLabel(r.day)}</td>
                <td className="py-1.5 pr-2 text-right text-(--ui-text)">{fmt(r.sale)}</td>
                <td className="py-1.5 pr-2 text-right text-(--ui-text-muted)">{fmt(r.purchase)}</td>
                <td className="py-1.5 text-right font-semibold"><Diff value={r.sale - r.purchase} fmt={fmt} /></td>
              </tr>
            ))}
            <tr data-testid="sale-purchase-total" className="border-t-2 border-(--ui-border) font-semibold">
              <td className="py-1.5 pr-2 text-(--ui-text)">7 days</td>
              <td className="py-1.5 pr-2 text-right text-(--ui-text)">{fmt(total.sale)}</td>
              <td className="py-1.5 pr-2 text-right text-(--ui-text)">{fmt(total.purchase)}</td>
              <td className="py-1.5 text-right"><Diff value={total.sale - total.purchase} fmt={fmt} /></td>
            </tr>
          </tbody>
        </table>
      </SectionCard>
    </div>
  );
}
