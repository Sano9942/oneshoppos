import { useEffect, useState, useRef, useCallback } from "react";
import { Download } from "lucide-react";
import { adminFetch } from "./AdminLogin";
import { downloadCsv } from "../../utils/csvExport";

const TABS = [
  { key: "admin", label: "Admin Actions" },
  { key: "tenant", label: "Tenant Activity" },
  { key: "security", label: "Security" },
];

const ACTION_TYPES = [
  "", "tenant_created", "tenant_updated", "tenant_suspended", "tenant_activated",
  "tenant_deleted", "pin_reset", "tenant_migrated", "migrate_all",
  "payment_recorded", "pricing_updated", "impersonation_started", "impersonation_ended",
  "broadcast_sent", "note_added", "announcement_created", "announcement_deleted",
  "email_deleted", "email_force_sent", "email_purge_deleted",
  "ticket_replied", "ticket_deleted", "backup_created", "orphaned_schemas_cleanup",
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
        setData(res.rows || res.logs || res.events || res || []);
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
        <h1 className="text-2xl font-bold text-slate-800">Activity Log</h1>
        <div className="flex items-center gap-3">
          <span className="text-[10px] font-medium text-slate-400 uppercase tracking-wider">Auto-refresh 30s</span>
          <button
            onClick={exportCsv}
            disabled={!data.length}
            className="flex items-center gap-1.5 rounded-lg bg-slate-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            <Download size={14} />
            CSV
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="mb-3 flex gap-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
              tab === t.key
                ? "bg-slate-800 text-white"
                : "bg-slate-100 text-slate-500 hover:bg-slate-200"
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
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
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
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
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
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}

      {/* Content */}
      {loading ? (
        <p className="text-sm text-slate-400">Loading...</p>
      ) : data.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <p className="text-sm font-medium text-slate-400">No records found</p>
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            {tab === "admin" && (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
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
                    <tr key={r.id || i} className="border-b border-slate-50 last:border-0">
                      <td className="px-4 py-3 text-xs text-slate-400 whitespace-nowrap">
                        {r.created_at ? new Date(r.created_at).toLocaleString() : ""}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600">{r.admin_email || r.admin_name || ""}</td>
                      <td className="px-4 py-3">
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                          {r.action}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600">{r.target_type || ""}</td>
                      <td className="px-4 py-3 text-xs text-slate-500">{r.target_id || ""}</td>
                      <td className="px-4 py-3 text-xs text-slate-400 max-w-xs" title={r.details ? JSON.stringify(r.details) : ""}>
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
                  <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
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
                    <tr key={r.id || i} className="border-b border-slate-50 last:border-0">
                      <td className="px-4 py-3 text-xs text-slate-400 whitespace-nowrap">
                        {r.created_at ? new Date(r.created_at).toLocaleString() : ""}
                      </td>
                      <td className="px-4 py-3">
                        {r.tenant_name ? (
                          <>
                            <span className="font-medium text-slate-700">{r.tenant_name}</span>
                            <span className="ml-1 text-xs text-slate-400">({r.tenant_slug})</span>
                          </>
                        ) : (
                          <span className="text-xs text-slate-400">{r.tenant_slug || ""}</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-semibold text-blue-700">
                          {r.action}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600">{r.entity_type || ""}</td>
                      <td className="px-4 py-3 text-xs text-slate-500">{r.entity_id || ""}</td>
                      <td className="px-4 py-3 text-xs text-slate-600">{r.performed_by || ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {tab === "security" && (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
                    <th className="px-4 py-3 font-medium">Time</th>
                    <th className="px-4 py-3 font-medium">Event</th>
                    <th className="px-4 py-3 font-medium">Email</th>
                    <th className="px-4 py-3 font-medium">IP Address</th>
                    <th className="px-4 py-3 font-medium">User Agent</th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((r, i) => (
                    <tr key={r.id || i} className="border-b border-slate-50 last:border-0">
                      <td className="px-4 py-3 text-xs text-slate-400 whitespace-nowrap">
                        {r.created_at ? new Date(r.created_at).toLocaleString() : ""}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          r.event_type === "login_success"
                            ? "bg-emerald-100 text-emerald-700"
                            : r.event_type === "login_failed"
                              ? "bg-red-100 text-red-700"
                              : "bg-slate-100 text-slate-600"
                        }`}>
                          {(r.event_type || "").replace(/_/g, " ")}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600">{r.email || ""}</td>
                      <td className="px-4 py-3 text-xs text-slate-500 font-mono">{r.ip_address || ""}</td>
                      <td className="px-4 py-3 text-xs text-slate-400 max-w-xs" title={r.user_agent || ""}>
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
            className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-200 disabled:opacity-40"
          >
            Previous
          </button>
          <span className="text-xs text-slate-400">Page {page}</span>
          <button
            disabled={data.length < LIMIT}
            onClick={() => setOffset((o) => o + LIMIT)}
            className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-200 disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
