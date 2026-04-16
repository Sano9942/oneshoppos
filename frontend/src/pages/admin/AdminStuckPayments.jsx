import { useEffect, useState, useRef } from "react";
import { adminFetch } from "./AdminLogin";

function ageFromNow(createdAt) {
  if (!createdAt) return "-";
  const ms = Date.now() - new Date(createdAt).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `${days}d`;
}

function ageBadgeClass(createdAt) {
  if (!createdAt) return "bg-slate-100 text-slate-600";
  const hrs = (Date.now() - new Date(createdAt).getTime()) / 3600000;
  if (hrs >= 6) return "bg-red-100 text-red-700";
  if (hrs >= 2) return "bg-amber-100 text-amber-700";
  return "bg-slate-100 text-slate-600";
}

function fmtAmount(amount, currency) {
  if (amount === null || amount === undefined) return "-";
  const n = Number(amount);
  if (Number.isNaN(n)) return "-";
  return `${currency || ""} ${n.toLocaleString()}`.trim();
}

function fmtTimestamp(ts) {
  if (!ts) return "-";
  return new Date(ts).toLocaleString();
}

export default function AdminStuckPayments() {
  const [intents, setIntents] = useState([]);
  const [events, setEvents] = useState([]);
  const [thresholdHours, setThresholdHours] = useState(2);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const timerRef = useRef(null);

  const fetchAll = async (showLoading) => {
    if (showLoading) setLoading(true);
    try {
      const [intentsRes, eventsRes] = await Promise.all([
        adminFetch(`/api/admin/payment-intents/stuck?hours=${thresholdHours}`),
        adminFetch("/api/admin/webhooks/payment-dead-letters?limit=100"),
      ]);
      if (!intentsRes.ok) throw new Error("Failed to load stuck payment intents");
      if (!eventsRes.ok) throw new Error("Failed to load webhook events");
      const intentsData = await intentsRes.json();
      const eventsData = await eventsRes.json();
      setIntents(intentsData.intents || []);
      setEvents(eventsData.events || []);
      setError("");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAll(true);
    timerRef.current = setInterval(() => fetchAll(false), 30000);
    return () => clearInterval(timerRef.current);
    // thresholdHours included to refetch when user changes threshold
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thresholdHours]);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-800">Stuck Payments</h1>
        <div className="flex items-center gap-3">
          <label className="text-xs text-slate-500">
            Threshold (hours):
            <select
              value={thresholdHours}
              onChange={(e) => setThresholdHours(Number(e.target.value))}
              className="ml-2 rounded border border-slate-200 bg-white px-2 py-1 text-xs"
            >
              <option value={1}>1h</option>
              <option value={2}>2h</option>
              <option value={6}>6h</option>
              <option value={24}>24h</option>
            </select>
          </label>
          <span className="text-[10px] font-medium text-slate-400 uppercase tracking-wider">Auto-refresh 30s</span>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}

      {/* Stuck Payment Intents */}
      <section className="mb-6">
        <h2 className="mb-2 text-sm font-semibold text-slate-700">
          Pending Intents Older Than {thresholdHours}h
          {intents.length > 0 && <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-700">{intents.length}</span>}
        </h2>
        {loading && intents.length === 0 ? (
          <p className="text-sm text-slate-400">Loading...</p>
        ) : intents.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
            <p className="text-sm font-medium text-emerald-600">No stuck payment intents</p>
          </div>
        ) : (
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
                    <th className="px-4 py-3 font-medium">Tenant</th>
                    <th className="px-4 py-3 font-medium">Plan / Cycle</th>
                    <th className="px-4 py-3 font-medium">Amount</th>
                    <th className="px-4 py-3 font-medium">Gateway</th>
                    <th className="px-4 py-3 font-medium">Gateway Ref</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Age</th>
                    <th className="px-4 py-3 font-medium">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {intents.map((it) => (
                    <tr key={it.id} className="border-b border-slate-50 last:border-0">
                      <td className="px-4 py-3">
                        <a
                          href={`/admin/tenants/${it.tenant_id}`}
                          className="font-medium text-violet-700 hover:underline"
                        >
                          {it.tenant_name}
                        </a>
                        <span className="ml-1 text-xs text-slate-400">({it.tenant_slug})</span>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600">
                        {it.plan} / {it.cycle}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-600">
                        {fmtAmount(it.amount, it.currency_code)}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600">{it.gateway || "-"}</td>
                      <td className="px-4 py-3">
                        <span className="font-mono text-xs text-slate-500 break-all">
                          {it.gateway_ref || "-"}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                          {it.status}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${ageBadgeClass(it.created_at)}`}>
                          {ageFromNow(it.created_at)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-400 whitespace-nowrap">
                        {fmtTimestamp(it.created_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      {/* Payment Webhook Events (Last 7 Days) */}
      <section>
        <h2 className="mb-2 text-sm font-semibold text-slate-700">
          Recent Payment Webhook Events (Last 7 Days)
          {events.length > 0 && <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">{events.length}</span>}
        </h2>
        {loading && events.length === 0 ? (
          <p className="text-sm text-slate-400">Loading...</p>
        ) : events.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
            <p className="text-sm text-slate-400">No webhook events in the last 7 days</p>
          </div>
        ) : (
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
                    <th className="px-4 py-3 font-medium">Provider</th>
                    <th className="px-4 py-3 font-medium">Event Type</th>
                    <th className="px-4 py-3 font-medium">Context</th>
                    <th className="px-4 py-3 font-medium">Event ID</th>
                    <th className="px-4 py-3 font-medium">Processed</th>
                    <th className="px-4 py-3 font-medium">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((e) => (
                    <tr key={e.id} className="border-b border-slate-50 last:border-0">
                      <td className="px-4 py-3">
                        <span className="font-medium text-slate-700">{e.provider}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-mono text-xs text-slate-600">{e.event_type || "-"}</span>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500">
                        {e.payment_context || "-"}
                        {e.context_ref && <span className="ml-1 text-[10px] text-slate-400">({e.context_ref})</span>}
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-mono text-xs text-slate-500 break-all">{e.event_id}</span>
                      </td>
                      <td className="px-4 py-3">
                        {e.processed_at ? (
                          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                            Processed
                          </span>
                        ) : (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                            Unprocessed
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-400 whitespace-nowrap">
                        {fmtTimestamp(e.created_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
