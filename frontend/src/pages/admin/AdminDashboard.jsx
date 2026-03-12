import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Activity, Building2, Server, Users } from "lucide-react";
import { API_BASE } from "../../config";
import { getAdminToken } from "./AdminLogin";

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
                  {entry.created_at ? new Date(entry.created_at + "Z").toLocaleString() : "—"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
