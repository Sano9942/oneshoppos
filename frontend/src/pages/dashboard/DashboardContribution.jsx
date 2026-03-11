import { SectionCard } from "../../ui/primitives";
import { useCurrency } from "./DashboardShared";

function ContributionBar({ label, pct, value, fmt }) {
  return (
    <div>
      <div className="flex items-center justify-between text-xs mb-1">
        <span className="text-(--ui-text)">{label}</span>
        <span className="text-(--ui-text-muted)">{fmt(value)} · {pct}%</span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-(--ui-muted-surface)">
        <div
          className="h-1.5 rounded-full bg-(--ui-primary)"
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
    </div>
  );
}

export function DashboardContribution({ data }) {
  const { fmt } = useCurrency();
  const payment = data?.paymentContribution || [];
  const category = data?.categoryContribution || [];

  if (!payment.length && !category.length) return null;

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {payment.length > 0 && (
        <SectionCard className="p-4">
          <h3 className="mb-3 text-sm font-semibold text-(--ui-text)">Payment Methods</h3>
          <div className="flex flex-col gap-2">
            {payment.map((p) => (
              <ContributionBar
                key={p.payment_method}
                label={p.payment_method}
                pct={p.contribution_pct}
                value={p.total}
                fmt={fmt}
              />
            ))}
          </div>
        </SectionCard>
      )}
      {category.length > 0 && (
        <SectionCard className="p-4">
          <h3 className="mb-3 text-sm font-semibold text-(--ui-text)">Top Categories (30d)</h3>
          <div className="flex flex-col gap-2">
            {category.map((c) => (
              <ContributionBar
                key={c.category}
                label={c.category}
                pct={c.contribution_pct}
                value={c.revenue}
                fmt={fmt}
              />
            ))}
          </div>
        </SectionCard>
      )}
    </div>
  );
}
