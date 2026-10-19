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
          data-bar
          className="h-1.5 rounded-full bg-(--ui-primary)"
          style={{ width: `${Math.max(0, Math.min(pct, 100))}%` }}
        />
      </div>
    </div>
  );
}

export function DashboardContribution({ data }) {
  const { fmt } = useCurrency();
  const payment = data?.paymentContribution || [];
  const category = data?.categoryContribution || [];
  // G3 (One Toy Store): last 30 days, top 10 + Others + No supplier.
  const supplier = data?.supplierContribution?.rows || [];

  if (!payment.length && !category.length && !supplier.length) return null;

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
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
      {supplier.length > 0 && (
        <div data-testid="supplier-contribution">
          <SectionCard className="p-4">
            <h3 className="mb-3 text-sm font-semibold text-(--ui-text)">Sales by Supplier (30d)</h3>
            <div className="flex flex-col gap-2">
              {supplier.map((s) => (
                <ContributionBar
                  key={s.supplier}
                  label={s.supplier}
                  pct={s.contribution_pct}
                  value={s.revenue}
                  fmt={fmt}
                />
              ))}
            </div>
          </SectionCard>
        </div>
      )}
    </div>
  );
}
