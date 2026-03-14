import { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Activity, Building2, Server, Users, Database, Zap, AlertTriangle, Clock, HardDrive } from "lucide-react";
import { API_BASE } from "../../config";
import { getAdminToken } from "./AdminLogin";

function safeDateParse(ts) {
  if (!ts) return null;
  const d = new Date(ts);
  return isNaN(d.getTime()) ? null : d;
}

function StatCard({ icon: Icon, label, value, color }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-3">
        <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${color}`}>
          <Icon size={20} className="text-white" />
        </div>
        <div>
          <p className="text-2xl font-bold text-slate-800">{value ?? "—"}</p>
          <p className="text-xs font-medium text-slate-500">{label}</p>
        </div>
      </div>
    </div>
  );
}

function connColor(pct) {
  if (pct >= 80) return "text-red-600";
  if (pct >= 60) return "text-amber-600";
  return "text-emerald-600";
}

function connBg(pct) {
  if (pct >= 80) return "bg-red-500";
  if (pct >= 60) return "bg-amber-500";
  return "bg-emerald-500";
}

function InfrastructurePanel() {
  const [infra, setInfra] = useState(null);
  const [infraErr, setInfraErr] = useState("");
  const timerRef = useRef(null);

  const fetchInfra = () => {
    const token = getAdminToken();
    if (!token) return;
    fetch(`${API_BASE}/api/admin/infra`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (data) { setInfra(data); setInfraErr(""); } })
      .catch((err) => setInfraErr(err.message));
  };

  useEffect(() => {
    fetchInfra();
    timerRef.current = setInterval(fetchInfra, 30000);
    return () => clearInterval(timerRef.current);
  }, []);

  if (infraErr) {
    return (
      <div className="mb-8 rounded-xl border border-red-200 bg-red-50 p-4">
        <p className="text-sm text-red-600">Infrastructure: {infraErr}</p>
      </div>
    );
  }

  if (!infra) {
    return (
      <div className="mb-8 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-3 text-lg font-semibold text-slate-800">Infrastructure</h2>
        <p className="text-sm text-slate-400">Loading...</p>
      </div>
    );
  }

  const c = infra.connections;
  const connPct = c.max > 0 ? Math.round((c.total / c.max) * 100) : 0;
  const cacheOk = infra.cache.hit_ratio >= 95;
  const th = infra.table_health;

  return (
    <div className="mb-8 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-800">Infrastructure</h2>
        <span className="text-[10px] font-medium text-slate-400 uppercase tracking-wider">Auto-refresh 30s</span>
      </div>

      {/* Top stats row */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-600">
              <Zap size={20} className="text-white" />
            </div>
            <div>
              <p className={`text-2xl font-bold ${connColor(connPct)}`}>{c.total}/{c.max}</p>
              <p className="text-xs font-medium text-slate-500">Connections</p>
            </div>
          </div>
          <div className="mt-3 h-2 rounded-full bg-slate-100">
            <div className={`h-2 rounded-full transition-all ${connBg(connPct)}`} style={{ width: `${Math.min(connPct, 100)}%` }} />
          </div>
          <div className="mt-1.5 flex gap-3 text-[10px] text-slate-400">
            <span>{c.active} active</span>
            <span>{c.idle} idle</span>
            {c.idle_in_tx > 0 && <span className="text-amber-500">{c.idle_in_tx} idle-in-tx</span>}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-violet-600">
              <Database size={20} className="text-white" />
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-800">{infra.database.size_mb} MB</p>
              <p className="text-xs font-medium text-slate-500">Database Size</p>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${cacheOk ? "bg-emerald-600" : "bg-red-500"}`}>
              <HardDrive size={20} className="text-white" />
            </div>
            <div>
              <p className={`text-2xl font-bold ${cacheOk ? "text-emerald-600" : "text-red-600"}`}>{infra.cache.hit_ratio}%</p>
              <p className="text-xs font-medium text-slate-500">Cache Hit Ratio</p>
            </div>
          </div>
          {!cacheOk && <p className="mt-2 text-[10px] text-red-500">Below 95% — queries hitting disk</p>}
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${th.tables_needing_vacuum > 0 ? "bg-amber-500" : "bg-emerald-600"}`}>
              <AlertTriangle size={20} className="text-white" />
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-800">{th.total_dead_tuples.toLocaleString()}</p>
              <p className="text-xs font-medium text-slate-500">Dead Tuples</p>
            </div>
          </div>
          {th.tables_needing_vacuum > 0 && (
            <p className="mt-2 text-[10px] text-amber-600">{th.tables_needing_vacuum} table(s) need vacuum</p>
          )}
        </div>
      </div>

      {/* Schema sizes */}
      {infra.schema_sizes.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Schema Sizes</h3>
          <div className="space-y-1.5">
            {infra.schema_sizes.map((s) => (
              <div key={s.schema} className="flex items-center justify-between text-sm">
                <span className="font-medium text-slate-700">{s.schema}</span>
                <span className="text-slate-500">{s.size_mb} MB</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Active slow queries */}
      {infra.slow_queries_now.length > 0 && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-5">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-red-700">
            <Clock size={14} /> Slow Queries Running Now
          </h3>
          <div className="space-y-2">
            {infra.slow_queries_now.map((q) => (
              <div key={q.pid} className="rounded-lg bg-white border border-red-100 p-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] font-semibold text-red-600">{q.duration_s}s</span>
                  <span className="text-[10px] text-slate-400">PID {q.pid} · {q.username}</span>
                </div>
                <p className="text-xs text-slate-600 font-mono break-all">{q.query}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Historical slow queries */}
      {infra.slow_queries_historical.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Slowest Queries (Historical Avg)
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-100 text-left text-slate-400">
                  <th className="pb-2 pr-4 font-medium">Query</th>
                  <th className="pb-2 pr-4 font-medium text-right">Avg (ms)</th>
                  <th className="pb-2 pr-4 font-medium text-right">Calls</th>
                  <th className="pb-2 font-medium text-right">Total (ms)</th>
                </tr>
              </thead>
              <tbody>
                {infra.slow_queries_historical.map((q, i) => (
                  <tr key={i} className="border-b border-slate-50 last:border-0">
                    <td className="py-2 pr-4 font-mono text-slate-600 max-w-xs truncate">{q.query}</td>
                    <td className="py-2 pr-4 text-right font-semibold text-slate-800">{q.mean_time_ms}</td>
                    <td className="py-2 pr-4 text-right text-slate-500">{q.calls}</td>
                    <td className="py-2 text-right text-slate-500">{Number(q.total_time_ms).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Table health details */}
      {th.worst_tables.length > 0 && (
        <details className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <summary className="cursor-pointer p-5 text-sm font-semibold text-slate-500 uppercase tracking-wide hover:text-slate-700">
            Table Health Details ({th.worst_tables.length} tables with dead tuples)
          </summary>
          <div className="px-5 pb-5">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-slate-400">
                    <th className="pb-2 pr-4 font-medium">Schema</th>
                    <th className="pb-2 pr-4 font-medium">Table</th>
                    <th className="pb-2 pr-4 font-medium text-right">Dead</th>
                    <th className="pb-2 pr-4 font-medium text-right">Live</th>
                    <th className="pb-2 font-medium">Last Vacuum</th>
                  </tr>
                </thead>
                <tbody>
                  {th.worst_tables.map((t, i) => (
                    <tr key={i} className="border-b border-slate-50 last:border-0">
                      <td className="py-1.5 pr-4 text-slate-500">{t.schema}</td>
                      <td className="py-1.5 pr-4 font-medium text-slate-700">{t.table}</td>
                      <td className={`py-1.5 pr-4 text-right font-semibold ${t.dead_tuples > 1000 ? "text-amber-600" : "text-slate-600"}`}>
                        {t.dead_tuples.toLocaleString()}
                      </td>
                      <td className="py-1.5 pr-4 text-right text-slate-500">{t.live_tuples.toLocaleString()}</td>
                      <td className="py-1.5 text-slate-400">
                        {t.last_autovacuum ? new Date(t.last_autovacuum).toLocaleString() : "Never"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </details>
      )}
    </div>
  );
}

export default function AdminDashboard() {
  const navigate = useNavigate();
  const [stats, setStats] = useState(null);
  const [attention, setAttention] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const token = getAdminToken();
    if (!token) return;
    const headers = { Authorization: `Bearer ${token}` };
    fetch(`${API_BASE}/api/admin/stats`, { headers })
      .then((r) => {
        if (r.status === 401) { navigate("/admin/login", { replace: true }); return null; }
        if (!r.ok) throw new Error("Failed to load stats");
        return r.json();
      })
      .then((data) => { if (data) setStats(data); })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
    fetch(`${API_BASE}/api/admin/attention`, { headers })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (data) setAttention(data); })
      .catch(() => {});
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-sm text-slate-500">Loading dashboard...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4">
        <p className="text-sm text-red-600">{error}</p>
      </div>
    );
  }

  const t = stats?.totals || {};

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-slate-800">Dashboard</h1>

      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={Server} label="Total Tenants" value={t.total} color="bg-violet-600" />
        <StatCard icon={Activity} label="Active" value={t.active} color="bg-emerald-600" />
        <StatCard icon={Building2} label="Suspended" value={t.suspended} color="bg-amber-500" />
        <StatCard icon={Users} label="Pro Plans" value={t.pro_plan} color="bg-blue-600" />
      </div>

      {/* Plan breakdown */}
      <div className="mb-8 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Plan Distribution
        </h2>
        <div className="flex gap-6">
          <div>
            <p className="text-lg font-bold text-slate-800">{t.free_plan ?? 0}</p>
            <p className="text-xs text-slate-500">Free</p>
          </div>
          <div>
            <p className="text-lg font-bold text-slate-800">{t.starter_plan ?? 0}</p>
            <p className="text-xs text-slate-500">Starter</p>
          </div>
          <div>
            <p className="text-lg font-bold text-slate-800">{t.pro_plan ?? 0}</p>
            <p className="text-xs text-slate-500">Pro</p>
          </div>
        </div>
      </div>

      {/* Needs Attention */}
      <div className="mb-8 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-4 text-lg font-semibold text-slate-800">Needs Attention</h2>
        {!attention ? (
          <p className="text-sm text-slate-400">Loading...</p>
        ) : attention.approaching_limits.length === 0 && attention.dormant.length === 0 && attention.setup_pending.length === 0 ? (
          <p className="text-sm font-medium text-emerald-600">All tenants healthy</p>
        ) : (
          <div className="space-y-3">
            {attention.approaching_limits.length > 0 && (
              <div>
                <p className="text-sm font-medium text-amber-600">
                  {attention.approaching_limits.length} approaching plan limits
                </p>
                {attention.approaching_limits.map((a) => (
                  <p key={`${a.id}-${a.dimension}`} className="ml-2 text-xs text-slate-500">
                    {a.name}: {a.used}/{a.max} {a.dimension}
                  </p>
                ))}
              </div>
            )}
            {attention.dormant.length > 0 && (
              <div>
                <p className="text-sm font-medium text-red-600">
                  {attention.dormant.length} dormant tenants
                </p>
                {attention.dormant.map((d) => (
                  <p key={d.id} className="ml-2 text-xs text-slate-500">
                    {d.name}: {d.days_inactive ? `${d.days_inactive}d inactive` : "Never logged in"}
                  </p>
                ))}
              </div>
            )}
            {attention.setup_pending.length > 0 && (
              <div>
                <p className="text-sm font-medium text-slate-600">
                  {attention.setup_pending.length} setup pending
                </p>
                {attention.setup_pending.map((s) => (
                  <p key={s.id} className="ml-2 text-xs text-slate-500">{s.name}</p>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Infrastructure Monitoring */}
      <InfrastructurePanel />

      {/* Recent tenants */}
      {stats?.recent_tenants?.length > 0 && (
        <div className="mb-8 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Recent Tenants
          </h2>
          <div className="space-y-2">
            {stats.recent_tenants.map((t) => (
              <div
                key={t.id}
                className="flex cursor-pointer items-center justify-between rounded-lg border border-slate-100 px-4 py-2.5 transition hover:bg-slate-50"
                onClick={() => navigate(`/admin/tenants/${t.id}`)}
              >
                <div>
                  <span className="text-sm font-medium text-slate-700">{t.name}</span>
                  <span className="ml-2 text-xs text-slate-400">{t.slug}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                    t.status === "active" ? "bg-emerald-100 text-emerald-700" :
                    t.status === "suspended" ? "bg-amber-100 text-amber-700" :
                    "bg-slate-100 text-slate-500"
                  }`}>{t.status}</span>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">
                    {t.plan}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent audit log */}
      {stats?.recent_audit?.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Recent Activity
          </h2>
          <div className="space-y-2">
            {stats.recent_audit.map((entry, i) => (
              <div key={i} className="flex items-center justify-between border-b border-slate-50 py-1.5 last:border-0">
                <div>
                  <span className="text-sm font-medium text-slate-700">{entry.action}</span>
                  {entry.tenant_slug && (
                    <span className="ml-2 text-xs text-slate-400">{entry.tenant_slug}</span>
                  )}
                </div>
                <span className="text-xs text-slate-400">
                  {safeDateParse(entry.created_at)?.toLocaleString() ?? "—"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
