import { useEffect, useState } from "react";
import { useOutletContext, useParams } from "react-router-dom";
import { portalApi } from "../../api/portalApi";

function statusColor(status) {
  switch (status) {
    case "active":
      return "bg-(--ui-success-bg) text-(--ui-success-fg)";
    case "exhausted":
      return "bg-(--ui-muted-surface) text-(--ui-text-muted)";
    case "expired":
      return "bg-(--ui-warning-bg) text-(--ui-warning-fg)";
    case "refunded":
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

export default function PortalPackages() {
  const { tenantSlug } = useParams();
  const ctx = useOutletContext() || {};
  const heading = ctx.labels?.packages_tab || "My Packages";
  const [packages, setPackages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(null);

  useEffect(() => {
    let cancelled = false;
    portalApi
      .get(tenantSlug, "/api/portal/me/packages")
      .then((data) => {
        if (!cancelled) setPackages(data?.packages || []);
      })
      .catch(() => {
        if (!cancelled) setPackages([]);
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
      ) : packages.length === 0 ? (
        <div className="bg-(--ui-surface) rounded-(--ui-radius-md) border border-(--ui-border) p-8 text-center text-(--ui-text-muted)">
          You don't have any packages yet.
        </div>
      ) : (
        <div className="space-y-4">
          {packages.map((pkg) => {
            const remaining = Number(pkg.credits_remaining);
            const total = Number(pkg.credits_total);
            const pct = total > 0 ? Math.max(0, Math.min(100, (remaining / total) * 100)) : 0;
            const history = Array.isArray(pkg.history) ? pkg.history : [];
            const isOpen = expanded === pkg.id;
            return (
              <div key={pkg.id} className="bg-(--ui-surface) rounded-(--ui-radius-md) border border-(--ui-border) overflow-hidden">
                <div className="p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="font-semibold text-lg">{pkg.template_name}</div>
                      <div className="text-sm text-(--ui-text-muted) mt-0.5">
                        {pkg.expires_at ? `Valid until ${formatDate(pkg.expires_at)}` : "No expiry"}
                      </div>
                    </div>
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-(--ui-radius-pill) ${statusColor(pkg.status)}`}>
                      {pkg.status}
                    </span>
                  </div>

                  <div className="mt-4">
                    <div className="flex items-baseline justify-between">
                      <div className="text-3xl font-bold text-(--ui-text)">{remaining}</div>
                      <div className="text-sm text-(--ui-text-muted)">of {total} credits left</div>
                    </div>
                    <div className="mt-2 h-2 w-full rounded-full bg-(--ui-muted-surface) overflow-hidden">
                      <div className="h-full rounded-full bg-(--ui-primary)" style={{ width: `${pct}%` }} />
                    </div>
                  </div>

                  {history.length > 0 ? (
                    <button
                      type="button"
                      onClick={() => setExpanded(isOpen ? null : pkg.id)}
                      className="mt-4 text-sm text-(--ui-link) hover:underline"
                    >
                      {isOpen ? "Hide history" : `View history (${history.length})`}
                    </button>
                  ) : null}
                </div>

                {isOpen && history.length > 0 ? (
                  <div className="border-t border-(--ui-border) bg-(--ui-muted-surface) px-5 py-3">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-(--ui-text-muted)">
                          <th className="font-medium py-1">Date</th>
                          <th className="font-medium py-1">Credits</th>
                          <th className="font-medium py-1">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {history.map((h) => (
                          <tr key={h.id} className="border-t border-(--ui-border)">
                            <td className="py-1.5 text-(--ui-text)">{formatDate(h.redeemed_at)}</td>
                            <td className="py-1.5 text-(--ui-text)">-{h.credits}</td>
                            <td className="py-1.5">
                              {h.reversed_at ? (
                                <span className="text-xs text-(--ui-warning-fg)">reversed</span>
                              ) : (
                                <span className="text-xs text-(--ui-text-muted)">redeemed</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
