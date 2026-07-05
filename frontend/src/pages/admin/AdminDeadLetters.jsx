import { useEffect, useState, useRef } from "react";
import { adminFetch } from "./AdminLogin";

export default function AdminDeadLetters() {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retrying, setRetrying] = useState(null);
  const [retryingAll, setRetryingAll] = useState(false);
  const timerRef = useRef(null);

  const fetchEvents = (showLoading) => {
    if (showLoading) setLoading(true);
    adminFetch("/api/admin/dead-letters")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Failed to load dead letters"))))
      .then((data) => { setEvents(data.events || []); setError(""); })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchEvents(true);
    timerRef.current = setInterval(() => fetchEvents(false), 30000);
    return () => clearInterval(timerRef.current);
  }, []);

  const retryOne = async (tenantId, eventId) => {
    setRetrying(eventId);
    try {
      const r = await adminFetch(`/api/admin/dead-letters/${tenantId}/${eventId}/retry`, { method: "POST" });
      if (!r.ok) throw new Error("Retry failed");
      setEvents((prev) => prev.filter((e) => !(e.id === eventId && e.tenant_id === tenantId)));
    } catch (err) {
      setError(err.message);
    } finally {
      setRetrying(null);
    }
  };

  const retryAll = async () => {
    setRetryingAll(true);
    try {
      for (const e of events) {
        await adminFetch(`/api/admin/dead-letters/${e.tenant_id}/${e.id}/retry`, { method: "POST" });
      }
      setEvents([]);
    } catch (err) {
      setError(err.message);
      fetchEvents(false);
    } finally {
      setRetryingAll(false);
    }
  };

  if (error && events.length === 0 && !loading) {
    return (
      <div className="rounded-(--ui-radius-md) border border-(--ui-danger-bg) bg-(--ui-danger-bg) p-4">
        <p className="text-sm text-(--ui-danger-fg)">{error}</p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-(--ui-text)">Dead Letter Queue</h1>
        <div className="flex items-center gap-3">
          <span className="text-[10px] font-medium text-(--ui-text-muted) uppercase tracking-wider">Auto-refresh 30s</span>
          {events.length > 0 && (
            <button
              disabled={retryingAll}
              onClick={retryAll}
              className="ui-focus-ring rounded-full bg-(--ui-primary) px-4 py-1.5 text-sm font-semibold text-(--ui-on-primary) transition hover:bg-(--ui-primary-strong) disabled:opacity-50"
            >
              {retryingAll ? "Retrying..." : `Retry All (${events.length})`}
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-(--ui-text-muted)">Loading...</p>
      ) : events.length === 0 ? (
        <div className="rounded-(--ui-radius-md) border border-(--ui-border) bg-(--ui-surface) p-8 text-center">
          <p className="text-sm font-medium text-(--ui-success-fg)">No dead letters — all webhooks processing normally</p>
        </div>
      ) : (
        <div className="rounded-(--ui-radius-md) border border-(--ui-border) bg-(--ui-surface)">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-(--ui-border) bg-(--ui-muted-surface) text-left text-xs text-(--ui-text-muted)">
                  <th className="px-4 py-3 font-medium">Tenant</th>
                  <th className="px-4 py-3 font-medium">Event Type</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Error</th>
                  <th className="px-4 py-3 font-medium text-right">Retries</th>
                  <th className="px-4 py-3 font-medium">Failed At</th>
                  <th className="px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => {
                  const key = `${e.tenant_id}-${e.id}`;
                  return (
                    <tr key={key} className="border-b border-(--ui-border) last:border-0">
                      <td className="px-4 py-3">
                        <span className="font-medium text-(--ui-text)">{e.tenant_name}</span>
                        <span className="ml-1 text-xs text-(--ui-text-muted)">({e.tenant_slug})</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-mono text-xs text-(--ui-text-muted)">{e.topic || "-"}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          e.status === "dead_letter" ? "bg-(--ui-danger-bg) text-(--ui-danger-fg)" : "bg-(--ui-warning-bg) text-(--ui-warning-fg)"
                        }`}>
                          {e.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 max-w-xs">
                        <span className="text-xs text-(--ui-danger-fg) break-all">
                          {e.error ? (e.error.length > 120 ? e.error.slice(0, 120) + "..." : e.error) : "-"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right text-xs text-(--ui-text-muted)">{e.retries ?? 0}</td>
                      <td className="px-4 py-3 text-xs text-(--ui-text-muted) whitespace-nowrap">
                        {e.updated_at ? new Date(e.updated_at).toLocaleString() : e.created_at ? new Date(e.created_at).toLocaleString() : "-"}
                      </td>
                      <td className="px-4 py-3">
                        <button
                          disabled={retrying === e.id}
                          onClick={() => retryOne(e.tenant_id, e.id)}
                          className="ui-focus-ring rounded-full bg-(--ui-muted-surface) px-3 py-1 text-xs font-semibold text-(--ui-text) transition hover:bg-(--ui-border-strong) disabled:opacity-50"
                        >
                          {retrying === e.id ? "..." : "Retry"}
                        </button>
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
