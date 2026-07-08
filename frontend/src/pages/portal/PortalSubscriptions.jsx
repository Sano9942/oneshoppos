import { useEffect, useState } from "react";
import { useParams, useOutletContext } from "react-router-dom";
import { portalApi } from "../../api/portalApi";

function statusColor(status) {
  switch (status) {
    case "active":
      return "bg-(--ui-success-bg) text-(--ui-success-fg)";
    case "trialing":
      return "bg-(--ui-muted-surface) text-(--ui-link)";
    case "paused":
      return "bg-(--ui-warning-bg) text-(--ui-warning-fg)";
    case "cancelled":
    case "expired":
      return "bg-(--ui-danger-bg) text-(--ui-danger-fg)";
    default:
      return "bg-(--ui-muted-surface) text-(--ui-text-muted)";
  }
}

function formatDate(d) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatMoney(amount, currency) {
  if (amount == null) return "—";
  const n = Number(amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return currency ? `${currency} ${n}` : n;
}

export default function PortalSubscriptions() {
  const { tenantSlug } = useParams();
  const ctx = useOutletContext() || {};
  const labels = ctx.labels || {};
  const heading = labels.subscriptions_tab || "My Subscriptions";
  const [subs, setSubs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    portalApi
      .get(tenantSlug, "/api/portal/me/subscriptions")
      .then((data) => {
        if (!cancelled) setSubs(Array.isArray(data) ? data : (data?.subscriptions || []));
      })
      .catch(() => {
        if (!cancelled) setSubs([]);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [tenantSlug]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{heading}</h1>

      {loading ? (
        <div className="text-(--ui-text-muted)">Loading…</div>
      ) : subs.length === 0 ? (
        <div className="bg-(--ui-surface) rounded-xl border border-(--ui-border) p-8 text-center text-(--ui-text-muted)">
          No active plans to show.
        </div>
      ) : (
        <div className="bg-(--ui-surface) rounded-xl border border-(--ui-border) overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-(--ui-muted-surface) border-b border-(--ui-border)">
              <tr>
                <th className="text-left font-medium px-4 py-3">Plan</th>
                <th className="text-left font-medium px-4 py-3">Status</th>
                <th className="text-left font-medium px-4 py-3">Current period</th>
                <th className="text-left font-medium px-4 py-3">Renews</th>
                <th className="text-right font-medium px-4 py-3">Price</th>
              </tr>
            </thead>
            <tbody>
              {subs.map((s) => (
                <tr key={s.id} className="border-b border-(--ui-border) last:border-0">
                  <td className="px-4 py-3 font-medium">
                    {s.plan_name || "—"}
                    {s.billing_interval ? (
                      <span className="text-xs text-(--ui-text-muted) ml-1">/ {s.billing_interval}</span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded ${statusColor(s.status)}`}>
                      {s.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-(--ui-text-muted)">
                    {formatDate(s.current_period_start)} – {formatDate(s.current_period_end)}
                  </td>
                  <td className="px-4 py-3 text-(--ui-text-muted)">
                    {s.cancelled_at
                      ? "Cancelled"
                      : s.auto_charge
                        ? formatDate(s.current_period_end)
                        : "Manual"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {formatMoney(s.plan_price, s.plan_currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-(--ui-text-muted)">
        To change or cancel a plan, please contact the store.
      </p>
    </div>
  );
}
