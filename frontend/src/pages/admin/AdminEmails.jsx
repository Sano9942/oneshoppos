import { useEffect, useState, useRef } from "react";
import { Send, Trash2, RotateCcw } from "lucide-react";
import { adminFetch } from "./AdminLogin";

const STATUS_TABS = [
  { key: "", label: "All" },
  { key: "pending", label: "Pending" },
  { key: "sent", label: "Sent" },
  { key: "failed", label: "Failed" },
  { key: "broadcasts", label: "Broadcasts" },
];

const TYPE_COLORS = {
  receipt: "bg-blue-100 text-blue-700",
  digest: "bg-blue-100 text-blue-700",
  drip_getting_started: "bg-violet-100 text-violet-700",
  drip_features: "bg-violet-100 text-violet-700",
  billing_payment_recorded: "bg-emerald-100 text-emerald-700",
  billing_plan_changed: "bg-emerald-100 text-emerald-700",
  billing_expiry_warning: "bg-amber-100 text-amber-700",
  billing_overdue: "bg-red-100 text-red-700",
  support_received: "bg-sky-100 text-sky-700",
  support_resolved: "bg-sky-100 text-sky-700",
  downtime: "bg-orange-100 text-orange-700",
  announcement: "bg-indigo-100 text-indigo-700",
};

function statusBadge(email) {
  if (email.sent_at) return <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">Sent</span>;
  if (email.attempts >= email.max_attempts) return <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-700">Failed</span>;
  return <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">Pending</span>;
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
        <h1 className="text-2xl font-bold text-slate-800">Email Queue</h1>
        <div className="flex items-center gap-3">
          <span className="text-[10px] font-medium text-slate-400 uppercase tracking-wider">Auto-refresh 30s</span>
          <button
            onClick={() => setShowBroadcast((v) => !v)}
            className="flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-700"
          >
            <Send size={14} />
            Broadcast
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="mb-4 grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium text-slate-400 uppercase">Pending</p>
          <p className="mt-1 text-2xl font-bold text-amber-600">{counts.pending}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium text-slate-400 uppercase">Sent</p>
          <p className="mt-1 text-2xl font-bold text-emerald-600">{counts.sent}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium text-slate-400 uppercase">Failed</p>
          <p className="mt-1 text-2xl font-bold text-red-600">{counts.failed}</p>
        </div>
      </div>

      {/* Broadcast form */}
      {showBroadcast && (
        <div className="mb-4 rounded-xl border border-violet-200 bg-violet-50 p-4 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold text-violet-800">Send Broadcast Email</h2>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Type</label>
              <select
                value={bcType}
                onChange={(e) => setBcType(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="downtime">Downtime Notice</option>
                <option value="announcement">Announcement</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Subject</label>
              <input
                type="text"
                value={bcSubject}
                onChange={(e) => setBcSubject(e.target.value)}
                placeholder="e.g. Scheduled Maintenance Tonight"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
          </div>
          <div className="mt-3">
            <label className="mb-1 block text-xs font-medium text-slate-600">Message (HTML supported)</label>
            <textarea
              value={bcMessage}
              onChange={(e) => setBcMessage(e.target.value)}
              placeholder="<p>We will be performing maintenance from 2am to 3am PKT.</p>"
              rows={3}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div className="mt-3 flex items-center gap-3">
            <button
              disabled={bcSending || !bcSubject.trim() || !bcMessage.trim()}
              onClick={sendBroadcast}
              className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
            >
              {bcSending ? "Sending..." : "Send to All Tenants"}
            </button>
            {bcResult && (
              <span className={`text-sm font-medium ${bcResult.ok ? "text-emerald-600" : "text-red-600"}`}>
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
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                filter === tab.key
                  ? "bg-slate-800 text-white"
                  : "bg-slate-100 text-slate-500 hover:bg-slate-200"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <button
          onClick={purgeDeleted}
          className="ml-auto flex items-center gap-1 rounded-lg bg-red-50 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-100"
        >
          <Trash2 size={12} />
          Purge Deleted Tenants
        </button>
        {purgeMsg && <span className="text-xs font-medium text-emerald-600">{purgeMsg}</span>}
      </div>

      {error && (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}

      {filter === "broadcasts" ? (
        /* ── Broadcasts tab ── */
        broadcastsLoading ? (
          <p className="text-sm text-slate-400">Loading...</p>
        ) : broadcasts.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
            <p className="text-sm font-medium text-slate-400">No broadcasts yet</p>
          </div>
        ) : (
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
                    <th className="px-4 py-3 font-medium">Time</th>
                    <th className="px-4 py-3 font-medium">Admin</th>
                    <th className="px-4 py-3 font-medium">Type</th>
                    <th className="px-4 py-3 font-medium">Subject</th>
                    <th className="px-4 py-3 font-medium text-right">Recipients</th>
                  </tr>
                </thead>
                <tbody>
                  {broadcasts.map((b, i) => (
                    <tr key={b.id || i} className="border-b border-slate-50 last:border-0">
                      <td className="px-4 py-3 text-xs text-slate-400 whitespace-nowrap">
                        {new Date(b.created_at).toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600">{b.admin_name || b.admin_email || "—"}</td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${TYPE_COLORS[b.type] || "bg-slate-100 text-slate-600"}`}>
                          {b.type}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600">{b.subject}</td>
                      <td className="px-4 py-3 text-right text-xs text-slate-500">{b.recipient_count ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      ) : loading ? (
        <p className="text-sm text-slate-400">Loading...</p>
      ) : emails.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <p className="text-sm font-medium text-slate-400">
            {filter ? `No ${filter} emails` : "Email queue is empty"}
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
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
                    <tr key={e.id} className="border-b border-slate-50 last:border-0">
                      <td className="px-4 py-3 text-xs text-slate-400">#{e.id}</td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${TYPE_COLORS[e.email_type] || "bg-slate-100 text-slate-600"}`}>
                          {e.email_type}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {e.tenant_name ? (
                          <>
                            <span className="font-medium text-slate-700">{e.tenant_name}</span>
                            <span className="ml-1 text-xs text-slate-400">({e.tenant_slug})</span>
                          </>
                        ) : (
                          <span className="text-xs text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600">{e.to_email}</td>
                      <td className="px-4 py-3 max-w-xs">
                        <span className="text-xs text-slate-600">{truncate(e.subject, 40)}</span>
                      </td>
                      <td className="px-4 py-3">{statusBadge(e)}</td>
                      <td className="px-4 py-3 text-right text-xs text-slate-500">
                        {e.attempts}/{e.max_attempts}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-400 whitespace-nowrap">
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
                              className="rounded p-1 text-blue-600 hover:bg-blue-50 disabled:opacity-50"
                            >
                              <Send size={14} />
                            </button>
                          )}
                          {isFailed && (
                            <button
                              disabled={busy}
                              onClick={() => retryOne(e.id)}
                              title="Retry"
                              className="rounded p-1 text-violet-600 hover:bg-violet-50 disabled:opacity-50"
                            >
                              <RotateCcw size={14} />
                            </button>
                          )}
                          {(isPending || isFailed) && (
                            <button
                              disabled={busy}
                              onClick={() => deleteOne(e.id)}
                              title="Delete"
                              className="rounded p-1 text-red-500 hover:bg-red-50 disabled:opacity-50"
                            >
                              <Trash2 size={14} />
                            </button>
                          )}
                          {e.error && (
                            <span className="ml-1 text-[10px] text-red-500" title={e.error}>
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
