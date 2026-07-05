import { SectionCard } from "../../ui/primitives";
import { parseDbDate } from "../../utils/dates";
import { AlertTriangle } from "lucide-react";

/**
 * Pure-frontend rules engine. Reads dashboard data and produces a prioritized
 * list of actionable alerts. Each item has: message, link, severity.
 */
function buildAlerts(data) {
  if (!data) return [];
  const alerts = [];
  const readiness = data.operationalReadiness || [];
  const lowStock = data.lowStock || [];
  const refundPct = data.refundsToday?.pct_of_sales ?? 0;
  const voidPct = data.voidsToday?.pct_of_sales ?? 0;
  const refundThreshold = data.targets?.refund_threshold_pct ?? 5;
  const voidThreshold = data.targets?.void_threshold_pct ?? 3;
  const now = Date.now();
  const twoHoursMs = 2 * 3600 * 1000;

  // Shift not open at any outlet
  readiness.forEach((o) => {
    if (!o.shift_open) {
      alerts.push({
        severity: "high",
        message: `${o.outlet_name}: no open shift — checkout is blocked`,
        link: "/cash-management",
        linkLabel: "Open Shift",
      });
    }
  });

  // No sales for 2+ hours with a shift open
  readiness.forEach((o) => {
    if (o.shift_open && o.last_sale_at) {
      const lastSaleMs = parseDbDate(o.last_sale_at).getTime();
      if (now - lastSaleMs > twoHoursMs) {
        const hoursAgo = ((now - lastSaleMs) / 3600000).toFixed(1);
        alerts.push({
          severity: "medium",
          message: `${o.outlet_name}: no sales in ${hoursAgo}h — shift is open but idle`,
          link: "/sales-history",
          linkLabel: "View Sales",
        });
      }
    }
  });

  // Refund % above threshold
  if (refundPct >= refundThreshold) {
    alerts.push({
      severity: "medium",
      message: `Refunds at ${refundPct}% of sales — above ${refundThreshold}% threshold`,
      link: "/reports?tab=governance&sub=exceptions",
      linkLabel: "View Exceptions",
    });
  }

  // Void % above threshold
  if (voidPct >= voidThreshold) {
    alerts.push({
      severity: "medium",
      message: `Voids at ${voidPct}% of sales — above ${voidThreshold}% threshold`,
      link: "/reports?tab=governance&sub=exceptions",
      linkLabel: "View Exceptions",
    });
  }

  // Low stock items
  if (lowStock.length > 0) {
    alerts.push({
      severity: "low",
      message: `${lowStock.length} product${lowStock.length > 1 ? "s" : ""} low on stock`,
      link: "/inventory",
      linkLabel: "View Inventory",
    });
  }

  return alerts;
}

const SEVERITY_STYLE = {
  high: "border-transparent bg-(--ui-danger-bg) text-(--ui-danger-fg)",
  medium: "border-transparent bg-(--ui-warning-bg) text-(--ui-warning-fg)",
  low: "border-transparent bg-(--ui-muted-surface) text-(--ui-text-muted)",
};

export function DashboardAttention({ data, onNavigate }) {
  const alerts = buildAlerts(data);
  if (!alerts.length) return null;

  return (
    <SectionCard className="p-4">
      <div className="mb-2 flex items-center gap-2">
        <AlertTriangle size={14} className="text-(--ui-warning-fg)" />
        <h3 className="text-sm font-semibold text-(--ui-text)">Needs Attention</h3>
      </div>
      <div className="flex flex-col gap-2">
        {alerts.map((alert, i) => (
          <div
            key={i}
            className={`flex items-center justify-between rounded-md border px-3 py-2 ${SEVERITY_STYLE[alert.severity]}`}
          >
            <p className="text-xs">{alert.message}</p>
            {alert.link && (
              <button
                onClick={() => onNavigate?.(alert.link)}
                className="ml-4 shrink-0 text-xs font-semibold underline underline-offset-2"
              >
                {alert.linkLabel} →
              </button>
            )}
          </div>
        ))}
      </div>
    </SectionCard>
  );
}
