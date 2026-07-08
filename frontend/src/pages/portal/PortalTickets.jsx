import { useEffect, useState } from "react";
import { useParams, useOutletContext } from "react-router-dom";
import { portalApi } from "../../api/portalApi";

function statusColor(status) {
  switch (status) {
    case "completed":
    case "invoiced":
      return "bg-(--ui-success-bg) text-(--ui-success-fg)";
    case "in_progress":
      return "bg-(--ui-muted-surface) text-(--ui-link)";
    case "on_hold":
    case "intake":
    case "approved":
      return "bg-(--ui-warning-bg) text-(--ui-warning-fg)";
    case "cancelled":
      return "bg-(--ui-danger-bg) text-(--ui-danger-fg)";
    default:
      return "bg-(--ui-muted-surface) text-(--ui-text-muted)";
  }
}

function statusLabel(status) {
  return String(status || "").replace(/_/g, " ");
}

function formatDate(d) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function PortalTickets() {
  const { tenantSlug } = useParams();
  const ctx = useOutletContext() || {};
  const labels = ctx.labels || {};
  const heading = labels.tickets_tab || "Repair Tickets";
  const [tickets, setTickets] = useState([]);
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    portalApi
      .get(tenantSlug, "/api/portal/me/tickets")
      .then((data) => {
        if (!cancelled) setTickets(Array.isArray(data) ? data : (data?.tickets || []));
      })
      .catch(() => {
        if (!cancelled) setTickets([]);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [tenantSlug]);

  const closedStatuses = ["completed", "invoiced", "cancelled"];
  const filtered = tickets.filter((t) => {
    if (filter === "all") return true;
    if (filter === "open") return !closedStatuses.includes(t.status);
    if (filter === "closed") return closedStatuses.includes(t.status);
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
          <option value="open">Open</option>
          <option value="closed">Closed</option>
        </select>
      </div>

      {loading ? (
        <div className="text-(--ui-text-muted)">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="bg-(--ui-surface) rounded-xl border border-(--ui-border) p-8 text-center text-(--ui-text-muted)">
          No tickets to show.
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((t) => (
            <div
              key={t.id}
              className="bg-(--ui-surface) rounded-xl border border-(--ui-border) p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium truncate">{t.title || t.ticket_number}</div>
                  <div className="text-xs text-(--ui-text-muted)">{t.ticket_number}</div>
                </div>
                <span className={`shrink-0 text-xs font-medium px-2 py-0.5 rounded ${statusColor(t.status)}`}>
                  {statusLabel(t.status)}
                </span>
              </div>
              {t.description ? (
                <p className="text-sm text-(--ui-text-muted) mt-2 line-clamp-3">{t.description}</p>
              ) : null}
              <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-(--ui-text-muted) mt-3">
                <span>Opened: {formatDate(t.created_at)}</span>
                {t.expected_completion ? (
                  <span>Expected: {formatDate(t.expected_completion)}</span>
                ) : null}
                {t.actual_completion ? (
                  <span>Completed: {formatDate(t.actual_completion)}</span>
                ) : null}
                {t.deposit_amount != null && Number(t.deposit_amount) > 0 ? (
                  <span>Deposit: {Number(t.deposit_amount).toLocaleString()}</span>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
