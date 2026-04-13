import { SectionCard } from "../../ui/primitives";
import { useCurrency } from "./DashboardShared";
import { usePreset } from "../../contexts/PresetContext";

export function DashboardTopProducts({ data }) {
  const { fmt } = useCurrency();
  const { label } = usePreset();
  // topProducts = today/7-day window [{name, units_sold}]
  const products = (data?.topProducts || []).slice(0, 5);

  if (!products.length) return null;

  const maxQty = Math.max(...products.map((p) => Number(p.units_sold || 0)), 1);

  return (
    <SectionCard className="p-4">
      <h3 className="mb-3 text-sm font-semibold text-(--ui-text)">Top {label("products")} Today</h3>
      <div className="flex flex-col gap-2">
        {products.map((p, i) => {
          const qty = Number(p.units_sold || 0);
          const barPct = Math.round((qty / maxQty) * 100);
          return (
            <div key={p.name} className="flex items-center gap-3">
              <span className="w-4 shrink-0 text-right text-xs font-semibold text-(--ui-text-muted)">
                {i + 1}
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex items-center justify-between">
                  <span className="truncate text-sm text-(--ui-text)">{p.name}</span>
                  <span className="ml-2 shrink-0 text-xs font-semibold text-(--ui-text)">
                    {qty} sold
                  </span>
                </div>
                <div className="h-1 w-full overflow-hidden rounded-full bg-(--ui-muted-surface)">
                  <div
                    className="h-1 rounded-full bg-(--ui-primary)"
                    style={{ width: `${barPct}%` }}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </SectionCard>
  );
}
