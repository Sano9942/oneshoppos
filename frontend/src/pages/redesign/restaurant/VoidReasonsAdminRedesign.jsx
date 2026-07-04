import { useCallback, useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { Ban, Gift, GripVertical } from "lucide-react";
import { PageShell, SectionCard, Button } from "../../../ui/primitives";
import { useAuth } from "../../../auth/AuthProvider";
import useFeatureFlags from "../../../hooks/useFeatureFlags";
import { useToast } from "../../../contexts/ToastContext";
import { api } from "../../../api";

// Phase 2-R.2 — Super-admin CRUD-lite for void/comp reason codes.
// Reasons are seeded at migration time; this page exposes toggle-active
// and sort_order editing. Creating/deleting reasons is intentionally out
// of scope — the seeded set reflects the house playbook.

export default function VoidReasonsAdminRedesign() {
  const { authHeaders, hasPerm } = useAuth();
  const { flags, loading: flagsLoading } = useFeatureFlags(authHeaders);
  const { success, error } = useToast();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Fetch both adjustment types (empty filter returns all active); we
      // need the full set (including inactive) for the admin page, but the
      // backend filter on /void-reasons only returns active. Use the list
      // endpoint without filter for "all active" and let toggling call PATCH.
      const data = await api.get("/api/restaurant/void-reasons");
      setRows(Array.isArray(data) ? data : []);
    } catch (e) {
      error(e?.message || "Failed to load reason codes");
    } finally {
      setLoading(false);
    }
  }, [error]);

  useEffect(() => { load(); }, [load]);

  if (flagsLoading) return null;
  if (!flags.phase4_restaurant_void_comp) return <Navigate to="/" replace />;
  if (!hasPerm("all_access")) return <Navigate to="/" replace />;

  const toggleActive = async (row) => {
    setBusyId(row.id);
    // Backend only registers PATCH /void-reasons/:id (no PUT); api.js has no
    // patch() helper, so use the raw-fetch PATCH pattern bumpSort uses below.
    try {
      const res = await fetch(`/api/restaurant/void-reasons/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: !row.is_active }),
      });
      if (!res.ok) throw new Error((await res.json())?.error || `HTTP ${res.status}`);
      success(`${row.label} ${row.is_active ? "hidden" : "enabled"}`);
      await load();
    } catch (err) {
      error(err?.message || "Failed to toggle");
    } finally {
      setBusyId(null);
    }
  };

  const bumpSort = async (row, delta) => {
    setBusyId(row.id);
    try {
      const res = await fetch(`/api/restaurant/void-reasons/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sort_order: Math.max(0, (row.sort_order || 0) + delta) }),
      });
      if (!res.ok) throw new Error((await res.json())?.error || `HTTP ${res.status}`);
      await load();
    } catch (err) {
      error(err?.message || "Failed to reorder");
    } finally {
      setBusyId(null);
    }
  };

  const typeBadge = (t) => {
    const tone = t === "void" ? "rose" : t === "comp" ? "emerald" : "slate";
    const Icon = t === "void" ? Ban : t === "comp" ? Gift : GripVertical;
    return (
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-${tone}-50 text-${tone}-700 border border-${tone}-200`}>
        <Icon size={12} /> {t}
      </span>
    );
  };

  return (
    <PageShell title="Void / Comp Reasons" subtitle="Manage the reason codes staff pick from when adjusting a sale item">
      <SectionCard>
        {loading ? (
          <div className="p-6 text-slate-500 text-sm">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="p-6 text-slate-500 text-sm">No reason codes configured.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase font-bold text-slate-500 border-b border-slate-200">
                <th className="py-3 px-4">Code</th>
                <th className="py-3 px-4">Label</th>
                <th className="py-3 px-4">Type</th>
                <th className="py-3 px-4">Order</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="py-3 px-4 font-mono text-xs text-slate-600">{r.code}</td>
                  <td className="py-3 px-4 font-semibold text-slate-900">{r.label}</td>
                  <td className="py-3 px-4">{typeBadge(r.adjustment_type)}</td>
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => bumpSort(r, -10)}
                        disabled={busyId === r.id}
                        className="w-7 h-7 rounded border border-slate-300 text-slate-600 hover:bg-slate-100 disabled:opacity-50"
                      >↑</button>
                      <span className="w-10 text-center text-slate-700">{r.sort_order}</span>
                      <button
                        onClick={() => bumpSort(r, 10)}
                        disabled={busyId === r.id}
                        className="w-7 h-7 rounded border border-slate-300 text-slate-600 hover:bg-slate-100 disabled:opacity-50"
                      >↓</button>
                    </div>
                  </td>
                  <td className="py-3 px-4">
                    {r.is_active ? (
                      <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">Active</span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-slate-50 text-slate-500 border border-slate-200">Hidden</span>
                    )}
                  </td>
                  <td className="py-3 px-4">
                    <Button
                      size="sm"
                      variant={r.is_active ? "ghost" : "primary"}
                      onClick={() => toggleActive(r)}
                      disabled={busyId === r.id}
                    >
                      {r.is_active ? "Hide" : "Enable"}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </SectionCard>
    </PageShell>
  );
}
