import { useNavigate } from "react-router-dom";
import { SectionCard } from "../../ui/primitives";
import { useCurrency } from "./DashboardShared";

export function DashboardInventoryAlerts({ data }) {
  const navigate = useNavigate();
  const { fmt } = useCurrency();
  const alerts = data?.lowStock || [];
  const iv = data?.inventoryValue;

  // Show the card if we have inventory value info OR low stock alerts
  if (!alerts.length && !iv) return null;

  return (
    <SectionCard className="p-4">
      {/* Inventory value summary header */}
      {iv && (
        <div className="mb-3 rounded-md bg-(--ui-muted-surface) px-3 py-2 text-xs text-(--ui-text-muted)">
          <span className="font-semibold text-(--ui-text)">{Number(iv.total_units || 0).toLocaleString()}</span>
          {" units in stock · Retail "}
          <span className="font-semibold text-(--ui-text)">{fmt(iv.retail_value)}</span>
          {" · Cost "}
          <span className="font-semibold text-(--ui-text)">{fmt(iv.cost_value)}</span>
        </div>
      )}

      {alerts.length > 0 && (
        <>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-(--ui-text)">Low Stock Alerts</h3>
            <button
              onClick={() => navigate("/inventory")}
              className="cursor-pointer text-xs font-medium text-(--ui-link) hover:underline"
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
                  <span className="font-semibold text-(--ui-danger-fg)">{item.stock} left</span>
                  <span className="text-(--ui-text-muted)">{fmt(item.price)}</span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* If we have inventory value but no low stock alerts */}
      {!alerts.length && iv && (
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-(--ui-text)">Inventory</h3>
          <button
            onClick={() => navigate("/inventory")}
            className="text-xs font-medium text-(--ui-primary) hover:underline"
          >
            View all →
          </button>
        </div>
      )}
    </SectionCard>
  );
}
