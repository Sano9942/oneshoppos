import { useEffect, useState, useRef, useCallback } from "react";
import { Download, ShieldAlert } from "lucide-react";
import { adminFetch } from "./AdminLogin";
import { downloadCsv } from "../../utils/csvExport";

const TABS = [
  { key: "admin", label: "Admin Actions" },
  { key: "tenant", label: "Tenant Activity" },
  { key: "security", label: "Security" },
];

const ACTION_TYPES = [
  "", "tenant_created", "tenant_updated", "tenant_suspended", "tenant_activated",
  "tenant_deleted", "pin_reset", "tenant_migrated", "migrate_all", "setup_token_regenerated",
  "payment_recorded", "pricing_updated", "impersonation_started", "impersonation_ended",
  "broadcast_sent", "note_added", "note_deleted", "announcement_created", "announcement_updated", "announcement_deleted",
  "email_deleted", "email_force_sent", "email_purge_deleted", "email_queue_retried",
  "ticket_replied", "ticket_status_updated", "ticket_deleted", "dead_letter_retried",
  "tax_rate_created", "tax_rate_updated", "tax_rate_deleted", "tax_suggestion_reviewed",
  "backup_created", "backup_verified", "cleanup_run", "orphaned_schemas_cleanup",
];

const SECURITY_TYPES = ["", "login_success", "login_failed"];

const LIMIT = 50;

function truncate(str, len = 80) {
  if (!str) return "";
  return str.length > len ? str.slice(0, len) + "..." : str;
}

function formatDetails(details) {
  if (!details) return "";
  try {
    const obj = typeof details === "string" ? JSON.parse(details) : details;
    return truncate(JSON.stringify(obj), 80);
  } catch {
    return truncate(String(details), 80);
  }
}

