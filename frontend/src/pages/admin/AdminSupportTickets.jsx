import { useEffect, useState, useRef } from "react";
import { Eye, Trash2, MessageSquare, Send } from "lucide-react";
import { adminFetch } from "./AdminLogin";

const STATUS_STYLES = {
  open: "bg-(--ui-warning-bg) text-(--ui-warning-fg)",
  acknowledged: "bg-(--ui-muted-surface) text-(--ui-text)",
  resolved: "bg-(--ui-success-bg) text-(--ui-success-fg)",
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
  const [impersonating, setImpersonating] = useState(null);
  const [replyTarget, setReplyTarget] = useState(null);
  const [replyText, setReplyText] = useState("");
  const [replying, setReplying] = useState(false);
  const [deleting, setDeleting] = useState(null);
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

  const handleDelete = async (tenantId, ticketId) => {
    if (!window.confirm("Delete this ticket?")) return;
    setDeleting(ticketId);
    try {
      const r = await adminFetch(`/api/admin/support-tickets/${tenantId}/${ticketId}`, {
        method: "DELETE",
      });
      if (!r.ok) throw new Error("Delete failed");
      setTickets((prev) => prev.filter((t) => !(t.id === ticketId && t.tenant_id === tenantId)));
      if (expanded === `${tenantId}-${ticketId}`) setExpanded(null);
      if (replyTarget === `${tenantId}-${ticketId}`) { setReplyTarget(null); setReplyText(""); }
    } catch (err) {
      setError(err.message);
    } finally {
      setDeleting(null);
    }
  };

  const handleReply = async (tenantId, ticketId) => {
    if (!replyText.trim()) return;
    setReplying(true);
    try {
      const r = await adminFetch(`/api/admin/support-tickets/${tenantId}/${ticketId}/reply`, {
        method: "PUT",
        body: JSON.stringify({ reply: replyText.trim() }),
      });
      if (!r.ok) throw new Error("Reply failed");
      const data = await r.json();
      setTickets((prev) =>
        prev.map((t) =>
          t.id === ticketId && t.tenant_id === tenantId
            ? { ...t, admin_reply: data.admin_reply, replied_at: data.replied_at, status: data.status }
            : t
        )
      );
      setReplyTarget(null);
      setReplyText("");
    } catch (err) {
      setError(err.message);
    } finally {
      setReplying(false);
    }
  };

  const handleImpersonate = async (ticket) => {
    const key = `${ticket.tenant_id}-${ticket.id}`;
    setImpersonating(key);
    try {
      const res = await adminFetch(`/api/admin/impersonate/${ticket.tenant_id}`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      const frontendUrl = window.location.origin;
      const params = new URLSearchParams({
        impersonate_token: data.token,
        impersonate_session: String(data.sessionId),
        tenant_slug: data.tenantSlug,
        tenant_name: data.tenantName,
      });
      // If ticket has a page_url, redirect to that page after context-select
      const target = ticket.page_url
        ? `${frontendUrl}/context-select?${params.toString()}&redirect=${encodeURIComponent(ticket.page_url)}`
        : `${frontendUrl}/context-select?${params.toString()}`;
      window.open(target, "_blank");
    } catch (err) {
      setError(err.message);
    } finally {
      setImpersonating(null);
    }
  };

  if (error && tickets.length === 0) {
    return (
      <div className="rounded-(--ui-radius-md) border border-(--ui-danger-bg) bg-(--ui-danger-bg) p-4">
        <p className="text-sm text-(--ui-danger-fg)">{error}</p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-(--ui-text)">Support Tickets</h1>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-medium text-(--ui-text-muted) uppercase tracking-wider">Auto-refresh 30s</span>
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="ui-focus-ring rounded-(--ui-radius-sm) border border-(--ui-border-strong) bg-white px-3 py-1.5 text-sm text-(--ui-text)"
          >
            <option value="">All Statuses</option>
            <option value="open">Open</option>
            <option value="acknowledged">Acknowledged</option>
            <option value="resolved">Resolved</option>
          </select>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-(--ui-text-muted)">Loading...</p>
      ) : tickets.length === 0 ? (
        <div className="rounded-(--ui-radius-md) border border-(--ui-border) bg-(--ui-surface) p-8 text-center">
          <p className="text-sm font-medium text-(--ui-success-fg)">No tickets found</p>
        </div>
      ) : (
        <div className="rounded-(--ui-radius-md) border border-(--ui-border) bg-(--ui-surface)">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-(--ui-border) bg-(--ui-muted-surface) text-left text-xs text-(--ui-text-muted)">
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
                  const key = `${t.tenant_id}-${t.id}`;
                  const isExpanded = expanded === key;
                  const isReplyOpen = replyTarget === key;
                  return (
                    <tr key={key} className="border-b border-(--ui-border) last:border-0">
                      <td className="px-4 py-3">
                        <span className="font-medium text-(--ui-text)">{t.tenant_name}</span>
                        <span className="ml-1 text-xs text-(--ui-text-muted)">({t.tenant_slug})</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="rounded-full bg-(--ui-muted-surface) px-2 py-0.5 text-xs font-medium text-(--ui-text-muted)">{t.type}</span>
                      </td>
                      <td className="px-4 py-3 max-w-xs">
                        <button
                          onClick={() => setExpanded(isExpanded ? null : key)}
                          className="text-left text-(--ui-text) hover:text-(--ui-text-muted)"
                        >
                          {isExpanded ? t.message : truncate(t.message)}
                        </button>
                        {isExpanded && (
                          <div className="mt-2 space-y-2 rounded-(--ui-radius-sm) bg-(--ui-muted-surface) p-3 text-xs text-(--ui-text-muted)">
                            {t.page_url && <p><span className="font-medium text-(--ui-text)">Page:</span> {t.page_url}</p>}
                            {t.browser && <p><span className="font-medium text-(--ui-text)">Browser:</span> {t.browser}</p>}
                            {t.last_req_id && <p><span className="font-medium text-(--ui-text)">Request ID:</span> {t.last_req_id}</p>}
                            {t.employee_id && <p><span className="font-medium text-(--ui-text)">Employee ID:</span> {t.employee_id}</p>}
                            {t.screenshots && t.screenshots.length > 0 && (
                              <div>
                                <p className="font-medium mb-1 text-(--ui-text)">Screenshots:</p>
                                <div className="flex flex-wrap gap-2">
                                  {t.screenshots.map((src, i) => (
                                    <img key={i} src={src.url} alt={src.filename || `Screenshot ${i + 1}`} className="max-h-40 rounded border border-(--ui-border)" />
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Admin reply display */}
                            {t.admin_reply && (
                              <div className="mt-2 rounded-(--ui-radius-sm) border border-(--ui-border-strong) bg-(--ui-surface) p-3">
                                <p className="font-semibold text-(--ui-text) mb-1">Admin Reply:</p>
                                <p className="text-(--ui-text) whitespace-pre-wrap">{t.admin_reply}</p>
                                {t.replied_at && (
                                  <p className="mt-1 text-[10px] text-(--ui-text-muted)">Replied: {new Date(t.replied_at).toLocaleString()}</p>
                                )}
                              </div>
                            )}

                            {/* Inline reply form */}
                            {isReplyOpen && (
                              <div className="mt-2 space-y-2">
                                <textarea
                                  value={replyText}
                                  onChange={(e) => setReplyText(e.target.value)}
                                  placeholder="Type your reply..."
                                  rows={3}
                                  className="ui-focus-ring w-full rounded-(--ui-radius-sm) border border-(--ui-border-strong) bg-white px-3 py-2 text-xs text-(--ui-text)"
                                />
                                <div className="flex gap-2">
                                  <button
                                    disabled={replying || !replyText.trim()}
                                    onClick={() => handleReply(t.tenant_id, t.id)}
                                    className="ui-focus-ring flex items-center gap-1 rounded-full bg-(--ui-primary) px-3 py-1.5 text-xs font-semibold text-(--ui-on-primary) transition hover:bg-(--ui-primary-strong) disabled:opacity-50"
                                  >
                                    <Send size={12} /> {replying ? "Sending..." : "Send Reply"}
                                  </button>
                                  <button
                                    onClick={() => { setReplyTarget(null); setReplyText(""); }}
                                    className="ui-focus-ring rounded-full px-3 py-1.5 text-xs font-medium text-(--ui-text-muted) hover:bg-(--ui-muted-surface)"
                                  >
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_STYLES[t.status] || "bg-(--ui-muted-surface) text-(--ui-text-muted)"}`}>
                          {t.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-(--ui-text-muted) whitespace-nowrap">
                        {t.created_at ? new Date(t.created_at).toLocaleString() : "-"}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1">
                          {t.status === "open" && (
                            <button
                              disabled={updating === t.id}
                              onClick={() => updateStatus(t.tenant_id, t.id, "acknowledged")}
                              className="ui-focus-ring rounded-full bg-(--ui-muted-surface) px-2.5 py-1 text-xs font-semibold text-(--ui-text) transition hover:bg-(--ui-border-strong) disabled:opacity-50"
                            >
                              Acknowledge
                            </button>
                          )}
                          {t.status !== "resolved" && (
                            <button
                              disabled={updating === t.id}
                              onClick={() => updateStatus(t.tenant_id, t.id, "resolved")}
                              className="ui-focus-ring rounded-full bg-(--ui-success-bg) px-2.5 py-1 text-xs font-semibold text-(--ui-success-fg) transition hover:opacity-80 disabled:opacity-50"
                            >
                              Resolve
                            </button>
                          )}
                          {t.status !== "resolved" && (
                            <button
                              onClick={() => {
                                const k = `${t.tenant_id}-${t.id}`;
                                if (!isExpanded) setExpanded(k);
                                setReplyTarget(isReplyOpen ? null : k);
                                if (isReplyOpen) setReplyText("");
                              }}
                              className="ui-focus-ring flex items-center gap-1 rounded-full bg-(--ui-muted-surface) px-2.5 py-1 text-xs font-semibold text-(--ui-text) transition hover:bg-(--ui-border-strong)"
                            >
                              <MessageSquare size={12} /> Reply
                            </button>
                          )}
                          <button
                            disabled={impersonating === key}
                            onClick={() => handleImpersonate(t)}
                            className="ui-focus-ring flex items-center gap-1 rounded-full bg-(--ui-muted-surface) px-2.5 py-1 text-xs font-semibold text-(--ui-text) transition hover:bg-(--ui-border-strong) disabled:opacity-50"
                          >
                            <Eye size={12} /> {impersonating === key ? "Opening..." : "Impersonate"}
                          </button>
                          <button
                            disabled={deleting === t.id}
                            onClick={() => handleDelete(t.tenant_id, t.id)}
                            className="ui-focus-ring flex items-center gap-1 rounded-full bg-(--ui-danger-bg) px-2.5 py-1 text-xs font-semibold text-(--ui-danger-fg) transition hover:opacity-80 disabled:opacity-50"
                          >
                            <Trash2 size={12} />
                          </button>
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
