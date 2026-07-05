import { useEffect, useState, useRef } from "react";
import { Download, Send, Trash2, RotateCcw } from "lucide-react";
import { adminFetch } from "./AdminLogin";
import { downloadCsv } from "../../utils/csvExport";

const STATUS_TABS = [
  { key: "", label: "All" },
  { key: "pending", label: "Pending" },
  { key: "sent", label: "Sent" },
  { key: "failed", label: "Failed" },
  { key: "broadcasts", label: "Broadcasts" },
];

// Categorical email types collapse to the near-monochrome palette; only the
// billing-lifecycle types keep a status hue (they read as real state).
const TYPE_COLORS = {
  receipt: "bg-(--ui-muted-surface) text-(--ui-text-muted)",
  digest: "bg-(--ui-muted-surface) text-(--ui-text-muted)",
  drip_getting_started: "bg-(--ui-muted-surface) text-(--ui-text-muted)",
  drip_features: "bg-(--ui-muted-surface) text-(--ui-text-muted)",
  billing_payment_recorded: "bg-(--ui-success-bg) text-(--ui-success-fg)",
  billing_plan_changed: "bg-(--ui-success-bg) text-(--ui-success-fg)",
  billing_expiry_warning: "bg-(--ui-warning-bg) text-(--ui-warning-fg)",
  billing_overdue: "bg-(--ui-danger-bg) text-(--ui-danger-fg)",
  support_received: "bg-(--ui-muted-surface) text-(--ui-text-muted)",
  support_resolved: "bg-(--ui-muted-surface) text-(--ui-text-muted)",
  downtime: "bg-(--ui-warning-bg) text-(--ui-warning-fg)",
  announcement: "bg-(--ui-muted-surface) text-(--ui-text-muted)",
};

function statusBadge(email) {
  if (email.sent_at) return <span className="rounded-full bg-(--ui-success-bg) px-2 py-0.5 text-[10px] font-semibold text-(--ui-success-fg)">Sent</span>;
  if (email.attempts >= email.max_attempts) return <span className="rounded-full bg-(--ui-danger-bg) px-2 py-0.5 text-[10px] font-semibold text-(--ui-danger-fg)">Failed</span>;
  return <span className="rounded-full bg-(--ui-warning-bg) px-2 py-0.5 text-[10px] font-semibold text-(--ui-warning-fg)">Pending</span>;
}

function truncate(str, len = 50) {
  if (!str) return "";
  return str.length > len ? str.slice(0, len) + "..." : str;
}

