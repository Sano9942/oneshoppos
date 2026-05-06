import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { Clock, Trash2, Plus, Save } from "lucide-react";
import { PageShell, SectionCard, Button, Input, Select, EmptyState } from "../../../ui/primitives";
import { useAuth } from "../../../auth/AuthProvider";
import useFeatureFlags from "../../../hooks/useFeatureFlags";
import { useToast } from "../../../contexts/ToastContext";
import { api } from "../../../api";

// Phase 2-R.6 — Menu schedules admin.
//
// Visual design: left panel = weekly grid (7 columns × 24 rows), right
// panel = selected schedule editor. Clicking a time cell in the grid
// creates a draft schedule pre-filled to that day/hour. The grid renders
// existing schedules as overlays so the operator can see how breakfast /
// lunch / happy-hour stack up across the week.

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const HOURS = Array.from({ length: 24 }, (_, i) => i);

function fmtTime(hhmm) {
  if (!hhmm) return "";
  const [h, m] = String(hhmm).split(":");
  return `${h.padStart(2, "0")}:${(m || "00").slice(0, 2)}`;
}

function hourFromTime(str) {
  if (!str) return 0;
  return Number(String(str).split(":")[0]) || 0;
}

export default function MenuSchedulesRedesign() {
  const { authHeaders, hasPerm } = useAuth();
  const { flags, loading: flagsLoading } = useFeatureFlags(authHeaders);
  const { success, error } = useToast();
  const [schedules, setSchedules] = useState([]);
  const [outlets, setOutlets] = useState([]);
  const [products, setProducts] = useState([]);
  const [selectedOutletId, setSelectedOutletId] = useState("");
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // draft schedule being edited
  const [saving, setSaving] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [sched, outs, prods] = await Promise.all([
        api.get("/api/restaurant/menu-schedules"),
        api.get("/api/outlets").catch(() => []),
        api.get("/api/products?limit=500").catch(() => ({ products: [] })),
      ]);
      setSchedules(Array.isArray(sched) ? sched : []);
      setOutlets(Array.isArray(outs) ? outs : outs?.outlets || []);
      setProducts(Array.isArray(prods?.products) ? prods.products : prods?.products || prods || []);
    } catch (e) {
      error(e?.message || "Failed to load menu schedules");
    } finally {
      setLoading(false);
    }
  }, [error]);

  useEffect(() => { loadAll(); }, [loadAll]);

  // W2 — useMemo MUST be called before any conditional early returns. Calling
  // it after the flagsLoading/perm gates produces a different hook count
  // across renders (none on first render, one on second) → React #310.
  const filtered = useMemo(
    () => selectedOutletId
      ? schedules.filter((s) => !s.outlet_id || String(s.outlet_id) === String(selectedOutletId))
      : schedules,
    [schedules, selectedOutletId]
  );

  if (flagsLoading) return null;
  if (!flags.phase4_restaurant_day_parting) return <Navigate to="/" replace />;
  if (!hasPerm("manage_restaurant")) return <Navigate to="/" replace />;

  const cellClick = (dow, hour) => {
    setEditing({
      name: `Schedule ${DAYS[dow]} ${String(hour).padStart(2, "0")}:00`,
      outlet_id: selectedOutletId ? Number(selectedOutletId) : null,
      day_of_week: dow,
      start_time: `${String(hour).padStart(2, "0")}:00`,
      end_time: `${String(Math.min(23, hour + 2)).padStart(2, "0")}:00`,
      product_ids: [],
      is_active: true,
    });
  };

  const save = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      const payload = { ...editing };
      if (editing.id) {
        await api.put(`/api/restaurant/menu-schedules/${editing.id}`, payload);
        success("Schedule updated");
      } else {
        await api.post("/api/restaurant/menu-schedules", payload);
        success("Schedule created");
      }
      setEditing(null);
      await loadAll();
    } catch (e) {
      error(e?.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const del = async (id) => {
    if (!confirm("Delete this schedule?")) return;
    try {
      await api.del(`/api/restaurant/menu-schedules/${id}`);
      success("Schedule deleted");
      await loadAll();
    } catch (e) {
      error(e?.message || "Failed to delete");
    }
  };

  return (
    <PageShell
      title="Menu Schedules"
      subtitle="Day-parting: breakfast, lunch, happy-hour windows. Unassigned products are always available."
      right={
        <div className="flex gap-2">
          <Select value={selectedOutletId} onChange={(e) => setSelectedOutletId(e.target.value)}>
            <option value="">All outlets</option>
            {outlets.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </Select>
          <Button
            tone="primary"
            onClick={() => setEditing({
              name: "New Schedule",
              outlet_id: selectedOutletId ? Number(selectedOutletId) : null,
              day_of_week: 1,
              start_time: "07:00",
              end_time: "11:00",
              product_ids: [],
              is_active: true,
            })}
          >
            <Plus size={14} /> New
          </Button>
        </div>
      }
    >
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Weekly grid */}
        <SectionCard className="lg:col-span-2 p-0 overflow-auto">
          {loading ? (
            <div className="p-6 text-slate-500 text-sm">Loading…</div>
          ) : (
            <div className="min-w-[720px]">
              <div className="grid grid-cols-8 sticky top-0 bg-white z-10 border-b border-slate-200">
                <div className="py-2 px-2 text-xs font-bold uppercase text-slate-500">
                  <Clock size={12} className="inline" />
                </div>
                {DAYS.map((d, i) => (
                  <div key={i} className="py-2 px-2 text-center text-xs font-bold uppercase text-slate-500">
                    {d}
                  </div>
                ))}
              </div>
              {HOURS.map((h) => (
                <div key={h} className="grid grid-cols-8 border-b border-slate-100 hover:bg-slate-50/50">
                  <div className="py-1 px-2 text-xs font-mono text-slate-400 border-r border-slate-100">
                    {String(h).padStart(2, "0")}:00
                  </div>
                  {DAYS.map((_, dow) => {
                    const overlays = filtered.filter((s) => {
                      if (s.day_of_week != null && Number(s.day_of_week) !== dow) return false;
                      return hourFromTime(s.start_time) <= h && hourFromTime(s.end_time) > h;
                    });
                    return (
                      <button
                        key={dow}
                        type="button"
                        onClick={() => cellClick(dow, h)}
                        className="py-1 px-1 border-l border-slate-100 hover:bg-indigo-50 text-left relative h-7"
                      >
                        {overlays.map((s) => (
                          <div
                            key={s.id}
                            className="absolute inset-0 bg-[#8066FF] opacity-70 text-white text-[10px] font-bold px-1 truncate"
                            style={{ opacity: s.is_active ? 0.7 : 0.25 }}
                            title={`${s.name} (${s.start_time}-${s.end_time})`}
                          >
                            {s.name}
                          </div>
                        ))}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        {/* Editor or schedule list */}
        <SectionCard className="space-y-4">
          {editing ? (
            <>
              <div className="flex items-center justify-between">
                <h3 className="font-black text-slate-900 text-base">
                  {editing.id ? "Edit schedule" : "New schedule"}
                </h3>
                <button onClick={() => setEditing(null)} className="text-xs font-bold text-slate-500 hover:text-slate-800">Cancel</button>
              </div>
              <div>
                <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Name</label>
                <Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Day</label>
                  <Select
                    value={editing.day_of_week == null ? "" : String(editing.day_of_week)}
                    onChange={(e) => setEditing({ ...editing, day_of_week: e.target.value === "" ? null : Number(e.target.value) })}
                  >
                    <option value="">Every day</option>
                    {DAYS.map((d, i) => <option key={i} value={i}>{d}</option>)}
                  </Select>
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Outlet</label>
                  <Select
                    value={editing.outlet_id == null ? "" : String(editing.outlet_id)}
                    onChange={(e) => setEditing({ ...editing, outlet_id: e.target.value === "" ? null : Number(e.target.value) })}
                  >
                    <option value="">All outlets</option>
                    {outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </Select>
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Start</label>
                  <Input type="time" value={editing.start_time?.slice(0, 5) || ""} onChange={(e) => setEditing({ ...editing, start_time: e.target.value })} />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase text-slate-500 mb-1">End</label>
                  <Input type="time" value={editing.end_time?.slice(0, 5) || ""} onChange={(e) => setEditing({ ...editing, end_time: e.target.value })} />
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold uppercase text-slate-500 mb-1">
                  Products ({(editing.product_ids || []).length})
                </label>
                <select
                  multiple
                  value={(editing.product_ids || []).map(String)}
                  onChange={(e) => {
                    const ids = Array.from(e.target.selectedOptions).map((o) => Number(o.value));
                    setEditing({ ...editing, product_ids: ids });
                  }}
                  className="w-full h-40 px-2 py-1 rounded-lg border border-slate-300 text-sm"
                >
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
                <p className="text-xs text-slate-500 mt-1">Hold Ctrl/Cmd to select multiple. Products NOT listed here are always available.</p>
              </div>
              <div className="flex justify-end gap-2">
                <Button tone="primary" onClick={save} disabled={saving}>
                  <Save size={14} /> {saving ? "Saving…" : "Save"}
                </Button>
              </div>
            </>
          ) : (
            <>
              <h3 className="font-black text-slate-900 text-base">Schedules</h3>
              {filtered.length === 0 ? (
                <EmptyState title="No schedules yet" body="Click a cell in the grid or press New to add one." />
              ) : (
                <ul className="divide-y divide-slate-100">
                  {filtered.map((s) => (
                    <li key={s.id} className="py-2 flex items-center justify-between">
                      <button
                        onClick={() => setEditing({ ...s, product_ids: s.product_ids || [] })}
                        className="text-left flex-1"
                      >
                        <div className="font-bold text-slate-900">{s.name}</div>
                        <div className="text-xs text-slate-500">
                          {s.day_of_week == null ? "Every day" : DAYS[s.day_of_week]} · {fmtTime(s.start_time)}–{fmtTime(s.end_time)}
                          {s.outlet_id ? ` · ${outlets.find((o) => o.id === s.outlet_id)?.name || "outlet"}` : ""}
                        </div>
                      </button>
                      <button
                        onClick={() => del(s.id)}
                        className="text-rose-500 hover:text-rose-700 p-1"
                      >
                        <Trash2 size={14} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </SectionCard>
      </div>
    </PageShell>
  );
}
