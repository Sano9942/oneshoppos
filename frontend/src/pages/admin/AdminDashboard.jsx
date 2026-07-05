import { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Activity, Building2, Server, Users, Database, Zap, AlertTriangle, Clock, HardDrive, DollarSign, TrendingUp, CreditCard, AlertCircle, CheckCircle, Wrench, Megaphone, HardDriveDownload, RefreshCw } from "lucide-react";
import { API_BASE } from "../../config";
import { getAdminToken, adminFetch } from "./AdminLogin";

function safeDateParse(ts) {
  if (!ts) return null;
  const d = new Date(ts);
  return isNaN(d.getTime()) ? null : d;
}

function StatCard({ icon: Icon, label, value, color }) {
  return (
    <div className="rounded-(--ui-radius-md) border border-(--ui-border) bg-(--ui-surface) p-5">
      <div className="flex items-center gap-3">
        <div className={`flex h-10 w-10 items-center justify-center rounded-(--ui-radius-sm) ${color}`}>
          <Icon size={20} className="text-white" />
        </div>
        <div>
          <p className="text-2xl font-bold text-(--ui-text)">{value ?? "—"}</p>
          <p className="text-xs font-medium text-(--ui-text-muted)">{label}</p>
        </div>
      </div>
    </div>
  );
}

function connColor(pct) {
  if (pct >= 80) return "text-(--ui-danger-fg)";
  if (pct >= 60) return "text-(--ui-warning-fg)";
  return "text-(--ui-success-fg)";
}

