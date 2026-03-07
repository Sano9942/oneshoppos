import { useNavigate } from "react-router-dom";
import { SectionCard } from "../../ui/primitives";
import { useCurrency } from "./DashboardShared";

export function DashboardInventoryAlerts({ data }) {
  const navigate = useNavigate();
  const fmt = useCurrency(data);
  const alerts = data?.lowStock || [];

  if (!alerts.length) return null;

  return (
    <SectionCard className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-(--ui-text)">Low Stock Alerts</h3>
        <button
          onClick={() => navigate("/inventory")}
          className="text-xs font-medium text-(--ui-primary) hover:underline"
        >
          View all →
        </button>
      </div>
      <div className="flex flex-col gap-1">
        {alerts.map((item) => (
          <div
            key={item.name}
            className="flex items-center justify-between rounded-md px-2 py-1.5"
          >
            <span className="text-sm text-(--ui-text)">{item.name}</span>
            <div className="flex items-center gap-4 text-xs">
              <span className="font-semibold text-red-600">{item.stock} left</span>
              <span className="text-(--ui-text-muted)">{fmt(item.price)}</span>
            </div>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}
