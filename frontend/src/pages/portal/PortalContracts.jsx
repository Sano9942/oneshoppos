import { useEffect, useState } from "react";
import { Link, useParams, useOutletContext } from "react-router-dom";
import { portalApi } from "../../api/portalApi";

function statusColor(status) {
  switch (status) {
    case "checked_out":
      return "bg-(--ui-success-bg) text-(--ui-success-fg)";
    case "reserved":
    case "confirmed":
      return "bg-(--ui-muted-surface) text-(--ui-link)";
    case "returned":
    case "completed":
    case "invoiced":
      return "bg-(--ui-muted-surface) text-(--ui-text-muted)";
    case "cancelled":
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

export default function PortalContracts() {
  const { tenantSlug } = useParams();
  const ctx = useOutletContext() || {};
  const labels = ctx.labels || {};
  const heading = labels.contracts_tab || "Rental Agreements";
  const [contracts, setContracts] = useState([]);
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    portalApi
      .get(tenantSlug, "/api/portal/me/contracts")
      .then((data) => {
        if (!cancelled) setContracts(Array.isArray(data) ? data : (data?.contracts || []));
      })
      .catch(() => {
        if (!cancelled) setContracts([]);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [tenantSlug]);

  const openStatuses = ["reserved", "confirmed", "checked_out"];
  const filtered = contracts.filter((c) => {
    if (filter === "all") return true;
    if (filter === "active") return openStatuses.includes(c.status);
    if (filter === "past") return !openStatuses.includes(c.status);
    return true;
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{heading}</h1>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="border border-(--ui-border-strong) rounded px-3 py-1 text-sm"
        >
          <option value="all">All</option>
          <option value="active">Active</option>
          <option value="past">Past</option>
        </select>
      </div>

      {loading ? (
        <div className="text-(--ui-text-muted)">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="bg-(--ui-surface) rounded-xl border border-(--ui-border) p-8 text-center text-(--ui-text-muted)">
          No agreements to show.
        </div>
      ) : (
        <div className="bg-(--ui-surface) rounded-xl border border-(--ui-border) overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-(--ui-muted-surface) border-b border-(--ui-border)">
              <tr>
                <th className="text-left font-medium px-4 py-3">Agreement</th>
                <th className="text-left font-medium px-4 py-3">Items</th>
                <th className="text-left font-medium px-4 py-3">Status</th>
                <th className="text-left font-medium px-4 py-3">Rental start</th>
                <th className="text-left font-medium px-4 py-3">Due back</th>
                <th className="text-right font-medium px-4 py-3">Total</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id} className="border-b border-(--ui-border) last:border-0">
                  <td className="px-4 py-3 font-medium">{c.contract_number || `#${c.id}`}</td>
                  <td className="px-4 py-3 text-(--ui-text-muted)">{c.items || "—"}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded ${statusColor(c.status)}`}>
                      {c.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-(--ui-text-muted)">{formatDate(c.rental_start)}</td>
                  <td className="px-4 py-3 text-(--ui-text-muted)">
                    {c.actual_return ? formatDate(c.actual_return) : formatDate(c.expected_return)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {c.final_total != null && Number(c.final_total) > 0
                      ? Number(c.final_total).toLocaleString()
                      : Number(c.rental_fee_total || 0).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-(--ui-text-muted)">
        Rental agreements are managed by the store. <Link to={`/portal/${tenantSlug}`} className="text-(--ui-link) hover:underline">Back to dashboard</Link>
      </p>
    </div>
  );
}
