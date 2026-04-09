import { useState, useEffect } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider";
import useFeatureFlags from "../../hooks/useFeatureFlags";
import { useToast } from "../../contexts/ToastContext";
import { useCurrency } from "../../contexts/CurrencyContext";
import { PageShell, SectionCard, Button, Badge } from "../../ui/primitives";
import { Plus, X, Ban } from "lucide-react";
import { fmtUtcDateTime } from "../../utils/dates";
import api from "../../api";

const STATUS_TONES = { pending: "warning", applied: "success", cancelled: "default", failed: "danger" };
const CHANGE_TYPES = ["price", "visibility", "status", "tax"];
const ENTITY_TYPES = ["product", "variant"];

export default function ScheduledChangesRedesign() {
  const { authHeaders } = useAuth();
  const { flags, loading: flagsLoading } = useFeatureFlags(authHeaders);
  const toast = useToast();
  const { fmt } = useCurrency();

  const [changes, setChanges] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [filter, setFilter] = useState("pending");

  const [form, setForm] = useState({
    change_type: "price", entity_type: "product", entity_id: "", field_name: "price",
    new_value: "", scheduled_at: "", notes: "",
  });

  const fetchChanges = () => {
    const params = filter ? `?status=${filter}` : "";
    api.get(`/catalog/scheduled-changes${params}`).then(r => {
      setChanges(r.changes || []);
      setLoading(false);
    }).catch(() => setLoading(false));
  };

  useEffect(() => { fetchChanges(); }, [filter]);

  const handleCreate = async () => {
    if (!form.entity_id || !form.new_value || !form.scheduled_at) return toast.error("Fill all required fields");
    try {
      const res = await api.post("/catalog/scheduled-changes", {
        ...form,
        entity_id: Number(form.entity_id),
      });
      setChanges(prev => [res.change, ...prev]);
      toast.success("Change scheduled");
      setShowModal(false);
    } catch (err) { toast.error(err.message); }
  };

  const handleCancel = async (id) => {
    try {
      const res = await api.put(`/catalog/scheduled-changes/${id}`, { status: "cancelled" });
      setChanges(prev => prev.map(c => c.id === id ? res.change : c));
      toast.success("Change cancelled");
    } catch (err) { toast.error(err.message); }
  };

  if (flagsLoading) return null;
  if (!flags.phase2_scheduled_changes) return <Navigate to="/" replace />;

  return (
    <PageShell
      title="Scheduled Changes"
      subtitle="Automate catalog updates — price changes, visibility toggles, and status transitions on a timer"
      right={<Button size="sm" onClick={() => setShowModal(true)}><Plus size={14} className="mr-1" /> Schedule Change</Button>}
    >
      <SectionCard>
        <div className="flex gap-2 mb-4">
          {["pending", "applied", "cancelled", "failed", ""].map(s => (
            <button key={s} onClick={() => setFilter(s)} className={`px-3 py-1 text-sm rounded ${filter === s ? "bg-(--ui-primary) text-white" : "bg-(--ui-bg) border border-(--ui-border) text-(--ui-text)"}`}>
              {s || "All"}
            </button>
          ))}
        </div>

        {loading ? (
          <p className="text-(--ui-muted) text-sm py-8 text-center">Loading...</p>
        ) : changes.length === 0 ? (
          <p className="text-(--ui-muted) text-sm py-8 text-center">No scheduled changes found.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-(--ui-border) text-left text-(--ui-muted)">
                <th className="py-2 font-medium">Type</th>
                <th className="py-2 font-medium">Entity</th>
                <th className="py-2 font-medium">Field</th>
                <th className="py-2 font-medium">Old</th>
                <th className="py-2 font-medium">New</th>
                <th className="py-2 font-medium">Scheduled</th>
                <th className="py-2 font-medium">Status</th>
                <th className="py-2 font-medium">By</th>
                <th className="py-2 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {changes.map(c => (
                <tr key={c.id} className="border-b border-(--ui-border)">
                  <td className="py-2">{c.change_type}</td>
                  <td className="py-2">{c.entity_type} #{c.entity_id}</td>
                  <td className="py-2">{c.field_name}</td>
                  <td className="py-2 text-(--ui-muted)">{c.old_value || "-"}</td>
                  <td className="py-2 font-medium">{c.new_value}</td>
                  <td className="py-2">{fmtUtcDateTime(c.scheduled_at)}</td>
                  <td className="py-2"><Badge tone={STATUS_TONES[c.status]}>{c.status}</Badge></td>
                  <td className="py-2">{c.created_by_name || "-"}</td>
                  <td className="py-2 text-right">
                    {c.status === "pending" && (
                      <button onClick={() => handleCancel(c.id)} className="p-1 hover:text-red-500" title="Cancel"><Ban size={14} /></button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </SectionCard>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-(--ui-bg) rounded-lg shadow-xl w-full max-w-md p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-semibold text-(--ui-text)">Schedule a Catalog Change</h2>
              <button onClick={() => setShowModal(false)}><X size={18} /></button>
            </div>

            <label className="block text-sm text-(--ui-muted) mb-1">Change Type</label>
            <select className="w-full border border-(--ui-border) rounded px-3 py-2 mb-3 text-sm bg-(--ui-bg) text-(--ui-text)" value={form.change_type} onChange={e => setForm(f => ({ ...f, change_type: e.target.value }))}>
              {CHANGE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>

            <label className="block text-sm text-(--ui-muted) mb-1">Entity Type</label>
            <select className="w-full border border-(--ui-border) rounded px-3 py-2 mb-3 text-sm bg-(--ui-bg) text-(--ui-text)" value={form.entity_type} onChange={e => setForm(f => ({ ...f, entity_type: e.target.value }))}>
              {ENTITY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>

            <label className="block text-sm text-(--ui-muted) mb-1">Entity ID</label>
            <input className="w-full border border-(--ui-border) rounded px-3 py-2 mb-3 text-sm bg-(--ui-bg) text-(--ui-text)" type="number" placeholder="Product or variant ID" value={form.entity_id} onChange={e => setForm(f => ({ ...f, entity_id: e.target.value }))} />

            <label className="block text-sm text-(--ui-muted) mb-1">Field Name</label>
            <input className="w-full border border-(--ui-border) rounded px-3 py-2 mb-3 text-sm bg-(--ui-bg) text-(--ui-text)" placeholder="e.g. price, status" value={form.field_name} onChange={e => setForm(f => ({ ...f, field_name: e.target.value }))} />

            <label className="block text-sm text-(--ui-muted) mb-1">New Value</label>
            <input className="w-full border border-(--ui-border) rounded px-3 py-2 mb-3 text-sm bg-(--ui-bg) text-(--ui-text)" placeholder="New value to apply" value={form.new_value} onChange={e => setForm(f => ({ ...f, new_value: e.target.value }))} />

            <label className="block text-sm text-(--ui-muted) mb-1">Scheduled At</label>
            <input className="w-full border border-(--ui-border) rounded px-3 py-2 mb-3 text-sm bg-(--ui-bg) text-(--ui-text)" type="datetime-local" value={form.scheduled_at} onChange={e => setForm(f => ({ ...f, scheduled_at: e.target.value }))} />

            <label className="block text-sm text-(--ui-muted) mb-1">Notes (optional)</label>
            <textarea className="w-full border border-(--ui-border) rounded px-3 py-2 mb-3 text-sm bg-(--ui-bg) text-(--ui-text)" rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />

            <div className="flex gap-2 justify-end">
              <Button tone="plain" size="sm" onClick={() => setShowModal(false)}>Cancel</Button>
              <Button size="sm" onClick={handleCreate}>Schedule</Button>
            </div>
          </div>
        </div>
      )}
    </PageShell>
  );
}
