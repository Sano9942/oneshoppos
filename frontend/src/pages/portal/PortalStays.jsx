import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { portalApi } from "../../api/portalApi";
import { API_BASE } from "../../config";

function statusColor(status) {
  switch (status) {
    case "checked_in":
      return "bg-(--ui-success-bg) text-(--ui-success-fg)";
    case "checked_out":
      return "bg-(--ui-muted-surface) text-(--ui-text-muted)";
    case "cancelled":
      return "bg-(--ui-danger-bg) text-(--ui-danger-fg)";
    case "confirmed":
      return "bg-(--ui-muted-surface) text-(--ui-link)";
    case "pending":
      return "bg-(--ui-warning-bg) text-(--ui-warning-fg)";
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

export default function PortalStays() {
  const { tenantSlug } = useParams();
  const [stays, setStays] = useState([]);
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  // V10: portal stays remains read-only, but deep-links the public booking
  // engine when the tenant has it enabled. Probe the PUBLIC config endpoint
  // (raw fetch by design — same precedent as the appointments booking modal);
  // a 403 means the flag is off and the CTA stays hidden.
  const [canBookOnline, setCanBookOnline] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/api/public/rooms/config?tenant=${tenantSlug}`)
      .then((r) => { if (!cancelled) setCanBookOnline(r.ok); })
      .catch(() => { if (!cancelled) setCanBookOnline(false); });
    return () => { cancelled = true; };
  }, [tenantSlug]);

  useEffect(() => {
    let cancelled = false;
    portalApi
      .get(tenantSlug, "/api/portal/me/stays")
      .then((data) => {
        if (!cancelled) setStays(data?.stays || []);
      })
      .catch(() => {
        if (!cancelled) setStays([]);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [tenantSlug]);

  const now = new Date();
  const filtered = stays.filter((s) => {
    if (filter === "all") return true;
    if (filter === "upcoming") {
      return new Date(s.check_in_date) >= now && s.status !== "cancelled";
    }
    if (filter === "past") {
      return new Date(s.check_out_date) < now || s.status === "checked_out";
    }
    return true;
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">My Stays</h1>
        <div className="flex items-center gap-2">
        {canBookOnline && (
          <Link
            to={`/book-room/${tenantSlug}`}
            className="px-4 py-1.5 rounded-full bg-(--ui-primary) text-white text-sm font-medium"
          >
            Book a stay
          </Link>
        )}
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="border border-(--ui-border-strong) rounded px-3 py-1 text-sm"
        >
          <option value="all">All</option>
          <option value="upcoming">Upcoming</option>
          <option value="past">Past</option>
        </select>
        </div>
      </div>

      {loading ? (
        <div className="text-(--ui-text-muted)">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="bg-(--ui-surface) rounded-xl border border-(--ui-border) p-8 text-center text-(--ui-text-muted)">
          No stays to show.
        </div>
      ) : (
        <div className="bg-(--ui-surface) rounded-xl border border-(--ui-border) overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-(--ui-muted-surface) border-b border-(--ui-border)">
              <tr>
                <th className="text-left font-medium px-4 py-3">Booking</th>
                <th className="text-left font-medium px-4 py-3">Room</th>
                <th className="text-left font-medium px-4 py-3">Status</th>
                <th className="text-left font-medium px-4 py-3">Check-in</th>
                <th className="text-left font-medium px-4 py-3">Check-out</th>
                <th className="text-right font-medium px-4 py-3">Folio</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((stay) => (
                <tr
                  key={stay.id}
                  className="border-b border-(--ui-border) last:border-0"
                >
                  <td className="px-4 py-3 font-medium">
                    {stay.booking_number || `#${stay.id}`}
                  </td>
                  <td className="px-4 py-3 text-(--ui-text-muted)">
                    {stay.room_number
                      ? `${stay.room_number}${stay.room_type_name ? ` · ${stay.room_type_name}` : ""}`
                      : stay.room_type_name || "—"}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`text-xs font-medium px-2 py-0.5 rounded ${statusColor(
                        stay.status,
                      )}`}
                    >
                      {stay.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-(--ui-text-muted)">
                    {formatDate(stay.check_in_date)}
                  </td>
                  <td className="px-4 py-3 text-(--ui-text-muted)">
                    {formatDate(stay.check_out_date)}
                    {stay.nights ? (
                      <span className="text-xs text-(--ui-text-muted) ml-1">
                        ({stay.nights}n)
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {stay.folio_grand_total != null
                      ? Number(stay.folio_grand_total).toLocaleString()
                      : "—"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {stay.invoice_id ? (
                      <Link
                        to={`/portal/${tenantSlug}/invoices/${stay.invoice_id}`}
                        className="text-(--ui-success-fg) hover:underline"
                      >
                        Invoice
                      </Link>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