function connBg(pct) {
  if (pct >= 80) return "bg-(--ui-danger)";
  if (pct >= 60) return "bg-(--ui-warning-fg)";
  return "bg-(--ui-success-fg)";
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
    // Polling cadence — backend now caches /api/admin/infra for 5 min, so 60s
    // here is plenty (backend keeps serving the cached payload between refreshes).
    // Pause polling when the tab is hidden so a forgotten admin tab doesn't
    // burn DB time forever.
    fetchInfra();
    const start = () => {
      if (timerRef.current) return;
      timerRef.current = setInterval(fetchInfra, 60000);
    };
    const stop = () => {
      if (!timerRef.current) return;
      clearInterval(timerRef.current);
      timerRef.current = null;
    };
    const onVisibility = () => {
      if (document.hidden) {
        stop();
      } else {
        fetchInfra();
        start();
      }
    };
    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  if (infraErr) {
    return (
      <div className="mb-8 rounded-(--ui-radius-md) border border-(--ui-danger-bg) bg-(--ui-danger-bg) p-4">
        <p className="text-sm text-(--ui-danger-fg)">Infrastructure: {infraErr}</p>
      </div>
    );
  }

  if (!infra) {
    return (
      <div className="mb-8 rounded-(--ui-radius-md) border border-(--ui-border) bg-(--ui-surface) p-5">
        <h2 className="mb-3 text-lg font-semibold text-(--ui-text)">Infrastructure</h2>
        <p className="text-sm text-(--ui-text-muted)">Loading...</p>
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
        <h2 className="text-lg font-semibold text-(--ui-text)">Infrastructure</h2>
        <span className="text-[10px] font-medium text-(--ui-text-muted) uppercase tracking-wider">Auto-refresh 60s · pauses when hidden</span>
      </div>

      {/* Top stats row */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-(--ui-radius-md) border border-(--ui-border) bg-(--ui-surface) p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-(--ui-radius-sm) bg-(--ui-primary)">
              <Zap size={20} className="text-white" />
            </div>
            <div>
              <p className={`text-2xl font-bold ${connColor(connPct)}`}>{c.total}/{c.max}</p>
              <p className="text-xs font-medium text-(--ui-text-muted)">Connections</p>
            </div>
          </div>
          <div className="mt-3 h-2 rounded-full bg-(--ui-muted-surface)">
            <div className={`h-2 rounded-full transition-all ${connBg(connPct)}`} style={{ width: `${Math.min(connPct, 100)}%` }} />
          </div>
          <div className="mt-1.5 flex gap-3 text-[10px] text-(--ui-text-muted)">
            <span>{c.active} active</span>
            <span>{c.idle} idle</span>
            {c.idle_in_tx > 0 && <span className="text-(--ui-warning-fg)">{c.idle_in_tx} idle-in-tx</span>}
          </div>
        </div>

        <div className="rounded-(--ui-radius-md) border border-(--ui-border) bg-(--ui-surface) p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-(--ui-radius-sm) bg-(--ui-primary)">
              <Database size={20} className="text-white" />
            </div>
            <div>
              <p className="text-2xl font-bold text-(--ui-text)">{infra.database.size_mb} MB</p>
              <p className="text-xs font-medium text-(--ui-text-muted)">Database Size</p>
            </div>
          </div>
        </div>

        <div className="rounded-(--ui-radius-md) border border-(--ui-border) bg-(--ui-surface) p-5">
          <div className="flex items-center gap-3">
            <div className={`flex h-10 w-10 items-center justify-center rounded-(--ui-radius-sm) ${cacheOk ? "bg-(--ui-primary)" : "bg-(--ui-danger)"}`}>
              <HardDrive size={20} className="text-white" />
            </div>
            <div>
              <p className={`text-2xl font-bold ${cacheOk ? "text-(--ui-success-fg)" : "text-(--ui-danger-fg)"}`}>{infra.cache.hit_ratio}%</p>
              <p className="text-xs font-medium text-(--ui-text-muted)">Cache Hit Ratio</p>
            </div>
          </div>
          {!cacheOk && <p className="mt-2 text-[10px] text-(--ui-danger-fg)">Below 95% — queries hitting disk</p>}
        </div>

        <div className="rounded-(--ui-radius-md) border border-(--ui-border) bg-(--ui-surface) p-5">
          <div className="flex items-center gap-3">
            <div className={`flex h-10 w-10 items-center justify-center rounded-(--ui-radius-sm) ${th.tables_needing_vacuum > 0 ? "bg-(--ui-warning-fg)" : "bg-(--ui-primary)"}`}>
              <AlertTriangle size={20} className="text-white" />
            </div>
            <div>
              <p className="text-2xl font-bold text-(--ui-text)">{th.total_dead_tuples.toLocaleString()}</p>
              <p className="text-xs font-medium text-(--ui-text-muted)">Dead Tuples</p>
            </div>
          </div>
          {th.tables_needing_vacuum > 0 && (
            <p className="mt-2 text-[10px] text-(--ui-warning-fg)">{th.tables_needing_vacuum} table(s) need vacuum</p>
          )}
        </div>
      </div>

      {/* Schema sizes */}
      {infra.schema_sizes.length > 0 && (
        <div className="rounded-(--ui-radius-md) border border-(--ui-border) bg-(--ui-surface) p-5">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-(--ui-text-muted)">Schema Sizes</h3>
          <div className="space-y-1.5">
            {infra.schema_sizes.map((s) => (
              <div key={s.schema} className="flex items-center justify-between text-sm">
                <span className="font-medium text-(--ui-text)">{s.schema}</span>
                <span className="text-(--ui-text-muted)">{s.size_mb} MB</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Active slow queries */}
      {infra.slow_queries_now.length > 0 && (
        <div className="rounded-(--ui-radius-md) border border-(--ui-danger-bg) bg-(--ui-danger-bg) p-5">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-(--ui-danger-fg)">
            <Clock size={14} /> Slow Queries Running Now
          </h3>
          <div className="space-y-2">
            {infra.slow_queries_now.map((q) => (
              <div key={q.pid} className="rounded-(--ui-radius-sm) bg-(--ui-surface) border border-(--ui-danger-bg) p-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] font-semibold text-(--ui-danger-fg)">{q.duration_s}s</span>
                  <span className="text-[10px] text-(--ui-text-muted)">PID {q.pid} · {q.username}</span>
                </div>
                <p className="text-xs text-(--ui-text) font-mono break-all">{q.query}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Historical slow queries */}
      {infra.slow_queries_historical.length > 0 && (
        <div className="rounded-(--ui-radius-md) border border-(--ui-border) bg-(--ui-surface) p-5">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-(--ui-text-muted)">
            Slowest Queries (Historical Avg)
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-(--ui-border) text-left text-(--ui-text-muted)">
                  <th className="pb-2 pr-4 font-medium">Query</th>
                  <th className="pb-2 pr-4 font-medium text-right">Avg (ms)</th>
                  <th className="pb-2 pr-4 font-medium text-right">Calls</th>
                  <th className="pb-2 font-medium text-right">Total (ms)</th>
                </tr>
              </thead>
              <tbody>
                {infra.slow_queries_historical.map((q, i) => (
                  <tr key={i} className="border-b border-(--ui-border) last:border-0">
                    <td className="py-2 pr-4 font-mono text-(--ui-text) max-w-xs truncate">{q.query}</td>
                    <td className="py-2 pr-4 text-right font-semibold text-(--ui-text)">{q.mean_time_ms}</td>
                    <td className="py-2 pr-4 text-right text-(--ui-text-muted)">{q.calls}</td>
                    <td className="py-2 text-right text-(--ui-text-muted)">{Number(q.total_time_ms).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Table health details */}
      {th.worst_tables.length > 0 && (
        <details className="rounded-(--ui-radius-md) border border-(--ui-border) bg-(--ui-surface)">
          <summary className="cursor-pointer p-5 text-sm font-semibold text-(--ui-text-muted) uppercase tracking-wide hover:text-(--ui-text)">
            Table Health Details ({th.worst_tables.length} tables with dead tuples)
          </summary>
          <div className="px-5 pb-5">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-(--ui-border) text-left text-(--ui-text-muted)">
                    <th className="pb-2 pr-4 font-medium">Schema</th>
                    <th className="pb-2 pr-4 font-medium">Table</th>
                    <th className="pb-2 pr-4 font-medium text-right">Dead</th>
                    <th className="pb-2 pr-4 font-medium text-right">Live</th>
                    <th className="pb-2 font-medium">Last Vacuum</th>
                  </tr>
                </thead>
                <tbody>
                  {th.worst_tables.map((t, i) => (
                    <tr key={i} className="border-b border-(--ui-border) last:border-0">
                      <td className="py-1.5 pr-4 text-(--ui-text-muted)">{t.schema}</td>
                      <td className="py-1.5 pr-4 font-medium text-(--ui-text)">{t.table}</td>
                      <td className={`py-1.5 pr-4 text-right font-semibold ${t.dead_tuples > 1000 ? "text-(--ui-warning-fg)" : "text-(--ui-text)"}`}>
                        {t.dead_tuples.toLocaleString()}
                      </td>
                      <td className="py-1.5 pr-4 text-right text-(--ui-text-muted)">{t.live_tuples.toLocaleString()}</td>
                      <td className="py-1.5 text-(--ui-text-muted)">
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
  const [billingAttention, setBillingAttention] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revenue, setRevenue] = useState(null);
  const [workers, setWorkers] = useState(null);
  const [orphans, setOrphans] = useState(null);
  const [backups, setBackups] = useState(null);
  const [announcements, setAnnouncements] = useState([]);
  const [backupLoading, setBackupLoading] = useState(false);
  const [migrateLoading, setMigrateLoading] = useState(false);
  const [migrateResult, setMigrateResult] = useState(null);
  const [cleanupLoading, setCleanupLoading] = useState(false);
  const [showAnnouncementForm, setShowAnnouncementForm] = useState(false);
  const [annForm, setAnnForm] = useState({ message: "", type: "info", ends_at: "" });

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
    fetch(`${API_BASE}/api/admin/billing-attention`, { headers })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (data) setBillingAttention(data); })
      .catch(() => {});
    adminFetch("/api/admin/revenue-stats")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (data) setRevenue(data); })
      .catch(() => {});
    adminFetch("/api/admin/worker-status")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (data) setWorkers(data); })
      .catch(() => {});
    adminFetch("/api/admin/orphaned-schemas")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (data) setOrphans(data); })
      .catch(() => {});
    adminFetch("/api/admin/backup-history")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (data) setBackups(data); })
      .catch(() => {});
    adminFetch("/api/admin/announcements")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (data) setAnnouncements(Array.isArray(data) ? data : data.announcements || []); })
      .catch(() => {});
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-sm text-(--ui-text-muted)">Loading dashboard...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-(--ui-radius-sm) border border-(--ui-danger-bg) bg-(--ui-danger-bg) p-4">
        <p className="text-sm text-(--ui-danger-fg)">{error}</p>
      </div>
    );
  }

  const t = stats?.totals || {};

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-(--ui-text)">Dashboard</h1>

      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={Server} label="Total Tenants" value={t.total} color="bg-(--ui-primary)" />
        <StatCard icon={Activity} label="Active" value={t.active} color="bg-(--ui-primary)" />
        <StatCard icon={Building2} label="Suspended" value={t.suspended} color="bg-(--ui-warning-fg)" />
        <StatCard icon={Users} label="Pro Plans" value={t.pro_plan} color="bg-(--ui-primary)" />
      </div>

      {/* Plan breakdown */}
      <div className="mb-8 rounded-(--ui-radius-md) border border-(--ui-border) bg-(--ui-surface) p-5">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-(--ui-text-muted)">
          Plan Distribution
        </h2>
        <div className="flex gap-6">
          <div>
            <p className="text-lg font-bold text-(--ui-text)">{t.free_plan ?? 0}</p>
            <p className="text-xs text-(--ui-text-muted)">Free</p>
          </div>
          <div>
            <p className="text-lg font-bold text-(--ui-text)">{t.pro_plan ?? 0}</p>
            <p className="text-xs text-(--ui-text-muted)">Pro</p>
          </div>
        </div>
      </div>

      {/* Needs Attention */}
      <div className="mb-8 rounded-(--ui-radius-md) border border-(--ui-border) bg-(--ui-surface) p-5">
        <h2 className="mb-4 text-lg font-semibold text-(--ui-text)">Needs Attention</h2>
        {!attention ? (
          <p className="text-sm text-(--ui-text-muted)">Loading...</p>
        ) : attention.approaching_limits.length === 0 && attention.dormant.length === 0 && attention.setup_pending.length === 0 ? (
          <p className="text-sm font-medium text-(--ui-success-fg)">All tenants healthy</p>
        ) : (
          <div className="space-y-3">
            {attention.approaching_limits.length > 0 && (
              <div>
                <p className="text-sm font-medium text-(--ui-warning-fg)">
                  {attention.approaching_limits.length} approaching plan limits
                </p>
                {attention.approaching_limits.map((a) => (
                  <p key={`${a.id}-${a.dimension}`} className="ml-2 text-xs text-(--ui-text-muted)">
                    {a.name}: {a.used}/{a.max} {a.dimension}
                  </p>
                ))}
              </div>
            )}
            {attention.dormant.length > 0 && (
              <div>
                <p className="text-sm font-medium text-(--ui-danger-fg)">
                  {attention.dormant.length} dormant tenants
                </p>
                {attention.dormant.map((d) => (
                  <p key={d.id} className="ml-2 text-xs text-(--ui-text-muted)">
                    {d.name}: {d.days_inactive ? `${d.days_inactive}d inactive` : "Never logged in"}
                  </p>
                ))}
              </div>
            )}
            {attention.setup_pending.length > 0 && (
              <div>
                <p className="text-sm font-medium text-(--ui-text)">
                  {attention.setup_pending.length} setup pending
                </p>
                {attention.setup_pending.map((s) => (
                  <p key={s.id} className="ml-2 text-xs text-(--ui-text-muted)">{s.name}</p>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Billing Attention */}
      {billingAttention && (billingAttention.due_soon.length > 0 || billingAttention.overdue.length > 0 || billingAttention.past_grace.length > 0 || billingAttention.pending_upgrades > 0) && (
        <div className="mb-8 rounded-(--ui-radius-md) border border-(--ui-border) bg-(--ui-surface) p-5">
          <h2 className="mb-4 text-lg font-semibold text-(--ui-text)">Billing Attention</h2>
          <div className="space-y-3">
            {billingAttention.past_grace.length > 0 && (
              <div className="rounded-(--ui-radius-sm) bg-(--ui-danger-bg) border border-(--ui-danger-bg) p-3">
                <p className="text-sm font-semibold text-(--ui-danger-fg)">{billingAttention.past_grace.length} tenant(s) past grace period — should be suspended</p>
                {billingAttention.past_grace.map(t => (
                  <a key={t.id} href={`/admin/tenants/${t.id}`} className="block text-sm text-(--ui-danger-fg) hover:underline mt-1">{t.name} ({t.slug})</a>
                ))}
              </div>
            )}
            {billingAttention.overdue.length > 0 && (
              <div className="rounded-(--ui-radius-sm) bg-(--ui-warning-bg) border border-(--ui-border) p-3">
                <p className="text-sm font-semibold text-(--ui-warning-fg)">{billingAttention.overdue.length} tenant(s) overdue — in grace period</p>
                {billingAttention.overdue.map(t => (
                  <a key={t.id} href={`/admin/tenants/${t.id}`} className="block text-sm text-(--ui-warning-fg) hover:underline mt-1">{t.name} ({t.slug})</a>
                ))}
              </div>
            )}
            {billingAttention.due_soon.length > 0 && (
              <div className="rounded-(--ui-radius-sm) bg-(--ui-muted-surface) border border-(--ui-border) p-3">
                <p className="text-sm font-semibold text-(--ui-text)">{billingAttention.due_soon.length} tenant(s) expiring within 7 days</p>
                {billingAttention.due_soon.map(t => (
                  <a key={t.id} href={`/admin/tenants/${t.id}`} className="block text-sm text-(--ui-link) hover:underline mt-1">{t.name} ({t.slug})</a>
                ))}
              </div>
            )}
            {billingAttention.pending_upgrades > 0 && (
              <div className="rounded-(--ui-radius-sm) bg-(--ui-muted-surface) border border-(--ui-border) p-3">
                <p className="text-sm font-semibold text-(--ui-text)">{billingAttention.pending_upgrades} pending upgrade request(s)</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Revenue Stats */}
      {revenue && (
        <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard icon={DollarSign} label="MRR" value={revenue.mrr != null ? Number(revenue.mrr).toLocaleString() : "—"} color="bg-(--ui-primary)" />
          <StatCard icon={TrendingUp} label="Revenue This Month" value={revenue.revenue_this_month != null ? Number(revenue.revenue_this_month).toLocaleString() : "—"} color="bg-(--ui-primary)" />
          <StatCard icon={CreditCard} label="Paying Tenants" value={revenue.paying_tenants ?? "—"} color="bg-(--ui-primary)" />
          <StatCard icon={AlertCircle} label="Overdue" value={revenue.overdue_count ?? 0} color={revenue.overdue_count > 0 ? "bg-(--ui-danger)" : "bg-(--ui-primary)"} />
        </div>
      )}

      {/* Worker Status */}
      {workers && (
        <div className="mb-8 rounded-(--ui-radius-md) border border-(--ui-border) bg-(--ui-surface) p-5">
          <h2 className="mb-4 text-lg font-semibold text-(--ui-text)">Worker Status</h2>
          <div className="space-y-2">
            {Object.entries(workers).map(([name, w]) => {
              if (!w || typeof w !== "object") return null;
              const dotColor = !w.enabled
                ? "bg-(--ui-border-strong)"
                : w.running
                ? "bg-(--ui-success-fg)"
                : "bg-(--ui-danger)";
              const stateLabel = !w.enabled ? "disabled" : w.running ? "running" : "stopped";
              return (
                <div key={name} className="flex items-center justify-between rounded-(--ui-radius-sm) border border-(--ui-border) px-4 py-2.5">
                  <div className="flex items-center gap-3">
                    <span className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${dotColor}`} />
                    <span className="text-sm font-medium text-(--ui-text)">{name}</span>
                    <span className="text-[10px] uppercase tracking-wider text-(--ui-text-muted)">{stateLabel}</span>
                  </div>
                  <div className="flex items-center gap-4 text-xs text-(--ui-text-muted)">
                    {w.enabled && w.queue_depth != null && <span>Queue: {w.queue_depth}</span>}
                    {w.enabled && w.processed_today != null && <span>Today: {w.processed_today}</span>}
                    {w.last_poll_at && (
                      <span title={new Date(w.last_poll_at).toLocaleString()}>
                        {w.last_poll_ago_seconds < 60
                          ? `${w.last_poll_ago_seconds}s ago`
                          : w.last_poll_ago_seconds < 3600
                          ? `${Math.round(w.last_poll_ago_seconds / 60)}m ago`
                          : `${Math.round(w.last_poll_ago_seconds / 3600)}h ago`}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Orphaned Schema Detector */}
      {orphans && (
        <div className="mb-8 rounded-(--ui-radius-md) border border-(--ui-border) bg-(--ui-surface) p-5">
          <h2 className="mb-4 text-lg font-semibold text-(--ui-text)">Orphaned Schemas</h2>
          {(orphans.schemas || []).length === 0 ? (
            <div className="flex items-center gap-2 text-sm font-medium text-(--ui-success-fg)">
              <CheckCircle size={16} /> All schemas healthy
            </div>
          ) : (
            <div>
              <div className="mb-3 rounded-(--ui-radius-sm) border border-(--ui-border) bg-(--ui-warning-bg) p-3">
                <p className="text-sm font-semibold text-(--ui-warning-fg)">{orphans.schemas.length} orphaned schema(s) found</p>
              </div>
              <div className="mb-3 space-y-1">
                {orphans.schemas.map((s) => (
                  <div key={s.schema || s.name} className="flex items-center justify-between text-sm">
                    <span className="font-medium text-(--ui-text)">{s.schema || s.name}</span>
                    {s.size_mb != null && <span className="text-(--ui-text-muted)">{s.size_mb} MB</span>}
                  </div>
                ))}
              </div>
              <button
                onClick={async () => {
                  if (!window.confirm("This will permanently delete orphaned schemas. Continue?")) return;
                  setCleanupLoading(true);
                  try {
                    const r = await adminFetch("/api/admin/orphaned-schemas/cleanup", { method: "POST" });
                    if (r.ok) {
                      const data = await r.json();
                      setOrphans({ schemas: [] });
                      alert(`Cleaned up ${data.cleaned ?? 0} schema(s).`);
                    } else {
                      alert("Cleanup failed.");
                    }
                  } catch { alert("Cleanup request failed."); }
                  setCleanupLoading(false);
                }}
                disabled={cleanupLoading}
                className="rounded-full bg-(--ui-primary) px-4 py-2 text-sm font-semibold text-white hover:bg-(--ui-primary-strong) disabled:opacity-50"
              >
                {cleanupLoading ? "Cleaning..." : "Clean Up"}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Database Backup */}
      <div className="mb-8 rounded-(--ui-radius-md) border border-(--ui-border) bg-(--ui-surface) p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-(--ui-text)">Database Backup</h2>
          <button
            onClick={async () => {
              setBackupLoading(true);
              try {
                const r = await adminFetch("/api/admin/backup", { method: "POST" });
                if (r.ok) {
                  const data = await r.json();
                  // Refresh backup list
                  const lr = await adminFetch("/api/admin/backup-history");
                  if (lr.ok) { const ld = await lr.json(); setBackups(ld); }
                  alert(data.message || "Backup started.");
                } else {
                  alert("Backup failed.");
                }
              } catch { alert("Backup request failed."); }
              setBackupLoading(false);
            }}
            disabled={backupLoading}
            className="flex items-center gap-2 rounded-full bg-(--ui-primary) px-4 py-2 text-sm font-semibold text-white hover:bg-(--ui-primary-strong) disabled:opacity-50"
          >
            <HardDriveDownload size={14} />
            {backupLoading ? "Backing up..." : "Backup Now"}
          </button>
        </div>
        {backups && (backups.backups || []).length > 0 ? (
          <div className="space-y-1.5">
            {(backups.backups || []).map((b, i) => (
              <div key={i} className="flex items-center justify-between rounded-(--ui-radius-sm) border border-(--ui-border) px-4 py-2 text-sm">
                <span className="font-medium text-(--ui-text)">{b.filename || b.name}</span>
                <div className="flex items-center gap-3 text-xs text-(--ui-text-muted)">
                  {b.size && <span>{b.size}</span>}
                  {b.created_at && <span>{new Date(b.created_at).toLocaleString()}</span>}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-(--ui-text-muted)">No backups recorded yet.</p>
        )}
      </div>

      {/* Migrate All Tenants */}
      <div className="mb-8 rounded-(--ui-radius-md) border border-(--ui-border) bg-(--ui-surface) p-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-(--ui-text)">Migrate All Tenants</h2>
            <p className="text-xs text-(--ui-text-muted)">Run pending migrations on all tenant schemas.</p>
          </div>
          <button
            onClick={async () => {
              if (!window.confirm("Run migrations on ALL tenant schemas? This may take a moment.")) return;
              setMigrateLoading(true);
              setMigrateResult(null);
              try {
                const r = await adminFetch("/api/admin/migrate-all", { method: "POST" });
                if (r.ok) {
                  const data = await r.json();
                  setMigrateResult(data);
                } else {
                  setMigrateResult({ error: "Migration failed." });
                }
              } catch { setMigrateResult({ error: "Migration request failed." }); }
              setMigrateLoading(false);
            }}
            disabled={migrateLoading}
            className="flex items-center gap-2 rounded-full bg-(--ui-primary) px-4 py-2 text-sm font-semibold text-white hover:bg-(--ui-primary-strong) disabled:opacity-50"
          >
            <RefreshCw size={14} className={migrateLoading ? "animate-spin" : ""} />
            {migrateLoading ? "Migrating..." : "Migrate All"}
          </button>
        </div>
        {migrateResult && (
          <div className={`mt-3 rounded-(--ui-radius-sm) p-3 text-sm ${migrateResult.error ? "bg-(--ui-danger-bg) border border-(--ui-danger-bg) text-(--ui-danger-fg)" : "bg-(--ui-success-bg) border border-(--ui-border) text-(--ui-success-fg)"}`}>
            {migrateResult.error
              ? migrateResult.error
              : `Done. ${migrateResult.migrated ?? 0} schema(s) migrated, ${migrateResult.skipped ?? 0} already current.${migrateResult.errors?.length ? ` ${migrateResult.errors.length} error(s).` : ""}`
            }
          </div>
        )}
      </div>

      {/* Announcements Management */}
      <div className="mb-8 rounded-(--ui-radius-md) border border-(--ui-border) bg-(--ui-surface) p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-(--ui-text)">Announcements</h2>
          <button
            onClick={() => setShowAnnouncementForm(!showAnnouncementForm)}
            className="flex items-center gap-2 rounded-full bg-(--ui-primary) px-4 py-2 text-sm font-semibold text-white hover:bg-(--ui-primary-strong)"
          >
            <Megaphone size={14} />
            {showAnnouncementForm ? "Cancel" : "New Announcement"}
          </button>
        </div>

        {showAnnouncementForm && (
          <div className="mb-4 rounded-(--ui-radius-sm) border border-(--ui-border) bg-(--ui-muted-surface) p-4 space-y-3">
            <input
              type="text"
              placeholder="Announcement message..."
              value={annForm.message}
              onChange={(e) => setAnnForm({ ...annForm, message: e.target.value })}
              className="w-full rounded-(--ui-radius-sm) border border-(--ui-border-strong) px-3 py-2 text-sm ui-focus-ring focus:outline-none"
            />
            <div className="flex items-center gap-3">
              <select
                value={annForm.type}
                onChange={(e) => setAnnForm({ ...annForm, type: e.target.value })}
                className="rounded-(--ui-radius-sm) border border-(--ui-border-strong) px-3 py-2 text-sm ui-focus-ring focus:outline-none"
              >
                <option value="info">Info</option>
                <option value="warning">Warning</option>
                <option value="maintenance">Maintenance</option>
              </select>
              <input
                type="datetime-local"
                value={annForm.ends_at}
                onChange={(e) => setAnnForm({ ...annForm, ends_at: e.target.value })}
                className="rounded-(--ui-radius-sm) border border-(--ui-border-strong) px-3 py-2 text-sm ui-focus-ring focus:outline-none"
                placeholder="End time (optional)"
              />
              <button
                onClick={async () => {
                  if (!annForm.message.trim()) return;
                  const body = { message: annForm.message, type: annForm.type };
                  if (annForm.ends_at) body.ends_at = new Date(annForm.ends_at).toISOString();
                  const r = await adminFetch("/api/admin/announcements", { method: "POST", body: JSON.stringify(body) });
                  if (r.ok) {
                    const created = await r.json();
                    setAnnouncements((prev) => [created, ...prev]);
                    setAnnForm({ message: "", type: "info", ends_at: "" });
                    setShowAnnouncementForm(false);
                  }
                }}
                className="rounded-full bg-(--ui-primary) px-4 py-2 text-sm font-semibold text-white hover:bg-(--ui-primary-strong)"
              >
                Create
              </button>
            </div>
          </div>
        )}

        {announcements.length === 0 ? (
          <p className="text-sm text-(--ui-text-muted)">No announcements.</p>
        ) : (
          <div className="space-y-2">
            {announcements.map((a) => (
              <div key={a.id} className="flex items-center justify-between rounded-(--ui-radius-sm) border border-(--ui-border) px-4 py-2.5">
                <div className="flex items-center gap-3">
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                    a.type === "warning" ? "bg-(--ui-warning-bg) text-(--ui-warning-fg)" :
                    a.type === "maintenance" ? "bg-(--ui-danger-bg) text-(--ui-danger-fg)" :
                    "bg-(--ui-muted-surface) text-(--ui-text)"
                  }`}>{a.type}</span>
                  <span className={`text-sm ${a.active === false ? "text-(--ui-text-muted) line-through" : "text-(--ui-text)"}`}>{a.message}</span>
                </div>
                <div className="flex items-center gap-2">
                  {a.active !== false && (
                    <button
                      onClick={async () => {
                        const r = await adminFetch(`/api/admin/announcements/${a.id}`, {
                          method: "PUT",
                          body: JSON.stringify({ active: false }),
                        });
                        if (r.ok) setAnnouncements((prev) => prev.map((x) => x.id === a.id ? { ...x, active: false } : x));
                      }}
                      className="text-xs text-(--ui-warning-fg) hover:text-(--ui-warning-fg) font-medium"
                    >
                      Deactivate
                    </button>
                  )}
                  <button
                    onClick={async () => {
                      const r = await adminFetch(`/api/admin/announcements/${a.id}`, { method: "DELETE" });
                      if (r.ok) setAnnouncements((prev) => prev.filter((x) => x.id !== a.id));
                    }}
                    className="text-xs text-(--ui-danger-fg) hover:text-(--ui-danger-fg) font-medium"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Infrastructure Monitoring */}
      <InfrastructurePanel />

      {/* Recent tenants */}
      {stats?.recent_tenants?.length > 0 && (
        <div className="mb-8 rounded-(--ui-radius-md) border border-(--ui-border) bg-(--ui-surface) p-5">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-(--ui-text-muted)">
            Recent Tenants
          </h2>
          <div className="space-y-2">
            {stats.recent_tenants.map((t) => (
              <div
                key={t.id}
                className="flex cursor-pointer items-center justify-between rounded-(--ui-radius-sm) border border-(--ui-border) px-4 py-2.5 transition hover:bg-(--ui-muted-surface)"
                onClick={() => navigate(`/admin/tenants/${t.id}`)}
              >
                <div>
                  <span className="text-sm font-medium text-(--ui-text)">{t.name}</span>
                  <span className="ml-2 text-xs text-(--ui-text-muted)">{t.slug}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                    t.status === "active" ? "bg-(--ui-success-bg) text-(--ui-success-fg)" :
                    t.status === "suspended" ? "bg-(--ui-warning-bg) text-(--ui-warning-fg)" :
                    "bg-(--ui-muted-surface) text-(--ui-text-muted)"
                  }`}>{t.status}</span>
                  <span className="rounded-full bg-(--ui-muted-surface) px-2 py-0.5 text-[10px] font-semibold text-(--ui-text-muted)">
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
        <div className="rounded-(--ui-radius-md) border border-(--ui-border) bg-(--ui-surface) p-5">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-(--ui-text-muted)">
            Recent Activity
          </h2>
          <div className="space-y-2">
            {stats.recent_audit.map((entry, i) => (
              <div key={i} className="flex items-center justify-between border-b border-(--ui-border) py-1.5 last:border-0">
                <div>
                  <span className="text-sm font-medium text-(--ui-text)">{entry.action}</span>
                  {entry.tenant_slug && (
                    <span className="ml-2 text-xs text-(--ui-text-muted)">{entry.tenant_slug}</span>
                  )}
                </div>
                <span className="text-xs text-(--ui-text-muted)">
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
