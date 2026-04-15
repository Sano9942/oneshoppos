import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { portalApi } from "../../api/portalApi";

function statusColor(status) {
  switch (status) {
    case "checked_in":
      return "bg-emerald-100 text-emerald-700";
    case "checked_out":
      return "bg-slate-100 text-slate-600";
    case "cancelled":
      return "bg-red-100 text-red-700";
    case "confirmed":
      return "bg-blue-100 text-blue-700";
    case "pending":
      return "bg-amber-100 text-amber-700";
    default:
      return "bg-slate-100 text-slate-600";
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
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="border border-slate-300 rounded px-3 py-1 text-sm"
        >
          <option value="all">All</option>
          <option value="upcoming">Upcoming</option>
          <option value="past">Past</option>
        </select>
      </div>

      {loading ? (
        <div className="text-slate-500">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-slate-500">
          No stays to show.
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
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
                  className="border-b border-slate-100 last:border-0"
                >
                  <td className="px-4 py-3 font-medium">
                    {stay.booking_number || `#${stay.id}`}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
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
                  <td className="px-4 py-3 text-slate-600">
                    {formatDate(stay.check_in_date)}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {formatDate(stay.check_out_date)}
                    {stay.nights ? (
                      <span className="text-xs text-slate-400 ml-1">
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
                        className="text-emerald-700 hover:underline"
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