export default function AdminEmails() {
  const [emails, setEmails] = useState([]);
  const [counts, setCounts] = useState({ pending: 0, sent: 0, failed: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("");
  const [retrying, setRetrying] = useState(null);
  const [actionInFlight, setActionInFlight] = useState(null);
  const [broadcasts, setBroadcasts] = useState([]);
  const [broadcastsLoading, setBroadcastsLoading] = useState(false);
  const [purgeMsg, setPurgeMsg] = useState("");
  const timerRef = useRef(null);

  // Broadcast form state
  const [showBroadcast, setShowBroadcast] = useState(false);
  const [bcType, setBcType] = useState("downtime");
  const [bcSubject, setBcSubject] = useState("");
  const [bcMessage, setBcMessage] = useState("");
  const [bcSending, setBcSending] = useState(false);
  const [bcResult, setBcResult] = useState(null);

  const fetchQueue = (showLoading) => {
    if (showLoading) setLoading(true);
    const qs = filter ? `?status=${filter}` : "";
    adminFetch(`/api/admin/email-queue${qs}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Failed to load email queue"))))
      .then((data) => {
        setEmails(data.emails || []);
        setCounts(data.counts || { pending: 0, sent: 0, failed: 0 });
        setError("");
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };

  const fetchBroadcasts = () => {
    setBroadcastsLoading(true);
    adminFetch("/api/admin/broadcast-history")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Failed to load broadcasts"))))
      .then((data) => {
        setBroadcasts(data.broadcasts || []);
        setError("");
      })
      .catch((err) => setError(err.message))
      .finally(() => setBroadcastsLoading(false));
  };

  useEffect(() => {
    if (filter === "broadcasts") {
      fetchBroadcasts();
      clearInterval(timerRef.current);
    } else {
      fetchQueue(true);
      timerRef.current = setInterval(() => fetchQueue(false), 30000);
    }
    return () => clearInterval(timerRef.current);
  }, [filter]);

  const retryOne = async (id) => {
    setRetrying(id);
    try {
      const r = await adminFetch(`/api/admin/email-queue/${id}/retry`, { method: "POST" });
      if (!r.ok) throw new Error("Retry failed");
      fetchQueue(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setRetrying(null);
    }
  };

  const deleteOne = async (id) => {
    if (!window.confirm("Delete this email?")) return;
    setActionInFlight(id);
    try {
      const r = await adminFetch(`/api/admin/email-queue/${id}`, { method: "DELETE" });
      if (!r.ok) throw new Error("Delete failed");
      fetchQueue(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setActionInFlight(null);
    }
  };

  const sendNow = async (id) => {
    setActionInFlight(id);
    try {
      const r = await adminFetch(`/api/admin/email-queue/${id}/send-now`, { method: "POST" });
      if (!r.ok) throw new Error("Send now failed");
      fetchQueue(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setActionInFlight(null);
    }
  };

  const purgeDeleted = async () => {
    if (!window.confirm("Purge all queued emails for deleted tenants?")) return;
    setPurgeMsg("");
    try {
      const r = await adminFetch("/api/admin/email-queue/purge-deleted", { method: "DELETE" });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Purge failed");
      setPurgeMsg(`Purged ${data.deleted || 0} email(s)`);
      fetchQueue(false);
      setTimeout(() => setPurgeMsg(""), 5000);
    } catch (err) {
      setError(err.message);
    }
  };

  const sendBroadcast = async () => {
    if (!bcSubject.trim() || !bcMessage.trim()) return;
    setBcSending(true);
    setBcResult(null);
    try {
      const r = await adminFetch("/api/admin/email/broadcast", {
        method: "POST",
        body: JSON.stringify({ type: bcType, subject: bcSubject.trim(), message: bcMessage.trim() }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Broadcast failed");
      setBcResult({ ok: true, enqueued: data.enqueued });
      setBcSubject("");
      setBcMessage("");
      fetchQueue(false);
    } catch (err) {
      setBcResult({ ok: false, error: err.message });
    } finally {
      setBcSending(false);
    }
  };

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-(--ui-text)">Email Queue</h1>
        <div className="flex items-center gap-3">
          <span className="text-[10px] font-medium text-(--ui-text-muted) uppercase tracking-wider">Auto-refresh 30s</span>
          {filter !== "broadcasts" && (
            <button
              onClick={() => {
                const headers = [
                  { key: "id", label: "ID" },
                  { key: "email_type", label: "Type" },
                  { key: "to_email", label: "To" },
                  { key: "subject", label: "Subject" },
                  { key: "attempts", label: "Attempts" },
                  { key: "created_at", label: "Created" },
                ];
                downloadCsv(headers, emails, "admin-emails.csv");
              }}
              className="ui-focus-ring flex items-center gap-1.5 rounded-full bg-(--ui-muted-surface) px-4 py-1.5 text-sm font-semibold text-(--ui-text) transition hover:bg-(--ui-border-strong)"
            >
              <Download size={14} /> Export
            </button>
          )}
          <button
            onClick={() => setShowBroadcast((v) => !v)}
            className="ui-focus-ring flex items-center gap-1.5 rounded-full bg-(--ui-primary) px-4 py-1.5 text-sm font-semibold text-(--ui-on-primary) transition hover:bg-(--ui-primary-strong)"
          >
            <Send size={14} />
            Broadcast
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="mb-4 grid grid-cols-3 gap-3">
        <div className="rounded-(--ui-radius-md) border border-(--ui-border) bg-(--ui-surface) p-4">
          <p className="text-xs font-medium text-(--ui-text-muted) uppercase">Pending</p>
          <p className="mt-1 text-2xl font-bold text-(--ui-warning-fg)">{counts.pending}</p>
        </div>
        <div className="rounded-(--ui-radius-md) border border-(--ui-border) bg-(--ui-surface) p-4">
          <p className="text-xs font-medium text-(--ui-text-muted) uppercase">Sent</p>
          <p className="mt-1 text-2xl font-bold text-(--ui-success-fg)">{counts.sent}</p>
        </div>
        <div className="rounded-(--ui-radius-md) border border-(--ui-border) bg-(--ui-surface) p-4">
          <p className="text-xs font-medium text-(--ui-text-muted) uppercase">Failed</p>
          <p className="mt-1 text-2xl font-bold text-(--ui-danger-fg)">{counts.failed}</p>
        </div>
      </div>

      {/* Broadcast form */}
      {showBroadcast && (
        <div className="mb-4 rounded-(--ui-radius-md) border border-(--ui-border) bg-(--ui-muted-surface) p-4">
          <h2 className="mb-3 text-sm font-semibold text-(--ui-text)">Send Broadcast Email</h2>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-(--ui-text-muted)">Type</label>
              <select
                value={bcType}
                onChange={(e) => setBcType(e.target.value)}
                className="ui-focus-ring w-full rounded-(--ui-radius-sm) border border-(--ui-border-strong) bg-white px-3 py-2 text-sm text-(--ui-text)"
              >
                <option value="downtime">Downtime Notice</option>
                <option value="announcement">Announcement</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-(--ui-text-muted)">Subject</label>
              <input
                type="text"
                value={bcSubject}
                onChange={(e) => setBcSubject(e.target.value)}
                placeholder="e.g. Scheduled Maintenance Tonight"
                className="ui-focus-ring w-full rounded-(--ui-radius-sm) border border-(--ui-border-strong) bg-white px-3 py-2 text-sm text-(--ui-text)"
              />
            </div>
          </div>
          <div className="mt-3">
            <label className="mb-1 block text-xs font-medium text-(--ui-text-muted)">Message (HTML supported)</label>
            <textarea
              value={bcMessage}
              onChange={(e) => setBcMessage(e.target.value)}
              placeholder="<p>We will be performing maintenance from 2am to 3am PKT.</p>"
              rows={3}
              className="ui-focus-ring w-full rounded-(--ui-radius-sm) border border-(--ui-border-strong) bg-white px-3 py-2 text-sm text-(--ui-text)"
            />
          </div>
          <div className="mt-3 flex items-center gap-3">
            <button
              disabled={bcSending || !bcSubject.trim() || !bcMessage.trim()}
              onClick={sendBroadcast}
              className="ui-focus-ring rounded-full bg-(--ui-primary) px-4 py-2 text-sm font-semibold text-(--ui-on-primary) transition hover:bg-(--ui-primary-strong) disabled:opacity-50"
            >
              {bcSending ? "Sending..." : "Send to All Tenants"}
            </button>
            {bcResult && (
              <span className={`text-sm font-medium ${bcResult.ok ? "text-(--ui-success-fg)" : "text-(--ui-danger-fg)"}`}>
                {bcResult.ok ? `Enqueued ${bcResult.enqueued} email(s)` : bcResult.error}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Filter tabs + purge */}
      <div className="mb-3 flex items-center gap-3">
        <div className="flex gap-1">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setFilter(tab.key)}
              className={`ui-focus-ring rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
                filter === tab.key
                  ? "bg-(--ui-primary) text-(--ui-on-primary)"
                  : "bg-(--ui-muted-surface) text-(--ui-text-muted) hover:bg-(--ui-border-strong) hover:text-(--ui-text)"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <button
          onClick={purgeDeleted}
          className="ui-focus-ring ml-auto flex items-center gap-1 rounded-full bg-(--ui-danger-bg) px-3.5 py-1.5 text-xs font-semibold text-(--ui-danger-fg) transition hover:opacity-80"
        >
          <Trash2 size={12} />
          Purge Deleted Tenants
        </button>
        {purgeMsg && <span className="text-xs font-medium text-(--ui-success-fg)">{purgeMsg}</span>}
      </div>

      {error && (
        <div className="mb-3 rounded-(--ui-radius-md) border border-(--ui-danger-bg) bg-(--ui-danger-bg) p-3">
          <p className="text-sm text-(--ui-danger-fg)">{error}</p>
        </div>
      )}

      {filter === "broadcasts" ? (
        /* ── Broadcasts tab ── */
        broadcastsLoading ? (
          <p className="text-sm text-(--ui-text-muted)">Loading...</p>
        ) : broadcasts.length === 0 ? (
          <div className="rounded-(--ui-radius-md) border border-(--ui-border) bg-(--ui-surface) p-8 text-center">
            <p className="text-sm font-medium text-(--ui-text-muted)">No broadcasts yet</p>
          </div>
        ) : (
          <div className="rounded-(--ui-radius-md) border border-(--ui-border) bg-(--ui-surface)">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-(--ui-border) bg-(--ui-muted-surface) text-left text-xs text-(--ui-text-muted)">
                    <th className="px-4 py-3 font-medium">Time</th>
                    <th className="px-4 py-3 font-medium">Admin</th>
                    <th className="px-4 py-3 font-medium">Type</th>
                    <th className="px-4 py-3 font-medium">Subject</th>
                    <th className="px-4 py-3 font-medium text-right">Recipients</th>
                  </tr>
                </thead>
                <tbody>
                  {broadcasts.map((b, i) => (
                    <tr key={b.id || i} className="border-b border-(--ui-border) last:border-0">
                      <td className="px-4 py-3 text-xs text-(--ui-text-muted) whitespace-nowrap">
                        {new Date(b.created_at).toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-xs text-(--ui-text)">{b.admin_name || b.admin_email || "—"}</td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${TYPE_COLORS[b.type] || "bg-(--ui-muted-surface) text-(--ui-text-muted)"}`}>
                          {b.type}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-(--ui-text)">{b.subject}</td>
                      <td className="px-4 py-3 text-right text-xs text-(--ui-text-muted)">{b.recipient_count ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      ) : loading ? (
        <p className="text-sm text-(--ui-text-muted)">Loading...</p>
      ) : emails.length === 0 ? (
        <div className="rounded-(--ui-radius-md) border border-(--ui-border) bg-(--ui-surface) p-8 text-center">
          <p className="text-sm font-medium text-(--ui-text-muted)">
            {filter ? `No ${filter} emails` : "Email queue is empty"}
          </p>
        </div>
      ) : (
        <div className="rounded-(--ui-radius-md) border border-(--ui-border) bg-(--ui-surface)">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-(--ui-border) bg-(--ui-muted-surface) text-left text-xs text-(--ui-text-muted)">
                  <th className="px-4 py-3 font-medium">ID</th>
                  <th className="px-4 py-3 font-medium">Type</th>
                  <th className="px-4 py-3 font-medium">Tenant</th>
                  <th className="px-4 py-3 font-medium">To</th>
                  <th className="px-4 py-3 font-medium">Subject</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium text-right">Attempts</th>
                  <th className="px-4 py-3 font-medium">Time</th>
                  <th className="px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {emails.map((e) => {
                  const isPending = !e.sent_at && e.attempts < e.max_attempts;
                  const isFailed = !e.sent_at && e.attempts >= e.max_attempts;
                  const busy = actionInFlight === e.id || retrying === e.id;
                  return (
                    <tr key={e.id} className="border-b border-(--ui-border) last:border-0">
                      <td className="px-4 py-3 text-xs text-(--ui-text-muted)">#{e.id}</td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${TYPE_COLORS[e.email_type] || "bg-(--ui-muted-surface) text-(--ui-text-muted)"}`}>
                          {e.email_type}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {e.tenant_name ? (
                          <>
                            <span className="font-medium text-(--ui-text)">{e.tenant_name}</span>
                            <span className="ml-1 text-xs text-(--ui-text-muted)">({e.tenant_slug})</span>
                          </>
                        ) : (
                          <span className="text-xs text-(--ui-text-muted)">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-(--ui-text)">{e.to_email}</td>
                      <td className="px-4 py-3 max-w-xs">
                        <span className="text-xs text-(--ui-text)">{truncate(e.subject, 40)}</span>
                      </td>
                      <td className="px-4 py-3">{statusBadge(e)}</td>
                      <td className="px-4 py-3 text-right text-xs text-(--ui-text-muted)">
                        {e.attempts}/{e.max_attempts}
                      </td>
                      <td className="px-4 py-3 text-xs text-(--ui-text-muted) whitespace-nowrap">
                        {e.sent_at
                          ? new Date(e.sent_at).toLocaleString()
                          : e.send_at
                            ? new Date(e.send_at).toLocaleString()
                            : new Date(e.created_at).toLocaleString()}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          {isPending && (
                            <button
                              disabled={busy}
                              onClick={() => sendNow(e.id)}
                              title="Send now"
                              className="ui-focus-ring rounded-full p-1.5 text-(--ui-text-muted) transition hover:bg-(--ui-muted-surface) hover:text-(--ui-text) disabled:opacity-50"
                            >
                              <Send size={14} />
                            </button>
                          )}
                          {isFailed && (
                            <button
                              disabled={busy}
                              onClick={() => retryOne(e.id)}
                              title="Retry"
                              className="ui-focus-ring rounded-full p-1.5 text-(--ui-text-muted) transition hover:bg-(--ui-muted-surface) hover:text-(--ui-text) disabled:opacity-50"
                            >
                              <RotateCcw size={14} />
                            </button>
                          )}
                          {(isPending || isFailed) && (
                            <button
                              disabled={busy}
                              onClick={() => deleteOne(e.id)}
                              title="Delete"
                              className="ui-focus-ring rounded-full p-1.5 text-(--ui-text-muted) transition hover:bg-(--ui-danger-bg) hover:text-(--ui-danger-fg) disabled:opacity-50"
                            >
                              <Trash2 size={14} />
                            </button>
                          )}
                          {e.error && (
                            <span className="ml-1 text-[10px] text-(--ui-danger-fg)" title={e.error}>
                              {truncate(e.error, 30)}
                            </span>
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
