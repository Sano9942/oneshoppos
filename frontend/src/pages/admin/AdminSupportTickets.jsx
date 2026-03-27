import { useEffect, useState, useRef } from "react";
import { adminFetch } from "./AdminLogin";

const STATUS_STYLES = {
  open: "bg-amber-100 text-amber-700",
  acknowledged: "bg-blue-100 text-blue-700",
  resolved: "bg-emerald-100 text-emerald-700",
};

function truncate(str, len = 80) {
  if (!str) return "";
  return str.length > len ? str.slice(0, len) + "..." : str;
}

export default function AdminSupportTickets() {
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("");
  const [expanded, setExpanded] = useState(null);
  const [updating, setUpdating] = useState(null);
  const timerRef = useRef(null);

  const fetchTickets = (showLoading) => {
    if (showLoading) setLoading(true);
    const qs = filter ? `?status=${filter}` : "";
    adminFetch(`/api/admin/support-tickets${qs}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Failed to load tickets"))))
      .then((data) => { setTickets(data.tickets || []); setError(""); })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchTickets(true);
    timerRef.current = setInterval(() => fetchTickets(false), 30000);
    return () => clearInterval(timerRef.current);
  }, [filter]);

  const updateStatus = async (tenantId, ticketId, newStatus) => {
    setUpdating(ticketId);
    try {
      const r = await adminFetch(`/api/admin/support-tickets/${tenantId}/${ticketId}`, {
        method: "PUT",
        body: JSON.stringify({ status: newStatus }),
      });
      if (!r.ok) throw new Error("Update failed");
      setTickets((prev) =>
        prev.map((t) =>
          t.id === ticketId && t.tenant_id === tenantId
            ? { ...t, status: newStatus, resolved_at: newStatus === "resolved" ? new Date().toISOString() : t.resolved_at }
            : t
        )
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setUpdating(null);
    }
  };

  if (error && tickets.length === 0) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4">
        <p className="text-sm text-red-600">{error}</p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-800">Support Tickets</h1>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-medium text-slate-400 uppercase tracking-wider">Auto-refresh 30s</span>
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700"
          >
            <option value="">All Statuses</option>
            <option value="open">Open</option>
            <option value="acknowledged">Acknowledged</option>
            <option value="resolved">Resolved</option>
          </select>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-slate-400">Loading...</p>
      ) : tickets.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <p className="text-sm font-medium text-emerald-600">No tickets found</p>
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
                  <th className="px-4 py-3 font-medium">Tenant</th>
                  <th className="px-4 py-3 font-medium">Type</th>
                  <th className="px-4 py-3 font-medium">Message</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Created</th>
                  <th className="px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {tickets.map((t) => {
                  const isExpanded = expanded === `${t.tenant_id}-${t.id}`;
                  const key = `${t.tenant_id}-${t.id}`;
                  return (
                    <tr key={key} className="border-b border-slate-50 last:border-0">
                      <td className="px-4 py-3">
                        <span className="font-medium text-slate-700">{t.tenant_name}</span>
                        <span className="ml-1 text-xs text-slate-400">({t.tenant_slug})</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">{t.type}</span>
                      </td>
                      <td className="px-4 py-3 max-w-xs">
                        <button
                          onClick={() => setExpanded(isExpanded ? null : key)}
                          className="text-left text-slate-600 hover:text-slate-800"
                        >
                          {isExpanded ? t.message : truncate(t.message)}
                        </button>
                        {isExpanded && (
                          <div className="mt-2 space-y-2 rounded-lg bg-slate-50 p-3 text-xs text-slate-500">
                            {t.page_url && <p><span className="font-medium">Page:</span> {t.page_url}</p>}
                            {t.browser && <p><span className="font-medium">Browser:</span> {t.browser}</p>}
                            {t.last_req_id && <p><span className="font-medium">Request ID:</span> {t.last_req_id}</p>}
                            {t.employee_id && <p><span className="font-medium">Employee ID:</span> {t.employee_id}</p>}
                            {t.screenshots && t.screenshots.length > 0 && (
                              <div>
                                <p className="font-medium mb-1">Screenshots:</p>
                                <div className="flex flex-wrap gap-2">
                                  {t.screenshots.map((src, i) => (
                                    <img key={i} src={src} alt={`Screenshot ${i + 1}`} className="max-h-40 rounded border border-slate-200" />
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_STYLES[t.status] || "bg-slate-100 text-slate-500"}`}>
                          {t.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-400 whitespace-nowrap">
                        {t.created_at ? new Date(t.created_at).toLocaleString() : "-"}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1">
                          {t.status === "open" && (
                            <button
                              disabled={updating === t.id}
                              onClick={() => updateStatus(t.tenant_id, t.id, "acknowledged")}
                              className="rounded bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50"
                            >
                              Acknowledge
                            </button>
                          )}
                          {t.status !== "resolved" && (
                            <button
                              disabled={updating === t.id}
                              onClick={() => updateStatus(t.tenant_id, t.id, "resolved")}
                              className="rounded bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
                            >
                              Resolve
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
