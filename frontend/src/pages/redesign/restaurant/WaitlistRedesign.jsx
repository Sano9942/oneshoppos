import { useCallback, useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { Users, Plus, Bell, UserCheck, Trash2 } from "lucide-react";
import { PageShell, SectionCard, Button } from "../../../ui/primitives";
import { useAuth } from "../../../auth/AuthProvider";
import useFeatureFlags from "../../../hooks/useFeatureFlags";
import { useToast } from "../../../contexts/ToastContext";
import { api } from "../../../api";

// Phase 2-R.4 — Walk-in waitlist admin.
// Auto-refreshes every 10s so the host sees new walk-ins quickly. Notify
// fires SMS; Seat opens a table-picker; Remove soft-deletes + reorders.

const STATUS_STYLES = {
  waiting: { color: "text-amber-700 bg-amber-100", label: "Waiting" },
  notified: { color: "text-sky-700 bg-sky-100", label: "Notified" },
  seated: { color: "text-violet-700 bg-violet-100", label: "Seated" },
  removed: { color: "text-slate-500 bg-slate-100", label: "Removed" },
};

export default function WaitlistRedesign() {
  const { authHeaders, hasPerm } = useAuth();
  const { flags, loading: flagsLoading } = useFeatureFlags(authHeaders);
  const { success, error } = useToast();

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ customer_name: "", phone: "", party_size: 2, quoted_wait_minutes: 15, notes: "" });
  const [busyId, setBusyId] = useState(null);
  const [seatPicker, setSeatPicker] = useState({ open: false, entry: null });
  const [tables, setTables] = useState([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get("/api/restaurant/waitlist?status=waiting,notified");
      setRows(data.entries || []);
    } catch (e) {
      error(e?.message || "Failed to load waitlist");
    } finally {
      setLoading(false);
    }
  }, [error]);

  useEffect(() => {
    load();
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, [load]);

  if (flagsLoading) return null;
  if (!flags.phase4_restaurant_reservations) return <Navigate to="/" replace />;
  if (!hasPerm("manage_restaurant")) return <Navigate to="/" replace />;

  const add = async () => {
    if (!form.customer_name || !form.party_size) { error("Name and party size required"); return; }
    try {
      await api.post("/api/restaurant/waitlist", {
        ...form,
        party_size: Number(form.party_size),
        quoted_wait_minutes: Number(form.quoted_wait_minutes) || null,
      });
      success("Added to waitlist");
      setCreating(false);
      setForm({ customer_name: "", phone: "", party_size: 2, quoted_wait_minutes: 15, notes: "" });
      await load();
    } catch (e) {
      error(e?.message || "Failed to add");
    }
  };

  const notify = async (r) => {
    setBusyId(r.id);
    try {
      await api.put(`/api/restaurant/waitlist/${r.id}/notify`, {});
      success(`${r.customer_name} notified`);
      await load();
    } catch (e) {
      error(e?.message || "Failed to notify");
    } finally { setBusyId(null); }
  };

  const openSeatPicker = async (entry) => {
    try {
      const data = await api.get("/api/restaurant/tables");
      setTables(Array.isArray(data) ? data : data.tables || []);
    } catch {
      setTables([]);
    }
    setSeatPicker({ open: true, entry });
  };

  const seat = async (tableId) => {
    const entry = seatPicker.entry;
    setBusyId(entry.id);
    try {
      await api.put(`/api/restaurant/waitlist/${entry.id}/seat`, { table_id: tableId || null });
      success(`${entry.customer_name} seated`);
      setSeatPicker({ open: false, entry: null });
      await load();
    } catch (e) {
      error(e?.message || "Failed to seat");
    } finally { setBusyId(null); }
  };

  const remove = async (r) => {
    if (!confirm(`Remove ${r.customer_name} from the waitlist?`)) return;
    setBusyId(r.id);
    try {
      await api.del(`/api/restaurant/waitlist/${r.id}`);
      success("Removed");
      await load();
    } catch (e) {
      error(e?.message || "Failed to remove");
    } finally { setBusyId(null); }
  };

  return (
    <PageShell
      title="Waitlist"
      subtitle="Walk-in guests waiting for a table"
    >
      <SectionCard>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2 text-sm text-(--ui-text-muted)">
            <Users size={16} /> {rows.length} guest{rows.length === 1 ? "" : "s"} in queue
          </div>
          <Button tone="primary" onClick={() => setCreating(true)}>
            <Plus size={14} /> Add
          </Button>
        </div>

        {loading ? (
          <div className="text-sm text-(--ui-text-muted)">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="text-sm text-(--ui-text-muted) italic py-8 text-center">
            No one is waiting.
          </div>
        ) : (
          <ul className="space-y-2">
            {rows.map((r) => {
              const style = STATUS_STYLES[r.status] || STATUS_STYLES.waiting;
              return (
                <li key={r.id} className="flex items-center gap-3 p-3 rounded-xl bg-white border border-(--ui-border)">
                  <div className="h-10 w-10 rounded-full bg-[#8066FF] text-white flex items-center justify-center font-bold">
                    #{r.position}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{r.customer_name}</span>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${style.color}`}>
                        {style.label}
                      </span>
                    </div>
                    <div className="text-xs text-(--ui-text-muted) mt-0.5">
                      Party of {r.party_size}
                      {r.phone && ` · ${r.phone}`}
                      {r.quoted_wait_minutes && ` · ${r.quoted_wait_minutes} min wait`}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    {r.status === "waiting" && (
                      <Button tone="default" onClick={() => notify(r)} disabled={busyId === r.id}>
                        <Bell size={14} /> Notify
                      </Button>
                    )}
                    <Button tone="default" onClick={() => openSeatPicker(r)} disabled={busyId === r.id}>
                      <UserCheck size={14} /> Seat
                    </Button>
                    <Button tone="default" onClick={() => remove(r)} disabled={busyId === r.id}>
                      <Trash2 size={14} />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>

      {creating && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setCreating(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-4">Add to waitlist</h3>
            <div className="space-y-3">
              <input
                placeholder="Guest name"
                value={form.customer_name}
                onChange={(e) => setForm({ ...form, customer_name: e.target.value })}
                className="w-full h-10 px-3 rounded-lg border border-slate-200 text-sm"
              />
              <input
                placeholder="Phone (for SMS notify)"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                className="w-full h-10 px-3 rounded-lg border border-slate-200 text-sm"
              />
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="number"
                  min="1"
                  placeholder="Party"
                  value={form.party_size}
                  onChange={(e) => setForm({ ...form, party_size: e.target.value })}
                  className="w-full h-10 px-3 rounded-lg border border-slate-200 text-sm"
                />
                <input
                  type="number"
                  min="0"
                  placeholder="Wait (min)"
                  value={form.quoted_wait_minutes}
                  onChange={(e) => setForm({ ...form, quoted_wait_minutes: e.target.value })}
                  className="w-full h-10 px-3 rounded-lg border border-slate-200 text-sm"
                />
              </div>
              <textarea
                rows="2"
                placeholder="Notes (optional)"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm"
              />
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <Button tone="default" onClick={() => setCreating(false)}>Cancel</Button>
              <Button tone="primary" onClick={add}>Add</Button>
            </div>
          </div>
        </div>
      )}

      {seatPicker.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setSeatPicker({ open: false, entry: null })}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-2">Seat {seatPicker.entry?.customer_name}</h3>
            <p className="text-sm text-slate-600 mb-4">Pick a table, or seat without assigning.</p>
            <div className="grid grid-cols-3 gap-2 max-h-64 overflow-y-auto">
              {tables.length === 0 && (
                <div className="col-span-3 text-center text-sm text-slate-500 italic py-4">No tables available</div>
              )}
              {tables.map((t) => (
                <button
                  key={t.id}
                  onClick={() => seat(t.id)}
                  className="h-14 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 text-sm font-bold"
                >
                  {t.label || t.name}
                </button>
              ))}
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <Button tone="default" onClick={() => setSeatPicker({ open: false, entry: null })}>Cancel</Button>
              <Button tone="primary" onClick={() => seat(null)}>Seat without table</Button>
            </div>
          </div>
        </div>
      )}
    </PageShell>
  );
}