// Active impersonation sessions + revoke, plus recent history. Revoke calls the
// existing POST /api/admin/impersonate/:sessionId/end route (blacklists the
// token's jti in the tenant's revoked_tokens + marks the session ended).
function ImpersonationCard() {
  const [active, setActive] = useState([]);
  const [history, setHistory] = useState([]);
  const [showHistory, setShowHistory] = useState(false);
  const [busy, setBusy] = useState(null);
  const timerRef = useRef(null);

  const loadActive = useCallback(() => {
    adminFetch("/api/admin/impersonation-sessions?active=1")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("load failed"))))
      .then((res) => setActive(res.sessions || []))
      .catch(() => {});
  }, []);

  const loadHistory = useCallback(() => {
    adminFetch("/api/admin/impersonation-sessions?limit=20")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("load failed"))))
      .then((res) => setHistory(res.sessions || []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadActive();
    timerRef.current = setInterval(loadActive, 30000);
    return () => clearInterval(timerRef.current);
  }, [loadActive]);

  const revoke = async (id) => {
    setBusy(id);
    try {
      const r = await adminFetch(`/api/admin/impersonate/${id}/end`, { method: "POST" });
      if (r.ok) { loadActive(); if (showHistory) loadHistory(); }
    } finally { setBusy(null); }
  };

  const toggleHistory = () => {
    const next = !showHistory;
    setShowHistory(next);
    if (next) loadHistory();
  };

  return (
    <div className="mb-4 rounded-(--ui-radius-md) border border-(--ui-border) bg-(--ui-surface) p-5">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldAlert size={16} className="text-(--ui-text-muted)" />
          <h2 className="text-sm font-semibold text-(--ui-text)">Impersonation sessions</h2>
          {active.length > 0 && (
            <span className="rounded-full bg-(--ui-warning-bg) px-2 py-0.5 text-[10px] font-semibold text-(--ui-warning-fg)">
              {active.length} active
            </span>
          )}
        </div>
        <button onClick={toggleHistory} className="ui-focus-ring text-xs font-medium text-(--ui-link) hover:underline">
          {showHistory ? "Hide history" : "Recent history"}
        </button>
      </div>

      {active.length === 0 ? (
        <p className="text-sm text-(--ui-text-muted)">No active impersonation sessions.</p>
      ) : (
        <div className="space-y-2">
          {active.map((s) => (
            <div key={s.id} className="flex items-center justify-between rounded-(--ui-radius-sm) border border-(--ui-warning-fg) bg-(--ui-warning-bg) px-3 py-2">
              <div className="text-sm">
                <span className="font-medium text-(--ui-text)">{s.tenant_name || s.tenant_slug}</span>
                <span className="ml-1 text-xs text-(--ui-text-muted)">({s.tenant_slug})</span>
                <span className="ml-2 text-xs text-(--ui-text-muted)">by {s.admin_email || s.admin_name || `admin #${s.super_admin_id}`}</span>
                <span className="ml-2 text-xs text-(--ui-text-muted)">· started {s.started_at ? new Date(s.started_at).toLocaleString() : ""}</span>
              </div>
              <button
                onClick={() => revoke(s.id)}
                disabled={busy === s.id}
                className="ui-focus-ring rounded-full bg-(--ui-danger) px-3 py-1 text-xs font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
              >
                {busy === s.id ? "Revoking..." : "Revoke"}
              </button>
            </div>
          ))}
        </div>
      )}

      {showHistory && (
        <div className="mt-4 border-t border-(--ui-border) pt-3">
          {history.length === 0 ? (
            <p className="text-xs text-(--ui-text-muted)">No impersonation history.</p>
          ) : (
            <div className="space-y-1.5">
              {history.map((s) => (
                <div key={s.id} className="flex items-center justify-between text-xs">
                  <div className="text-(--ui-text-muted)">
                    <span className="font-medium text-(--ui-text)">{s.tenant_name || s.tenant_slug}</span>
                    <span className="ml-1">by {s.admin_email || `#${s.super_admin_id}`}</span>
                    <span className="ml-2">{s.started_at ? new Date(s.started_at).toLocaleString() : ""}</span>
                  </div>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                    s.is_active
                      ? "bg-(--ui-warning-bg) text-(--ui-warning-fg)"
                      : s.revoked_at
                        ? "bg-(--ui-danger-bg) text-(--ui-danger-fg)"
                        : "bg-(--ui-muted-surface) text-(--ui-text-muted)"
                  }`}>
                    {s.is_active ? "active" : s.revoked_at ? "revoked" : "ended"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function AdminActivity() {
  const [tab, setTab] = useState("admin");
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [offset, setOffset] = useState(0);
  const [filter, setFilter] = useState("");
  const timerRef = useRef(null);

  const fetchData = useCallback((showLoading) => {
    if (showLoading) setLoading(true);
    let url;
    if (tab === "admin") {
      const qs = new URLSearchParams({ limit: LIMIT, offset });
      if (filter) qs.set("action", filter);
      url = `/api/admin/activity-log?${qs}`;
    } else if (tab === "tenant") {
      url = `/api/admin/tenant-activity?limit=${LIMIT}`;
    } else {
      const qs = new URLSearchParams({ limit: LIMIT, offset });
      if (filter) qs.set("event_type", filter);
      url = `/api/admin/security-log?${qs}`;
    }
    adminFetch(url)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Failed to load"))))
      .then((res) => {
        setData(res.entries || res.rows || res.logs || res.events || []);
        setError("");
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [tab, offset, filter]);

  useEffect(() => {
    fetchData(true);
    timerRef.current = setInterval(() => fetchData(false), 30000);
    return () => clearInterval(timerRef.current);
  }, [fetchData]);

  // Reset offset and filter on tab change
  useEffect(() => {
    setOffset(0);
    setFilter("");
  }, [tab]);

  const page = Math.floor(offset / LIMIT) + 1;

  const exportCsv = () => {
    if (!data.length) return;
    if (tab === "admin") {
      downloadCsv(
        ["Time", "Admin", "Action", "Target Type", "Target ID", "Details"],
        data.map((r) => [
          r.created_at ? new Date(r.created_at).toLocaleString() : "",
          r.admin_email || r.admin_name || "",
          r.action || "",
          r.target_type || "",
          r.target_id || "",
          formatDetails(r.details),
        ]),
        "admin_actions",
      );
    } else if (tab === "tenant") {
      downloadCsv(
        ["Time", "Tenant", "Action", "Entity Type", "Entity ID", "Performed By"],
        data.map((r) => [
          r.created_at ? new Date(r.created_at).toLocaleString() : "",
          r.tenant_name ? `${r.tenant_name} (${r.tenant_slug})` : r.tenant_slug || "",
          r.action || "",
          r.entity_type || "",
          r.entity_id || "",
          r.performed_by || "",
        ]),
        "tenant_activity",
      );
    } else {
      downloadCsv(
        ["Time", "Event", "Email", "IP Address", "User Agent"],
        data.map((r) => [
          r.created_at ? new Date(r.created_at).toLocaleString() : "",
          r.event_type || "",
          r.email || "",
          r.ip_address || "",
          r.user_agent || "",
        ]),
        "security_log",
      );
    }
  };

  return (
    <div>
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-(--ui-text)">Activity Log</h1>
        <div className="flex items-center gap-3">
          <span className="text-[10px] font-medium text-(--ui-text-muted) uppercase tracking-wider">Auto-refresh 30s</span>
          <button
            onClick={exportCsv}
            disabled={!data.length}
            className="ui-focus-ring flex items-center gap-1.5 rounded-full bg-(--ui-muted-surface) px-4 py-1.5 text-sm font-semibold text-(--ui-text) transition hover:bg-(--ui-border-strong) disabled:opacity-50"
          >
            <Download size={14} />
            CSV
          </button>
        </div>
      </div>

      {/* Impersonation sessions — active + revoke + recent history */}
      <ImpersonationCard />

      {/* Tabs */}
      <div className="mb-3 flex gap-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`ui-focus-ring rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
              tab === t.key
                ? "bg-(--ui-primary) text-(--ui-on-primary)"
                : "bg-(--ui-muted-surface) text-(--ui-text-muted) hover:bg-(--ui-border-strong) hover:text-(--ui-text)"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Filter — admin and security tabs only */}
      {tab === "admin" && (
        <div className="mb-3">
          <select
            value={filter}
            onChange={(e) => { setFilter(e.target.value); setOffset(0); }}
            className="ui-focus-ring rounded-(--ui-radius-sm) border border-(--ui-border-strong) bg-white px-3 py-1.5 text-sm text-(--ui-text)"
          >
            <option value="">All actions</option>
            {ACTION_TYPES.filter(Boolean).map((a) => (
              <option key={a} value={a}>{a.replace(/_/g, " ")}</option>
            ))}
          </select>
        </div>
      )}
      {tab === "security" && (
        <div className="mb-3">
          <select
            value={filter}
            onChange={(e) => { setFilter(e.target.value); setOffset(0); }}
            className="ui-focus-ring rounded-(--ui-radius-sm) border border-(--ui-border-strong) bg-white px-3 py-1.5 text-sm text-(--ui-text)"
          >
            <option value="">All events</option>
            {SECURITY_TYPES.filter(Boolean).map((s) => (
              <option key={s} value={s}>{s.replace(/_/g, " ")}</option>
            ))}
          </select>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mb-3 rounded-(--ui-radius-md) border border-(--ui-danger-bg) bg-(--ui-danger-bg) p-3">
          <p className="text-sm text-(--ui-danger-fg)">{error}</p>
        </div>
      )}

      {/* Content */}
      {loading ? (
        <p className="text-sm text-(--ui-text-muted)">Loading...</p>
      ) : data.length === 0 ? (
        <div className="rounded-(--ui-radius-md) border border-(--ui-border) bg-(--ui-surface) p-8 text-center">
          <p className="text-sm font-medium text-(--ui-text-muted)">No records found</p>
        </div>
      ) : (
        <div className="rounded-(--ui-radius-md) border border-(--ui-border) bg-(--ui-surface)">
          <div className="overflow-x-auto">
            {tab === "admin" && (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-(--ui-border) bg-(--ui-muted-surface) text-left text-xs text-(--ui-text-muted)">
                    <th className="px-4 py-3 font-medium">Time</th>
                    <th className="px-4 py-3 font-medium">Admin</th>
                    <th className="px-4 py-3 font-medium">Action</th>
                    <th className="px-4 py-3 font-medium">Target Type</th>
                    <th className="px-4 py-3 font-medium">Target ID</th>
                    <th className="px-4 py-3 font-medium">Details</th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((r, i) => (
                    <tr key={r.id || i} className="border-b border-(--ui-border) last:border-0">
                      <td className="px-4 py-3 text-xs text-(--ui-text-muted) whitespace-nowrap">
                        {r.created_at ? new Date(r.created_at).toLocaleString() : ""}
                      </td>
                      <td className="px-4 py-3 text-xs text-(--ui-text)">{r.admin_email || r.admin_name || ""}</td>
                      <td className="px-4 py-3">
                        <span className="rounded-full bg-(--ui-muted-surface) px-2 py-0.5 text-[10px] font-semibold text-(--ui-text-muted)">
                          {r.action}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-(--ui-text)">{r.target_type || ""}</td>
                      <td className="px-4 py-3 text-xs text-(--ui-text-muted)">{r.target_id || ""}</td>
                      <td className="px-4 py-3 text-xs text-(--ui-text-muted) max-w-xs" title={r.details ? JSON.stringify(r.details) : ""}>
                        {formatDetails(r.details)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {tab === "tenant" && (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-(--ui-border) bg-(--ui-muted-surface) text-left text-xs text-(--ui-text-muted)">
                    <th className="px-4 py-3 font-medium">Time</th>
                    <th className="px-4 py-3 font-medium">Tenant</th>
                    <th className="px-4 py-3 font-medium">Action</th>
                    <th className="px-4 py-3 font-medium">Entity Type</th>
                    <th className="px-4 py-3 font-medium">Entity ID</th>
                    <th className="px-4 py-3 font-medium">Performed By</th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((r, i) => (
                    <tr key={r.id || i} className="border-b border-(--ui-border) last:border-0">
                      <td className="px-4 py-3 text-xs text-(--ui-text-muted) whitespace-nowrap">
                        {r.created_at ? new Date(r.created_at).toLocaleString() : ""}
                      </td>
                      <td className="px-4 py-3">
                        {r.tenant_name ? (
                          <>
                            <span className="font-medium text-(--ui-text)">{r.tenant_name}</span>
                            <span className="ml-1 text-xs text-(--ui-text-muted)">({r.tenant_slug})</span>
                          </>
                        ) : (
                          <span className="text-xs text-(--ui-text-muted)">{r.tenant_slug || ""}</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className="rounded-full bg-(--ui-muted-surface) px-2 py-0.5 text-[10px] font-semibold text-(--ui-text)">
                          {r.action}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-(--ui-text)">{r.entity_type || ""}</td>
                      <td className="px-4 py-3 text-xs text-(--ui-text-muted)">{r.entity_id || ""}</td>
                      <td className="px-4 py-3 text-xs text-(--ui-text)">{r.performed_by || ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {tab === "security" && (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-(--ui-border) bg-(--ui-muted-surface) text-left text-xs text-(--ui-text-muted)">
                    <th className="px-4 py-3 font-medium">Time</th>
                    <th className="px-4 py-3 font-medium">Event</th>
                    <th className="px-4 py-3 font-medium">Email</th>
                    <th className="px-4 py-3 font-medium">IP Address</th>
                    <th className="px-4 py-3 font-medium">User Agent</th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((r, i) => (
                    <tr key={r.id || i} className="border-b border-(--ui-border) last:border-0">
                      <td className="px-4 py-3 text-xs text-(--ui-text-muted) whitespace-nowrap">
                        {r.created_at ? new Date(r.created_at).toLocaleString() : ""}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          r.event_type === "login_success"
                            ? "bg-(--ui-success-bg) text-(--ui-success-fg)"
                            : r.event_type === "login_failed"
                              ? "bg-(--ui-danger-bg) text-(--ui-danger-fg)"
                              : "bg-(--ui-muted-surface) text-(--ui-text-muted)"
                        }`}>
                          {(r.event_type || "").replace(/_/g, " ")}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-(--ui-text)">{r.email || ""}</td>
                      <td className="px-4 py-3 text-xs text-(--ui-text-muted) font-mono">{r.ip_address || ""}</td>
                      <td className="px-4 py-3 text-xs text-(--ui-text-muted) max-w-xs" title={r.user_agent || ""}>
                        {truncate(r.user_agent, 60)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* Pagination — admin and security tabs */}
      {(tab === "admin" || tab === "security") && !loading && data.length > 0 && (
        <div className="mt-3 flex items-center justify-between">
          <button
            disabled={offset === 0}
            onClick={() => setOffset((o) => Math.max(0, o - LIMIT))}
            className="ui-focus-ring rounded-full bg-(--ui-muted-surface) px-4 py-1.5 text-xs font-semibold text-(--ui-text) transition hover:bg-(--ui-border-strong) disabled:opacity-40"
          >
            Previous
          </button>
          <span className="text-xs text-(--ui-text-muted)">Page {page}</span>
          <button
            disabled={data.length < LIMIT}
            onClick={() => setOffset((o) => o + LIMIT)}
            className="ui-focus-ring rounded-full bg-(--ui-muted-surface) px-4 py-1.5 text-xs font-semibold text-(--ui-text) transition hover:bg-(--ui-border-strong) disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
