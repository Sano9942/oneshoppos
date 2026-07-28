import { useEffect, useState, useRef } from "react";
import { adminFetch } from "./AdminLogin";

const TABS = [
  { id: "shopify", label: "Shopify" },
  { id: "aggregator", label: "Aggregators" },
  { id: "channel_sync", label: "Channel Sync" },
  { id: "fbr", label: "FBR Health" },
];

const ENDPOINTS = {
  shopify: "/api/admin/dead-letters",
  aggregator: "/api/admin/dead-letters/aggregator",
  channel_sync: "/api/admin/dead-letters/channel-sync",
  fbr: "/api/admin/fbr-health",
};

function StatusPill({ value, tone }) {
  const cls = tone === "danger"
    ? "bg-(--ui-danger-bg) text-(--ui-danger-fg)"
    : tone === "warning"
      ? "bg-(--ui-warning-bg) text-(--ui-warning-fg)"
      : "bg-(--ui-muted-surface) text-(--ui-text-muted)";
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${cls}`}>{value}</span>;
}

export default function AdminDeadLetters() {
  const [tab, setTab] = useState("shopify");
  const [events, setEvents] = useState([]);
  const [fbr, setFbr] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [acting, setActing] = useState(null);
  const [retryingAll, setRetryingAll] = useState(false);
  const timerRef = useRef(null);

  const fetchData = (activeTab, showLoading) => {
    if (showLoading) setLoading(true);
    adminFetch(ENDPOINTS[activeTab])
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Failed to load"))))
      .then((data) => {
        if (activeTab === "fbr") setFbr(data);
        else setEvents(data.events || []);
        setError("");
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    setEvents([]);
    setFbr(null);
    fetchData(tab, true);
    timerRef.current = setInterval(() => fetchData(tab, false), 30000);
    return () => clearInterval(timerRef.current);
  }, [tab]);

  const removeEvent = (tenantId, eventId) =>
    setEvents((prev) => prev.filter((e) => !(e.id === eventId && e.tenant_id === tenantId)));

  const act = async (e, path, options) => {
    setActing(`${e.tenant_id}-${e.id}`);
    try {
      const r = await adminFetch(path, options);
      if (!r.ok) throw new Error("Action failed");
      removeEvent(e.tenant_id, e.id);
    } catch (err) {
      setError(err.message);
    } finally {
      setActing(null);
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
      fetchData(tab, false);
    } finally {
      setRetryingAll(false);
    }
  };

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-(--ui-text)">Dead Letters & Queue Health</h1>
        <div className="flex items-center gap-3">
          <span className="text-[10px] font-medium text-(--ui-text-muted) uppercase tracking-wider">Auto-refresh 30s</span>
          {tab === "shopify" && events.length > 0 && (
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

      <div className="mb-4 flex gap-1 rounded-full bg-(--ui-muted-surface) p-1 w-fit">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`ui-focus-ring rounded-full px-4 py-1.5 text-sm font-semibold transition ${
              tab === t.id ? "bg-white text-(--ui-text)" : "text-(--ui-text-muted) hover:text-(--ui-text)"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="mb-4 rounded-(--ui-radius-md) border border-(--ui-danger-bg) bg-(--ui-danger-bg) p-3">
          <p className="text-sm text-(--ui-danger-fg)">{error}</p>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-(--ui-text-muted)">Loading...</p>
      ) : tab === "fbr" ? (
        <FbrHealthPanel fbr={fbr} />
      ) : events.length === 0 ? (
        <div className="rounded-(--ui-radius-md) border border-(--ui-border) bg-(--ui-surface) p-8 text-center">
          <p className="text-sm font-medium text-(--ui-success-fg)">
            {tab === "shopify" && "No Shopify dead letters — all webhooks processing normally"}
            {tab === "aggregator" && "No aggregator dead letters — order injection healthy"}
            {tab === "channel_sync" && "No open channel-sync conflicts"}
          </p>
        </div>
      ) : (
        <div className="rounded-(--ui-radius-md) border border-(--ui-border) bg-(--ui-surface)">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-(--ui-border) bg-(--ui-muted-surface) text-left text-xs text-(--ui-text-muted)">
                  <th className="px-4 py-3 font-medium">Tenant</th>
                  {tab === "shopify" && (<>
                    <th className="px-4 py-3 font-medium">Topic</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Error</th>
                    <th className="px-4 py-3 font-medium text-right">Retries</th>
                  </>)}
                  {tab === "aggregator" && (<>
                    <th className="px-4 py-3 font-medium">Type</th>
                    <th className="px-4 py-3 font-medium">Idempotency Key</th>
                    <th className="px-4 py-3 font-medium">Error</th>
                    <th className="px-4 py-3 font-medium text-right">Attempts</th>
                  </>)}
                  {tab === "channel_sync" && (<>
                    <th className="px-4 py-3 font-medium">External UID</th>
                    <th className="px-4 py-3 font-medium">Dates</th>
                    <th className="px-4 py-3 font-medium">Reason</th>
                    <th className="px-4 py-3 font-medium">Conflicting Booking</th>
                  </>)}
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
                      {tab === "shopify" && (<>
                        <td className="px-4 py-3"><span className="font-mono text-xs text-(--ui-text-muted)">{e.topic || "-"}</span></td>
                        <td className="px-4 py-3"><StatusPill value={e.status} tone={e.status === "dead_letter" ? "danger" : "warning"} /></td>
                        <td className="max-w-xs px-4 py-3"><span className="break-all text-xs text-(--ui-danger-fg)">{e.error ? e.error.slice(0, 120) : "-"}</span></td>
                        <td className="px-4 py-3 text-right text-xs text-(--ui-text-muted)">{e.retries ?? 0}</td>
                      </>)}
                      {tab === "aggregator" && (<>
                        <td className="px-4 py-3"><span className="font-mono text-xs text-(--ui-text-muted)">{e.entity_type}</span></td>
                        <td className="max-w-[12rem] px-4 py-3"><span className="break-all font-mono text-xs text-(--ui-text-muted)">{e.idempotency_key}</span></td>
                        <td className="max-w-xs px-4 py-3"><span className="break-all text-xs text-(--ui-danger-fg)">{e.error_message ? e.error_message.slice(0, 120) : "-"}</span></td>
                        <td className="px-4 py-3 text-right text-xs text-(--ui-text-muted)">{e.attempt_count ?? 0}</td>
                      </>)}
                      {tab === "channel_sync" && (<>
                        <td className="max-w-[10rem] px-4 py-3"><span className="break-all font-mono text-xs text-(--ui-text-muted)">{e.external_uid}</span></td>
                        <td className="px-4 py-3 text-xs text-(--ui-text-muted) whitespace-nowrap">{e.start_date} → {e.end_date}</td>
                        <td className="max-w-xs px-4 py-3"><span className="text-xs text-(--ui-danger-fg)">{e.reason || "-"}</span></td>
                        <td className="px-4 py-3 text-xs text-(--ui-text-muted)">{e.conflicting_booking_id ? `#${e.conflicting_booking_id}` : "-"}</td>
                      </>)}
                      <td className="px-4 py-3 text-xs text-(--ui-text-muted) whitespace-nowrap">
                        {e.created_at ? new Date(e.created_at).toLocaleString() : "-"}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1.5">
                          {tab === "shopify" && (
                            <button
                              disabled={acting === key}
                              onClick={() => act(e, `/api/admin/dead-letters/${e.tenant_id}/${e.id}/retry`, { method: "POST" })}
                              className="ui-focus-ring rounded-full bg-(--ui-muted-surface) px-3 py-1 text-xs font-semibold text-(--ui-text) transition hover:bg-(--ui-border-strong) disabled:opacity-50"
                            >
                              {acting === key ? "..." : "Retry"}
                            </button>
                          )}
                          {tab === "aggregator" && (
                            <button
                              disabled={acting === key}
                              onClick={() => act(e, `/api/admin/dead-letters/aggregator/${e.tenant_id}/${e.id}/dismiss`, { method: "POST" })}
                              className="ui-focus-ring rounded-full bg-(--ui-muted-surface) px-3 py-1 text-xs font-semibold text-(--ui-text) transition hover:bg-(--ui-border-strong) disabled:opacity-50"
                            >
                              {acting === key ? "..." : "Dismiss"}
                            </button>
                          )}
                          {tab === "channel_sync" && (<>
                            <button
                              disabled={acting === key}
                              onClick={() => act(e, `/api/admin/dead-letters/channel-sync/${e.tenant_id}/${e.id}`, { method: "PUT", body: JSON.stringify({ status: "resolved" }) })}
                              className="ui-focus-ring rounded-full bg-(--ui-muted-surface) px-3 py-1 text-xs font-semibold text-(--ui-text) transition hover:bg-(--ui-border-strong) disabled:opacity-50"
                            >
                              Resolve
                            </button>
                            <button
                              disabled={acting === key}
                              onClick={() => act(e, `/api/admin/dead-letters/channel-sync/${e.tenant_id}/${e.id}`, { method: "PUT", body: JSON.stringify({ status: "dismissed" }) })}
                              className="ui-focus-ring rounded-full bg-(--ui-muted-surface) px-3 py-1 text-xs font-semibold text-(--ui-text-muted) transition hover:bg-(--ui-border-strong) disabled:opacity-50"
                            >
                              Dismiss
                            </button>
                          </>)}
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

function FbrHealthPanel({ fbr }) {
  if (!fbr) {
    return (
      <div className="rounded-(--ui-radius-md) border border-(--ui-border) bg-(--ui-surface) p-8 text-center">
        <p className="text-sm text-(--ui-text-muted)">No FBR health data.</p>
      </div>
    );
  }
  const tenants = fbr.health || [];
  const totals = tenants.reduce(
    (acc, t) => ({
      pending: acc.pending + Number(t.pending || 0),
      failed: acc.failed + Number(t.failed || 0),
      posted: acc.posted + Number(t.posted || 0),
    }),
    { pending: 0, failed: 0, posted: 0 }
  );
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-(--ui-radius-md) border border-(--ui-border) bg-(--ui-surface) p-4">
          <p className="text-2xl font-bold text-(--ui-text)">{totals.pending}</p>
          <p className="text-xs font-medium text-(--ui-text-muted)">Pending invoices</p>
        </div>
        <div className="rounded-(--ui-radius-md) border border-(--ui-border) bg-(--ui-surface) p-4">
          <p className={`text-2xl font-bold ${totals.failed > 0 ? "text-(--ui-danger-fg)" : "text-(--ui-text)"}`}>{totals.failed}</p>
          <p className="text-xs font-medium text-(--ui-text-muted)">Failed invoices</p>
        </div>
        <div className="rounded-(--ui-radius-md) border border-(--ui-border) bg-(--ui-surface) p-4">
          <p className="text-2xl font-bold text-(--ui-success-fg)">{totals.posted}</p>
          <p className="text-xs font-medium text-(--ui-text-muted)">Posted invoices</p>
        </div>
      </div>
      {tenants.length === 0 ? (
        <div className="rounded-(--ui-radius-md) border border-(--ui-border) bg-(--ui-surface) p-8 text-center">
          <p className="text-sm text-(--ui-text-muted)">No tenants have FBR integration enabled.</p>
        </div>
      ) : (
        <div className="rounded-(--ui-radius-md) border border-(--ui-border) bg-(--ui-surface)">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-(--ui-border) bg-(--ui-muted-surface) text-left text-xs text-(--ui-text-muted)">
                  <th className="px-4 py-3 font-medium">Tenant</th>
                  <th className="px-4 py-3 font-medium text-right">Pending</th>
                  <th className="px-4 py-3 font-medium text-right">Failed</th>
                  <th className="px-4 py-3 font-medium text-right">Posted</th>
                  <th className="px-4 py-3 font-medium">Oldest Pending</th>
                  <th className="px-4 py-3 font-medium text-right">Avg Delay (s)</th>
                </tr>
              </thead>
              <tbody>
                {tenants.map((t) => (
                  <tr key={t.tenant_slug} className="border-b border-(--ui-border) last:border-0">
                    <td className="px-4 py-3 font-medium text-(--ui-text)">{t.tenant_name || t.tenant_slug}</td>
                    <td className="px-4 py-3 text-right text-(--ui-text)">{t.pending ?? 0}</td>
                    <td className={`px-4 py-3 text-right ${Number(t.failed) > 0 ? "font-semibold text-(--ui-danger-fg)" : "text-(--ui-text)"}`}>{t.failed ?? 0}</td>
                    <td className="px-4 py-3 text-right text-(--ui-text)">{t.posted ?? 0}</td>
                    <td className="px-4 py-3 text-xs text-(--ui-text-muted)">{t.oldest_pending ? new Date(t.oldest_pending).toLocaleString() : "-"}</td>
                    <td className="px-4 py-3 text-right text-xs text-(--ui-text-muted)">{t.avg_delay_secs != null ? Math.round(Number(t.avg_delay_secs)) : "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
